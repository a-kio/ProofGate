/**
 * ProofGate result statuses.
 *
 * Semantics are contractual — see docs/reference/statuses.md:
 * - PASS    the configured condition was actually checked and satisfied.
 * - FAIL    the condition was checked and did not hold.
 * - UNKNOWN available evidence is insufficient to determine the result.
 * - SKIPPED the check was intentionally not executed.
 * - BLOCKED the check could not proceed because a required dependency was unavailable.
 * - ERROR   the verification infrastructure itself hit an execution or configuration error.
 */
export const CHECK_STATUSES = ['PASS', 'FAIL', 'UNKNOWN', 'SKIPPED', 'BLOCKED', 'ERROR'] as const
export type CheckStatus = (typeof CHECK_STATUSES)[number]

/** Overall task status. VERIFIED requires every required criterion to actually have passed. */
export const TASK_STATUSES = ['VERIFIED', 'FAILED', 'INCOMPLETE', 'UNVERIFIABLE'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const VERIFICATION_PROFILES = ['fast', 'balanced', 'thorough'] as const
export type VerificationProfile = (typeof VERIFICATION_PROFILES)[number]

export const TRIGGERS = ['manual', 'agent', 'hook', 'ci', 'mcp'] as const
export type TriggerKind = (typeof TRIGGERS)[number]

export const CHECK_STATUSES_SET: ReadonlySet<string> = new Set(CHECK_STATUSES)
export const TASK_STATUSES_SET: ReadonlySet<string> = new Set(TASK_STATUSES)

/** CLI exit codes (documented in README + docs/reference/exit-codes.md). */
export const EXIT_CODES = {
  VERIFIED: 0,
  FAILED: 1,
  ERROR: 2,
  INCOMPLETE: 3,
  /** cancelled by user (SIGINT) */
  CANCELLED: 130,
} as const

export function isTerminalFailure(status: CheckStatus): boolean {
  return status === 'FAIL' || status === 'ERROR'
}

export function describeStatus(status: CheckStatus | TaskStatus): string {
  switch (status) {
    case 'PASS':
      return 'checked and satisfied'
    case 'FAIL':
      return 'checked and failed'
    case 'UNKNOWN':
      return 'insufficient evidence'
    case 'SKIPPED':
      return 'intentionally not executed'
    case 'BLOCKED':
      return 'required dependency unavailable'
    case 'ERROR':
      return 'verification infrastructure error'
    case 'VERIFIED':
      return 'all required criteria passed and were actually checked'
    case 'FAILED':
      return 'at least one required criterion failed or could not be verified'
    case 'INCOMPLETE':
      return 'verification could not finish; the task cannot be called verified'
    case 'UNVERIFIABLE':
      return 'no criteria or runnable checks exist — nothing was measured'
  }
}
