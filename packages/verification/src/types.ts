import type {
  AcceptanceCriterion,
  ChangedFilesSummary,
  CheckResult,
  CriterionResult,
  Profile,
  RunSummaryCounts,
  SkippedCheck,
  VerificationMode,
} from '@proofgate/shared'
import type { CheckConfig } from '@proofgate/config'

export interface PlannedCheck {
  config: CheckConfig
  id: string
  title: string
  dependencies: string[]
}

export interface OmittedCheck {
  id: string
  title: string
  reason: 'profile' | 'not-applicable'
  detail: string
}

export interface PlanGuardResult {
  blocked: boolean
  reason?: string
  matchedPaths: string[]
}

export interface VerificationPlan {
  mode: VerificationMode
  profile: Profile
  root: string
  task?: string
  checks: PlannedCheck[]
  omitted: OmittedCheck[]
  changed: ChangedFilesSummary
  intentHash: string
  acceptanceApproved: boolean
  acceptanceReason?: string
  guard: PlanGuardResult
  notes: string[]
}

export interface PlanOptions {
  mode: VerificationMode
  profile: Profile
  root: string
  changed: ChangedFilesSummary
  config: {
    checks: CheckConfig[]
    guards: { forbiddenPaths: string[]; maxChangedFiles?: number }
  }
  task?: string
  intentHash: string
  acceptanceApproved: boolean
  acceptanceReason?: string
}

export interface ManualSignoff {
  criterionId: string
  intentHash: string
  signedAt: string
  signedBy: string
  note?: string
}

export interface ExecutionOptions {
  plan: VerificationPlan
  /** Full acceptance criteria, including criteria whose checks are omitted by profile. */
  criteria: AcceptanceCriterion[]
  config: {
    cache: { enabled: boolean; maxEntries: number; maxAgeDays: number }
    limits: { timeoutSeconds: number; maxParallelChecks: number; maxOutputBytes: number }
    verification: { ignorePaths: string[] }
  }
  configHash: string
  cacheDir: string
  noCache?: boolean
  signal?: AbortSignal
  signoffs?: ManualSignoff[]
  hooks?: EngineHooks
}

export interface EngineHooks {
  onCheckStart?: (check: PlannedCheck) => void
  onCheckFinish?: (result: CheckResult) => void
  onNote?: (message: string) => void
}

export interface ExecutionResult {
  checks: CheckResult[]
  skippedChecks: SkippedCheck[]
  criteria: CriterionResult[]
  summary: RunSummaryCounts
  cache: { enabled: boolean; hits: number; misses: number }
  notes: string[]
}
