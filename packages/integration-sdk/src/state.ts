import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  BACKUPS_REL_DIR,
  INTEGRATIONS_STATE_REL_PATH,
  TOOL_VERSION,
  nowIso,
  type IntegrationStateEntry,
  type IntegrationsStateFile,
} from '@proofgate/shared'
import type { AdapterId, ChangedFile, IntegrationScope } from './types.js'
import { atomicWrite, readTextIfExists } from './fsx.js'

export function integrationsStatePath(root: string): string {
  return path.join(root, INTEGRATIONS_STATE_REL_PATH)
}

export function integrationsBackupDir(root: string, adapterId: string): string {
  const stamp = nowIso().replace(/[:.]/g, '-')
  return path.join(root, BACKUPS_REL_DIR, 'integrations', adapterId, stamp)
}

export async function readIntegrationsState(root: string): Promise<IntegrationsStateFile> {
  const text = await readTextIfExists(integrationsStatePath(root))
  if (!text) return { schemaVersion: 1, integrations: [] }
  try {
    const parsed = JSON.parse(text) as Partial<IntegrationsStateFile>
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.integrations)) {
      return { schemaVersion: 1, integrations: [] }
    }
    return parsed as IntegrationsStateFile
  } catch {
    return { schemaVersion: 1, integrations: [] }
  }
}

export async function writeIntegrationsState(root: string, state: IntegrationsStateFile): Promise<void> {
  await atomicWrite(integrationsStatePath(root), `${JSON.stringify(state, null, 2)}\n`)
}

export async function upsertIntegrationState(
  root: string,
  entry: {
    id: AdapterId
    scope: IntegrationScope
    files: ChangedFile[]
    backupDir?: string
    notes?: string[]
  },
): Promise<IntegrationsStateFile> {
  const state = await readIntegrationsState(root)
  const files = entry.files.map((file) => path.relative(root, file.path).replace(/\\/g, '/'))
  const next: IntegrationStateEntry = {
    id: entry.id,
    version: TOOL_VERSION,
    installedAt: nowIso(),
    scope: entry.scope,
    files,
    ...(entry.backupDir ? { backupDir: path.relative(root, entry.backupDir).replace(/\\/g, '/') } : {}),
    notes: entry.notes ?? [],
  }
  state.integrations = [...state.integrations.filter((existing) => existing.id !== entry.id), next].sort((a, b) =>
    a.id.localeCompare(b.id),
  )
  await writeIntegrationsState(root, state)
  return state
}

export async function removeIntegrationState(root: string, id: AdapterId): Promise<IntegrationsStateFile> {
  const state = await readIntegrationsState(root)
  state.integrations = state.integrations.filter((entry) => entry.id !== id)
  await writeIntegrationsState(root, state)
  return state
}

export async function backupDirSize(dir: string): Promise<number> {
  let total = 0
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const target = path.join(dir, entry.name)
      if (entry.isDirectory()) total += await backupDirSize(target)
      else if (entry.isFile()) total += (await fsp.stat(target)).size
    }
  } catch {
    return total
  }
  return total
}
