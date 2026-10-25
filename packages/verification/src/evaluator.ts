import fsp from 'node:fs/promises'
import path from 'node:path'
import fg from 'fast-glob'
import {
  makeChunk,
  nowIso,
  safeJoin,
  type CheckResult,
  type CheckStatus,
  type Finding,
  type VerificationMode,
} from '@proofgate/shared'
import { runCommand } from '@proofgate/executor'
import type { CheckConfig, CommandCheckConfig, FilesCheckConfig, HttpCheckConfig, SecretScanCheckConfig } from '@proofgate/config'
import { parseCommandOutput } from './parsers.js'
import { scanForSecrets } from './secret-scan.js'

export interface CheckRunContext {
  root: string
  mode: VerificationMode
  changedFiles: string[]
  signal?: AbortSignal
  maxOutputBytes: number
  defaultTimeoutSeconds: number
  ignoreGlobs: string[]
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host.endsWith('.localhost')
}

function baseResult(check: CheckConfig, startedAt: string, startedMs: number): CheckResult {
  return {
    id: check.id,
    title: check.title ?? check.id,
    type: check.type,
    status: 'ERROR',
    required: check.required,
    profiles: check.profiles,
    durationMs: Date.now() - startedMs,
    startedAt,
    finishedAt: nowIso(),
    cached: false,
    summary: '',
    stdout: makeChunk('', 0),
    stderr: makeChunk('', 0),
    findings: [],
  }
}

function finish(result: CheckResult, startedMs: number, patch: Partial<CheckResult>): CheckResult {
  return {
    ...result,
    ...patch,
    durationMs: Date.now() - startedMs,
    finishedAt: nowIso(),
  }
}

function expectationFailure(message: string): Finding {
  return { kind: 'runtime-error', message }
}

async function runCommandCheck(
  check: CommandCheckConfig,
  ctx: CheckRunContext,
  startedAt: string,
  startedMs: number,
): Promise<CheckResult> {
  const base = baseResult(check, startedAt, startedMs)
  const cwd = check.cwd ? safeJoin(ctx.root, check.cwd) : ctx.root
  const timeoutMs = (check.timeoutSeconds ?? ctx.defaultTimeoutSeconds) * 1000
  const result = await runCommand({
    argv: check.run,
    cwd,
    ...(check.env ? { env: check.env } : {}),
    timeoutMs,
    maxOutputBytes: ctx.maxOutputBytes,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  })

  if (result.failedToStart) {
    return finish(base, startedMs, {
      status: 'ERROR',
      summary: `Could not start "${check.run[0]}": ${result.spawnError ?? 'unknown error'}`,
      stdout: result.stdout,
      stderr: result.stderr,
      command: check.run,
      cwd,
      errorMessage: result.spawnError,
      findings: [expectationFailure(result.spawnError ?? `Command not found: ${check.run[0]}`)],
    })
  }
  if (result.timedOut) {
    return finish(base, startedMs, {
      status: 'ERROR',
      summary: `Timed out after ${Math.round(result.durationMs / 1000)}s`,
      stdout: result.stdout,
      stderr: result.stderr,
      command: check.run,
      cwd,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: true,
      errorMessage: `Command exceeded its ${timeoutMs / 1000}s timeout`,
      findings: [expectationFailure(`Timed out after ${timeoutMs / 1000}s`)],
    })
  }
  if (result.canceled) {
    return finish(base, startedMs, {
      status: 'ERROR',
      summary: 'Execution was canceled',
      stdout: result.stdout,
      stderr: result.stderr,
      command: check.run,
      cwd,
      exitCode: result.exitCode,
      errorMessage: 'Canceled by signal',
    })
  }

  const parsed = parseCommandOutput(result.stdout.text, result.stderr.text, result.exitCode)
  const findings = [...parsed.findings]
  const expectedExitCodes = check.expectExitCode
  const exitOk = result.exitCode !== null && expectedExitCodes.includes(result.exitCode)
  if (!exitOk) {
    findings.unshift(
      expectationFailure(
        `Expected exit code ${expectedExitCodes.join(' or ')}, got ${result.exitCode ?? `signal ${result.signal ?? 'unknown'}`}`,
      ),
    )
  }
  let stdoutOk = true
  if (check.expectStdout) {
    try {
      stdoutOk = new RegExp(check.expectStdout).test(result.stdout.text)
      if (!stdoutOk) findings.push(expectationFailure(`stdout did not match /${check.expectStdout}/`))
    } catch {
      stdoutOk = false
      findings.push(expectationFailure('expectStdout is not a valid regular expression'))
    }
  }
  let stderrOk = true
  if (check.expectStderr) {
    try {
      stderrOk = new RegExp(check.expectStderr).test(result.stderr.text)
      if (!stderrOk) findings.push(expectationFailure(`stderr did not match /${check.expectStderr}/`))
    } catch {
      stderrOk = false
      findings.push(expectationFailure('expectStderr is not a valid regular expression'))
    }
  }

  const status: CheckStatus = exitOk && stdoutOk && stderrOk ? 'PASS' : 'FAIL'
  const metricText = parsed.metrics
    ? [
        parsed.metrics.testsFailed ? `${parsed.metrics.testsFailed} failed` : '',
        typeof parsed.metrics.testsPassed === 'number' ? `${parsed.metrics.testsPassed} passed` : '',
        parsed.metrics.testsSkipped ? `${parsed.metrics.testsSkipped} skipped` : '',
      ]
        .filter(Boolean)
        .join(', ')
    : ''
  const summary =
    status === 'PASS'
      ? metricText || `exit ${result.exitCode ?? 0}`
      : `${metricText ? `${metricText}; ` : ''}exit ${result.exitCode ?? 'null'}`

  return finish(base, startedMs, {
    status,
    summary,
    stdout: result.stdout,
    stderr: result.stderr,
    findings,
    ...(parsed.metrics ? { metrics: parsed.metrics } : {}),
    command: check.run,
    cwd,
    exitCode: result.exitCode,
    signal: result.signal,
  })
}

async function readResponseBody(response: Response, maxBytes: number): Promise<{ text: string; total: number; truncated: boolean }> {
  if (!response.body) return { text: '', total: 0, truncated: false }
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (chunks.reduce((sum, chunk) => sum + chunk.length, 0) < maxBytes) {
        chunks.push(Buffer.from(value))
      } else {
        truncated = true
      }
    }
  } finally {
    reader.releaseLock()
  }
  let combined = Buffer.concat(chunks).toString('utf8')
  if (Buffer.byteLength(combined, 'utf8') > maxBytes) {
    combined = Buffer.from(combined, 'utf8').subarray(0, maxBytes).toString('utf8')
    truncated = true
  }
  return { text: combined, total, truncated }
}

async function runHttpCheck(
  check: HttpCheckConfig,
  ctx: CheckRunContext,
  startedAt: string,
  startedMs: number,
): Promise<CheckResult> {
  const base = baseResult(check, startedAt, startedMs)
  let url: URL
  try {
    url = new URL(check.url)
  } catch {
    return finish(base, startedMs, { status: 'ERROR', summary: `Invalid URL: ${check.url}`, errorMessage: 'Invalid URL' })
  }
  if (!check.allowRemote && !isLoopbackHost(url.hostname)) {
    return finish(base, startedMs, {
      status: 'ERROR',
      summary: `Refusing non-loopback URL ${url.origin} without allowRemote: true`,
      errorMessage: 'Remote HTTP checks are disabled by default',
    })
  }
  const timeoutMs = (check.timeoutSeconds ?? Math.min(ctx.defaultTimeoutSeconds, 120)) * 1000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = (): void => controller.abort()
  ctx.signal?.addEventListener('abort', onAbort, { once: true })
  const started = Date.now()
  try {
    const response = await fetch(url, {
      method: check.method,
      headers: check.headers,
      ...(check.body && check.method !== 'HEAD' ? { body: check.body } : {}),
      signal: controller.signal,
      redirect: 'manual',
    })
    const body = check.method === 'HEAD' ? { text: '', total: 0, truncated: false } : await readResponseBody(response, ctx.maxOutputBytes)
    const findings: Finding[] = []
    const statusOk = check.expectStatus.includes(response.status)
    if (!statusOk) {
      findings.push(expectationFailure(`Expected HTTP ${check.expectStatus.join(' or ')}, got ${response.status}`))
    }
    for (const expected of check.expectBodyContains ?? []) {
      if (!body.text.includes(expected)) findings.push(expectationFailure(`Response body did not contain ${JSON.stringify(expected)}`))
    }
    const status: CheckStatus = statusOk && findings.length === 0 ? 'PASS' : 'FAIL'
    const headerText = [...response.headers.entries()].map(([key, value]) => `${key}: ${value}`).join('\n')
    const output = makeChunk(
      `${check.method} ${check.url}\nHTTP ${response.status} ${response.statusText}\n${headerText}\n\n${body.text}`,
      ctx.maxOutputBytes,
    )
    return finish(base, startedMs, {
      status,
      summary: `HTTP ${response.status} in ${Date.now() - started}ms${findings.length ? `; ${findings.length} expectation(s) failed` : ''}`,
      stdout: output,
      stderr: makeChunk('', 0),
      findings,
      metrics: {},
    })
  } catch (error) {
    const aborted = controller.signal.aborted && !ctx.signal?.aborted
    const message = error instanceof Error ? error.message : String(error)
    return finish(base, startedMs, {
      status: 'ERROR',
      summary: aborted ? `Request timed out after ${Math.round(timeoutMs / 1000)}s` : `Request failed: ${message}`,
      stdout: makeChunk('', 0),
      stderr: makeChunk(message, ctx.maxOutputBytes),
      errorMessage: message,
      timedOut: aborted,
      findings: [expectationFailure(aborted ? 'HTTP check timed out' : `HTTP request failed: ${message}`)],
    })
  } finally {
    clearTimeout(timer)
    ctx.signal?.removeEventListener('abort', onAbort)
  }
}

async function runFilesCheck(
  check: FilesCheckConfig,
  ctx: CheckRunContext,
  startedAt: string,
  startedMs: number,
): Promise<CheckResult> {
  const base = baseResult(check, startedAt, startedMs)
  const findings: Finding[] = []
  const artifacts: string[] = []
  let matched = 0
  try {
    for (const expectation of check.files) {
      const matches = await fg(expectation.pattern, {
        cwd: ctx.root,
        dot: true,
        onlyFiles: true,
        followSymbolicLinks: false,
        ignore: ['.git/**', 'node_modules/**'],
      })
      if (expectation.mustNotExist) {
        if (matches.length > 0) {
          findings.push({
            kind: 'runtime-error',
            message: `Path must not exist but matched ${matches.length} file(s): ${expectation.pattern}`,
            file: matches[0],
          })
        }
        continue
      }
      if (matches.length === 0) {
        findings.push({ kind: 'runtime-error', message: `No files matched: ${expectation.pattern}` })
        continue
      }
      let satisfied: string | undefined
      for (const file of matches.slice(0, 200)) {
        try {
          const stat = await fsp.stat(path.join(ctx.root, file))
          if (!stat.isFile()) continue
          if (expectation.minBytes !== undefined && stat.size < expectation.minBytes) continue
          if (expectation.maxBytes !== undefined && stat.size > expectation.maxBytes) continue
          satisfied = file
          break
        } catch {
          continue
        }
      }
      if (!satisfied) {
        const range = [
          expectation.minBytes !== undefined ? `min ${expectation.minBytes}B` : '',
          expectation.maxBytes !== undefined ? `max ${expectation.maxBytes}B` : '',
        ]
          .filter(Boolean)
          .join(', ')
        findings.push({
          kind: 'runtime-error',
          message: `Matched ${matches.length} file(s) for ${expectation.pattern}, but none satisfied ${range || 'the size constraint'}`,
        })
        continue
      }
      matched += matches.length
      artifacts.push(...matches.slice(0, 50))
    }
    const uniqueArtifacts = [...new Set(artifacts)].slice(0, 50)
    const status: CheckStatus = findings.length === 0 ? 'PASS' : 'FAIL'
    return finish(base, startedMs, {
      status,
      summary:
        status === 'PASS'
          ? `${check.files.length} file expectation(s) satisfied`
          : `${findings.length} file expectation(s) failed`,
      stdout: makeChunk(
        status === 'PASS'
          ? `Matched:\n${uniqueArtifacts.map((file) => `  ${file}`).join('\n')}`
          : findings.map((finding) => finding.message).join('\n'),
        ctx.maxOutputBytes,
      ),
      stderr: makeChunk('', 0),
      findings,
      artifacts: uniqueArtifacts,
      metrics: { artifactsMatched: matched },
    })
  } catch (error) {
    return finish(base, startedMs, {
      status: 'ERROR',
      summary: `Artifact check failed: ${error instanceof Error ? error.message : String(error)}`,
      errorMessage: error instanceof Error ? error.message : String(error),
      findings,
    })
  }
}

async function runSecretScanCheck(
  check: SecretScanCheckConfig,
  ctx: CheckRunContext,
  startedAt: string,
  startedMs: number,
): Promise<CheckResult> {
  const base = baseResult(check, startedAt, startedMs)
  try {
    const result = await scanForSecrets({
      root: ctx.root,
      check,
      ...(ctx.mode === 'changed' ? { changedPaths: ctx.changedFiles } : {}),
      ignoreGlobs: ctx.ignoreGlobs,
    })
    if (result.filesScanned === 0) {
      return finish(base, startedMs, {
        status: 'SKIPPED',
        skipReason: 'No scannable files matched this secret scan',
        summary: 'No files scanned',
        stdout: makeChunk('', 0),
        stderr: makeChunk('', 0),
        metrics: { filesScanned: 0 },
      })
    }
    const status: CheckStatus = result.findings.length > 0 ? 'FAIL' : 'PASS'
    return finish(base, startedMs, {
      status,
      summary:
        status === 'PASS'
          ? `No secrets found in ${result.filesScanned} file(s)`
          : `${result.findings.length} potential secret(s) in ${result.filesScanned} file(s)`,
      stdout: makeChunk(
        result.findings
          .map((finding) => `${finding.file ?? '?'}:${finding.line ?? '?'}  ${finding.message}`)
          .join('\n'),
        ctx.maxOutputBytes,
      ),
      stderr: makeChunk('', 0),
      findings: result.findings,
      metrics: { filesScanned: result.filesScanned },
    })
  } catch (error) {
    return finish(base, startedMs, {
      status: 'ERROR',
      summary: `Secret scan failed: ${error instanceof Error ? error.message : String(error)}`,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function runCheck(check: CheckConfig, ctx: CheckRunContext): Promise<CheckResult> {
  const startedAt = nowIso()
  const startedMs = Date.now()
  switch (check.type) {
    case 'command':
      return runCommandCheck(check, ctx, startedAt, startedMs)
    case 'http':
      return runHttpCheck(check, ctx, startedAt, startedMs)
    case 'files':
      return runFilesCheck(check, ctx, startedAt, startedMs)
    case 'secret-scan':
      return runSecretScanCheck(check, ctx, startedAt, startedMs)
    default: {
      const exhaustive: never = check
      return finish(baseResult(check, startedAt, startedMs), startedMs, {
        status: 'ERROR',
        summary: `Unsupported check type: ${String((exhaustive as { type?: string }).type)}`,
      })
    }
  }
}

export function skippedResult(check: CheckConfig, reason: string, skipReason: string): CheckResult {
  const now = nowIso()
  return {
    ...baseResult(check, now, Date.now()),
    status: 'SKIPPED',
    skipReason,
    summary: reason,
    finishedAt: now,
    durationMs: 0,
  }
}
