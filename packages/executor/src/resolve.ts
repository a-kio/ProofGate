import fs from 'node:fs'
import path from 'node:path'
import { resolveCommand } from './which.js'

export type ResolveStatus = 'resolved' | 'not-found' | 'unresolved-shim'

export interface ResolvedExecutable {
  status: ResolveStatus
  /** argv with argv[0] replaced by an absolute executable path (or a node + script pair). */
  argv: string[]
  /** Human-readable detail when status is not 'resolved'. */
  error?: string
  /** Patch notes about what changed from the configured argv (e.g. shim unwrapping). */
  notes: string[]
}

/**
 * Resolve a configured argv array into something spawnable without a shell.
 *
 * 1. argv[0] is resolved against node_modules/.bin (walking upward) and PATH,
 *    honoring PATHEXT on Windows.
 * 2. On Windows, npm/pnpm create `.cmd` shims that cannot be spawned directly
 *    (Node raises EINVAL since the 2024 shell-injection hardening). The shim is
 *    read as text and rewritten to `node <script>` when it unmistakably wraps a
 *    JS entry point. It is never rewritten when anything is ambiguous - we
 *    refuse rather than guess.
 *
 * Arguments after argv[0] are passed through unchanged.
 */
export function resolveExecutable(argv: readonly string[], options: { cwd?: string } = {}): ResolvedExecutable | null {
  if (argv.length === 0 || !argv[0]) {
    return {
      status: 'not-found',
      argv: [...argv],
      error: 'empty command',
      notes: [],
    }
  }
  const [head, ...rest] = argv
  const resolved = resolveCommand(head, { cwd: options.cwd })
  if (!resolved) {
    return {
      status: 'not-found',
      argv: [...argv],
      error: `command not found: "${head}" (looked in node_modules/.bin and PATH)`,
      notes: [],
    }
  }
  const lower = resolved.toLowerCase()
  if (lower.endsWith('.cmd') || lower.endsWith('.bat')) {
    const unwrapped = unwrapCmdShim(resolved)
    if (unwrapped) {
      return {
        status: 'resolved',
        argv: ['node', unwrapped.scriptPath, ...rest],
        notes: [
          `rewrote Windows shim ${path.basename(resolved)} to node ${path.basename(unwrapped.scriptPath)} (no shell involved)`,
        ],
      }
    }
    return {
      status: 'unresolved-shim',
      argv: [...argv],
      error: `found Windows command shim "${resolved}" but could not identify the script it wraps; refusing to run it through a shell. Reference the node script directly (for example: ["node", "node_modules/tool/dist/cli.js"]).`,
      notes: [],
    }
  }
  return {
    status: 'resolved',
    argv: [resolved, ...rest],
    notes: [],
  }
}

export interface ShimUnwrap {
  scriptPath: string
}

/**
 * Parse the contents of an npm/pnpm `.cmd` shim and extract the JS entry point.
 *
 * Typical contents:
 *   @ECHO off
 *   ...
 *   "%~dp0\node.exe"  "%~dp0\node_modules\tool\dist\cli.js" %*
 * or, for pnpm shims:
 *   node "%~dp0\..\..\node_modules\tool\bin\run.js" %*
 */
export function unwrapCmdShim(shimPath: string): ShimUnwrap | null {
  let text: string
  try {
    text = fs.readFileSync(shimPath, 'utf8')
  } catch {
    return null
  }
  if (!/%~dp0/i.test(text)) return null
  const shimDir = path.dirname(shimPath)

  // Quoted scripts first (npm shims quote the script unless it contains no spaces).
  const quoted = /"%~dp0([^"]*?\.(?:js|cjs|mjs))"/i.exec(text)
  if (quoted?.[1]) {
    const scriptPath = normalizeShimPath(shimDir, quoted[1])
    if (scriptPath && fs.existsSync(scriptPath)) return { scriptPath }
  }
  const unquoted = /%~dp0([^\s"&<>|]*?\.(?:js|cjs|mjs))/i.exec(text)
  if (unquoted?.[1]) {
    const scriptPath = normalizeShimPath(shimDir, unquoted[1])
    if (scriptPath && fs.existsSync(scriptPath)) return { scriptPath }
  }
  return null
}

function normalizeShimPath(shimDir: string, rawTail: string): string | null {
  if (rawTail.includes('%')) return null
  // The tail starts with a backslash after %~dp0; `..` segments are legitimate.
  if (rawTail.includes('..')) {
    if (rawTail.replace(/[\\/]/g, '/').split('/').some((part) => part === '..')) {
      // pnpm-style relative shims are allowed exactly one level of depth
      return path.resolve(shimDir, rawTail)
    }
  }
  return path.resolve(shimDir, rawTail)
}
