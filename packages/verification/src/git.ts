import path from 'node:path'
import { resolveCommand, runCommand } from '@proofgate/executor'
import type { ChangedFile, GitRevision } from '@proofgate/core'

const NO_REPO: GitRevision = { hasCommits: false, isWorktree: false, isRepository: false }

interface GitOut {
  ok: boolean
  stdout: string
}

async function git(root: string, args: string[]): Promise<GitOut> {
  const gitBin = resolveCommand('git', { cwd: root })
  if (!gitBin) return { ok: false, stdout: '' }
  const rr = await runCommand({
    argv: [gitBin, ...args],
    cwd: root,
    timeoutMs: 20_000,
    maxOutputBytes: 8 * 1024 * 1024,
  })
  return { ok: rr.exitCode === 0 && !rr.failedToStart, stdout: rr.stdout.text }
}

async function gitOut(root: string, args: string[]): Promise<string | null> {
  const rr = await git(root, args)
  return rr.ok ? rr.stdout.trim() : null
}

/** Inspect the repository state. A missing git repo never throws. */
export async function readRevision(projectRoot: string): Promise<GitRevision> {
  try {
    const inside = await gitOut(projectRoot, ['rev-parse', '--is-inside-work-tree'])
    if (inside !== 'true') return { ...NO_REPO }
    const repoRoot = await gitOut(projectRoot, ['rev-parse', '--show-toplevel'])
    if (!repoRoot) return { ...NO_REPO }

    const headFull = await gitOut(projectRoot, ['rev-parse', 'HEAD'])
    const branch = await gitOut(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])
    const gitDir = await gitOut(projectRoot, ['rev-parse', '--absolute-git-dir'])
    const commonDir = await gitOut(projectRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    const isWorktree = Boolean(gitDir && commonDir && path.resolve(gitDir) !== path.resolve(commonDir))

    return {
      repositoryRoot: path.resolve(repoRoot),
      head: headFull ?? undefined,
      headShort: headFull ? headFull.slice(0, 12) : undefined,
      branch: branch && branch !== 'HEAD' ? branch : undefined,
      hasCommits: Boolean(headFull),
      isWorktree,
      isRepository: true,
    }
  } catch {
    return { ...NO_REPO }
  }
}

/**
 * Working-tree changes relative to HEAD (untracked files count as added).
 * Parsed from `git status --porcelain=v1 -z` so spaces/unicode filenames are safe.
 */
export async function readChangedFiles(projectRoot: string): Promise<ChangedFile[]> {
  const rr = await git(projectRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=normal'])
  if (!rr.ok) return []
  return parseStatusZ(rr.stdout)
}

export function parseStatusZ(out: string): ChangedFile[] {
  const files: ChangedFile[] = []
  const tokens = out.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] ?? ''
    if (t.length < 4) continue
    const x = t[0]!
    const y = t[1]!
    const p = t.slice(3)
    if (x === '?' && y === '?') {
      files.push({ path: p, kind: 'added' })
      continue
    }
    if (x === 'R' || y === 'R' || x === 'C' || y === 'C') {
      // rename pair: next NUL token is the original path
      i++
      files.push({ path: p, kind: 'renamed' })
      continue
    }
    if (x === 'D' || y === 'D') files.push({ path: p, kind: 'deleted' })
    else if (x === 'A' || y === 'A') files.push({ path: p, kind: 'added' })
    else files.push({ path: p, kind: 'modified' })
  }
  return files
}
