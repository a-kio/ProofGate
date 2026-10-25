/**
 * Minimal glob matcher for `appliesTo` patterns (posix, relative paths).
 * Supported: `**` (any depth), `*` (any chars except /), `?`, and plain segments.
 */
export function matchesGlob(pattern: string, relPath: string): boolean {
  const p = pattern.replace(/\\/g, '/').replace(/^\.\//, '')
  const f = relPath.replace(/\\/g, '/')
  if (p === '**' || p === '**/*') return true
  let re = ''
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!
    if (c === '*') {
      if (p[i + 1] === '*') {
        // '**'
        if (p[i + 2] === '/') {
          re += '(?:.*/|^)'
          i += 2
        } else {
          re += '.*'
          i++
        }
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      re += `\\${c}`
    } else {
      re += c
    }
  }
  try {
    return new RegExp(`^${re}$`).test(f)
  } catch {
    return f === p
  }
}

export function matchesAny(patterns: string[], relPath: string): boolean {
  return patterns.some((p) => matchesGlob(p, relPath))
}
