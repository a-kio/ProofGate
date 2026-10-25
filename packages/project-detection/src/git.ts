import path from 'node:path'
import type { ChangedFile, GitInfo } from '@proofgate/shared'
import { sha256Json, toPosix } from '@proofgate/shared'
import { runCommand } from '@proofgate/executor'

export interface GitChangeSet {
  info: GitInfo
  files: ChangedFile[]
  fingerprint: string
  truncated: boolean
  source: 'git-working-tree' | 'git-base' | 'none'
}

const MAX_FILES = 5000

async function git(root: string, args: string[], timeoutMs = 15_000) {
  return runCommand({
    argv: ['git', '-C', root, ...args],
    cwd: root,
    timeoutMs,
    maxOutputBytes: 8 * 1024 * 1024,
  })
}

export async function isGitRepository(root: string): Promise<boolean> {
  const result = await git(root, ['rev-parse', '--is-inside-work-tree'], 5000)
  return result.exitCode === 0 && result.stdout.text.trim() === 'true'
}

export async function getGitInfo(root: string): Promise<GitInfo> {
  const inside = await git(root, ['rev-parse', '--is-inside-work-tree'], 5000)
  if (inside.failedToStart) {
    return { available: false, error: inside.spawnError ?? 'git is not installed or not on PATH' }
  }
  if (inside.exitCode !== 0) {
    return { available: true, error: inside.stderr.text.trim() || 'not a git working tree' }
  }
  if (inside.stdout.text.trim() !== 'true') {
    return { available: true, error: 'not a git working tree' }
  }
  const [top, branch, head, status] = await Promise.all([
    git(root, ['rev-parse', '--show-toplevel'], 5000),
    git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], 5000),
    git(root, ['rev-parse', 'HEAD'], 5000),
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 15_000),
  ])
  return {
    available: true,
    root: top.exitCode === 0 ? toPosix(top.stdout.text.trim()) : undefined,
    branch: branch.exitCode === 0 ? branch.stdout.text.trim() : undefined,
    head: head.exitCode === 0 ? head.stdout.text.trim() : undefined,
    dirty: status.exitCode === 0 ? status.stdout.text.length > 0 : undefined,
    ...(status.exitCode !== 0 ? { error: status.stderr.text.trim() || 'git status failed' } : {}),
  }
}

function normalizeStatus(code: string, isUntracked: boolean): ChangedFile['status'] {
  if (isUntracked) return 'untracked'
  const char = code.trim() || code
  switch (char[0]) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'added'
    case 'U':
      return 'modified'
    default:
      return 'modified'
  }
}

function parsePorcelainZ(output: string): ChangedFile[] {
  const parts = output.split('\0')
  const files: ChangedFile[] = []
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (!entry) continue
    if (entry.length < 4) continue
    const code = entry.slice(0, 2)
    const filePath = entry.slice(3)
    if (!filePath) continue
    const isRename = code.includes('R') || code.includes('C')
    let oldPath: string | undefined
    if (isRename) {
      oldPath = parts[i + 1]
      i += 1
    }
    files.push({
      path: toPosix(filePath),
      status: normalizeStatus(code, code.startsWith('??')),
      ...(oldPath ? { oldPath: toPosix(oldPath) } : {}),
    })
  }
  return files
}

function parseNameStatusZ(output: string): ChangedFile[] {
  const parts = output.split('\0').filter(Boolean)
  const files: ChangedFile[] = []
  for (let i = 0; i < parts.length; i++) {
    const statusToken = parts[i]!
    const filePath = parts[i + 1]
    if (!filePath) break
    i += 1
    const code = statusToken[0] ?? 'M'
    if (code === 'R' || code === 'C') {
      const newPath = parts[i + 1]
      if (newPath) i += 1
      files.push({
        path: toPosix(newPath ?? filePath),
        oldPath: toPosix(filePath),
        status: code === 'R' ? 'renamed' : 'added',
      })
    } else {
      files.push({
        path: toPosix(filePath),
        status: code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified',
      })
    }
  }
  return files
}

function dedupe(files: ChangedFile[]): ChangedFile[] {
  const seen = new Map<string, ChangedFile>()
  for (const file of files) {
    const existing = seen.get(file.path)
    if (!existing) seen.set(file.path, file)
    else if (existing.status !== 'deleted' && file.status === 'deleted') seen.set(file.path, file)
  }
  return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path))
}

export async function readWorkingTreeChanges(root: string): Promise<GitChangeSet> {
  const info = await getGitInfo(root)
  if (!info.available) {
    return { info, files: [], fingerprint: '', truncated: false, source: 'none' }
  }
  if (info.error) {
    return { info, files: [], fingerprint: '', truncated: false, source: 'none' }
  }
  const status = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 20_000)
  if (status.exitCode !== 0) {
    return { info, files: [], fingerprint: '', truncated: false, source: 'none' }
  }
  const all = dedupe(parsePorcelainZ(status.stdout.text))
  const files = all.slice(0, MAX_FILES)
  return {
    info,
    files,
    fingerprint: sha256Json(files),
    truncated: all.length > MAX_FILES,
    source: 'git-working-tree',
  }
}

export async function readChangesAgainstBase(root: string, base: string): Promise<GitChangeSet> {
  const info = await getGitInfo(root)
  if (!info.available || info.error) {
    return { info, files: [], fingerprint: '', truncated: false, source: 'none' }
  }
  const [diff, status] = await Promise.all([
    git(root, ['diff', '--name-status', '-z', '--find-renames', `${base}`], 30_000),
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 20_000),
  ])
  if (diff.exitCode !== 0) {
    return { info, files: [], fingerprint: '', truncated: false, source: 'none' }
  }
  const committed = parseNameStatusZ(diff.stdout.text)
  const working = status.exitCode === 0 ? parsePorcelainZ(status.stdout.text) : []
  const all = dedupe([...committed, ...working])
  const files = all.slice(0, MAX_FILES)
  return {
    info,
    files,
    fingerprint: sha256Json(files),
    truncated: all.length > MAX_FILES,
    source: 'git-base',
  }
}

/** Resolve the repository root for a directory, or the nearest manifest root. */
export async function findProjectRoot(startDir: string): Promise<string | null> {
  const resolved = path.resolve(startDir)
  const inside = await git(resolved, ['rev-parse', '--show-toplevel'], 5000)
  if (inside.exitCode === 0 && inside.stdout.text.trim()) {
    return path.resolve(inside.stdout.text.trim())
  }
  // No repository: walk up to the nearest directory holding a project manifest.
  const markers = [
    'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle',
    'composer.json', 'Gemfile', '.git', 'pnpm-workspace.yaml',
  ]
  const { statSync } = await import('node:fs')
  let dir = resolved
  for (;;) {
    for (const marker of markers) {
      try {
        if (statSync(path.join(dir, marker)).isFile()) return dir
      } catch {
        // keep looking
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) return resolved
    dir = parent
  }
}
