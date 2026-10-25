import {
  applyAdapterEdits,
  fileEdit,
  jsonFileEdit,
  pathExists,
  readTextIfExists,
  removeManagedBlock,
  standardMcpEntry,
  upsertManagedBlock,
  withMcpServer,
  withoutMcpServer,
  writeHookWrapper,
  verifyCommand,
  shellJoin,
  type AgentAdapter,
  type HealthRow,
} from '@proofgate/integration-sdk'
import { MCP_SERVER_NAME, projectPath } from '../common.js'

const AGENTS_BLOCK = `## ProofGate

Use ProofGate as the completion gate for this project.

1. Make the change.
2. Run \`proofgate verify\` (or call the \`proofgate_verify\` MCP tool).
3. Only report completion when the result is \`VERIFIED\`. If it is \`FAILED\`, \`INCOMPLETE\`, or \`UNVERIFIABLE\`, report the exact status and the failing checks.

Never edit \`.proofgate/acceptance.yaml\`, \`.proofgate/acceptance.lock.json\`, or files under \`.proofgate/runs/\`.
`

export const genericCliAdapter: AgentAdapter = {
  id: 'generic-cli',
  displayName: 'Generic CLI / agents',
  description: 'Documentation block, optional MCP registration, and a manual hook wrapper.',
  capabilities: {
    manualVerification: true,
    mcpVerification: true,
    automaticCompletionChecks: false,
    automaticFileChangeEvents: false,
    blockingFeedback: false,
    limitations: [
      'Generic agents have no standard hook protocol; ProofGate writes instructions and an optional wrapper you can call yourself.',
    ],
  },

  async detect() {
    return { installed: true, binFound: true, configFound: false }
  },

  async install(options) {
    const docs = projectPath(options.root, '.proofgate/PROOFGATE.md')
    const command = shellJoin(verifyCommand(options.invoker))
    const docsBefore = await readTextIfExists(docs)
    const docsAfter = `# ProofGate for this project

Run this before claiming work is complete:

\`\`\`sh
${command}
\`\`\`

Result meanings:

- \`VERIFIED\` — every required check and criterion produced passing evidence.
- \`FAILED\` — required work failed; the completion claim is not supported.
- \`INCOMPLETE\` — evidence is missing, skipped, or optional checks failed.
- \`UNVERIFIABLE\` — acceptance is unapproved or verification could not run.

Do not edit \`.proofgate/acceptance.yaml\` or the approval lock. Reports live under \`.proofgate/runs/\`.
`
    const agents = projectPath(options.root, 'AGENTS.md')
    const agentsBefore = await readTextIfExists(agents)
    const edits = [
      fileEdit(docs, docsBefore, docsAfter, 'write ProofGate instructions'),
      fileEdit(agents, agentsBefore, upsertManagedBlock(agentsBefore, AGENTS_BLOCK), 'add AGENTS.md instructions'),
    ]
    if (options.includeMcp) {
      edits.push(
        await jsonFileEdit(
          projectPath(options.root, '.mcp.json'),
          (current) => withMcpServer(current, MCP_SERVER_NAME, standardMcpEntry(options.invoker)),
          'register MCP server',
        ),
      )
    }
    if (options.includeHooks) {
      await writeHookWrapper({
        root: options.root,
        name: 'generic-cli-stop',
        invoker: options.invoker,
        provider: 'generic',
        extraArgs: ['--quiet'],
      })
    }
    return applyAdapterEdits({
      root: options.root,
      adapterId: this.id,
      scope: options.scope,
      edits,
      dryRun: options.dryRun,
      notes: ['AGENTS.md and .proofgate/PROOFGATE.md were updated with managed instructions.'],
    })
  },

  async uninstall(options) {
    const docs = projectPath(options.root, '.proofgate/PROOFGATE.md')
    const docsBefore = await readTextIfExists(docs)
    const agents = projectPath(options.root, 'AGENTS.md')
    const agentsBefore = await readTextIfExists(agents)
    const edits = [fileEdit(docs, docsBefore, null, 'remove ProofGate instructions')]
    if (agentsBefore !== null) {
      const after = removeManagedBlock(agentsBefore)
      edits.push(fileEdit(agents, agentsBefore, after.trim() ? after : null, 'remove AGENTS.md block'))
    }
    const mcp = projectPath(options.root, '.mcp.json')
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
    rows.push(
      (await pathExists(projectPath(options.root, '.proofgate/PROOFGATE.md')))
        ? { level: 'ok', message: 'Instructions are installed.' }
        : { level: 'warn', message: 'Instructions are missing.' },
    )
    if (options.includeMcp) {
      const mcp = await readTextIfExists(projectPath(options.root, '.mcp.json'))
      rows.push(
        mcp?.includes(`"${MCP_SERVER_NAME}"`)
          ? { level: 'ok', message: 'MCP server is registered.' }
          : { level: 'warn', message: 'MCP server is not registered.' },
      )
    }
    return rows
  },
}
