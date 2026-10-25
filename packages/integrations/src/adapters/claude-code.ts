import path from 'node:path'
import {
  ProofGateError,
  nowIso,
  type ChangedFile,
  type IntegrationStateEntry,
} from '@proofgate/shared'
import {
  applyAdapterEdits,
  fileEdit,
  jsonFileEdit,
  pathExists,
  readTextIfExists,
  standardMcpEntry,
  withMcpServer,
  withoutMcpServer,
  writeHookWrapper,
  claudeUserSettingsPath,
  homeDir,
  type AgentAdapter,
  type AdapterInstallOptions,
  type AdapterUninstallOptions,
  type HealthRow,
  type IntegrationChangeSet,
} from '@proofgate/integration-sdk'
import { binaryFound, hookCommandFor, isRecord, MCP_SERVER_NAME, projectPath, removeOurHookCommands } from '../common.js'

const HOOK_NAME = 'claude-code-stop'
const MARKER = '.proofgate/hooks/claude-code-stop'

function settingsPath(root: string, scope: 'project' | 'user'): string {
  return scope === 'user' ? claudeUserSettingsPath() : projectPath(root, '.claude/settings.json')
}

function mcpPath(root: string, scope: 'project' | 'user'): string {
  return scope === 'user' ? path.join(homeDir(), '.claude.json') : projectPath(root, '.mcp.json')
}

function mergeHooks(current: Record<string, unknown>, wrapperPath: string): Record<string, unknown> {
  const hooks = isRecord(current.hooks) ? { ...current.hooks } : {}
  const existing = Array.isArray(hooks.Stop) ? hooks.Stop : []
  const filtered = removeOurHookCommands(existing, MARKER)
  const groups = Array.isArray(filtered) ? filtered : []
  groups.push({
    matcher: '',
    hooks: [
      {
        type: 'command',
        command: hookCommandFor(wrapperPath),
        timeout: 900,
      },
    ],
  })
  return { ...current, hooks: { ...hooks, Stop: groups } }
}

function removeHooks(current: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(current.hooks)) return current
  const hooks = { ...current.hooks }
  if (Array.isArray(hooks.Stop)) {
    const filtered = removeOurHookCommands(hooks.Stop, MARKER)
    if (Array.isArray(filtered) && filtered.length > 0) hooks.Stop = filtered
    else delete hooks.Stop
  }
  if (Object.keys(hooks).length === 0) {
    const next = { ...current }
    delete next.hooks
    return next
  }
  return { ...current, hooks }
}

export const claudeCodeAdapter: AgentAdapter = {
  id: 'claude-code',
  displayName: 'Claude Code',
  description: 'Project or user hooks on Stop plus a project MCP server.',
  capabilities: {
    manualVerification: true,
    mcpVerification: true,
    automaticCompletionChecks: true,
    automaticFileChangeEvents: false,
    blockingFeedback: true,
    limitations: [
      'Claude Code asks you to review new hooks; run `/hooks` once after installation.',
      'Blocking feedback is only used when policy.onFailure is "block".',
      'User-scope hooks reuse the wrapper in this project; they will not work from another project.',
    ],
  },

  async detect(root) {
    const binFound = binaryFound('claude', root)
    const projectSettings = await pathExists(settingsPath(root, 'project'))
    const userSettings = await pathExists(settingsPath(root, 'user'))
    return {
      installed: binFound || projectSettings || userSettings,
      binFound,
      configFound: projectSettings || userSettings,
      ...(projectSettings ? { configScope: 'project' as const } : userSettings ? { configScope: 'user' as const } : {}),
    }
  },

  async install(options) {
    const wrapper = await writeHookWrapper({
      root: options.root,
      name: HOOK_NAME,
      invoker: options.invoker,
      provider: 'claude',
      extraArgs: ['--quiet'],
    })
    const wrapperPath = path.relative(options.root, wrapper.path)
    const edits = []
    if (options.includeHooks) {
      edits.push(
        await jsonFileEdit(
          settingsPath(options.root, options.scope),
          (current) => mergeHooks(current, wrapperPath),
          'add Stop hook',
        ),
      )
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
      notes: [
        'Open Claude Code and run `/hooks` to review and trust the ProofGate Stop hook.',
        ...(options.includeMcp ? ['MCP server name: proofgate'] : []),
      ],
    })
  },

  async uninstall(options) {
    const edits = []
    const settings = settingsPath(options.root, options.scope)
    if (await pathExists(settings)) {
      edits.push(await jsonFileEdit(settings, removeHooks, 'remove ProofGate Stop hook'))
    }
    const mcp = mcpPath(options.root, options.scope)
    if (await pathExists(mcp)) {
      edits.push(await jsonFileEdit(mcp, (current) => withoutMcpServer(current, MCP_SERVER_NAME), 'remove MCP server'))
    }
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
    const wrapper = projectPath(options.root, `.proofgate/hooks/${HOOK_NAME}.mjs`)
    if (options.includeHooks) {
      rows.push(
        (await pathExists(wrapper))
          ? { level: 'ok', message: 'Hook wrapper exists.' }
          : { level: 'warn', message: 'Hook wrapper missing; reinstall the integration.' },
      )
      const text = await readTextIfExists(settingsPath(options.root, options.scope))
      rows.push(
        text?.includes(MARKER)
          ? { level: 'ok', message: `Stop hook is configured in ${settingsPath(options.root, options.scope)}.` }
          : { level: 'warn', message: 'Stop hook is not configured for this scope.' },
      )
    }
    if (options.includeMcp) {
      const mcp = await readTextIfExists(mcpPath(options.root, options.scope))
      rows.push(
        mcp?.includes(`"${MCP_SERVER_NAME}"`)
          ? { level: 'ok', message: 'MCP server is registered.' }
          : { level: 'warn', message: 'MCP server is not registered for this scope.' },
      )
    }
    return rows
  },
}

export { settingsPath as claudeCodeSettingsPath }
