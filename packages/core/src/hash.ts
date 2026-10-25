import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex')
}

export async function sha256File(path: string): Promise<string | null> {
  try {
    const buf = await readFile(path)
    return sha256Hex(buf)
  } catch {
    return null
  }
}

/** Deterministic JSON stringify (sorted keys) for fingerprints. */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  const walk = (v: unknown): unknown => {
    if (typeof v !== 'object' || v === null) return v
    if (seen.has(v as object)) return '[circular]'
    seen.add(v as object)
    if (Array.isArray(v)) return v.map(walk)
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = walk((v as Record<string, unknown>)[k])
    }
    return out
  }
  return JSON.stringify(walk(value))
}
