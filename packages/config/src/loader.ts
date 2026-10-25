import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  ACCEPTANCE_REL_PATH,
  CONFIG_REL_PATH,
  ProofGateError,
  PROOFGATE_DIR,
  normalizeRelative,
  sha256Json,
} from '@proofgate/shared'
import YAML from 'yaml'
import {
  acceptanceSchema,
  configSchema,
  ConfigError,
  type AcceptanceFile,
  type ConfigIssue,
  type ProofGateConfig,
} from './schema.js'

export { ConfigError } from './schema.js'
export type { ConfigIssue } from './schema.js'

const MAX_CONFIG_BYTES = 2 * 1024 * 1024

export interface ConfigLocation {
  root: string
  configPath: string
}

export interface LoadedConfig {
  config: ProofGateConfig
  path: string
  raw: Record<string, unknown>
  /** Dotted key → "config" when authored, "default" when filled by the schema. */
  origins: Record<string, 'config' | 'default'>
  text: string
  hash: string
}

export function findConfigRoot(startDir: string): ConfigLocation | null {
  let dir = path.resolve(startDir)
  for (;;) {
    const candidate = path.join(dir, CONFIG_REL_PATH)
    if (fs.existsSync(candidate)) return { root: dir, configPath: candidate }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function configPathFor(root: string): string {
  return path.join(root, CONFIG_REL_PATH)
}

export function acceptancePathFor(root: string): string {
  return path.join(root, ACCEPTANCE_REL_PATH)
}

export function proofGateDirOf(root: string): string {
  return path.join(root, PROOFGATE_DIR)
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fsp.stat(filePath)
    return stat.isFile()
  } catch {
    return false
  }
}

export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fsp.stat(dirPath)
    return stat.isDirectory()
  } catch {
    return false
  }
}

export async function atomicWriteFile(targetPath: string, contents: string): Promise<void> {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true })
  const tempPath = `${targetPath}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`
  try {
    await fsp.writeFile(tempPath, contents, 'utf8')
    await fsp.rename(tempPath, targetPath)
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function writeJsonFile(targetPath: string, value: unknown): Promise<void> {
  await atomicWriteFile(targetPath, `${JSON.stringify(value, null, 2)}\n`)
}

export function parseYaml(text: string, source: string): unknown {
  try {
    return YAML.parse(text, { prettyErrors: true, uniqueKeys: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ConfigError(`Invalid YAML in ${source}:\n${message}`, [])
  }
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = current
    }
  }
  return row[b.length]!
}

const KNOWN_KEYS = new Set([
  'version', 'project', 'verification', 'checks', 'limits', 'policy', 'guards', 'cache', 'retention',
  'integrations', 'name', 'profile', 'changedProfile', 'base', 'ignorePaths', 'timeoutSeconds',
  'maxParallelChecks', 'maxOutputBytes', 'onFailure', 'concurrentRuns', 'failureFeedback', 'retryLimit',
  'optionalFailures', 'forbiddenPaths', 'maxChangedFiles', 'protectAcceptance', 'enabled',
  'maxEntries', 'maxAgeDays', 'maxRuns', 'scope', 'invoker', 'id', 'title', 'type', 'required',
  'profiles', 'appliesTo', 'dependsOn', 'description', 'run', 'cwd', 'env', 'expectExitCode',
  'expectStdout', 'expectStderr', 'url', 'method', 'headers', 'body', 'expectStatus',
  'expectBodyContains', 'allowRemote', 'files', 'pattern', 'minBytes', 'maxBytes', 'mustNotExist',
  'paths', 'allow', 'maxFileBytes', 'patterns',
])

function suggestKey(key: string): string | undefined {
  // Unknown-key messages from Zod include the key; match it once.
  let best: { key: string; distance: number } | undefined
  for (const candidate of KNOWN_KEYS) {
    if (candidate === key) continue
    const distance = levenshtein(key.toLowerCase(), candidate.toLowerCase())
    if (distance <= 2 && (!best || distance < best.distance)) best = { key: candidate, distance }
  }
  return best?.key
}

export function formatZodIssues(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): ConfigIssue[] {
  return issues
    .map((issue) => {
      const issuePath = issue.path.map((part) => String(part)).join('.')
      let message = issue.message
      let suggestion: string | undefined
      const unknown = /Unrecognized key[s]?:?\s*"([^"]+)"/.exec(message) ?? /unrecognized key[s]?:?\s*"([^"]+)"/i.exec(message)
      const badKey = unknown?.[1]
      if (badKey) {
        message = `unknown key "${badKey}"`
        suggestion = suggestKey(badKey)
      }
      return { path: issuePath || '(root)', message, suggestion }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
}

function renderIssues(issues: ConfigIssue[]): string {
  return issues
    .map((issue) => {
      const hint = issue.suggestion ? ` (did you mean "${issue.suggestion}"?)` : ''
      return `  - ${issue.path}: ${issue.message}${hint}`
    })
    .join('\n')
}

export async function loadConfig(
  root: string,
  options: { required?: boolean } = {},
): Promise<LoadedConfig> {
  const configPath = configPathFor(root)
  if (!(await fileExists(configPath))) {
    if (options.required === false) {
      const parsed = configSchema.parse({ version: 1 })
      return {
        config: parsed,
        path: configPath,
        raw: {},
        origins: {},
        text: '',
        hash: sha256Json(parsed),
      }
    }
    throw new ConfigError(
      `No ProofGate config found at ${configPath}\nRun \`proofgate init\` to create one.`,
      [],
    )
  }
  const stat = await fsp.stat(configPath)
  if (stat.size > MAX_CONFIG_BYTES) {
    throw new ConfigError(`Config is too large (${stat.size} bytes, limit ${MAX_CONFIG_BYTES}): ${configPath}`, [])
  }
  let text: string
  try {
    text = await fsp.readFile(configPath, 'utf8')
  } catch (error) {
    throw new ConfigError(`Cannot read ${configPath}: ${error instanceof Error ? error.message : String(error)}`, [])
  }
  const rawValue = parseYaml(text, configPath)
  const raw = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)
    ? (rawValue as Record<string, unknown>)
    : {}
  if (rawValue !== null && rawValue !== undefined && (typeof rawValue !== 'object' || Array.isArray(rawValue))) {
    throw new ConfigError(`Config root must be a mapping (object), got ${Array.isArray(rawValue) ? 'array' : typeof rawValue}`, [])
  }
  const parsed = configSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = formatZodIssues(parsed.error.issues)
    throw new ConfigError(`Invalid config at ${configPath}\n${renderIssues(issues)}`, issues)
  }
  const origins = collectOrigins(raw)
  return {
    config: parsed.data,
    path: configPath,
    raw,
    origins,
    text,
    hash: sha256Json(parsed.data),
  }
}

function collectOrigins(raw: Record<string, unknown>): Record<string, 'config' | 'default'> {
  const origins: Record<string, 'config' | 'default'> = {}
  const walk = (value: unknown, prefix: string): void => {
    if (value === null || typeof value !== 'object') {
      if (prefix) origins[prefix] = 'config'
      return
    }
    if (Array.isArray(value)) {
      if (prefix) origins[prefix] = 'config'
      value.forEach((entry, index) => walk(entry, prefix ? `${prefix}.${index}` : String(index)))
      return
    }
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      walk(entry, prefix ? `${prefix}.${key}` : key)
    }
  }
  walk(raw, '')
  return origins
}

export function renderConfigYaml(config: ProofGateConfig): string {
  const header = [
    '# ProofGate — independent verification for AI coding agents',
    '# Docs: https://github.com/a-kio/ProofGate/blob/main/docs/configuration.md',
    '#',
    '# Checks run as argv arrays, never through a shell. Review commands before use.',
    '# After editing checks or acceptance criteria, run `proofgate criteria approve`.',
    '',
  ].join('\n')
  return `${header}${YAML.stringify(config, { lineWidth: 120 })}`
}

export async function writeConfig(root: string, config: ProofGateConfig): Promise<string> {
  const target = configPathFor(root)
  await atomicWriteFile(target, renderConfigYaml(config))
  return target
}

export async function ensureProofGateDirs(root: string): Promise<void> {
  for (const rel of ['runs', 'cache', 'locks', 'backups', 'hooks']) {
    await fsp.mkdir(path.join(root, PROOFGATE_DIR, rel), { recursive: true })
  }
}

export async function readAcceptanceDocument(
  root: string,
): Promise<{ kind: 'missing'; path: string } | { kind: 'invalid'; path: string; error: string } | { kind: 'valid'; path: string; data: AcceptanceFile; hash: string; text: string }> {
  const acceptancePath = acceptancePathFor(root)
  if (!(await fileExists(acceptancePath))) return { kind: 'missing', path: acceptancePath }
  let text: string
  try {
    text = await fsp.readFile(acceptancePath, 'utf8')
  } catch (error) {
    return { kind: 'invalid', path: acceptancePath, error: `cannot read file: ${String(error)}` }
  }
  let raw: unknown
  try {
    raw = parseYaml(text, acceptancePath)
  } catch (error) {
    return { kind: 'invalid', path: acceptancePath, error: error instanceof Error ? error.message : String(error) }
  }
  const parsed = acceptanceSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = formatZodIssues(parsed.error.issues)
    return { kind: 'invalid', path: acceptancePath, error: renderIssues(issues) }
  }
  const hash = sha256Json(parsed.data)
  return { kind: 'valid', path: acceptancePath, data: parsed.data, hash, text }
}

export function validateAcceptanceReferences(
  acceptance: AcceptanceFile,
  checks: ReadonlyArray<{ id: string }>,
): ConfigIssue[] {
  const checkIds = new Set(checks.map((check) => check.id))
  const issues: ConfigIssue[] = []
  acceptance.criteria.forEach((criterion, index) => {
    if (criterion.kind === 'check' && criterion.check && !checkIds.has(criterion.check)) {
      issues.push({
        path: `criteria.${index}.check`,
        message: `references unknown check "${criterion.check}"`,
        suggestion: checkIds.values().next().value,
      })
    }
  })
  return issues
}

export async function writeAcceptanceTemplate(root: string, contents: string): Promise<string> {
  const target = acceptancePathFor(root)
  await atomicWriteFile(target, contents)
  return target
}

export function assertWritableProjectRoot(root: string): void {
  try {
    fs.accessSync(root, fs.constants.W_OK)
  } catch {
    throw new ProofGateError('PATH_UNSAFE', `Project directory is not writable: ${root}`)
  }
}

export { normalizeRelative }
