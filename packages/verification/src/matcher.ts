import picomatch from 'picomatch'
import { PROOFGATE_DIR, normalizeRelative } from '@proofgate/shared'

const cache = new Map<string, (input: string) => boolean>()

export function compileGlob(pattern: string): (input: string) => boolean {
  const cached = cache.get(pattern)
  if (cached) return cached
  const matcher = picomatch(pattern, {
    dot: true,
    nocase: process.platform === 'win32',
    bash: true,
  })
  const wrapped = (input: string): boolean => matcher(normalizeRelative(input))
  cache.set(pattern, wrapped)
  return wrapped
}

export function matchesGlob(filePath: string, pattern: string): boolean {
  return compileGlob(pattern)(filePath)
}

export function matchesAny(filePath: string, patterns: readonly string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return false
  return patterns.some((pattern) => matchesGlob(filePath, pattern))
}

export function matchesAll(filePath: string, patterns: readonly string[]): boolean {
  return patterns.every((pattern) => matchesGlob(filePath, pattern))
}

/** True when any changed file is covered by the check's appliesTo globs. */
export function anyChangedMatches(
  files: ReadonlyArray<{ path: string }>,
  patterns: readonly string[] | undefined,
): boolean {
  if (!patterns || patterns.length === 0) return true
  return files.some((file) => matchesAny(file.path, patterns))
}

export const SCAN_IGNORE_GLOBS = [
  `${PROOFGATE_DIR}/**`,
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/.venv/**',
  '**/venv/**',
  '**/__pycache__/**',
  '**/target/**',
  '**/vendor/**',
]

export function isIgnoredScanPath(filePath: string): boolean {
  return SCAN_IGNORE_GLOBS.some((pattern) => matchesGlob(filePath, pattern))
}
