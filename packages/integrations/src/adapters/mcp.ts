import { ProofGateError } from '@proofgate/shared'
import {
  applyAdapterEdits,
  jsonFileEdit,
  pathExists,
  readTextIfExists,
  standardMcpEntry,
  withMcpServer,
  withoutMcpServer,
  type AgentAdapter,
  type HealthRow,
} from '@proofgate/integration-sdk'
import { MCP_SERVER_NAME, projectPath } from '../common.js'

export const universalMcpAdapter: AgentAdapter = {
  id: 'mcp',
  displayName: 'Universal MCP server',
  description: 'Writes a portable .mcp.json entry for any MCP-capable client.',
  capabilities: {
    manualVerification: true,
    mcpVerification: true,
    automaticCompletionChecks: false,
    automaticFileChangeEvents: false,
    blockingFeedback: false,
    limitations: [
      'The client must support stdio MCP servers and must be able to read .mcp.json (or you must copy the entry).',
      'MCP is on-demand: it does not verify automatically when an agent stops.',
    ],
  },

  async detect(root) {
    return { installed: true, binFound: false, configFound: await pathExists(projectPath(root, '.mcp.json')), configScope: 'project' as const }
  },

  async install(options) {
    if (options.scope !== 'project') {
      throw new ProofGateError('UNSUPPORTED', 'The universal MCP config is project-scoped', {
        hint: 'Run `proofgate integrations add mcp --scope project`, or copy the printed config into your client.',
      })
    }
    if (!options.includeMcp) return { files: [], notes: ['Nothing to install without MCP.'] }
    const target = projectPath(options.root, '.mcp.json')
    const edit = await jsonFileEdit(
      target,
      (current) => withMcpServer(current, MCP_SERVER_NAME, standardMcpEntry(options.invoker)),
      'register universal MCP server',
    )
    return applyAdapterEdits({
      root: options.root,
      adapterId: this.id,
      scope: 'project',
      edits: [edit],
      dryRun: options.dryRun,
      notes: ['MCP server name: proofgate', 'Restart the MCP client after installing.'],
    })
  },

  async uninstall(options) {
    const target = projectPath(options.root, '.mcp.json')
    if (!(await pathExists(target))) return { files: [], notes: [] }
    const edit = await jsonFileEdit(target, (current) => withoutMcpServer(current, MCP_SERVER_NAME), 'remove MCP server')
    return applyAdapterEdits({
      root: options.root,
      adapterId: this.id,
      scope: 'project',
      edits: [edit],
      dryRun: options.dryRun,
      backup: false,
    })
  },

  async health(options): Promise<HealthRow[]> {
    const text = await readTextIfExists(projectPath(options.root, '.mcp.json'))
    return [
      text?.includes(`"${MCP_SERVER_NAME}"`)
        ? { level: 'ok', message: 'MCP server is registered in .mcp.json.' }
        : { level: 'warn', message: '.mcp.json does not contain the ProofGate server.' },
    ]
  },
}
