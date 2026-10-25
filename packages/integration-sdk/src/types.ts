export const ADAPTER_IDS = [
  'claude-code',
  'claude-desktop',
  'codex',
  'opencode-v1',
  'opencode-v2',
  'cursor',
  'gemini',
  'windsurf',
  'generic-cli',
  'mcp',
] as const

export type AdapterId = (typeof ADAPTER_IDS)[number]
export type IntegrationScope = 'project' | 'user'

export interface IntegrationCapabilities {
  /** A human or agent can run `proofgate verify` from this tool. */
  manualVerification: boolean
  /** The tool can call the local MCP server for on-demand verification. */
  mcpVerification: boolean
  /** Completion events can invoke verification automatically. */
  automaticCompletionChecks: boolean
  /** File-change events are available to the integration. */
  automaticFileChangeEvents: boolean
  /** The integration can return a failure summary to the agent. */
  blockingFeedback: boolean
  /** Honest disclosure of what the integration cannot do. */
  limitations: string[]
}

export interface AdapterDetectResult {
  installed: boolean
  /** The tool binary appears to be on PATH. */
  binFound: boolean
  configFound: boolean
  /** The scope where the tool's configuration was found. */
  configScope?: IntegrationScope
  detail?: string
}

export type InvokerKind = 'node-entry' | 'global' | 'npx'

export interface Invoker {
  kind: InvokerKind
  /** Absolute path to the ProofGate CLI entry point for `node-entry`. */
  entryPath?: string
  /** npm package spec for `npx`, default `@proofgate/cli`. */
  packageSpec?: string
}

export interface CommandSpec {
  command: string
  args: string[]
}

export interface AdapterInstallOptions {
  root: string
  scope: IntegrationScope
  invoker: Invoker
  includeMcp: boolean
  includeHooks: boolean
  /** Compute the change set without touching disk. */
  dryRun?: boolean
  /** Overwrite conflicting ProofGate-managed entries instead of preserving them. */
  force?: boolean
}

export interface AdapterUninstallOptions {
  root: string
  scope: IntegrationScope
  dryRun?: boolean
}

export interface ChangedFile {
  path: string
  action: 'created' | 'updated' | 'removed' | 'unchanged'
  backup?: string
  /** Short human-readable summary of the edit. */
  note?: string
}

export interface IntegrationChangeSet {
  files: ChangedFile[]
  notes: string[]
}

export interface HealthRow {
  level: 'ok' | 'warn' | 'error'
  message: string
}

export interface AgentAdapter {
  id: AdapterId
  displayName: string
  /** One-line description of the integration surface. */
  description: string
  capabilities: IntegrationCapabilities
  detect(root: string): Promise<AdapterDetectResult>
  install(options: AdapterInstallOptions): Promise<IntegrationChangeSet>
  uninstall(options: AdapterUninstallOptions): Promise<IntegrationChangeSet>
  health(options: AdapterInstallOptions): Promise<HealthRow[]>
}

export const INTEGRATION_MARKER = 'proofgate-managed'

export function isAdapterId(value: string): value is AdapterId {
  return (ADAPTER_IDS as readonly string[]).includes(value)
}
