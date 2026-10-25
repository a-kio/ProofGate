import type { CheckStatus, TaskStatus, TriggerKind, VerificationProfile } from './status.js'

export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed'

export interface ChangedFile {
  /** posix path relative to the project root */
  path: string
  kind: ChangeKind
}

export interface GitRevision {
  /** absolute path of the repo root, null when not a git repo */
  repositoryRoot?: string
  head?: string
  headShort?: string
  branch?: string
  hasCommits: boolean
  isWorktree: boolean
  isRepository: boolean
}

export interface EnvironmentInfo {
  platform: string
  osVersion: string
  node: string
  proofgate: string
  cpuCount: number
}

export interface CheckResultV1 {
  checkId: string
  title?: string
  required: boolean
  profiles: VerificationProfile[]
  type: string
  /** as configured — never interpolated */
  command: { argv: string[]; cwd?: string }
  /** the executable actually spawned (a resolved absolute path or node+script pair) */
  argvResolved?: string[]
  status: CheckStatus
  exitCode?: number | null
  signal?: string
  timedOut?: boolean
  truncated?: boolean
  durationMs?: number
  startedAt?: string
  finishedAt?: string
  reason?: string
  evidencePath?: string
  cachedFrom?: { runId: string; fingerprint: string }
  dependsOn?: string[]
  notes?: string[]
}

export interface AcceptanceCriterionResult {
  id: string
  kind: 'check' | 'artifact' | 'manual'
  required: boolean
  status: CheckStatus
  detail?: string
}

export interface AcceptanceOutcome {
  present: boolean
  changedSinceApproval: boolean
  approved?: boolean
  approvedHash?: string
  currentHash?: string
  criteria: AcceptanceCriterionResult[]
}

export interface RunSummary {
  total: number
  pass: number
  fail: number
  unknown: number
  skipped: number
  blocked: number
  error: number
  requiredTotal: number
  requiredPassed: number
  /** share of *executed* checks that passed — an advisory stat, never a verdict */
  executedPassRate?: number
}

export interface VerificationRunV1 {
  schemaVersion: 1
  runId: string
  projectRoot: string
  projectName?: string
  startedAt: string
  finishedAt?: string
  durationMs?: number
  status: TaskStatus
  profile: VerificationProfile
  trigger: TriggerKind
  provider?: string
  providerVersion?: string
  sessionId?: string
  task?: string
  revision: GitRevision
  changedFiles: ChangedFile[]
  changedMode: boolean
  checks: CheckResultV1[]
  acceptance?: AcceptanceOutcome
  summary: RunSummary
  configPath?: string
  configFingerprint?: string
  exitCode?: number
  cancelled?: boolean
  notes: string[]
  environment: EnvironmentInfo
}

export function emptySummary(): RunSummary {
  return {
    total: 0,
    pass: 0,
    fail: 0,
    unknown: 0,
    skipped: 0,
    blocked: 0,
    error: 0,
    requiredTotal: 0,
    requiredPassed: 0,
  }
}

/** Advisory-only aggregate; never used to override required failures. */
export function buildSummary(checks: CheckResultV1[]): RunSummary {
  const s = emptySummary()
  let executed = 0
  let passed = 0
  for (const c of checks) {
    s.total++
    s[c.status.toLowerCase() as keyof RunSummary & (Lowercase<CheckStatus> | 'total')]++
    if (c.status === 'PASS' || c.status === 'FAIL' || c.status === 'ERROR') {
      executed++
      if (c.status === 'PASS') passed++
    }
    if (c.required) {
      s.requiredTotal++
      if (c.status === 'PASS') s.requiredPassed++
    }
  }
  if (executed > 0) s.executedPassRate = Math.round((passed / executed) * 100) / 100
  return s
}
