import type { ProofGateConfig } from './schema.js'
import type { LoadedConfig } from './loader.js'

export interface EffectiveEntry {
  path: string
  value: unknown
  origin: 'config' | 'default'
}

/** Flatten the effective config into dotted paths, retaining schema-filled defaults. */
export function flattenConfig(config: unknown, prefix = ''): EffectiveEntry[] {
  if (config === null || typeof config !== 'object') {
    return prefix ? [{ path: prefix, value: config, origin: 'default' }] : []
  }
  if (Array.isArray(config)) {
    return config.flatMap((entry, index) => flattenConfig(entry, prefix ? `${prefix}.${index}` : String(index)))
  }
  const entries: EffectiveEntry[] = []
  for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
    const entryPath = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object') {
      entries.push(...flattenConfig(value, entryPath))
    } else {
      entries.push({ path: entryPath, value, origin: 'default' })
    }
  }
  return entries
}

function originFor(origins: Record<string, 'config' | 'default'>, key: string, prefix: string): 'config' | 'default' {
  if (origins[prefix]) return 'config'
  for (const [path, origin] of Object.entries(origins)) {
    if (path === key || path.startsWith(`${key}.`) || path.startsWith(`${key}[`)) return origin
  }
  return 'default'
}

export function explainConfig(loaded: LoadedConfig, query?: string): EffectiveEntry[] {
  const entries = flattenConfig(loaded.config)
  const normalizedQuery = query?.replace(/\[(\d+)\]/g, '.$1')
  return entries
    .filter((entry) => !normalizedQuery || entry.path === normalizedQuery || entry.path.startsWith(`${normalizedQuery}.`))
    .map((entry) => ({
      ...entry,
      origin: originFor(loaded.origins, entry.path, entry.path),
    }))
}

export function formatValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === null) return 'null'
  if (Array.isArray(value)) return value.length === 0 ? '[]' : JSON.stringify(value)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function summarizeConfig(config: ProofGateConfig): Array<{ label: string; value: string }> {
  return [
    { label: 'Config version', value: String(config.version) },
    { label: 'Project', value: config.project.name ?? '(unnamed)' },
    { label: 'Default profile', value: config.verification.profile },
    { label: 'Changed profile', value: config.verification.changedProfile },
    { label: 'Checks', value: String(config.checks.length) },
    { label: 'Required checks', value: String(config.checks.filter((check) => check.required).length) },
    { label: 'Parallelism', value: String(config.limits.maxParallelChecks) },
    { label: 'Check timeout', value: `${config.limits.timeoutSeconds}s` },
    { label: 'On failure', value: config.policy.onFailure },
    { label: 'Acceptance protected', value: config.guards.protectAcceptance ? 'yes' : 'no' },
    { label: 'Cache', value: config.cache.enabled ? 'enabled' : 'disabled' },
  ]
}

export function requiredCaveats(config: ProofGateConfig): string[] {
  const notes: string[] = []
  if (config.checks.length === 0) notes.push('No checks configured. Verification will return UNVERIFIABLE.')
  if (!config.guards.protectAcceptance) {
    notes.push('Acceptance protection is disabled; criteria can change without a new approval.')
  }
  if (!config.checks.some((check) => check.required)) {
    notes.push('No required checks. A run cannot produce VERIFIED.')
  }
  if (config.cache.enabled) {
    notes.push('Cached passes are reused only when the check intent, tree fingerprint, tools, and lockfile match.')
  }
  return notes
}
