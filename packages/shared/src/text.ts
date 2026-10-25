import type { OutputChunk } from './types.js'

const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g

export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, '')
}

/** Remove carriage returns and normalize line endings for log persistence. */
export function normalizeNewlines(input: string): string {
  return input.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function byteLength(input: string): number {
  return Buffer.byteLength(input, 'utf8')
}

/**
 * Keep the last `maxBytes` bytes of a string without splitting a UTF-8
 * sequence. Used for output tails, where the end of a log is the useful part.
 */
export function truncateTail(input: string, maxBytes: number): { text: string; truncated: boolean; totalBytes: number } {
  const totalBytes = byteLength(input)
  if (totalBytes <= maxBytes || maxBytes <= 0) {
    return { text: input, truncated: false, totalBytes }
  }
  let start = input.length - maxBytes
  const code = input.charCodeAt(start)
  if (code >= 0xdc00 && code <= 0xdfff) start += 1
  const text = input.slice(Math.max(0, start))
  return {
    text: `… [truncated ${totalBytes - byteLength(text)} bytes] …\n${text}`,
    truncated: true,
    totalBytes,
  }
}

export function truncateMiddle(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input
  const half = Math.floor((maxChars - 20) / 2)
  return `${input.slice(0, half)}\n… [truncated] …\n${input.slice(-half)}`
}

export function truncateLine(input: string, maxChars: number): string {
  const singleLine = input.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= maxChars) return singleLine
  return `${singleLine.slice(0, Math.max(0, maxChars - 1))}…`
}

export function firstLines(input: string, count: number): string[] {
  return normalizeNewlines(input)
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .slice(0, count)
}

export function lastLines(input: string, count: number): string[] {
  return normalizeNewlines(input)
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .slice(-count)
}

export function lineCount(input: string): number {
  if (!input) return 0
  return normalizeNewlines(input).split('\n').length
}

export function indent(input: string, spaces: number): string {
  const pad = ' '.repeat(spaces)
  return input
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n')
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`
}

export function emptyChunk(): OutputChunk {
  return { text: '', bytes: 0, totalBytes: 0, truncated: false }
}

/** Build an output chunk by tail-truncating already-captured text. */
export function makeChunk(input: string, maxBytes: number): OutputChunk {
  const normalized = normalizeNewlines(stripAnsi(input))
  const tail = truncateTail(normalized, maxBytes)
  return {
    text: tail.text,
    bytes: byteLength(tail.text),
    totalBytes: tail.totalBytes,
    truncated: tail.truncated,
  }
}

/** Escape text for safe inclusion in terminal output (control chars removed). */
export function sanitizeForTerminal(input: string): string {
  // eslint-disable-next-line no-control-regex
  return stripAnsi(input).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
}

export function slugify(input: string, fallback = 'item'): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || fallback
}
