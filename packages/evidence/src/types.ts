import type { EvidenceEntry, EvidenceSummary, CheckResult, RunSummaryCounts, CriterionResult, OverallStatus } from '@proofgate/shared'

export interface EvidenceManifest {
  schemaVersion: 1
  runId: string
  createdAt: string
  entries: EvidenceEntry[]
  totalBytes: number
  redacted: boolean
  tool: { name: string; version: string }
}

export interface EvidenceCheckWrite {
  /** Redacted result, safe to include in the JSON report. */
  result: CheckResult
  /** Project-relative paths of the files written for this check. */
  files: string[]
}

export interface EvidenceSummaryInput {
  status: OverallStatus
  summary: RunSummaryCounts
  criteria: CriterionResult[]
  notes: string[]
}

export interface EvidenceVerifyProblem {
  path: string
  problem: 'missing' | 'hash-mismatch' | 'size-mismatch' | 'unexpected'
  expected?: string
  actual?: string
}

export interface EvidenceVerifyResult {
  ok: boolean
  manifestPath: string
  checked: number
  problems: EvidenceVerifyProblem[]
}

export interface EvidencePruneOptions {
  maxRuns: number
  maxAgeDays: number
  /** Run ids that must never be deleted (for example the active or latest run). */
  keep?: string[]
}

export interface EvidencePruneResult {
  removed: string[]
  kept: number
}

export type { EvidenceEntry, EvidenceSummary }
