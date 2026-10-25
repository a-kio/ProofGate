import path from 'node:path'

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

/** Normalize to a repo-relative posix path, or null if outside root. */
export function relToRoot(root: string, file: string): string | null {
  const rel = path.relative(root, file)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return toPosix(rel)
}

/** True when `candidate` is `root` itself or inside `root` (symlink-blind: operate on the realpath upstream). */
export function isInsideRoot(root: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Reject path-traversal elements before a value is ever used as a file path component. */
export function safeJoin(root: string, ...segments: string[]): string | null {
  const rel = segments.join('/')
  const resolved = path.resolve(root, rel)
  return isInsideRoot(root, resolved) ? resolved : null
}
