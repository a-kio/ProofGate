import type {
  CheckResult,
  CheckStatus,
  CriterionResult,
  CriterionStatus,
  OverallStatus,
  RunSummaryCounts,
} from './types.js'

/** Statuses that mean a required check did not demonstrate success. */
const NON_SUCCESS = new Set<CheckStatus>(['FAIL', 'UNKNOWN', 'BLOCKED', 'ERROR'])
const OPTIONAL_SOFT_FAILURES = new Set<CheckStatus>(['UNKNOWN', 'BLOCKED', 'ERROR'])

export function isCheckSuccess(status: CheckStatus): boolean {
  return status === 'PASS' || status === 'SKIPPED'
}

export function isBlockingStatus(status: CheckStatus): boolean {
  return NON_SUCCESS.has(status)
}

export function summarizeChecks(checks: CheckResult[]): RunSummaryCounts {
  const counts: RunSummaryCounts = {
    total: checks.length,
    passed: 0,
    failed: 0,
    unknown: 0,
    skipped: 0,
    blocked: 0,
    error: 0,
    requiredTotal: 0,
    requiredPassed: 0,
    requiredFailed: 0,
  }
  for (const check of checks) {
    switch (check.status) {
      case 'PASS':
        counts.passed += 1
        break
      case 'FAIL':
        counts.failed += 1
        break
      case 'UNKNOWN':
        counts.unknown += 1
        break
      case 'SKIPPED':
        counts.skipped += 1
        break
      case 'BLOCKED':
        counts.blocked += 1
        break
      case 'ERROR':
        counts.error += 1
        break
    }
    if (check.required) {
      counts.requiredTotal += 1
      if (check.status === 'PASS') counts.requiredPassed += 1
      if (isBlockingStatus(check.status)) counts.requiredFailed += 1
    }
  }
  return counts
}

/**
 * Derive the only honest overall status from check and criterion results.
 *
 * - UNVERIFIABLE: the approval intent changed, no checks ran, or a required
 *   check was blocked by policy. ProofGate cannot claim anything.
 * - FAILED: a required check failed, or a required criterion is unsatisfied.
 * - INCOMPLETE: everything that ran passed, but evidence is missing (optional
 *   failures, unknown/skipped required checks, pending manual sign-off).
 * - VERIFIED: every required check passed and every required criterion passed.
 */
export function deriveOverallStatus(input: {
  checks: CheckResult[]
  criteria: CriterionResult[]
  acceptanceApproved: boolean
  blockedByPolicy?: boolean
  /** Policy for failing optional checks. `block` (default) makes the run INCOMPLETE; `warn` does not. */
  optionalFailures?: 'block' | 'warn'
}): OverallStatus {
  const { checks, criteria, acceptanceApproved, blockedByPolicy, optionalFailures = 'block' } = input

  if (!acceptanceApproved || blockedByPolicy) return 'UNVERIFIABLE'
  if (checks.length === 0) return 'UNVERIFIABLE'

  const required = checks.filter((c) => c.required)
  if (required.some((c) => c.status === 'FAIL')) return 'FAILED'

  // An infrastructure error on a required check means ProofGate could not
  // produce evidence either way. That is unverifiable, not a failed test.
  if (required.some((c) => c.status === 'BLOCKED' || c.status === 'ERROR')) return 'UNVERIFIABLE'

  const requiredCriteria = criteria.filter((c) => c.required)
  if (requiredCriteria.some((c) => c.status === 'FAIL')) return 'FAILED'

  const optionalBlocking =
    optionalFailures === 'block' && checks.some((c) => !c.required && c.status !== 'PASS' && c.status !== 'SKIPPED')

  const softIncomplete =
    required.some((c) => c.status === 'UNKNOWN' || c.status === 'SKIPPED') ||
    requiredCriteria.some((c) => c.status !== 'PASS') ||
    optionalBlocking

  return softIncomplete ? 'INCOMPLETE' : 'VERIFIED'
}

export function isVerified(status: OverallStatus): boolean {
  return status === 'VERIFIED'
}

export function statusGlyph(status: CheckStatus | CriterionStatus | OverallStatus): string {
  switch (status) {
    case 'PASS':
    case 'VERIFIED':
      return '✔'
    case 'FAIL':
    case 'FAILED':
      return '✖'
    case 'UNKNOWN':
      return '?'
    case 'SKIPPED':
      return '–'
    case 'BLOCKED':
      return '■'
    case 'ERROR':
      return '!'
    case 'INCOMPLETE':
      return '◐'
    case 'UNVERIFIABLE':
      return '⊘'
    default:
      return '·'
  }
}

export function statusLabel(status: CheckStatus | OverallStatus): string {
  switch (status) {
    case 'PASS':
      return 'passed'
    case 'FAIL':
      return 'failed'
    case 'UNKNOWN':
      return 'unknown'
    case 'SKIPPED':
      return 'skipped'
    case 'BLOCKED':
      return 'blocked'
    case 'ERROR':
      return 'errored'
    case 'VERIFIED':
      return 'verified'
    case 'FAILED':
      return 'failed'
    case 'INCOMPLETE':
      return 'incomplete'
    case 'UNVERIFIABLE':
      return 'unverifiable'
    default:
      return String(status).toLowerCase()
  }
}

export function overallFromExit(status: OverallStatus): number {
  switch (status) {
    case 'VERIFIED':
      return 0
    case 'FAILED':
      return 1
    case 'INCOMPLETE':
      return 2
    case 'UNVERIFIABLE':
      return 3
    default:
      return 4
  }
}

export function severityRank(status: CheckStatus): number {
  switch (status) {
    case 'BLOCKED':
      return 0
    case 'FAIL':
      return 1
    case 'ERROR':
      return 2
    case 'UNKNOWN':
      return 3
    case 'SKIPPED':
      return 4
    case 'PASS':
      return 5
    default:
      return 6
  }
}

export function hasOptionalFailures(checks: CheckResult[]): boolean {
  return checks.some((c) => !c.required && (c.status === 'FAIL' || c.status === 'ERROR'))
}

export { OPTIONAL_SOFT_FAILURES }
