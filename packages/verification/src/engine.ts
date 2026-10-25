import {
  nowIso,
  summarizeChecks,
  type CheckResult,
  type SkippedCheck,
} from '@proofgate/shared'
import { VerificationCache, type CacheEntry } from './cache.js'
import { evaluateCriteria } from './criteria.js'
import { runCheck, skippedResult } from './evaluator.js'
import { computeCacheKey, computeTreeFingerprint, hashLockfiles, identifyTool, type TreeFingerprint } from './fingerprint.js'
import type { ExecutionOptions, ExecutionResult, PlannedCheck } from './types.js'

function cachedResult(check: PlannedCheck, entry: CacheEntry, key: string): CheckResult {
  const now = nowIso()
  return {
    id: check.id,
    title: check.title,
    type: check.config.type,
    status: 'PASS',
    required: check.config.required,
    profiles: check.config.profiles,
    durationMs: 0,
    startedAt: now,
    finishedAt: now,
    cached: true,
    cacheKey: key,
    ...(entry.result.command ? { command: entry.result.command } : {}),
    ...(entry.result.cwd ? { cwd: entry.result.cwd } : {}),
    ...(entry.result.exitCode !== undefined ? { exitCode: entry.result.exitCode } : {}),
    ...(entry.result.signal !== undefined ? { signal: entry.result.signal } : {}),
    ...(entry.result.timedOut ? { timedOut: entry.result.timedOut } : {}),
    summary: `cached pass (${entry.result.summary || `from ${entry.cachedAt}`})`,
    stdout: entry.result.stdout,
    stderr: entry.result.stderr,
    findings: entry.result.findings,
    ...(entry.result.metrics ? { metrics: entry.result.metrics } : {}),
  }
}

function internalErrorResult(check: PlannedCheck, error: unknown): CheckResult {
  const message = error instanceof Error ? error.message : String(error)
  const now = nowIso()
  return {
    id: check.id,
    title: check.title,
    type: check.config.type,
    status: 'ERROR',
    required: check.config.required,
    profiles: check.config.profiles,
    durationMs: 0,
    startedAt: now,
    finishedAt: now,
    cached: false,
    summary: `ProofGate could not execute this check: ${message}`,
    stdout: { text: '', bytes: 0, totalBytes: 0, truncated: false },
    stderr: { text: message, bytes: Buffer.byteLength(message), totalBytes: Buffer.byteLength(message), truncated: false },
    findings: [],
    errorMessage: message,
  }
}

function plannedSkipped(check: PlannedCheck, detail: string): CheckResult {
  return skippedResult(check.config, detail, detail)
}

export async function executePlan(options: ExecutionOptions): Promise<ExecutionResult> {
  const { plan, config } = options
  const notes: string[] = [...plan.notes]
  const skippedChecks: SkippedCheck[] = plan.omitted.map((entry) => ({
    id: entry.id,
    title: entry.title,
    reason: entry.reason,
    detail: entry.detail,
  }))

  const effectiveCacheEnabled = config.cache.enabled && !options.noCache && plan.checks.length > 0
  let hits = 0
  let misses = 0

  const finish = async (checks: CheckResult[], extraNotes: string[] = []): Promise<ExecutionResult> => {
    const criteria = await evaluateCriteria({
      root: plan.root,
      criteria: options.criteria,
      checks,
      omitted: plan.omitted,
      signoffs: options.signoffs ?? [],
      intentHash: plan.intentHash,
    })
    return {
      checks,
      skippedChecks,
      criteria,
      summary: summarizeChecks(checks),
      cache: { enabled: effectiveCacheEnabled, hits, misses },
      notes: [...notes, ...extraNotes],
    }
  }

  if (!plan.acceptanceApproved) {
    const checks = plan.checks.map((check) =>
      plannedSkipped(check, plan.acceptanceReason ?? 'Acceptance criteria are not approved'),
    )
    skippedChecks.push(
      ...plan.checks.map((check) => ({
        id: check.id,
        title: check.title,
        reason: 'guard' as const,
        detail: 'verification did not run because acceptance criteria are not approved',
      })),
    )
    return finish(checks, ['Execution was blocked before any check ran: acceptance criteria are not approved.'])
  }

  if (plan.guard.blocked) {
    const checks = plan.checks.map((check) => plannedSkipped(check, plan.guard.reason ?? 'Blocked by guard policy'))
    skippedChecks.push(
      ...plan.checks.map((check) => ({
        id: check.id,
        title: check.title,
        reason: 'guard' as const,
        detail: plan.guard.reason ?? 'blocked by guard policy',
      })),
    )
    return finish(checks, ['Execution was blocked before any check ran by a change guard.'])
  }

  if (plan.checks.length === 0) {
    skippedChecks.push(
      ...plan.omitted.map((entry) => ({ id: entry.id, title: entry.title, reason: entry.reason, detail: entry.detail })),
    )
    return finish([], ['No checks were selected. Nothing was proven.'])
  }

  let cache: VerificationCache | null = null
  let tree: TreeFingerprint = { available: false, value: '', files: 0, reason: 'cache disabled' }
  let lockfilesHash = ''

  if (effectiveCacheEnabled) {
    const loaded = await VerificationCache.load(options.cacheDir, {
      maxEntries: config.cache.maxEntries,
      maxAgeDays: config.cache.maxAgeDays,
    })
    cache = loaded.cache
    notes.push(...loaded.warnings)
    tree = await computeTreeFingerprint(plan.root, plan.changed)
    if (!tree.available) notes.push(`Cache is ineffective for this workspace: ${tree.reason ?? 'no tree fingerprint'}.`)
    else lockfilesHash = await hashLockfiles(plan.root)
  }

  const results = new Map<string, CheckResult>()
  const running = new Map<string, Promise<void>>()
  const limit = Math.max(1, config.limits.maxParallelChecks)

  const addDependencySkip = (check: PlannedCheck, detail: string): void => {
    const result = plannedSkipped(check, detail)
    results.set(check.id, result)
    skippedChecks.push({ id: check.id, title: check.title, reason: 'dependency-failed', detail })
  }

  const skipRemaining = (detail: string, reason: SkippedCheck['reason']): void => {
    for (const check of plan.checks) {
      if (results.has(check.id)) continue
      results.set(check.id, plannedSkipped(check, detail))
      skippedChecks.push({ id: check.id, title: check.title, reason, detail })
    }
  }

  if (options.signal?.aborted) {
    skipRemaining('verification was canceled before this check started', 'disabled')
    return finish([...results.values()], ['Verification was canceled before completion.'])
  }

  const executeOne = async (check: PlannedCheck): Promise<CheckResult> => {
    options.hooks?.onCheckStart?.(check)
    let cacheKey: string | undefined
    const cacheable =
      cache !== null &&
      tree.available &&
      check.config.type === 'command' &&
      check.config.cache &&
      check.config.run.length > 0

    if (cacheable && check.config.type === 'command' && cache) {
      try {
        const tool = await identifyTool(check.config.run[0]!, plan.root)
        cacheKey = computeCacheKey({
          check: check.config,
          profile: plan.profile,
          intentHash: plan.intentHash,
          configHash: options.configHash,
          tree,
          tool,
          lockfilesHash,
          root: plan.root,
          ...(check.config.env ? { env: check.config.env } : {}),
        })
        const hit = cache.get(cacheKey)
        if (hit) {
          hits += 1
          return cachedResult(check, hit, cacheKey)
        }
        misses += 1
      } catch {
        cacheKey = undefined
      }
    }

    const ctx = {
      root: plan.root,
      mode: plan.mode,
      changedFiles: plan.changed.files.map((file) => file.path),
      ...(options.signal ? { signal: options.signal } : {}),
      maxOutputBytes: config.limits.maxOutputBytes,
      defaultTimeoutSeconds: config.limits.timeoutSeconds,
      ignoreGlobs: config.verification.ignorePaths,
    }
    let result: CheckResult
    try {
      result = await runCheck(check.config, ctx)
    } catch (error) {
      result = internalErrorResult(check, error)
    }

    if (cache && cacheKey && result.status === 'PASS') {
      cache.set(cacheKey, check.id, {
        summary: result.summary,
        ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
        ...(result.signal !== undefined ? { signal: result.signal } : {}),
        ...(result.timedOut ? { timedOut: result.timedOut } : {}),
        stdout: result.stdout,
        stderr: result.stderr,
        findings: result.findings,
        ...(result.metrics ? { metrics: result.metrics } : {}),
        ...(result.command ? { command: result.command } : {}),
        ...(result.cwd ? { cwd: result.cwd } : {}),
        durationMs: result.durationMs,
      })
    }
    return result
  }

  const launch = (check: PlannedCheck): void => {
    const promise = executeOne(check)
      .then((result) => {
        results.set(check.id, result)
        options.hooks?.onCheckFinish?.(result)
      })
      .catch((error: unknown) => {
        const result = internalErrorResult(check, error)
        results.set(check.id, result)
        options.hooks?.onCheckFinish?.(result)
      })
      .finally(() => {
        running.delete(check.id)
      })
    running.set(check.id, promise)
  }

  while (results.size < plan.checks.length) {
    if (options.signal?.aborted) {
      skipRemaining('verification was canceled before this check started', 'disabled')
      notes.push('Verification was canceled before completion.')
      break
    }

    for (const check of plan.checks) {
      if (results.has(check.id) || running.has(check.id)) continue
      const dependenciesReady = check.dependencies.every((id) => results.has(id))
      if (!dependenciesReady) continue
      const failedDependency = check.dependencies.find((id) => results.get(id)?.status !== 'PASS')
      if (failedDependency) {
        addDependencySkip(check, `dependency "${failedDependency}" did not pass`)
      }
    }

    while (running.size < limit) {
      const candidate = plan.checks.find(
        (check) =>
          !results.has(check.id) &&
          !running.has(check.id) &&
          check.dependencies.every((id) => results.get(id)?.status === 'PASS'),
      )
      if (!candidate) break
      launch(candidate)
    }

    if (running.size === 0) {
      const remaining = plan.checks.filter((check) => !results.has(check.id))
      if (remaining.length > 0) {
        for (const check of remaining) {
          addDependencySkip(check, 'dependency graph could not be satisfied')
        }
      }
      break
    }

    await Promise.race([...running.values()])
  }

  const checks = plan.checks.map((check) => results.get(check.id)).filter((result): result is CheckResult => Boolean(result))

  if (cache) {
    const saved = await cache.save()
    if (saved.error) notes.push(`Could not save the verification cache: ${saved.error}`)
  }

  if (checks.some((check) => check.cached)) {
    notes.push('Some passing checks were reused from cache; their evidence is the cached output from an identical intent and tree state.')
  }

  return finish(checks)
}
