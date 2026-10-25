import { firstLines } from '@proofgate/shared'
import { runCommand } from './run.js'
import { resolveCommand } from './which.js'

const versionCache = new Map<string, string | null>()

/**
 * Read a tool's version for environment fingerprints and doctor output.
 * Never throws; an unavailable or uncooperative tool simply returns null.
 */
export async function getToolVersion(
  command: string,
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<string | null> {
  const cwd = options.cwd ?? process.cwd()
  const resolved = resolveCommand(command, { cwd })
  if (!resolved) return null
  const key = `${resolved}::${cwd}`
  if (versionCache.has(key)) return versionCache.get(key) ?? null

  for (const flag of ['--version', '-v', 'version']) {
    const result = await runCommand({
      argv: [resolved, flag],
      cwd,
      timeoutMs: options.timeoutMs ?? 4000,
      maxOutputBytes: 16 * 1024,
    })
    if (result.failedToStart) break
    if (result.timedOut) continue
    const line = firstLines(`${result.stdout.text}\n${result.stderr.text}`, 1)[0]
    if (result.exitCode === 0 && line) {
      const version = line.trim().slice(0, 200)
      versionCache.set(key, version)
      return version
    }
  }
  versionCache.set(key, null)
  return null
}

export function clearVersionCache(): void {
  versionCache.clear()
}

export function nodeRuntimeSummary(): string {
  return `Node ${process.version} · ${process.platform}/${process.arch}`
}
