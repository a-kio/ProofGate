import { spawn } from 'node:child_process'
import { execa } from 'execa'
import fs from 'node:fs'
import { formatDuration, nowIso } from '@proofgate/shared'
import type { OutputChunk } from '@proofgate/shared'
import { OutputCollector } from './collector.js'
import { formatCommand } from './which.js'

const isWindows = process.platform === 'win32'

export interface RunCommandOptions {
  /** argv[0] is the executable; no shell is involved. */
  argv: string[]
  cwd: string
  env?: Record<string, string>
  /** Milliseconds. 0 disables the timeout. */
  timeoutMs?: number
  maxOutputBytes?: number
  signal?: AbortSignal
  /** Optional stdin content. */
  input?: string
}

export interface CommandResult {
  argv: string[]
  command: string
  cwd: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  canceled: boolean
  failedToStart: boolean
  spawnError?: string
  stdout: OutputChunk
  stderr: OutputChunk
  durationMs: number
  startedAt: string
  finishedAt: string
}

function buildEnv(overrides: Record<string, string> | undefined): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value
  }
  Object.assign(env, overrides ?? {})
  env.PROOFGATE = '1'
  if (overrides?.NO_COLOR === undefined) env.NO_COLOR = '1'
  if (overrides?.FORCE_COLOR === undefined) env.FORCE_COLOR = '0'
  return env
}

/** Kill a process and all of its descendants. Best-effort and silent. */
export function killProcessTree(pid: number | undefined, signal: NodeJS.Signals = 'SIGKILL'): void {
  if (!pid || pid <= 0) return
  if (isWindows) {
    try {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        detached: true,
      })
      killer.on('error', () => undefined)
      killer.unref()
    } catch {
      // Process may already be gone.
    }
    return
  }
  try {
    // The child was spawned detached, so its pid is also the process-group id.
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      // Process may already be gone.
    }
  }
}

function emptyChunk(): OutputChunk {
  return { text: '', bytes: 0, totalBytes: 0, truncated: false }
}

/**
 * Run one command with a hard timeout, bounded output capture, and process-tree
 * cleanup. Arguments are passed as an array; no shell interpolation occurs.
 */
export async function runCommand(options: RunCommandOptions): Promise<CommandResult> {
  const { argv, cwd } = options
  const maxOutputBytes = options.maxOutputBytes ?? 2 * 1024 * 1024
  const timeoutMs = options.timeoutMs ?? 0
  const startedAt = nowIso()
  const started = Date.now()
  const stdout = new OutputCollector(maxOutputBytes)
  const stderr = new OutputCollector(maxOutputBytes)

  if (argv.length === 0 || !argv[0]) {
    return {
      argv,
      command: '',
      cwd,
      exitCode: null,
      signal: null,
      timedOut: false,
      canceled: false,
      failedToStart: true,
      spawnError: 'Empty command',
      stdout: emptyChunk(),
      stderr: emptyChunk(),
      durationMs: 0,
      startedAt,
      finishedAt: nowIso(),
    }
  }

  try {
    const stat = fs.statSync(cwd)
    if (!stat.isDirectory()) throw new Error('not a directory')
  } catch {
    return {
      argv,
      command: formatCommand(argv),
      cwd,
      exitCode: null,
      signal: null,
      timedOut: false,
      canceled: false,
      failedToStart: true,
      spawnError: `Working directory does not exist: ${cwd}`,
      stdout: emptyChunk(),
      stderr: emptyChunk(),
      durationMs: 0,
      startedAt,
      finishedAt: nowIso(),
    }
  }

  let timedOut = false
  let canceled = false
  let timeoutTimer: NodeJS.Timeout | undefined
  let hardKillTimer: NodeJS.Timeout | undefined
  let abortListener: (() => void) | undefined

  const subprocess = execa(argv[0], argv.slice(1), {
    cwd,
    env: buildEnv(options.env),
    extendEnv: false,
    preferLocal: true,
    localDir: cwd,
    reject: false,
    buffer: false,
    encoding: 'utf8',
    stripFinalNewline: false,
    cleanup: false,
    detached: !isWindows,
    windowsHide: true,
    stdin: options.input === undefined ? 'ignore' : undefined,
    input: options.input,
    timeout: 0,
  })

  const childStdout = subprocess.stdout
  const childStderr = subprocess.stderr
  childStdout?.on('data', (chunk: Buffer | string) => stdout.push(chunk))
  childStderr?.on('data', (chunk: Buffer | string) => stderr.push(chunk))

  const pid = subprocess.pid

  const beginKill = (): void => {
    killProcessTree(pid, 'SIGTERM')
    hardKillTimer = setTimeout(() => killProcessTree(pid, 'SIGKILL'), 3000)
    hardKillTimer.unref()
  }

  if (timeoutMs > 0) {
    timeoutTimer = setTimeout(() => {
      timedOut = true
      beginKill()
    }, timeoutMs)
    timeoutTimer.unref()
  }

  if (options.signal) {
    if (options.signal.aborted) {
      canceled = true
      beginKill()
    } else {
      abortListener = () => {
        canceled = true
        beginKill()
      }
      options.signal.addEventListener('abort', abortListener, { once: true })
    }
  }

  let failedToStart = false
  let spawnError: string | undefined
  let exitCode: number | null = null
  let signal: NodeJS.Signals | null = null
  let durationMs = Date.now() - started

  try {
    const result = await subprocess
    exitCode = result.exitCode ?? null
    signal = (result.signal as NodeJS.Signals | undefined) ?? null
    durationMs = result.durationMs ?? Date.now() - started
    if (result.failed && exitCode === null && signal === null) {
      failedToStart = true
      spawnError = result.originalMessage ?? result.shortMessage ?? 'Process failed to start'
    }
  } catch (error) {
    const candidate = error as {
      exitCode?: number
      signal?: string
      durationMs?: number
      code?: string
      originalMessage?: string
      shortMessage?: string
      message?: string
    }
    exitCode = candidate.exitCode ?? null
    signal = (candidate.signal as NodeJS.Signals | undefined) ?? null
    durationMs = candidate.durationMs ?? Date.now() - started
    if (candidate.code === 'ENOENT' || /ENOENT|not found/i.test(candidate.message ?? '')) {
      failedToStart = true
    }
    spawnError = candidate.originalMessage ?? candidate.shortMessage ?? candidate.message ?? String(error)
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer)
    if (hardKillTimer) clearTimeout(hardKillTimer)
    if (options.signal && abortListener) options.signal.removeEventListener('abort', abortListener)
    // Ensure no descendants survive a timeout or cancellation.
    if (timedOut || canceled) killProcessTree(pid, 'SIGKILL')
  }

  return {
    argv,
    command: formatCommand(argv),
    cwd,
    exitCode,
    signal,
    timedOut,
    canceled,
    failedToStart,
    ...(spawnError ? { spawnError } : {}),
    stdout: stdout.chunk(maxOutputBytes),
    stderr: stderr.chunk(maxOutputBytes),
    durationMs,
    startedAt,
    finishedAt: nowIso(),
  }
}

export function describeCommandResult(result: CommandResult): string {
  if (result.failedToStart) return `could not start: ${result.spawnError ?? 'unknown error'}`
  if (result.timedOut) return `timed out after ${formatDuration(result.durationMs)}`
  if (result.canceled) return 'canceled'
  if (result.exitCode === 0) return `exit 0 in ${formatDuration(result.durationMs)}`
  return `exit ${result.exitCode ?? 'null'} in ${formatDuration(result.durationMs)}`
}
