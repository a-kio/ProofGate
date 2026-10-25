import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { PROOFGATE_VERSION } from '@proofgate/core'
import type { VerificationRunV1, TriggerKind, VerificationProfile } from '@proofgate/core'
import { loadConfig } from '@proofgate/config'
import { runVerification } from '@proofgate/verification'
import { RunStore } from '@proofgate/evidence'

export interface McpServerOptions {
  /** the single authorized project root; requests may target this root only */
  root: string
  /** hard cap for verification wall time started via MCP (ms) */
  verifyTimeoutMs?: number
}

const PROFILES: VerificationProfile[] = ['fast', 'balanced', 'thorough']

function text(content: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }],
  }
}

function errText(message: string) {
  return { ...text(message), isError: true }
}

function summarizeRun(run: VerificationRunV1): string {
  const lines = [
    `run ${run.runId}`,
    `status: ${run.status}`,
    `profile: ${run.profile}`,
    ...run.checks.map((c) => `  ${c.status.padEnd(8)} ${c.title ?? c.checkId}${c.reason ? ` — ${c.reason}` : ''}`),
  ]
  return lines.join('\n')
}

/**
 * Local ProofGate MCP server (stdio transport).
 * It exposes verification against ONE authorized project root — the directory
 * the server was started in. It never grants arbitrary filesystem or shell access.
 */
export function createProofGateMcpServer(options: McpServerOptions): { server: McpServer; start: () => Promise<void> } {
  const root = options.root
  const server = new McpServer(
    { name: 'proofgate', version: PROOFGATE_VERSION },
    { instructions: 'ProofGate verifies completed AI coding work with real, reproducible evidence.' },
  )

  server.registerTool(
    'proofgate_verify',
    {
      title: 'Run ProofGate verification',
      description:
        'Run the configured verification suite for the authorized project. Use the default profile unless the user asked otherwise. Results are evidence-backed, not model-generated.',
      inputSchema: {
        profile: z.enum(['fast', 'balanced', 'thorough']).optional().describe('verification profile'),
        changed: z.boolean().optional().describe('restrict to checks relevant to changed files'),
        task: z.string().max(300).optional().describe('task context for the report'),
      },
    },
    async (input) => {
      try {
        const { config } = await loadConfig(root)
        const profile = (input.profile ? PROFILES.find((p) => p === input.profile) : undefined) as VerificationProfile | undefined
        const outcome = await runVerification({
          root,
          config,
          profile,
          changed: input.changed,
          task: input.task,
          trigger: 'mcp' as TriggerKind,
          provider: 'mcp',
        })
        if (outcome.kind === 'deduplicated') {
          return text(`another verification run is in progress (pid ${outcome.holder.pid}) — this request was deduplicated`)
        }
        if (outcome.kind === 'error') return errText(outcome.error)
        return text(summarizeRun(outcome.run))
      } catch (e) {
        return errText(String(e))
      }
    },
  )

  server.registerTool('proofgate_get_status', { title: 'Latest verification status', description: 'Return the latest verification run status.' }, async () => {
    const run = await new RunStore(root).latestRun()
    if (!run) return text('no verification run recorded yet')
    return text(summarizeRun(run))
  })

  server.registerTool(
    'proofgate_get_report',
    { title: 'Full verification report', description: 'Return the complete JSON report for the latest (or given) run.' },
    async () => {
      const run = await new RunStore(root).latestRun()
      if (!run) return errText('no verification run recorded yet')
      return text(JSON.stringify(run, null, 2))
    },
  )

  server.registerTool('proofgate_list_checks', { title: 'List checks', description: 'List checks configured in .proofgate/config.yaml.' }, async () => {
    try {
      const { config } = await loadConfig(root)
      return text(
        config.checks.map(
          (c) => `${c.id}  [${c.profiles.join(',')}]  required=${c.required}  argv=${JSON.stringify(c.run)}`,
        ).join('\n') || '(no checks configured)',
      )
    } catch (e) {
      return errText(String(e))
    }
  })

  server.registerTool('proofgate_get_failures', { title: 'List failures', description: 'Return actionable failed checks with evidence paths.' }, async () => {
    const run = await new RunStore(root).latestRun()
    if (!run) return errText('no verification run recorded yet')
    const failures = run.checks.filter((c) => c.status === 'FAIL' || c.status === 'ERROR' || c.status === 'BLOCKED')
    if (failures.length === 0) return text('no failed checks in the latest run')
    return text(failures.map((c) => `${c.checkId}: ${c.reason ?? `exit ${c.exitCode ?? '?'}`} (evidence: ${c.evidencePath ?? 'none'})`).join('\n'))
  })

  server.registerTool('proofgate_get_acceptance_criteria', { title: 'Acceptance criteria', description: 'Read configured acceptance criteria and approval state.' }, async () => {
    try {
      const { config } = await loadConfig(root)
      const { loadAcceptance, loadAcceptanceState } = await import('@proofgate/config')
      const loaded = await loadAcceptance(root, config.checks)
      if (loaded.kind === 'missing') return text('no acceptance criteria defined (.proofgate/acceptance.yaml)')
      if (loaded.kind === 'invalid') return errText(`acceptance criteria invalid:\n${loaded.error}`)
      const state = await loadAcceptanceState(root)
      return text(
        [
          `task: ${loaded.data.task ?? '(unspecified)'}`,
          ...loaded.data.criteria.map((c) => `  - ${c.id} [${c.kind}${c.required ? ', required' : ', optional'}] ${c.description}`),
          `approved: ${state.approvedAcceptanceHash ? 'yes' : 'no'}`,
          `changed since approval: ${state.approvedAcceptanceHash && state.approvedAcceptanceHash !== loaded.hash ? 'YES — run `proofgate accept`' : 'no'}`,
        ].join('\n'),
      )
    } catch (e) {
      return errText(String(e))
    }
  })

  server.registerTool('proofgate_detect_project', { title: 'Detect project', description: 'Return detected project type summary for the authorized root.' }, async () => {
    try {
      const { detectProject, suggestChecks } = await import('@proofgate/project-detection')
      if (!detectProject) return errText('detection unavailable')
      const det = await detectProject(root)
      const suggestions = suggestChecks(det)
      return text(JSON.stringify({ ecosystems: det.ecosystems, toolchains: det.toolchains, packageManager: det.packageManager?.name, hasGit: det.hasGit, suggestedChecks: suggestions.map((s) => s.id) }, null, 2))
    } catch (e) {
      return errText(String(e))
    }
  })

  server.registerTool('proofgate_get_integration_status', { title: 'Integration status', description: 'Return which agent integrations are configured in this project.' }, async () => {
    try {
      const { listIntegrationsStatus } = await import('@proofgate/integrations')
      const rows = await listIntegrationsStatus(root)
      return text(rows.map((r) => `${r.id.padEnd(16)} ${r.installed ? 'installed' : 'not installed'}  (auto-completion checks: ${r.capabilities.automaticCompletionChecks ? 'yes' : 'no'})`).join('\n'))
    } catch (e) {
      return errText(String(e))
    }
  })

  const start = async (): Promise<void> => {
    const transport = new StdioServerTransport()
    await server.connect(transport)
  }

  return { server, start }
}

/** Entry used by `proofgate mcp`; keeps stdout clean for the protocol. */
export async function startMcpServer(root: string): Promise<void> {
  const { start } = createProofGateMcpServer({ root, verifyTimeoutMs: 10 * 60_000 })
  await start()
}
