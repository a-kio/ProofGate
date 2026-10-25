import path from 'node:path'
import { resolveCommand } from '@proofgate/executor'
import type { IntegrationScope } from '@proofgate/integration-sdk'
import { readJsonObject } from '@proofgate/integration-sdk'

export function projectPath(root: string, relative: string): string {
  return path.join(root, ...relative.split('/'))
}

export function binaryFound(id: string, cwd?: string): boolean {
  return resolveCommand(id, { cwd }) !== null
}

export function hookCommandFor(wrapperRelativePath: string): string {
  // Relative path keeps the checked-in/project config portable across machines.
  return `node ${wrapperRelativePath.replace(/\\/g, '/')}`
}

export interface HookGroup {
  matcher?: string
  hooks?: Array<{ type?: string; command?: string; timeout?: number }>
  [key: string]: unknown
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Remove ProofGate command entries from a provider's hook array, preserving the rest. */
export function removeOurHookCommands(groups: unknown, wrapperMarker: string): unknown {
  if (!Array.isArray(groups)) return groups
  const result: unknown[] = []
  for (const group of groups) {
    if (!isRecord(group)) {
      result.push(group)
      continue
    }
    const hooks = Array.isArray(group.hooks) ? group.hooks : null
    if (!hooks) {
      result.push(group)
      continue
    }
    const kept = hooks.filter((hook) => {
      if (!isRecord(hook)) return true
      return typeof hook.command !== 'string' || !hook.command.includes(wrapperMarker)
    })
    if (kept.length > 0) result.push({ ...group, hooks: kept })
  }
  return result
}

/** Read a provider JSON file without failing on comments; returns parse errors to the caller. */
export async function readProviderJson(target: string): Promise<{
  value: Record<string, unknown>
  text: string | null
  error?: string
}> {
  return readJsonObject(target)
}

export function scopeLabel(scope: IntegrationScope): string {
  return scope === 'project' ? 'project' : 'user'
}

export const MCP_SERVER_NAME = 'proofgate'
