import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  ACTIVE_RUN_REL_PATH,
  LOCKS_REL_DIR,
  RUN_LOCK_REL_PATH,
  nowIso,
  randomToken,
  sleep,
} from '@proofgate/shared'

const DEFAULT_STALE_MS = 6 * 60 * 60 * 1000

interface LockRecord {
  schemaVersion: 1
  token: string
  runId: string
  pid: number
  hostname: string
  startedAt: string
}

export interface AcquiredLock {
  kind: 'acquired'
  lockPath: string
  token: string
  runId: string
  release: () => Promise<void>
}

export interface ExistingLock {
  kind: 'existing'
  runId?: string
  startedAt?: string
  pid?: number
  reason: string
}

export type AcquireLockResult = AcquiredLock | ExistingLock

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'EPERM'
  }
}

function isStale(record: LockRecord | null, rawAgeMs: number, staleMs: number): boolean {
  if (!record) return true
  const started = Date.parse(record.startedAt)
  const age = Number.isFinite(started) ? Date.now() - started : rawAgeMs
  if (age > staleMs) return true
  if (record.hostname !== os.hostname()) return false
  return !isProcessAlive(record.pid)
}

async function readLock(lockPath: string): Promise<LockRecord | null> {
  try {
    const stat = await fsp.stat(lockPath)
    const raw: unknown = JSON.parse(await fsp.readFile(lockPath, 'utf8'))
    if (!isRecord(raw)) return null
    if (
      raw.schemaVersion !== 1 ||
      typeof raw.token !== 'string' ||
      typeof raw.runId !== 'string' ||
      typeof raw.pid !== 'number' ||
      typeof raw.hostname !== 'string' ||
      typeof raw.startedAt !== 'string'
    ) {
      return null
    }
    if (Date.now() - stat.mtimeMs > DEFAULT_STALE_MS * 2) return null
    return raw as unknown as LockRecord
  } catch {
    return null
  }
}

async function tryCreate(lockPath: string, record: LockRecord): Promise<boolean> {
  try {
    const handle = await fsp.open(lockPath, 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8')
    } finally {
      await handle.close()
    }
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
}

export interface AcquireLockOptions {
  runId: string
  concurrent?: 'dedupe' | 'fail'
  waitMs?: number
  staleMs?: number
}

/**
 * Cross-process run lock. The lock is created with O_EXCL so two agents cannot
 * verify the same workspace simultaneously and interleave evidence.
 */
export async function acquireRunLock(root: string, options: AcquireLockOptions): Promise<AcquireLockResult> {
  const lockDir = path.join(root, LOCKS_REL_DIR)
  await fsp.mkdir(lockDir, { recursive: true })
  const lockPath = path.join(root, RUN_LOCK_REL_PATH)
  const token = randomToken(18)
  const record: LockRecord = {
    schemaVersion: 1,
    token,
    runId: options.runId,
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: nowIso(),
  }
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS
  const concurrent = options.concurrent ?? 'dedupe'
  const deadline = Date.now() + (options.waitMs ?? 0)

  for (let attempt = 0; attempt < 4; attempt++) {
    if (await tryCreate(lockPath, record)) {
      return {
        kind: 'acquired',
        lockPath,
        token,
        runId: options.runId,
        release: async () => {
          const current = await readLock(lockPath)
          if (!current || current.token !== token) return
          await fsp.rm(lockPath, { force: true })
        },
      }
    }

    const existing = await readLock(lockPath)
    let rawAge = 0
    try {
      rawAge = Date.now() - (await fsp.stat(lockPath)).mtimeMs
    } catch {
      // released between calls; retry
      continue
    }
    if (isStale(existing, rawAge, staleMs)) {
      await fsp.rm(lockPath, { force: true }).catch(() => undefined)
      continue
    }

    if (concurrent === 'fail') {
      return {
        kind: 'existing',
        ...(existing?.runId ? { runId: existing.runId } : {}),
        ...(existing?.startedAt ? { startedAt: existing.startedAt } : {}),
        ...(existing?.pid ? { pid: existing.pid } : {}),
        reason: 'Another ProofGate run is already active in this project.',
      }
    }

    // Dedupe: wait briefly for a short run, then report the in-flight run instead of duplicating work.
    while (Date.now() < deadline) {
      await sleep(250)
      if (!fs.existsSync(lockPath)) break
    }
    if (!fs.existsSync(lockPath)) continue
    const active = await readActiveRun(root)
    const holder = await readLock(lockPath)
    return {
      kind: 'existing',
      ...(active?.runId || holder?.runId ? { runId: active?.runId ?? holder?.runId } : {}),
      ...(holder?.startedAt ? { startedAt: holder.startedAt } : {}),
      ...(holder?.pid ? { pid: holder.pid } : {}),
      reason: 'A verification run is already active; duplicate work was suppressed.',
    }
  }

  return {
    kind: 'existing',
    reason: 'Could not acquire the verification lock after several attempts. Another process may be racing for it.',
  }
}

export interface ActiveRunRecord {
  schemaVersion: 1
  runId: string
  startedAt: string
  pid: number
  mode?: string
  profile?: string
}

export function activeRunPathFor(root: string): string {
  return path.join(root, ACTIVE_RUN_REL_PATH)
}

export async function writeActiveRun(root: string, record: Omit<ActiveRunRecord, 'schemaVersion' | 'pid'>): Promise<void> {
  const filePath = activeRunPathFor(root)
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  const payload: ActiveRunRecord = {
    schemaVersion: 1,
    runId: record.runId,
    startedAt: record.startedAt,
    pid: process.pid,
    ...(record.mode ? { mode: record.mode } : {}),
    ...(record.profile ? { profile: record.profile } : {}),
  }
  await fsp.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

export async function readActiveRun(root: string): Promise<ActiveRunRecord | null> {
  try {
    const raw: unknown = JSON.parse(await fsp.readFile(activeRunPathFor(root), 'utf8'))
    if (!isRecord(raw) || typeof raw.runId !== 'string') return null
    return raw as unknown as ActiveRunRecord
  } catch {
    return null
  }
}

export async function clearActiveRun(root: string, runId?: string): Promise<void> {
  if (runId) {
    const active = await readActiveRun(root)
    if (active && active.runId !== runId) return
  }
  await fsp.rm(activeRunPathFor(root), { force: true }).catch(() => undefined)
}

export async function readLockSummary(root: string): Promise<{ active: boolean; runId?: string; startedAt?: string; pid?: number; reason?: string }> {
  const lockPath = path.join(root, RUN_LOCK_REL_PATH)
  const record = await readLock(lockPath)
  if (!record) return { active: false, reason: 'no active run lock' }
  if (isStale(record, 0, DEFAULT_STALE_MS)) return { active: false, reason: 'stale lock' }
  return { active: true, runId: record.runId, startedAt: record.startedAt, pid: record.pid }
}
