import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  ACCEPTANCE_LOCK_REL_PATH,
  TOOL_VERSION,
  nowIso,
  type AcceptanceLockFile,
  type IntentSummary,
  type Profile,
} from '@proofgate/shared'
import type { AcceptanceFile, ProofGateConfig } from './schema.js'
import { computeAcceptanceHash, computeIntentHash } from './intent.js'
import { acceptancePathFor, atomicWriteFile, fileExists, writeJsonFile } from './loader.js'

export function acceptanceLockPathFor(root: string): string {
  return path.join(root, ACCEPTANCE_LOCK_REL_PATH)
}

interface LockReadResult {
  lock: AcceptanceLockFile | null
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function readAcceptanceLock(root: string): Promise<LockReadResult> {
  const lockPath = acceptanceLockPathFor(root)
  if (!(await fileExists(lockPath))) return { lock: null }
  try {
    const raw: unknown = JSON.parse(await fsp.readFile(lockPath, 'utf8'))
    if (!isRecord(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.approvals)) {
      return { lock: null, error: `${lockPath} is not a valid ProofGate acceptance lock` }
    }
    return { lock: raw as unknown as AcceptanceLockFile }
  } catch (error) {
    return { lock: null, error: `cannot read ${lockPath}: ${error instanceof Error ? error.message : String(error)}` }
  }
}

function snapshotOf(
  acceptance: AcceptanceFile,
  config: ProofGateConfig,
  profile: Profile,
): {
  task?: string
  criteria: AcceptanceFile['criteria']
  fileHash: string
  checks: Array<{ id: string; title: string; type: ProofGateConfig['checks'][number]['type']; required: boolean; profiles: Profile[] }>
  policy: Record<string, unknown>
  profile: Profile
} {
  return {
    task: acceptance.task,
    criteria: acceptance.criteria,
    fileHash: computeAcceptanceHash(acceptance),
    checks: config.checks.map((check) => ({
      id: check.id,
      title: check.title ?? check.id,
      type: check.type,
      required: check.required,
      profiles: check.profiles,
    })),
    policy: config.policy as unknown as Record<string, unknown>,
    profile,
  }
}

export async function writeAcceptanceLock(
  root: string,
  acceptance: AcceptanceFile,
  config: ProofGateConfig,
  profiles: Profile[],
  approvedBy = 'user',
): Promise<{ lock: AcceptanceLockFile; path: string }> {
  const lockPath = acceptanceLockPathFor(root)
  const existing = (await readAcceptanceLock(root)).lock
  const acceptanceHash = computeAcceptanceHash(acceptance)
  const sameDocument = existing?.acceptanceFileHash === acceptanceHash
  const kept = sameDocument
    ? (existing?.approvals ?? []).filter((approval) => !profiles.includes(approval.profile))
    : []
  const now = nowIso()
  const approvals = [
    ...kept,
    ...profiles.map((profile) => ({
      profile,
      intentHash: computeIntentHash(config, acceptance, profile),
      approvedAt: now,
      approvedBy,
    })),
  ].sort((a, b) => a.profile.localeCompare(b.profile))
  const snapshot = snapshotOf(acceptance, config, profiles[0] ?? config.verification.profile)
  const lock: AcceptanceLockFile = {
    schemaVersion: 1,
    approvedAt: now,
    approvedBy,
    acceptanceFileHash: acceptanceHash,
    approvals,
    snapshot: {
      task: snapshot.task,
      criteria: snapshot.criteria,
      checks: snapshot.checks,
      policy: snapshot.policy,
      profile: snapshot.profile,
    },
    toolVersion: TOOL_VERSION,
  }
  await writeJsonFile(lockPath, lock)
  return { lock, path: lockPath }
}

export async function removeAcceptanceLock(root: string): Promise<void> {
  await fsp.rm(acceptanceLockPathFor(root), { force: true })
}

/** Resolve whether the current intent is approved for this profile. */
export async function resolveAcceptanceApproval(
  root: string,
  acceptance: AcceptanceFile | null,
  config: ProofGateConfig,
  profile: Profile,
  options: { enforce?: boolean } = {},
): Promise<IntentSummary> {
  const lockPath = acceptanceLockPathFor(root)
  const enforce = options.enforce ?? config.guards.protectAcceptance
  if (!acceptance) {
    return {
      hash: '',
      approved: false,
      stale: false,
      lockPath,
      reason: 'Acceptance criteria are missing or invalid. Run `proofgate criteria approve` after fixing them.',
    }
  }
  const currentHash = computeIntentHash(config, acceptance, profile)
  const acceptanceHash = computeAcceptanceHash(acceptance)
  if (!enforce) {
    return {
      hash: currentHash,
      approved: true,
      stale: false,
      lockPath,
      reason: 'Acceptance protection is disabled by config (guards.protectAcceptance=false).',
    }
  }
  const { lock, error } = await readAcceptanceLock(root)
  if (!lock) {
    return {
      hash: currentHash,
      approved: false,
      stale: false,
      lockPath,
      reason: error
        ? `${error}. Run \`proofgate criteria approve\` to re-approve.`
        : 'Acceptance criteria have not been approved. Run `proofgate criteria approve`.',
    }
  }
  if (lock.acceptanceFileHash !== acceptanceHash) {
    return {
      hash: currentHash,
      approved: false,
      stale: true,
      lockPath,
      approvedAt: lock.approvedAt,
      approvedBy: lock.approvedBy,
      reason: 'Acceptance criteria changed since they were approved. Review the diff, then run `proofgate criteria approve`.',
    }
  }
  const approval = lock.approvals.find((entry) => entry.profile === profile)
  if (!approval) {
    return {
      hash: currentHash,
      approved: false,
      stale: true,
      lockPath,
      approvedAt: lock.approvedAt,
      approvedBy: lock.approvedBy,
      reason: `The "${profile}" profile has not been approved. Run \`proofgate criteria approve --profile ${profile}\`.`,
    }
  }
  if (approval.intentHash !== currentHash) {
    return {
      hash: currentHash,
      approved: false,
      stale: true,
      lockPath,
      approvedAt: approval.approvedAt,
      approvedBy: approval.approvedBy,
      reason: 'Checks, criteria, or policy changed since approval. Review the diff, then run `proofgate criteria approve`.',
    }
  }
  return {
    hash: currentHash,
    approved: true,
    stale: false,
    lockPath,
    approvedAt: approval.approvedAt,
    approvedBy: approval.approvedBy,
  }
}

export interface ApprovedSnapshotView {
  lockPath: string
  exists: boolean
  approvedAt?: string
  approvedBy?: string
  profiles: string[]
  checks: number
  criteria: number
}

export async function describeApproval(root: string): Promise<ApprovedSnapshotView> {
  const { lock } = await readAcceptanceLock(root)
  if (!lock) return { lockPath: acceptanceLockPathFor(root), exists: false, profiles: [], checks: 0, criteria: 0 }
  return {
    lockPath: acceptanceLockPathFor(root),
    exists: true,
    approvedAt: lock.approvedAt,
    approvedBy: lock.approvedBy,
    profiles: lock.approvals.map((entry) => entry.profile),
    checks: lock.snapshot.checks.length,
    criteria: lock.snapshot.criteria.length,
  }
}

export async function ensureAcceptanceFileExists(root: string): Promise<string> {
  const target = acceptancePathFor(root)
  if (!(await fileExists(target))) {
    throw new Error(`Acceptance file missing: ${target}`)
  }
  return target
}

export async function writeRawAcceptance(root: string, contents: string): Promise<string> {
  const target = acceptancePathFor(root)
  await atomicWriteFile(target, contents)
  return target
}
