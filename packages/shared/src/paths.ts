import path from 'node:path'
import { ProofGateError } from './errors.js'

/** Convert OS separators to POSIX separators without touching the filesystem. */
export function toPosix(input: string): string {
  return input.replace(/\\/g, '/')
}

/** Normalize a project-relative path: POSIX separators, no leading `./`, no trailing slash. */
export function normalizeRelative(input: string): string {
  let value = toPosix(input).replace(/^\.\/+/, '')
  value = value.replace(/\/+/g, '/')
  if (value === '.') return ''
  return value.replace(/\/$/, '')
}

export function isAbsolutePath(input: string): boolean {
  return path.isAbsolute(input) || /^[A-Za-z]:[\\/]/.test(input)
}

/** True when `candidate` is the same as, or inside, `root`. Resolves `..` segments. */
export function isInsideRoot(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  const relative = path.relative(resolvedRoot, resolvedCandidate)
  if (relative === '') return true
  return !relative.startsWith('..') && !path.isAbsolute(relative)
}

/**
 * Join a user-controlled relative path onto a root, refusing anything that
 * escapes it. Absolute paths are rejected unless they are already inside root.
 */
export function safeJoin(root: string, relativeOrAbsolute: string): string {
  if (relativeOrAbsolute.includes('\0')) {
    throw new ProofGateError('PATH_UNSAFE', 'Path contains a NUL byte')
  }
  const absolute = isAbsolutePath(relativeOrAbsolute)
    ? path.resolve(relativeOrAbsolute)
    : path.resolve(root, relativeOrAbsolute)
  if (!isInsideRoot(root, absolute)) {
    throw new ProofGateError(
      'PATH_UNSAFE',
      `Refusing to access a path outside the project: ${relativeOrAbsolute}`,
      { hint: `Project root: ${path.resolve(root)}` },
    )
  }
  return absolute
}

export function relativeTo(root: string, target: string): string {
  return normalizeRelative(path.relative(root, target))
}

/** Reject drive-relative and UNC paths in configuration values. */
export function assertRelativeConfigPath(value: string, field: string): string {
  if (!value.trim()) {
    throw new ProofGateError('CONFIG_INVALID', `${field} must not be empty`)
  }
  if (isAbsolutePath(value)) {
    throw new ProofGateError('CONFIG_INVALID', `${field} must be relative to the project root`, {
      details: { value },
    })
  }
  const normalized = normalizeRelative(value)
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new ProofGateError('CONFIG_INVALID', `${field} must not escape the project root`, {
      details: { value },
    })
  }
  return normalized
}

export function isHiddenPath(relativePath: string): boolean {
  return normalizeRelative(relativePath)
    .split('/')
    .some((segment) => segment.startsWith('.') && segment !== '.')
}

export function pathSegments(relativePath: string): string[] {
  const normalized = normalizeRelative(relativePath)
  return normalized === '' ? [] : normalized.split('/')
}

/** Join for display, always with forward slashes. */
export function displayPath(...parts: string[]): string {
  return toPosix(path.join(...parts))
}
