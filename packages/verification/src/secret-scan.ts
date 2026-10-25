import fsp from 'node:fs/promises'
import path from 'node:path'
import fg from 'fast-glob'
import { normalizeRelative, type Finding } from '@proofgate/shared'
import type { SecretScanCheckConfig } from '@proofgate/config'
import { SCAN_IGNORE_GLOBS, isIgnoredScanPath, matchesAny } from './matcher.js'

interface SecretPattern {
  id: string
  description: string
  pattern: RegExp
}

/** High-signal credential shapes. Generic "password =" heuristics are opt-in. */
export const BUILTIN_SECRET_PATTERNS: SecretPattern[] = [
  {
    id: 'private-key',
    description: 'PEM private key block',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    id: 'aws-access-key-id',
    description: 'AWS access key id',
    pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/,
  },
  {
    id: 'github-token',
    description: 'GitHub token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
  },
  {
    id: 'google-api-key',
    description: 'Google API key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    id: 'stripe-live-key',
    description: 'Stripe live secret key',
    pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/,
  },
  {
    id: 'slack-token',
    description: 'Slack token',
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{20,}\b/,
  },
  {
    id: 'openai-key',
    description: 'OpenAI API key',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/,
  },
  {
    id: 'anthropic-key',
    description: 'Anthropic API key',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/,
  },
]

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff', '.pdf', '.zip', '.gz', '.tar',
  '.7z', '.rar', '.exe', '.dll', '.so', '.dylib', '.bin', '.wasm', '.woff', '.woff2', '.ttf', '.otf',
  '.mp3', '.mp4', '.mov', '.avi', '.mkv', '.sqlite', '.db', '.pyc', '.class', '.jar', '.node',
])

export interface SecretScanOptions {
  root: string
  check: SecretScanCheckConfig
  /** When provided, only these project-relative files are considered. */
  changedPaths?: string[]
  ignoreGlobs?: string[]
}

export interface SecretScanResult {
  findings: Finding[]
  filesScanned: number
  filesSkipped: number
}

function isProbablyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8192)
  return sample.includes(0)
}

async function candidateFiles(options: SecretScanOptions): Promise<string[]> {
  const { check, root, changedPaths } = options
  const allow = check.allow ?? []
  const ignore = [...SCAN_IGNORE_GLOBS, ...(options.ignoreGlobs ?? [])]
  let files: string[]
  if (changedPaths) {
    files = changedPaths
      .map((file) => normalizeRelative(file))
      .filter((file) => matchesAny(file, check.paths))
      .filter((file) => !matchesAny(file, allow))
      .filter((file) => !isIgnoredScanPath(file))
      .filter((file) => !matchesAny(file, ignore))
  } else {
    files = await fg(check.paths, {
      cwd: root,
      dot: true,
      onlyFiles: true,
      followSymbolicLinks: false,
      ignore,
      absolute: false,
    })
  }
  return [...new Set(files.map(normalizeRelative))].sort()
}

/**
 * Scan candidate files for credential material. Findings never contain the
 * matched secret; only the pattern id, file, and line are reported.
 */
export async function scanForSecrets(options: SecretScanOptions): Promise<SecretScanResult> {
  const { check, root } = options
  const patterns: SecretPattern[] = [
    ...BUILTIN_SECRET_PATTERNS,
    ...(check.patterns ?? []).map((custom) => ({
      id: custom.id,
      description: custom.description ?? custom.id,
      pattern: new RegExp(custom.pattern),
    })),
  ]
  const files = await candidateFiles(options)
  const findings: Finding[] = []
  let filesScanned = 0
  let filesSkipped = 0

  for (const file of files) {
    const extension = path.extname(file).toLowerCase()
    if (BINARY_EXTENSIONS.has(extension)) {
      filesSkipped += 1
      continue
    }
    const absolute = path.join(root, file)
    let buffer: Buffer
    try {
      const stat = await fsp.stat(absolute)
      if (!stat.isFile() || stat.size > check.maxFileBytes) {
        filesSkipped += 1
        continue
      }
      buffer = await fsp.readFile(absolute)
    } catch {
      filesSkipped += 1
      continue
    }
    if (isProbablyBinary(buffer)) {
      filesSkipped += 1
      continue
    }
    filesScanned += 1
    const lines = buffer.toString('utf8').split(/\r?\n/)
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] ?? ''
      if (line.length > 5000) continue
      for (const pattern of patterns) {
        pattern.pattern.lastIndex = 0
        if (pattern.pattern.test(line)) {
          findings.push({
            kind: 'secret',
            message: `Potential ${pattern.description} (${pattern.id})`,
            file,
            line: index + 1,
          })
          if (findings.length >= 100) break
        }
      }
      if (findings.length >= 100) break
    }
    if (findings.length >= 100) break
  }

  return { findings, filesScanned, filesSkipped }
}
