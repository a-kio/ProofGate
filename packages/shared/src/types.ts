/** Domain types shared by verification, storage, reporting, MCP, and the CLI. */

export const PROFILES = ['fast', 'balanced', 'thorough'] as const
export type Profile = (typeof PROFILES)[number]

export const VERIFICATION_MODES = ['changed', 'full', 'task'] as const
export type VerificationMode = (typeof VERIFICATION_MODES)[number]

export const CHECK_TYPES = ['command', 'http', 'files', 'secret-scan'] as const
export type CheckType = (typeof CHECK_TYPES)[number]

export const CHECK_STATUSES = ['PASS', 'FAIL', 'UNKNOWN', 'SKIPPED', 'BLOCKED', 'ERROR'] as const
export type CheckStatus = (typeof CHECK_STATUSES)[number]

export const OVERALL_STATUSES = ['VERIFIED', 'FAILED', 'INCOMPLETE', 'UNVERIFIABLE'] as const
export type OverallStatus = (typeof OVERALL_STATUSES)[number]

export const CRITERION_KINDS = ['check', 'artifact', 'manual'] as const
export type CriterionKind = (typeof CRITERION_KINDS)[number]

export const CRITERION_STATUSES = ['PASS', 'FAIL', 'UNKNOWN', 'SKIPPED'] as const
export type CriterionStatus = (typeof CRITERION_STATUSES)[number]

export type FindingKind = 'test-failure' | 'type-error' | 'lint-error' | 'runtime-error' | 'secret' | 'warning' | 'info'

export interface Finding {
  kind: FindingKind
  message: string
  file?: string
  line?: number
  column?: number
  details?: string
}

export interface OutputChunk {
  /** Captured tail, already redacted before persistence. */
  text: string
  /** Bytes captured in `text`. */
  bytes: number
  /** Total bytes emitted by the process, even when truncated. */
  totalBytes: number
  truncated: boolean
}

export interface CheckMetrics {
  testsTotal?: number
  testsPassed?: number
  testsFailed?: number
  testsSkipped?: number
  filesScanned?: number
  artifactsMatched?: number
}

export interface CheckResult {
  id: string
  title: string
  type: CheckType
  status: CheckStatus
  required: boolean
  profiles: Profile[]
  durationMs: number
  startedAt: string
  finishedAt: string
  /** True when the cached result was reused; evidence then points at the original run. */
  cached: boolean
  cacheKey?: string
  command?: string[]
  cwd?: string
  exitCode?: number | null
  signal?: string | null
  timedOut?: boolean
  summary: string
  stdout: OutputChunk
  stderr: OutputChunk
  findings: Finding[]
  metrics?: CheckMetrics
  errorMessage?: string
  skipReason?: string
  artifacts?: string[]
}

export interface SkippedCheck {
  id: string
  title: string
  reason: 'profile' | 'not-applicable' | 'dependency-failed' | 'guard' | 'disabled'
  detail: string
}

export interface ChangedFile {
  /** Project-relative posix path. */
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'unknown'
  oldPath?: string
}

export interface ChangedFilesSummary {
  /** How the file set was produced. */
  source: 'git-working-tree' | 'git-base' | 'full' | 'none' | 'unavailable'
  base?: string
  files: ChangedFile[]
  fingerprint: string
  truncated: boolean
}

export interface GitInfo {
  available: boolean
  root?: string
  branch?: string
  head?: string
  dirty?: boolean
  error?: string
}

export interface EnvironmentInfo {
  platform: NodeJS.Platform
  arch: string
  osRelease: string
  nodeVersion: string
  cwd: string
  hostname: string
  ci: boolean
  git: GitInfo
  toolVersions: Record<string, string>
  capturedAt: string
}

export interface AcceptanceCriterion {
  id: string
  description: string
  kind: CriterionKind
  /** Required for kind=check. */
  check?: string
  /** Required for kind=artifact. POSIX globs relative to the project root. */
  artifacts?: string[]
  required: boolean
}

export interface AcceptanceSnapshot {
  task?: string
  criteria: AcceptanceCriterion[]
  /** Hash of the acceptance document as authored. */
  fileHash: string | null
}

export interface IntentSummary {
  /** Hash binding checks, criteria, policy, and profile into one approval target. */
  hash: string
  approved: boolean
  approvedAt?: string
  approvedBy?: string
  lockPath: string
  /** True when an approval exists but no longer matches the current intent. */
  stale: boolean
  reason?: string
}

export interface CriterionResult {
  id: string
  description: string
  kind: CriterionKind
  required: boolean
  status: CriterionStatus
  reason: string
  evidence: string[]
}

export interface EvidenceEntry {
  /** Path relative to the run directory. */
  path: string
  sha256: string
  bytes: number
  kind: 'log' | 'json' | 'artifact' | 'summary'
}

export interface EvidenceSummary {
  dir: string
  manifestPath: string
  manifestHash: string
  entries: EvidenceEntry[]
  totalBytes: number
  redacted: boolean
}

export interface RunProjectInfo {
  root: string
  name?: string
  ecosystem: string[]
  packageManager?: string
}

export interface RunSummaryCounts {
  total: number
  passed: number
  failed: number
  unknown: number
  skipped: number
  blocked: number
  error: number
  requiredTotal: number
  requiredPassed: number
  requiredFailed: number
}

export interface RunReport {
  schemaVersion: 1
  id: string
  status: OverallStatus
  mode: VerificationMode
  profile: Profile
  task?: string
  project: RunProjectInfo
  startedAt: string
  finishedAt: string
  durationMs: number
  environment: EnvironmentInfo
  intent: IntentSummary
  changedFiles: ChangedFilesSummary
  criteria: CriterionResult[]
  checks: CheckResult[]
  skippedChecks: SkippedCheck[]
  cache: { enabled: boolean; hits: number; misses: number }
  evidence: EvidenceSummary
  summary: RunSummaryCounts
  notes: string[]
  tool: { name: string; version: string; schemaVersion: number }
}

/** Lightweight projection used by lists, status, and the dashboard. */
export interface RunListItem {
  id: string
  status: OverallStatus
  mode: VerificationMode
  profile: Profile
  task?: string
  startedAt: string
  finishedAt: string
  durationMs: number
  summary: RunSummaryCounts
  checks: Array<{ id: string; title: string; status: CheckStatus; required: boolean }>
  evidenceDir: string
  intentHash: string
}

export interface AcceptanceLockFile {
  schemaVersion: 1
  approvedAt: string
  approvedBy: string
  acceptanceFileHash: string | null
  /** One approval per verification profile, because each profile runs a different check set. */
  approvals: Array<{
    profile: Profile
    intentHash: string
    approvedAt: string
    approvedBy: string
  }>
  /** Snapshot so a human can audit what was approved even after edits. */
  snapshot: {
    task?: string
    criteria: AcceptanceCriterion[]
    checks: Array<{ id: string; title: string; type: CheckType; required: boolean; profiles: Profile[] }>
    policy: Record<string, unknown>
    profile: Profile
  }
  toolVersion: string
}

export interface IntegrationStateEntry {
  id: string
  version: string
  installedAt: string
  scope: 'project' | 'user'
  files: string[]
  backupDir?: string
  notes: string[]
}

export interface IntegrationsStateFile {
  schemaVersion: 1
  integrations: IntegrationStateEntry[]
}

export interface ProofGateStateFile {
  schemaVersion: 1
  approvedAcceptanceHash?: string
  approvedAt?: string
  approvedBy?: string
  lastRunId?: string
  installId?: string
  initializedAt?: string
}
