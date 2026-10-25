import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { getToolVersion, resolveCommand, runCommand } from '@proofgate/executor'
import {
  PROOFGATE_DIR,
  quickFileFingerprint,
  sha256File,
  sha256Json,
  toPosix,
  type ChangedFilesSummary,
} from '@proofgate/shared'
import type { CheckConfig } from '@proofgate/config'

export interface TreeFingerprint {
  available: boolean
  value: string
  head?: string
  files: number
  reason?: string
}async function gitHead(root: string): Promise<string | null> {
  const result = await runCommand({
    argv: ['git', '-C', root, 'rev-parse', 'HEAD'],
    cwd: root,
    timeoutMs: 5000,
    maxOutputBytes: 4096,
  })
  if (result.exitCode !== 0) return null
  const head = result.stdout.text.trim()
  return head || null
}

/**
 * Content-aware fingerprint of the working tree. A cache key is only safe when
 * it changes whenever any file that could affect a check changes, so dirty and
 * untracked files are hashed individually on top of the committed tree id.
 */
export async function computeTreeFingerprint(root: string, changed: ChangedFilesSummary): Promise<TreeFingerprint> {
  if (changed.truncated) {
    return { available: false, value: '', files: changed.files.length, reason: 'changed-file list was truncated' }
  }
  const head = await gitHead(root)
  if (!head) {
    return { available: false, value: '', files: changed.files.length, reason: 'not a git repository with a commit' }
  }
  const entries: Array<{ path: string; status: string; hash: string }> = []
  for (const file of changed.files) {
    if (file.status === 'deleted') {
      entries.push({ path: file.path, status: file.status, hash: 'deleted' })
      continue
    }
    const absolute = path.join(root, file.path)
    try {
      const stat = await fsp.stat(absolute)
      if (!stat.isFile()) {
        entries.push({ path: file.path, status: file.status, hash: `non-file:${stat.isDirectory() ? 'dir' : 'other'}` })
        continue
      }
      const hash = stat.size > 8 * 1024 * 1024 ? await quickFileFingerprint(absolute) : await sha256File(absolute)
      entries.push({ path: file.path, status: file.status, hash })
    } catch {
      entries.push({ path: file.path, status: file.status, hash: 'missing' })
    }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path))
  return {
    available: true,
    head,
    files: entries.length,
    value: sha256Json({ head, entries }),
  }
}

export interface ToolIdentity {
  command: string
  resolved: string | null
  version: string | null
  binaryFingerprint: string | null
}

export async function identifyTool(argv0: string, cwd: string): Promise<ToolIdentity> {
  const resolved = resolveCommand(argv0, { cwd })
  if (!resolved) return { command: argv0, resolved: null, version: null, binaryFingerprint: null }
  const [version, binaryFingerprint] = await Promise.all([
    getToolVersion(argv0, { cwd }),
    quickFileFingerprint(resolved).catch(() => null),
  ])
  return { command: argv0, resolved, version, binaryFingerprint }
}

const LOCKFILES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'go.sum',
  'poetry.lock',
  'Pipfile.lock',
  'composer.lock',
  'Gemfile.lock',
]

export async function hashLockfiles(root: string): Promise<string> {
  const entries: Array<{ file: string; hash: string }> = []
  for (const file of LOCKFILES) {
    const absolute = path.join(root, file)
    try {
      const stat = await fsp.stat(absolute)
      if (!stat.isFile()) continue
      entries.push({ file, hash: await sha256File(absolute) })
    } catch {
      // absent
    }
  }
  return sha256Json(entries)
}

export interface CacheKeyInput {
  check: CheckConfig
  profile: string
  intentHash: string
  configHash: string
  tree: TreeFingerprint
  tool: ToolIdentity | null
  lockfilesHash: string
  root: string
  env?: Record<string, string>
}

export function computeCacheKey(input: CacheKeyInput): string {
  const { title: _title, description: _description, cache: _cache, ...definition } = input.check
  return sha256Json({
    cacheSchema: 1,
    check: definition,
    profile: input.profile,
    intentHash: input.intentHash,
    configHash: input.configHash,
    tree: input.tree.value,
    treeHead: input.tree.head,
    tool: input.tool,
    lockfiles: input.lockfilesHash,
    root: toPosix(input.root),
    env: input.env ?? {},
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    ci: process.env.CI ?? '',
    nodeEnv: process.env.NODE_ENV ?? '',
  })
}

export function cacheDirFor(root: string): string {
  return path.join(root, PROOFGATE_DIR, 'cache')
}

export function isCacheWritable(cacheDir: string): boolean {
  try {
    fs.mkdirSync(cacheDir, { recursive: true })
    fs.accessSync(cacheDir, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}
