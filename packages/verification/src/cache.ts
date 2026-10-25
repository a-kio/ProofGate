import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  DEFAULT_CACHE_ENTRIES,
  sha256Json,
  type CheckResult,
  type Finding,
  type OutputChunk,
} from '@proofgate/shared'
import { atomicWriteFile } from '@proofgate/config'

interface CachedCheckPayload {
  summary: string
  exitCode?: number | null
  signal?: string | null
  timedOut?: boolean
  stdout: OutputChunk
  stderr: OutputChunk
  findings: Finding[]
  metrics?: CheckResult['metrics']
  command?: string[]
  cwd?: string
  durationMs: number
  sourceRunId?: string
}

export interface CacheEntry {
  key: string
  checkId: string
  status: 'PASS'
  cachedAt: string
  lastUsedAt: string
  result: CachedCheckPayload
}

interface CacheFile {
  schemaVersion: 1
  entries: Record<string, CacheEntry>
}

const MAX_STORED_OUTPUT = 64 * 1024

function trimChunk(chunk: OutputChunk): OutputChunk {
  if (chunk.text.length <= MAX_STORED_OUTPUT) return chunk
  const text = `${chunk.text.slice(0, MAX_STORED_OUTPUT)}\n… [cache copy truncated] …`
  return { text, bytes: Buffer.byteLength(text, 'utf8'), totalBytes: chunk.totalBytes, truncated: true }
}

function isCacheEntry(value: unknown): value is CacheEntry {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.key === 'string' &&
    typeof record.checkId === 'string' &&
    record.status === 'PASS' &&
    typeof record.cachedAt === 'string' &&
    typeof record.result === 'object' &&
    record.result !== null
  )
}

export class VerificationCache {
  private entries = new Map<string, CacheEntry>()
  private dirty = false
  private readonly filePath: string

  constructor(
    filePath: string,
    private readonly maxEntries: number,
    private readonly maxAgeDays: number,
  ) {
    this.filePath = filePath
  }

  static async load(
    cacheDir: string,
    options: { maxEntries?: number; maxAgeDays?: number } = {},
  ): Promise<{ cache: VerificationCache; warnings: string[] }> {
    const filePath = path.join(cacheDir, 'cache.json')
    const cache = new VerificationCache(
      filePath,
      options.maxEntries ?? DEFAULT_CACHE_ENTRIES,
      options.maxAgeDays ?? 30,
    )
    const warnings: string[] = []
    await fsp.mkdir(cacheDir, { recursive: true }).catch(() => undefined)
    let raw: string
    try {
      raw = await fsp.readFile(filePath, 'utf8')
    } catch {
      return { cache, warnings }
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || (parsed as CacheFile).schemaVersion !== 1) {
        throw new Error('unsupported cache schema')
      }
      const entries = (parsed as CacheFile).entries
      if (entries && typeof entries === 'object') {
        for (const [key, entry] of Object.entries(entries)) {
          if (isCacheEntry(entry)) cache.entries.set(key, entry)
        }
      }
      cache.prune()
    } catch (error) {
      warnings.push(
        `Cache file was unreadable and will be rebuilt: ${error instanceof Error ? error.message : String(error)}`,
      )
      await fsp
        .copyFile(filePath, `${filePath}.corrupt-${Date.now()}`)
        .catch(() => undefined)
      cache.entries.clear()
    }
    return { cache, warnings }
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (this.isExpired(entry)) {
      this.entries.delete(key)
      this.dirty = true
      return undefined
    }
    entry.lastUsedAt = new Date().toISOString()
    this.dirty = true
    return entry
  }

  set(key: string, checkId: string, result: CachedCheckPayload): void {
    const now = new Date().toISOString()
    this.entries.set(key, {
      key,
      checkId,
      status: 'PASS',
      cachedAt: now,
      lastUsedAt: now,
      result: {
        ...result,
        stdout: trimChunk(result.stdout),
        stderr: trimChunk(result.stderr),
      },
    })
    this.dirty = true
    this.prune()
  }

  private isExpired(entry: CacheEntry): boolean {
    const cachedAt = Date.parse(entry.cachedAt)
    if (!Number.isFinite(cachedAt)) return true
    return Date.now() - cachedAt > this.maxAgeDays * 24 * 60 * 60 * 1000
  }

  prune(): void {
    for (const [key, entry] of this.entries) {
      if (this.isExpired(entry)) {
        this.entries.delete(key)
        this.dirty = true
      }
    }
    if (this.entries.size <= this.maxEntries) return
    const ordered = [...this.entries.values()].sort(
      (a, b) => Date.parse(a.lastUsedAt || a.cachedAt) - Date.parse(b.lastUsedAt || b.cachedAt),
    )
    const remove = ordered.slice(0, Math.max(0, this.entries.size - this.maxEntries))
    for (const entry of remove) {
      this.entries.delete(entry.key)
      this.dirty = true
    }
  }

  async save(): Promise<{ saved: boolean; error?: string }> {
    if (!this.dirty) return { saved: false }
    this.prune()
    const file: CacheFile = { schemaVersion: 1, entries: Object.fromEntries(this.entries) }
    try {
      await atomicWriteFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`)
      this.dirty = false
      return { saved: true }
    } catch (error) {
      return { saved: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  stats(): { entries: number; size: number } {
    return { entries: this.entries.size, size: this.entries.size }
  }

  /** Only PASS results are cacheable; this guard documents the invariant. */
  static isCacheable(result: CheckResult): boolean {
    return result.status === 'PASS' && !result.cached
  }

  fingerprint(): string {
    return sha256Json([...this.entries.keys()].sort())
  }
}
