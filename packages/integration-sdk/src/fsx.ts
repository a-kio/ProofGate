import fsp from 'node:fs/promises'
import path from 'node:path'
import { nowIso, sha256Hex } from '@proofgate/shared'

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

export async function readTextIfExists(target: string): Promise<string | null> {
  try {
    return await fsp.readFile(target, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function atomicWrite(target: string, contents: string): Promise<void> {
  await fsp.mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  await fsp.writeFile(temporary, contents, 'utf8')
  await fsp.rename(temporary, target)
}

export async function removeFileIfExists(target: string): Promise<boolean> {
  try {
    await fsp.unlink(target)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Copy a file into a timestamped backup directory. Returns the backup path. */
export async function backupFile(target: string, backupDir: string): Promise<string | null> {
  if (!(await pathExists(target))) return null
  await fsp.mkdir(backupDir, { recursive: true })
  const stat = await fsp.stat(target)
  const safeName = target.replace(/^[A-Za-z]:/, '').replace(/[\\/:]+/g, '_').replace(/^_+/, '')
  const stamp = nowIso().replace(/[:.]/g, '-')
  const destination = path.join(backupDir, `${stamp}__${safeName}`)
  await fsp.copyFile(target, destination)
  const recordPath = path.join(backupDir, 'backups.json')
  let records: Array<Record<string, unknown>> = []
  try {
    const parsed: unknown = JSON.parse(await fsp.readFile(recordPath, 'utf8'))
    if (Array.isArray(parsed)) records = parsed as Array<Record<string, unknown>>
  } catch {
    records = []
  }
  records.push({
    source: target,
    backup: destination,
    bytes: stat.size,
    sha256: sha256Hex(await fsp.readFile(target)),
    createdAt: nowIso(),
  })
  await atomicWrite(recordPath, `${JSON.stringify(records, null, 2)}\n`)
  return destination
}

export interface FileEdit {
  path: string
  before: string | null
  after: string | null
  note?: string
}

export interface ApplyResult {
  changed: Array<{ path: string; action: 'created' | 'updated' | 'removed'; backup?: string }>
  unchanged: string[]
  backups: string[]
}

/**
 * Apply a set of whole-file edits transactionally.
 *
 * Existing files are backed up before the first write. If any write fails,
 * every already-applied edit is rolled back: updated files are restored from
 * their backup and created files are removed. Unchanged paths are skipped.
 */
export async function applyFileEdits(edits: FileEdit[], options: {
  backupDir?: string
  dryRun?: boolean
} = {}): Promise<ApplyResult> {
  const changed: ApplyResult['changed'] = []
  const unchanged: string[] = []
  const backups: string[] = []
  const applied: Array<{ edit: FileEdit; backup: string | null; created: boolean }> = []

  for (const edit of edits) {
    if (edit.before === edit.after) {
      unchanged.push(edit.path)
      continue
    }
    if (!options.dryRun) {
      const backup = options.backupDir ? await backupFile(edit.path, options.backupDir) : null
      if (backup) backups.push(backup)
      try {
        if (edit.after === null) {
          await removeFileIfExists(edit.path)
          changed.push({ path: edit.path, action: 'removed', ...(backup ? { backup } : {}) })
        } else {
          await atomicWrite(edit.path, edit.after)
          const action = edit.before === null ? 'created' : 'updated'
          changed.push({ path: edit.path, action, ...(backup ? { backup } : {}) })
        }
        applied.push({ edit, backup, created: edit.before === null })
      } catch (error) {
        // Roll back everything applied so far.
        for (const entry of applied.reverse()) {
          try {
            if (entry.created) await removeFileIfExists(entry.edit.path)
            else if (entry.backup) await fsp.copyFile(entry.backup, entry.edit.path)
          } catch {
            // Best effort rollback; the original error is more useful.
          }
        }
        throw error
      }
    } else {
      changed.push({
        path: edit.path,
        action: edit.after === null ? 'removed' : edit.before === null ? 'created' : 'updated',
      })
      applied.push({ edit, backup: null, created: edit.before === null })
    }
  }

  return { changed, unchanged, backups }
}

export async function ensureDir(target: string): Promise<void> {
  await fsp.mkdir(target, { recursive: true })
}
