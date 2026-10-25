import path from 'node:path'
import { isInsideRoot, relativeTo, toPosix } from '@proofgate/shared'
import type { CommandSpec, Invoker, InvokerKind } from './types.js'
import { atomicWrite } from './fsx.js'

export const DEFAULT_PACKAGE_SPEC = '@proofgate/cli'
export const HOOKS_DIR = '.proofgate/hooks'

export function quoteShellArg(value: string): string {
  if (process.platform === 'win32') {
    if (!/[\s"&|<>^]/.test(value)) return value
    return `"${value.replace(/"/g, '\\"')}"`
  }
  if (!/[\s"'$`\\!*?[\]{}()<>|&;#~]/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function shellJoin(command: CommandSpec): string {
  return [command.command, ...command.args].map(quoteShellArg).join(' ')
}

function base(invoker: Invoker): { command: string; prefix: string[] } {
  switch (invoker.kind) {
    case 'global':
      return { command: 'proofgate', prefix: [] }
    case 'node-entry':
      if (!invoker.entryPath) throw new Error('node-entry invoker requires entryPath')
      return { command: process.execPath, prefix: [invoker.entryPath] }
    case 'npx':
      return { command: 'npx', prefix: ['-y', invoker.packageSpec ?? DEFAULT_PACKAGE_SPEC] }
    default: {
      const exhaustive: never = invoker.kind
      throw new Error(`unknown invoker: ${String(exhaustive)}`)
    }
  }
}

export function cliCommand(invoker: Invoker, args: string[]): CommandSpec {
  const resolved = base(invoker)
  return { command: resolved.command, args: [...resolved.prefix, ...args] }
}

export function verifyHookCommand(invoker: Invoker, extra: string[] = []): CommandSpec {
  return cliCommand(invoker, ['verify', '--trigger', 'hook', ...extra])
}

export function verifyCommand(invoker: Invoker, extra: string[] = []): CommandSpec {
  return cliCommand(invoker, ['verify', ...extra])
}

export function mcpCommand(invoker: Invoker): CommandSpec {
  return cliCommand(invoker, ['mcp'])
}

export function statusCommand(invoker: Invoker, extra: string[] = []): CommandSpec {
  return cliCommand(invoker, ['status', ...extra])
}

/** Best-effort detection of the currently running CLI entry. */
export function currentCliEntry(): string | undefined {
  const entry = process.argv[1]
  if (!entry) return undefined
  if (/[\\/](?:tsx|vitest|vite|tsup|node_modules[\\/]\.bin)[\\/]/.test(entry)) return undefined
  if (/\.(?:ts|tsx)$/.test(entry) && !process.execArgv.some((arg) => arg.includes('tsx'))) return undefined
  return path.resolve(entry)
}

export function resolveInvoker(options: {
  requested?: InvokerKind | 'auto'
  projectRoot: string
  entryPath?: string
  packageSpec?: string
}): Invoker {
  const requested = options.requested ?? 'auto'
  if (requested === 'global' || requested === 'npx' || requested === 'node-entry') {
    return {
      kind: requested,
      ...(requested === 'node-entry' ? { entryPath: options.entryPath ?? currentCliEntry() ?? 'proofgate' } : {}),
      ...(requested === 'npx' ? { packageSpec: options.packageSpec ?? DEFAULT_PACKAGE_SPEC } : {}),
    }
  }
  const entry = options.entryPath ?? currentCliEntry()
  if (entry) return { kind: 'node-entry', entryPath: entry }
  return { kind: 'npx', packageSpec: options.packageSpec ?? DEFAULT_PACKAGE_SPEC }
}

export interface HookWrapperOptions {
  root: string
  /** Stable file name without extension. */
  name: string
  invoker: Invoker
  /** Provider id passed to the CLI's hook formatter. */
  provider: string
  extraArgs?: string[]
}

/**
 * Generate a small Node wrapper under `.proofgate/hooks/`.
 *
 * Agent hook configs invoke the wrapper with `node`, which is portable on
 * Windows (no `.cmd` shim or shell). The wrapper runs the configured ProofGate
 * invocation, forwards its output, and keeps verification non-blocking unless
 * the CLI's policy explicitly returns a blocking result.
 */
export async function writeHookWrapper(options: HookWrapperOptions): Promise<{ path: string; relativePath: string; command: CommandSpec }> {
  const dir = path.join(options.root, HOOKS_DIR)
  const fileName = `${options.name}.mjs`
  const target = path.join(dir, fileName)

  let command: CommandSpec
  let cwdExpression: string
  if (options.invoker.kind === 'node-entry' && options.invoker.entryPath) {
    if (isInsideRoot(options.root, options.invoker.entryPath)) {
      const relative = toPosix(path.relative(options.root, options.invoker.entryPath))
      command = { command: process.execPath, args: [relative] }
      cwdExpression = 'path.resolve(__dirname, "..", "..")'
    } else {
      command = { command: process.execPath, args: [options.invoker.entryPath] }
      cwdExpression = 'path.resolve(__dirname, "..", "..")'
    }
  } else if (options.invoker.kind === 'global') {
    command = { command: 'proofgate', args: [] }
    cwdExpression = 'path.resolve(__dirname, "..", "..")'
  } else {
    command = { command: 'npx', args: ['-y', options.invoker.packageSpec ?? DEFAULT_PACKAGE_SPEC] }
    cwdExpression = 'path.resolve(__dirname, "..", "..")'
  }

  const args = ['verify', '--trigger', 'hook', '--hook-format', options.provider, ...(options.extraArgs ?? [])]
  const script = `#!/usr/bin/env node
// Generated by ProofGate. Safe to delete; reinstalling recreates it.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = ${cwdExpression}
const command = ${JSON.stringify(command.command)}
const argv = ${JSON.stringify([...command.args, ...args])}
const result = spawnSync(command, argv, {
  cwd: root,
  env: { ...process.env, PROOFGATE_INTEGRATION_HOOK: ${JSON.stringify(options.provider)} },
  encoding: 'utf8',
  timeout: 900000,
  windowsHide: true,
})

if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
if (result.error) {
  // Never turn a broken integration into a blocked agent. Verification must be
  // triggered explicitly if the hook itself cannot run.
  process.stdout.write(JSON.stringify({ proofgate: 'hook-error', message: String(result.error.message ?? result.error) }) + '\\n')
  process.exit(0)
}
const status = typeof result.status === 'number' ? result.status : 0
process.exit(status === 3 ? 0 : status)
`
  await atomicWrite(target, script)
  return {
    path: target,
    relativePath: toPosix(path.relative(options.root, target)),
    command: { command: process.execPath, args: [relativeTo(options.root, target)] },
  }
}
