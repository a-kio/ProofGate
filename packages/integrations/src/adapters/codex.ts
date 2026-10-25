import path from 'node:path'
import {
  applyAdapterEdits,
  codexHome,
  fileEdit,
  mcpCommand,
  pathExists,
  readTextIfExists,
  removeManagedBlock,
  removeTomlTable,
  upsertManagedBlock,
  upsertTomlTable,
  hasTomlTable,
  type AgentAdapter,
  type HealthRow,
} from '@proofgate/integration-sdk'
import { binaryFound, MCP_SERVER_NAME, projectPath } from '../common.js'

const BLOCK = `## ProofGate verification

This project uses ProofGate as the independent completion gate.

- Before claiming a task is complete, call the \`proofgate_verify\` MCP tool or run \`proofgate verify\`.
- A result other than \`VERIFIED\` means the task is not proven complete. Read the failing checks and fix them.
- Do not edit \`.proofgate/acceptance.yaml\` or the approval lock. Acceptance is human-owned.
- Evidence is stored under \`.proofgate/runs/\`; reports contain real command output, not model claims.
`

function configPath(root: string, scope: 'project' | 'user'): string {
  return scope === 'user' ? path.join(codexHome(), 'config.toml') : projectPath(root, '.codex/config.toml')
}

function agentsPath(root: string, scope: 'project' | 'user'): string {
  return scope === 'user' ? path.join(codexHome(), 'AGENTS.md') : projectPath(root, 'AGENTS.md')
}

export const codexAdapter: AgentAdapter = {
  id: 'codex',
  displayName: 'Codex CLI',
  description: 'MCP server plus AGENTS.md guidance. Hook trust is left to the user.',
  capabilities: {
    manualVerification: true,
    mcpVerification: true,
    automaticCompletionChecks: false,
    automaticFileChangeEvents: false,
    blockingFeedback: false,
    limitations: [
      'Codex requires explicit trust review for hooks, so ProofGate installs MCP and instructions instead of a hook.',
      'Use the proofgate_verify tool or `proofgate verify` before declaring completion.',
    ],
  },

  async detect(root) {
    const binFound = binaryFound('codex', root)
    const projectConfig = await pathExists(configPath(root, 'project'))
    const userConfig = await pathExists(configPath(root, 'user'))
    return {
      installed: binFound || projectConfig || userConfig,
      binFound,
      configFound: projectConfig || userConfig,
      ...(projectConfig ? { configScope: 'project' as const } : userConfig ? { configScope: 'user' as const } : {}),
    }
  },

  async install(options) {
    const target = configPath(options.root, options.scope)
    const before = await readTextIfExists(target)
    const command = mcpCommand(options.invoker)
    const after = upsertTomlTable(before ?? '', ['mcp_servers', MCP_SERVER_NAME], {
      command: command.command,
      args: command.args,
    })
    const agents = agentsPath(options.root, options.scope)
    const agentsBefore = await readTextIfExists(agents)
    const agentsAfter = options.includeMcp ? upsertManagedBlock(agentsBefore, BLOCK, { prepend: true }) : agentsBefore
    const notes = [
      'MCP server name: proofgate',
      'Hooks are not installed: Codex requires explicit trust review. Use MCP or `proofgate verify`.',
    ]
    return applyAdapterEdits({
      root: options.root,
      adapterId: this.id,
      scope: options.scope,
      edits: [
        fileEdit(target, before, after, 'register MCP server in Codex config'),
        fileEdit(agents, agentsBefore, agentsAfter, 'add ProofGate instructions'),
      ],
      dryRun: options.dryRun,
      notes,
    })
  },

  async uninstall(options) {
    const target = configPath(options.root, options.scope)
    const before = await readTextIfExists(target)
    const after = before === null ? null : removeTomlTable(before, ['mcp_servers', MCP_SERVER_NAME])
    const agents = agentsPath(options.root, options.scope)
    const agentsBefore = await readTextIfExists(agents)
    const agentsAfter = agentsBefore === null ? null : removeManagedBlock(agentsBefore)
    return applyAdapterEdits({
      root: options.root,
      adapterId: this.id,
      scope: options.scope,
      edits: [
        fileEdit(target, before, after, 'remove MCP server'),
        fileEdit(agents, agentsBefore, agentsAfter, 'remove ProofGate instructions'),
      ],
      dryRun: options.dryRun,
      backup: false,
    })
  },

  async health(options): Promise<HealthRow[]> {
    const target = configPath(options.root, options.scope)
    const text = await readTextIfExists(target)
    const rows: HealthRow[] = []
    rows.push(
      text && hasTomlTable(text, ['mcp_servers', MCP_SERVER_NAME])
        ? { level: 'ok', message: `MCP server registered in ${target}.` }
        : { level: 'warn', message: `MCP server is not registered in ${target}.` },
    )
    const agents = await readTextIfExists(agentsPath(options.root, options.scope))
    rows.push(
      agents?.includes('proofgate:start')
        ? { level: 'ok', message: 'AGENTS.md guidance is installed.' }
        : { level: 'warn', message: 'AGENTS.md guidance is missing.' },
    )
    return rows
  },
}
