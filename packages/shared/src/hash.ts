import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'

/** Deterministic JSON: sorted object keys, stable arrays, no undefined values. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value))
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return null
    return value
  }
  if (Array.isArray(value)) return value.map((entry) => (entry === undefined ? null : normalize(entry)))
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Map) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of [...value.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)))) {
      out[String(k)] = normalize(v)
    }
    return out
  }
  if (value instanceof Set) return [...value].map(normalize).sort()
  const record = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) {
    const entry = record[key]
    if (entry === undefined) continue
    out[key] = normalize(entry)
  }
  return out
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex')
}

export function sha256Json(value: unknown): string {
  return sha256Hex(stableStringify(value))
}

export function shortHash(input: string, length = 8): string {
  return sha256Hex(input).slice(0, length)
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = fs.createReadStream(filePath)
  for await (const chunk of stream) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export function sha256FileSync(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

/** Hash of a file's size, mtime, and first/last blocks — cheap identity for large binaries. */
export async function quickFileFingerprint(filePath: string): Promise<string> {
  const stat = await fsp.stat(filePath)
  const handle = await fsp.open(filePath, 'r')
  try {
    const chunkSize = Math.min(64 * 1024, stat.size)
    const head = Buffer.alloc(chunkSize)
    const tail = Buffer.alloc(chunkSize)
    if (chunkSize > 0) {
      await handle.read(head, 0, chunkSize, 0)
      await handle.read(tail, 0, chunkSize, Math.max(0, stat.size - chunkSize))
    }
    return sha256Hex(Buffer.concat([head, tail, Buffer.from(`${stat.size}:${stat.mtimeMs}`)]))
  } finally {
    await handle.close()
  }
}

export function randomToken(bytes = 16): string {
  return randomBytes(bytes).toString('base64url')
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
