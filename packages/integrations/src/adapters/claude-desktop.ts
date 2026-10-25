import { ProofGateError } from '@proofgate/shared'
import {
  applyAdapterEdits,
  claudeDesktopConfigPath,
  jsonFileEdit,
  pathExists,
  readTextIfExists,
  standardMcpEntry,
  withMcpServer,
  withoutMcpServer,
  type AgentAdapter,
  type HealthRow,
} from '@proofgate/integration-sdk'
import { MCP_SERVER_NAME } from '../common.js'

export const claudeDesktopAdapter: AgentAdapter = {
  id: 'claude-desktop',
  displayName: 'Claude Desktop',
  description: 'User-scope MCP server only; Claude Desktop has no project hooks.',
  capabilities: {
    manualVerification: true,
    mcpVerification: true,
    automaticCompletionChecks: false,
    automaticFileChangeEvents: false,
    blockingFeedback: false,
    limitations: [
      'Claude Desktop cannot run project hooks; verification is on demand through MCP or the CLI.',
      'Configuration is user-scoped and shared across Claude Desktop projects.',
    ],
  },

  async detect() {
    const config = claudeDesktopConfigPath()
    const configFound = await pathExists(config)
    return { installed: configFound, binFound: false, configFound, configScope: 'user' as const }
  },

  async install(options) {
    if (options.scope !== 'user') {
      throw new ProofGateError('UNSUPPORTED', 'Claude Desktop integrations are user-scoped only', {
        hint: 'Run `proofgate integrations add claude-desktop --scope user`.',
      })
    }
    if (!options.includeMcp) {
      return { files: [], notes: ['Claude Desktop only supports MCP; nothing to install.'] }
    }
    const target = claudeDesktopConfigPath()
    const edit = await jsonFileEdit(
      target,
      (current) => withMcpServer(current, MCP_SERVER_NAME, standardMcpEntry(options.invoker)),
      'register MCP server',
    )
    return applyAdapterEdits({
      root: options.root,
      adapterId: this.id,
      scope: 'user',
      edits: [edit],
      dryRun: options.dryRun,
      notes: ['Restart Claude Desktop after installing. MCP server name: proofgate'],
    })
  },

  async uninstall(options) {
    const target = claudeDesktopConfigPath()
    if (!(await pathExists(target))) return { files: [], notes: [] }
    const edit = await jsonFileEdit(target, (current) => withoutMcpServer(current, MCP_SERVER_NAME), 'remove MCP server')
    return applyAdapterEdits({
      root: options.root,
      adapterId: this.id,
      scope: 'user',
      edits: [edit],
      dryRun: options.dryRun,
      backup: false,
    })
  },

  async health(options): Promise<HealthRow[]> {
    const target = claudeDesktopConfigPath()
    const text = await readTextIfExists(target)
    if (text === null) return [{ level: 'warn', message: `Claude Desktop config not found at ${target}.` }]
    return [
      text.includes(`"${MCP_SERVER_NAME}"`)
        ? { level: 'ok', message: 'MCP server is registered.' }
        : { level: 'warn', message: 'MCP server is not registered.' },
    ]
  },
}
