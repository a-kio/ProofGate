import path from 'node:path'
import { ProofGateError } from '@proofgate/shared'
import type {
  AdapterId,
  ChangedFile,
  IntegrationChangeSet,
  IntegrationScope,
  Invoker,
} from './types.js'
import { applyFileEdits, type FileEdit } from './fsx.js'
import { readJsonObject, writeJson } from './jsonc.js'
import { integrationsBackupDir, upsertIntegrationState } from './state.js'
import { mcpCommand } from './invoker.js'

export function fileEdit(target: string, before: string | null, after: string | null, note?: string): FileEdit {
  return { path: target, before, after, ...(note ? { note } : {}) }
}

export async function jsonFileEdit(
  target: string,
  mutate: (current: Record<string, unknown>) => Record<string, unknown>,
  note?: string,
): Promise<FileEdit> {
  const { value, text, error } = await readJsonObject(target)
  if (error) {
    throw new ProofGateError('INTEGRATION_CONFLICT', `Cannot safely edit ${target}: ${error}`, {
      hint: 'Fix the existing JSON file, then retry the integration install.',
    })
  }
  const next = mutate(value)
  const after = `${JSON.stringify(next, null, 2)}\n`
  return fileEdit(target, text, after, note)
}

export interface StandardMcpServerEntry {
  command: string
  args: string[]
  env?: Record<string, string>
}

export function standardMcpEntry(invoker: Invoker): StandardMcpServerEntry {
  const command = mcpCommand(invoker)
  return { command: command.command, args: command.args }
}

export function withMcpServer(
  current: Record<string, unknown>,
  name: string,
  entry: StandardMcpServerEntry,
): Record<string, unknown> {
  const existing = current.mcpServers
  const servers = typeof existing === 'object' && existing !== null && !Array.isArray(existing)
    ? { ...(existing as Record<string, unknown>) }
    : {}
  servers[name] = entry
  return { ...current, mcpServers: servers }
}

export function withoutMcpServer(current: Record<string, unknown>, name: string): Record<string, unknown> {
  const existing = current.mcpServers
  if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) return current
  const servers = { ...(existing as Record<string, unknown>) }
  delete servers[name]
  if (Object.keys(servers).length === 0) {
    const next = { ...current }
    delete next.mcpServers
    return next
  }
  return { ...current, mcpServers: servers }
}

export async function applyAdapterEdits(options: {
  root: string
  adapterId: AdapterId
  scope: IntegrationScope
  edits: FileEdit[]
  notes?: string[]
  dryRun?: boolean
  backup?: boolean
}): Promise<IntegrationChangeSet> {
  const backupDir = options.dryRun || options.backup === false
    ? undefined
    : integrationsBackupDir(options.root, options.adapterId)
  try {
    const result = await applyFileEdits(options.edits, {
      ...(backupDir ? { backupDir } : {}),
      ...(options.dryRun ? { dryRun: true } : {}),
    })
    const files: ChangedFile[] = result.changed.map((change) => {
      const source = options.edits.find((edit) => edit.path === change.path)
      return {
        path: change.path,
        action: change.action,
        ...(change.backup ? { backup: change.backup } : {}),
        ...(source?.note ? { note: source.note } : {}),
      }
    })
    if (!options.dryRun && result.changed.length > 0) {
      await upsertIntegrationState(options.root, {
        id: options.adapterId,
        scope: options.scope,
        files,
        ...(backupDir ? { backupDir } : {}),
        ...(options.notes ? { notes: options.notes } : {}),
      })
    }
    return { files, notes: options.notes ?? [] }
  } catch (error) {
    if (error instanceof ProofGateError) throw error
    throw new ProofGateError(
      'INTEGRATION_FAILED',
      `Could not install the ${options.adapterId} integration: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error, hint: 'Existing files are backed up under .proofgate/backups/integrations/.' },
    )
  }
}

/** Merge integration changes without clobbering unrelated top-level keys. */
export function mergeIntegrationMeta(
  current: Record<string, unknown>,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const existing = current.proofgate
  const base = typeof existing === 'object' && existing !== null && !Array.isArray(existing)
    ? (existing as Record<string, unknown>)
    : {}
  return { ...current, proofgate: { ...base, ...metadata } }
}

export function relativeDisplay(root: string, target: string): string {
  return path.relative(root, target).replace(/\\/g, '/')
}

export { writeJson }
