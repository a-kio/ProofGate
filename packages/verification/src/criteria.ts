import fg from 'fast-glob'
import {
  normalizeRelative,
  type AcceptanceCriterion,
  type CheckResult,
  type CriterionResult,
  type CriterionStatus,
} from '@proofgate/shared'
import type { ManualSignoff } from './types.js'
import type { OmittedCheck } from './types.js'

export interface CriteriaContext {
  root: string
  criteria: AcceptanceCriterion[]
  checks: CheckResult[]
  omitted: OmittedCheck[]
  signoffs: ManualSignoff[]
  intentHash: string
}

function checkStatusToCriterion(result: CheckResult): { status: CriterionStatus; reason: string } {
  switch (result.status) {
    case 'PASS':
      return { status: 'PASS', reason: `check "${result.id}" passed` }
    case 'FAIL':
      return { status: 'FAIL', reason: `check "${result.id}" failed` }
    case 'SKIPPED':
      return { status: 'SKIPPED', reason: result.skipReason ?? `check "${result.id}" was skipped` }
    case 'ERROR':
      return { status: 'UNKNOWN', reason: `check "${result.id}" could not produce evidence` }
    case 'UNKNOWN':
      return { status: 'UNKNOWN', reason: `check "${result.id}" produced an unknown result` }
    case 'BLOCKED':
      return { status: 'UNKNOWN', reason: `check "${result.id}" was blocked by policy` }
    default:
      return { status: 'UNKNOWN', reason: `check "${result.id}" has no usable result` }
  }
}

async function evaluateArtifacts(pattern: string, root: string): Promise<string[]> {
  return fg(pattern, {
    cwd: root,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: ['.git/**'],
  })
}

export async function evaluateCriteria(context: CriteriaContext): Promise<CriterionResult[]> {
  const byId = new Map(context.checks.map((check) => [check.id, check]))
  const omittedById = new Map(context.omitted.map((entry) => [entry.id, entry]))
  const results: CriterionResult[] = []

  for (const criterion of context.criteria) {
    const base = {
      id: criterion.id,
      description: criterion.description,
      kind: criterion.kind,
      required: criterion.required,
    }

    if (criterion.kind === 'check') {
      const checkId = criterion.check ?? ''
      const result = byId.get(checkId)
      if (result) {
        const mapped = checkStatusToCriterion(result)
        results.push({ ...base, ...mapped, evidence: [`check:${checkId}`, `status:${result.status}`] })
        continue
      }
      const omitted = omittedById.get(checkId)
      results.push({
        ...base,
        status: omitted ? 'SKIPPED' : 'UNKNOWN',
        reason: omitted
          ? `check "${checkId}" was not run (${omitted.detail})`
          : `check "${checkId}" is not part of this verification plan`,
        evidence: omitted ? [`omitted:${omitted.reason}`] : [],
      })
      continue
    }

    if (criterion.kind === 'artifact') {
      const patterns = criterion.artifacts ?? []
      const missing: string[] = []
      const matched: string[] = []
      for (const pattern of patterns) {
        let files: string[] = []
        try {
          files = await evaluateArtifacts(pattern, context.root)
        } catch {
          missing.push(`${pattern} (invalid glob)`)
          continue
        }
        if (files.length === 0) missing.push(pattern)
        else matched.push(...files.slice(0, 20).map(normalizeRelative))
      }
      results.push({
        ...base,
        status: missing.length === 0 ? 'PASS' : 'FAIL',
        reason:
          missing.length === 0
            ? `all ${patterns.length} artifact pattern(s) matched`
            : `missing artifact pattern(s): ${missing.join(', ')}`,
        evidence: [...new Set(matched)].slice(0, 20),
      })
      continue
    }

    const signoff = context.signoffs.find(
      (entry) => entry.criterionId === criterion.id && entry.intentHash === context.intentHash,
    )
    results.push({
      ...base,
      status: signoff ? 'PASS' : 'UNKNOWN',
      reason: signoff
        ? `signed off by ${signoff.signedBy} at ${signoff.signedAt}`
        : `awaiting human sign-off (proofgate criteria signoff ${criterion.id})`,
      evidence: signoff ? [`signoff:${signoff.signedAt}`] : [],
    })
  }

  return results
}
