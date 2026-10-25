import { ProofGateError } from '@proofgate/shared'
import {
  applyAdapterEdits,
  jsonFileEdit,
  pathExists,
  readTextIfExists,
  standardMcpEntry,
  windsurfMcpConfigPath,
  withMcpServer,
  withoutMcpServer,
  type AgentAdapter,
  type HealthRow,
} from '@proofgate/integration-sdk'
import { binaryFound, MCP_SERVER_NAME } from '../common.js'

export const windsurfAdapter: AgentAdapter = {
  id: 'windsurf',
  displayName: 'Windsurf',
  description: 'User-scope MCP server. Windsurf has no documented project hook API.',
  capabilities: {
    manualVerification: true,
    mcpVerification: true,
    automaticCompletionChecks: false,
    automaticFileChangeEvents: false,
    blockingFeedback: false,
    limitations: [
      'Windsurf exposes no documented hook mechanism, so ProofGate cannot verify automatically on completion.',
      'MCP configuration is user-scoped and applies to every Windsurf workspace.',
    ],
  },

  async detect(root) {
    const binFound = binaryFound('windsurf', root)
    const config = windsurfMcpConfigPath()
    const configFound = await pathExists(config)
    return { installed: binFound || configFound, binFound, configFound, configScope: 'user' as const }
  },

  async install(options) {
    if (options.scope !== 'user') {
      throw new ProofGateError('UNSUPPORTED', 'Windsurf MCP configuration is user-scoped only', {
        hint: 'Run `proofgate integrations add windsurf --scope user`.',
      })
    }
    if (!options.includeMcp) return { files: [], notes: ['Windsurf only supports MCP; nothing to install.'] }
    const target = windsurfMcpConfigPath()
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
      notes: ['Restart Windsurf after installing.', 'MCP server name: proofgate'],
    })
  },

  async uninstall(options) {
    const target = windsurfMcpConfigPath()
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

  async health(): Promise<HealthRow[]> {
    const target = windsurfMcpConfigPath()
    const text = await readTextIfExists(target)
    if (text === null) return [{ level: 'warn', message: `Windsurf MCP config not found at ${target}.` }]
    return [
      text.includes(`"${MCP_SERVER_NAME}"`)
        ? { level: 'ok', message: 'MCP server is registered.' }
        : { level: 'warn', message: 'MCP server is not registered.' },
    ]
  },
}
