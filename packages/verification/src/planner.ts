import { ProofGateError } from '@proofgate/shared'
import type { CheckConfig } from '@proofgate/config'
import { anyChangedMatches, matchesAny } from './matcher.js'
import type { OmittedCheck, PlanOptions, PlannedCheck, VerificationPlan } from './types.js'

function titleOf(check: CheckConfig): string {
  return check.title ?? check.id
}

function findDependencyPath(
  start: string,
  target: string,
  byId: Map<string, CheckConfig>,
  seen = new Set<string>(),
): string[] | null {
  if (start === target) return [start]
  if (seen.has(start)) return null
  seen.add(start)
  const check = byId.get(start)
  if (!check) return null
  for (const dependency of check.dependsOn ?? []) {
    const path = findDependencyPath(dependency, target, byId, seen)
    if (path) return [start, ...path]
  }
  return null
}

function orderByDependencies(selected: PlannedCheck[]): PlannedCheck[] {
  const selectedIds = new Set(selected.map((check) => check.id))
  const ordered: PlannedCheck[] = []
  const state = new Map<string, 'visiting' | 'done'>()

  const visit = (check: PlannedCheck, stack: string[]): void => {
    const current = state.get(check.id)
    if (current === 'done') return
    if (current === 'visiting') {
      const cycleStart = stack.indexOf(check.id)
      const cycle = [...stack.slice(cycleStart), check.id].join(' → ')
      throw new ProofGateError('CONFIG_INVALID', `Dependency cycle detected: ${cycle}`, {
        hint: 'Remove one of the dependsOn edges in .proofgate/config.yaml.',
      })
    }
    state.set(check.id, 'visiting')
    for (const dependencyId of check.dependencies) {
      if (!selectedIds.has(dependencyId)) continue
      const dependency = selected.find((candidate) => candidate.id === dependencyId)
      if (dependency) visit(dependency, [...stack, check.id])
    }
    state.set(check.id, 'done')
    ordered.push(check)
  }

  for (const check of selected) visit(check, [])
  return ordered
}

export function createPlan(options: PlanOptions): VerificationPlan {
  const { config, changed, mode, profile } = options
  const byId = new Map(config.checks.map((check) => [check.id, check]))
  const notes: string[] = []

  const omitted: OmittedCheck[] = []
  const selected = new Map<string, PlannedCheck>()
  const omittedById = new Map<string, OmittedCheck>()

  const addOmitted = (check: CheckConfig, reason: OmittedCheck['reason'], detail: string): void => {
    if (omittedById.has(check.id)) return
    const entry: OmittedCheck = { id: check.id, title: titleOf(check), reason, detail }
    omitted.push(entry)
    omittedById.set(check.id, entry)
  }

  for (const check of config.checks) {
    if (!check.profiles.includes(profile)) {
      addOmitted(check, 'profile', `not part of the "${profile}" profile`)
      continue
    }
    if (mode === 'changed' && check.appliesTo && changed.files.length > 0 && !anyChangedMatches(changed.files, check.appliesTo)) {
      addOmitted(check, 'not-applicable', 'no changed file matches appliesTo')
      continue
    }
    selected.set(check.id, {
      config: check,
      id: check.id,
      title: titleOf(check),
      dependencies: [...(check.dependsOn ?? [])],
    })
  }

  // Pull in dependencies that were skipped only because no changed file matched.
  let changedSelection = true
  while (changedSelection) {
    changedSelection = false
    for (const check of [...selected.values()]) {
      for (const dependencyId of check.dependencies) {
        if (selected.has(dependencyId)) continue
        const dependency = byId.get(dependencyId)
        if (!dependency) {
          throw new ProofGateError('CONFIG_INVALID', `Check "${check.id}" depends on unknown check "${dependencyId}"`)
        }
        if (!dependency.profiles.includes(profile)) {
          selected.delete(check.id)
          addOmitted(check.config, 'profile', `depends on "${dependency.id}", which is not part of the "${profile}" profile`)
          changedSelection = true
          break
        }
        const priorOmission = omittedById.get(dependencyId)
        if (priorOmission?.reason === 'not-applicable') {
          const index = omitted.findIndex((entry) => entry.id === dependencyId)
          if (index >= 0) omitted.splice(index, 1)
          omittedById.delete(dependencyId)
          selected.set(dependencyId, {
            config: dependency,
            id: dependency.id,
            title: titleOf(dependency),
            dependencies: [...(dependency.dependsOn ?? [])],
          })
          changedSelection = true
          notes.push(`Included "${dependencyId}" because "${check.id}" depends on it.`)
        } else if (!selected.has(dependencyId)) {
          selected.delete(check.id)
          addOmitted(check.config, 'profile', `depends on "${dependencyId}", which is not selected`)
          changedSelection = true
          break
        }
      }
    }
  }

  const ordered = orderByDependencies([...selected.values()])

  if (ordered.length === 0) {
    notes.push('No checks are selected for this profile and change set. Verification cannot produce VERIFIED.')
  }
  if (mode === 'changed' && changed.files.length === 0) {
    notes.push('No changed files were detected. Use --full for a whole-project run, or --base <ref> to verify committed work.')
  }

  const guard = evaluateGuards(config.guards, changed)
  if (guard.blocked && guard.reason) notes.push(guard.reason)
  if (options.acceptanceReason && !options.acceptanceApproved) notes.push(options.acceptanceReason)

  return {
    mode,
    profile,
    root: options.root,
    ...(options.task ? { task: options.task } : {}),
    checks: ordered,
    omitted,
    changed,
    intentHash: options.intentHash,
    acceptanceApproved: options.acceptanceApproved,
    ...(options.acceptanceReason ? { acceptanceReason: options.acceptanceReason } : {}),
    guard,
    notes,
  }
}

function evaluateGuards(
  guards: { forbiddenPaths: string[]; maxChangedFiles?: number },
  changed: { files: Array<{ path: string }>; truncated: boolean },
): VerificationPlan['guard'] {
  if (guards.maxChangedFiles && changed.files.length > guards.maxChangedFiles) {
    return {
      blocked: true,
      reason: `Guard: ${changed.files.length} changed files exceeds maxChangedFiles=${guards.maxChangedFiles}. Split the change or adjust guards.`,
      matchedPaths: [],
    }
  }
  if (guards.forbiddenPaths.length > 0) {
    const matched = changed.files
      .filter((file) => matchesAny(file.path, guards.forbiddenPaths))
      .map((file) => file.path)
    if (matched.length > 0) {
      return {
        blocked: true,
        reason: `Guard: changed files match forbiddenPaths: ${matched.slice(0, 5).join(', ')}${matched.length > 5 ? ` (+${matched.length - 5} more)` : ''}`,
        matchedPaths: matched,
      }
    }
  }
  return { blocked: false, matchedPaths: [] }
}

/** Find a dependency cycle even when both checks are in different profiles. */
export function assertNoDependencyCycles(checks: CheckConfig[]): void {
  const byId = new Map(checks.map((check) => [check.id, check]))
  for (const check of checks) {
    for (const dependency of check.dependsOn ?? []) {
      if (dependency === check.id) {
        throw new ProofGateError('CONFIG_INVALID', `Check "${check.id}" depends on itself`)
      }
      const path = findDependencyPath(dependency, check.id, byId)
      if (path) {
        const cycle = [check.id, ...path].join(' → ')
        throw new ProofGateError('CONFIG_INVALID', `Dependency cycle detected: ${cycle}`)
      }
    }
  }
}
