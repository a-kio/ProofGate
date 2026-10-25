import { ProofGateError } from '@proofgate/shared'
import type {
  AdapterDetectResult,
  AdapterId,
  AdapterInstallOptions,
  AdapterUninstallOptions,
  AgentAdapter,
  HealthRow,
  IntegrationChangeSet,
  IntegrationScope,
} from '@proofgate/integration-sdk'
import { ADAPTER_IDS } from '@proofgate/integration-sdk'
import { claudeCodeAdapter } from './adapters/claude-code.js'
import { claudeDesktopAdapter } from './adapters/claude-desktop.js'
import { codexAdapter } from './adapters/codex.js'
import { openCodeV1Adapter, openCodeV2Adapter } from './adapters/opencode.js'
import { cursorAdapter } from './adapters/cursor.js'
import { geminiAdapter } from './adapters/gemini.js'
import { windsurfAdapter } from './adapters/windsurf.js'
import { genericCliAdapter } from './adapters/generic-cli.js'
import { universalMcpAdapter } from './adapters/mcp.js'

const ADAPTERS: Record<AdapterId, AgentAdapter> = {
  'claude-code': claudeCodeAdapter,
  'claude-desktop': claudeDesktopAdapter,
  codex: codexAdapter,
  'opencode-v1': openCodeV1Adapter,
  'opencode-v2': openCodeV2Adapter,
  cursor: cursorAdapter,
  gemini: geminiAdapter,
  windsurf: windsurfAdapter,
  'generic-cli': genericCliAdapter,
  mcp: universalMcpAdapter,
}

export function listAdapters(): AgentAdapter[] {
  return ADAPTER_IDS.map((id) => ADAPTERS[id])
}

export function getAdapter(id: string): AgentAdapter {
  const adapter = ADAPTERS[id as AdapterId]
  if (!adapter) {
    throw new ProofGateError('INTEGRATION_UNKNOWN', `Unknown integration "${id}"`, {
      hint: `Available integrations: ${ADAPTER_IDS.join(', ')}`,
    })
  }
  return adapter
}

export function defaultScopeFor(id: AdapterId): IntegrationScope {
  return id === 'claude-desktop' || id === 'windsurf' ? 'user' : 'project'
}

export interface AdapterDetection {
  adapter: AgentAdapter
  detection: AdapterDetectResult
}

export async function detectIntegrations(root: string): Promise<AdapterDetection[]> {
  const results: AdapterDetection[] = []
  for (const adapter of listAdapters()) {
    try {
      results.push({ adapter, detection: await adapter.detect(root) })
    } catch (error) {
      results.push({
        adapter,
        detection: {
          installed: false,
          binFound: false,
          configFound: false,
          detail: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }
  return results
}

export function normalizeInstallOptions(
  adapter: AgentAdapter,
  options: Omit<AdapterInstallOptions, 'includeMcp' | 'includeHooks'> & {
    includeMcp?: boolean
    includeHooks?: boolean
  },
): AdapterInstallOptions {
  return {
    ...options,
    scope: options.scope ?? defaultScopeFor(adapter.id),
    includeMcp: options.includeMcp ?? adapter.capabilities.mcpVerification,
    includeHooks: options.includeHooks ?? adapter.capabilities.automaticCompletionChecks,
  }
}

export async function installIntegration(
  id: string,
  options: Omit<AdapterInstallOptions, 'includeMcp' | 'includeHooks'> & {
    includeMcp?: boolean
    includeHooks?: boolean
  },
): Promise<{ adapter: AgentAdapter; changes: IntegrationChangeSet }> {
  const adapter = getAdapter(id)
  return {
    adapter,
    changes: await adapter.install(normalizeInstallOptions(adapter, options)),
  }
}

export async function uninstallIntegration(
  id: string,
  options: AdapterUninstallOptions,
): Promise<{ adapter: AgentAdapter; changes: IntegrationChangeSet }> {
  const adapter = getAdapter(id)
  return {
    adapter,
    changes: await adapter.uninstall({ ...options, scope: options.scope ?? defaultScopeFor(adapter.id) }),
  }
}

export async function integrationHealth(
  id: string,
  options: AdapterInstallOptions,
): Promise<{ adapter: AgentAdapter; rows: HealthRow[] }> {
  const adapter = getAdapter(id)
  return {
    adapter,
    rows: await adapter.health({ ...options, scope: options.scope ?? defaultScopeFor(adapter.id) }),
  }
}

export { ADAPTER_IDS }
export type { AgentAdapter, AdapterId, AdapterInstallOptions, AdapterUninstallOptions, IntegrationScope }
