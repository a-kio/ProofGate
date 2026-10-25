import path from 'node:path'
import {
  applyAdapterEdits,
  geminiHome,
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
import { binaryFound, hookCommandFor, isRecord, MCP_SERVER_NAME, projectPath, removeOurHookCommands } from '../common.js'

const HOOK_NAME = 'gemini-stop'
const MARKER = '.proofgate/hooks/gemini-stop'

function configPath(root: string, scope: 'project' | 'user'): string {
  return scope === 'user' ? path.join(geminiHome(), 'settings.json') : projectPath(root, '.gemini/settings.json')
}

function mergeHooks(current: Record<string, unknown>, wrapperPath: string): Record<string, unknown> {
  const hooks = isRecord(current.hooks) ? { ...current.hooks } : {}
  const existing = Array.isArray(hooks.AfterAgent) ? hooks.AfterAgent : []
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
  return { ...current, hooks: { ...hooks, AfterAgent: groups } }
}

function removeHooks(current: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(current.hooks)) return current
  const hooks = { ...current.hooks }
  if (Array.isArray(hooks.AfterAgent)) {
    const filtered = removeOurHookCommands(hooks.AfterAgent, MARKER)
    if (Array.isArray(filtered) && filtered.length > 0) hooks.AfterAgent = filtered
    else delete hooks.AfterAgent
  }
  if (Object.keys(hooks).length === 0) {
    const next = { ...current }
    delete next.hooks
    return next
  }
  return { ...current, hooks }
}

export const geminiAdapter: AgentAdapter = {
  id: 'gemini',
  displayName: 'Gemini CLI',
  description: 'AfterAgent hook and MCP server for Gemini CLI.',
  capabilities: {
    manualVerification: true,
    mcpVerification: true,
    automaticCompletionChecks: true,
    automaticFileChangeEvents: false,
    blockingFeedback: false,
    limitations: [
      'Hook output is strict JSON; ProofGate suppresses human output when invoked by the hook.',
      'Gemini CLI is being replaced by Antigravity CLI; re-check the integration after switching.',
    ],
  },

  async detect(root) {
    const binFound = binaryFound('gemini', root)
    const projectConfig = await pathExists(configPath(root, 'project'))
    const userConfig = await pathExists(configPath(root, 'user'))
    return {
      installed: binFound || projectConfig || userConfig,
      binFound,
      configFound: projectConfig || userConfig,
      ...(projectConfig ? { configScope: 'project' as const } : userConfig ? { configScope: 'user' as const } : {}),
    }
  },

  async install(options): Promise<IntegrationChangeSet> {
    let wrapperPath: string | undefined
    if (options.includeHooks) {
      const wrapper = await writeHookWrapper({
        root: options.root,
        name: HOOK_NAME,
        invoker: options.invoker,
        provider: 'gemini',
        extraArgs: ['--quiet'],
      })
      wrapperPath = path.relative(options.root, wrapper.path)
    }
    const edits = []
    if (wrapperPath || options.includeMcp) {
      edits.push(
        await jsonFileEdit(
          configPath(options.root, options.scope),
          (current) => {
            let next = wrapperPath ? mergeHooks(current, wrapperPath) : current
            if (options.includeMcp) next = withMcpServer(next, MCP_SERVER_NAME, standardMcpEntry(options.invoker))
            return next
          },
          'configure ProofGate hook and MCP server',
        ),
      )
    }
    return applyAdapterEdits({
      root: options.root,
      adapterId: this.id,
      scope: options.scope,
      edits,
      dryRun: options.dryRun,
      notes: ['MCP server name: proofgate', 'Gemini CLI requires JSON-only stdout from hooks; ProofGate complies.'],
    })
  },

  async uninstall(options): Promise<IntegrationChangeSet> {
    const target = configPath(options.root, options.scope)
    const edits = []
    if (await pathExists(target)) {
      edits.push(
        await jsonFileEdit(
          target,
          (current) => withoutMcpServer(removeHooks(current), MCP_SERVER_NAME),
          'remove ProofGate hook and MCP server',
        ),
      )
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
    const text = await readTextIfExists(configPath(options.root, options.scope))
    const rows: HealthRow[] = []
    rows.push(
      text?.includes(MARKER)
        ? { level: 'ok', message: 'AfterAgent hook is configured.' }
        : { level: 'warn', message: 'AfterAgent hook is not configured.' },
    )
    rows.push(
      text?.includes(`"${MCP_SERVER_NAME}"`)
        ? { level: 'ok', message: 'MCP server is registered.' }
        : { level: 'warn', message: 'MCP server is not registered.' },
    )
    return rows
  },
}
