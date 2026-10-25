import path from 'node:path'
import {
  applyAdapterEdits,
  fileEdit,
  homeDir,
  jsonFileEdit,
  pathExists,
  readTextIfExists,
  standardMcpEntry,
  withMcpServer,
  withoutMcpServer,
  writeHookWrapper,
  type AgentAdapter,
  type HealthRow,
  type IntegrationChangeSet,
} from '@proofgate/integration-sdk'
import { binaryFound, hookCommandFor, isRecord, MCP_SERVER_NAME, projectPath } from '../common.js'

const HOOK_NAME = 'cursor-stop'
const MARKER = '.proofgate/hooks/cursor-stop'

function mcpPath(root: string, scope: 'project' | 'user'): string {
  return scope === 'user' ? path.join(homeDir(), '.cursor', 'mcp.json') : projectPath(root, '.cursor/mcp.json')
}

function hooksPath(root: string, scope: 'project' | 'user'): string {
  return scope === 'user' ? path.join(homeDir(), '.cursor', 'hooks.json') : projectPath(root, '.cursor/hooks.json')
}

function mergeHooks(current: Record<string, unknown>, wrapperPath: string): Record<string, unknown> {
  const version = typeof current.version === 'number' ? current.version : 1
  const hooks = isRecord(current.hooks) ? { ...current.hooks } : {}
  const existing = Array.isArray(hooks.stop) ? hooks.stop : []
  const filtered = existing.filter((entry) => !(isRecord(entry) && typeof entry.command === 'string' && entry.command.includes(MARKER)))
  filtered.push({
    command: hookCommandFor(wrapperPath),
    timeout: 900,
  })
  return { ...current, version, hooks: { ...hooks, stop: filtered } }
}

function removeHooks(current: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(current.hooks)) return current
  const hooks = { ...current.hooks }
  if (Array.isArray(hooks.stop)) {
    const filtered = hooks.stop.filter(
      (entry) => !(isRecord(entry) && typeof entry.command === 'string' && entry.command.includes(MARKER)),
    )
    if (filtered.length > 0) hooks.stop = filtered
    else delete hooks.stop
  }
  if (Object.keys(hooks).length === 0) {
    const next = { ...current }
    delete next.hooks
    if (next.version === 1) delete next.version
    return next
  }
  return { ...current, hooks }
}

export const cursorAdapter: AgentAdapter = {
  id: 'cursor',
  displayName: 'Cursor',
  description: 'Stop hook and MCP server in project or user configuration.',
  capabilities: {
    manualVerification: true,
    mcpVerification: true,
    automaticCompletionChecks: true,
    automaticFileChangeEvents: false,
    blockingFeedback: false,
    limitations: [
      'Cursor hook behavior varies by version; the generated stop hook reports evidence but does not block the agent.',
      'Restart Cursor after installation.',
    ],
  },

  async detect(root) {
    const binFound = binaryFound('cursor', root)
    const projectConfig = await pathExists(mcpPath(root, 'project'))
    const userConfig = await pathExists(mcpPath(root, 'user'))
    return {
      installed: binFound || projectConfig || userConfig,
      binFound,
      configFound: projectConfig || userConfig,
      ...(projectConfig ? { configScope: 'project' as const } : userConfig ? { configScope: 'user' as const } : {}),
    }
  },

  async install(options): Promise<IntegrationChangeSet> {
    const edits = []
    if (options.includeHooks) {
      const wrapper = await writeHookWrapper({
        root: options.root,
        name: HOOK_NAME,
        invoker: options.invoker,
        provider: 'cursor',
        extraArgs: ['--quiet'],
      })
      const wrapperPath = path.relative(options.root, wrapper.path)
      edits.push(await jsonFileEdit(hooksPath(options.root, options.scope), (current) => mergeHooks(current, wrapperPath), 'add stop hook'))
    }
    if (options.includeMcp) {
      edits.push(
        await jsonFileEdit(
          mcpPath(options.root, options.scope),
          (current) => withMcpServer(current, MCP_SERVER_NAME, standardMcpEntry(options.invoker)),
          'register MCP server',
        ),
      )
    }
    return applyAdapterEdits({
      root: options.root,
      adapterId: this.id,
      scope: options.scope,
      edits,
      dryRun: options.dryRun,
      notes: ['Restart Cursor after installing.', 'MCP server name: proofgate'],
    })
  },

  async uninstall(options): Promise<IntegrationChangeSet> {
    const edits = []
    const hooks = hooksPath(options.root, options.scope)
    if (await pathExists(hooks)) edits.push(await jsonFileEdit(hooks, removeHooks, 'remove stop hook'))
    const mcp = mcpPath(options.root, options.scope)
    if (await pathExists(mcp)) edits.push(await jsonFileEdit(mcp, (current) => withoutMcpServer(current, MCP_SERVER_NAME), 'remove MCP server'))
    return applyAdapterEdits({
      root: options.root,
      adapterId: this.id,
      scope: options.scope,
      edits,
      dryRun: options.dryRun,
      backup: false,
    })
  },

  async health(options): Promise<HealthRow[]> {
    const rows: HealthRow[] = []
    const hooks = await readTextIfExists(hooksPath(options.root, options.scope))
    rows.push(
      hooks?.includes(MARKER)
        ? { level: 'ok', message: 'Stop hook is configured.' }
        : { level: 'warn', message: 'Stop hook is not configured.' },
    )
    const mcp = await readTextIfExists(mcpPath(options.root, options.scope))
    rows.push(
      mcp?.includes(`"${MCP_SERVER_NAME}"`)
        ? { level: 'ok', message: 'MCP server is registered.' }
        : { level: 'warn', message: 'MCP server is not registered.' },
    )
    if (options.includeHooks) {
      rows.push(
        (await pathExists(projectPath(options.root, `.proofgate/hooks/${HOOK_NAME}.mjs`)))
          ? { level: 'ok', message: 'Hook wrapper exists.' }
          : { level: 'warn', message: 'Hook wrapper is missing.' },
      )
    }
    return rows
  },
}
