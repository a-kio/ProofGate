import type { OutputChunk } from '@proofgate/shared'
import { normalizeNewlines, redactSecrets, stripAnsi } from '@proofgate/shared'

const HEAD_SHARE = 0.4

/**
 * Bounded stdout/stderr collector. Keeps the head and tail of a stream within
 * a fixed byte budget so failure summaries at either end survive, while total
 * byte counts remain accurate and memory stays bounded.
 */
export class OutputCollector {
  private chunks: Buffer[] = []
  private bytes = 0
  totalBytes = 0
  private compacted = false

  constructor(private readonly maxBytes: number) {}

  push(chunk: Buffer | string): void {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
    this.totalBytes += buffer.length
    this.chunks.push(buffer)
    this.bytes += buffer.length
    if (this.bytes > this.maxBytes * 2) this.compact()
  }

  private compact(): void {
    let combined = Buffer.concat(this.chunks)
    if (combined.length <= this.maxBytes) {
      this.chunks = [combined]
      this.bytes = combined.length
      return
    }
    const headBytes = Math.floor(this.maxBytes * HEAD_SHARE)
    const tailBytes = this.maxBytes - headBytes
    combined = Buffer.concat([
      combined.subarray(0, headBytes),
      Buffer.from('\n… [output truncated] …\n', 'utf8'),
      combined.subarray(combined.length - tailBytes),
    ])
    this.chunks = [combined]
    this.bytes = combined.length
    this.compacted = true
  }

  text(): string {
    const combined = Buffer.concat(this.chunks).toString('utf8')
    return normalizeNewlines(stripAnsi(combined))
  }

  isEmpty(): boolean {
    return this.totalBytes === 0
  }

  chunk(maxReportBytes = this.maxBytes): OutputChunk {
    const text = this.text()
    const redacted = redactSecrets(text)
    if (Buffer.byteLength(redacted.text, 'utf8') <= maxReportBytes) {
      return {
        text: redacted.text,
        bytes: Buffer.byteLength(redacted.text, 'utf8'),
        totalBytes: this.totalBytes,
        truncated: this.compacted,
      }
    }
    const headBytes = Math.floor(maxReportBytes * HEAD_SHARE)
    const tailBytes = maxReportBytes - headBytes
    const buffer = Buffer.from(redacted.text, 'utf8')
    let start = buffer.length - tailBytes
    while (start > 0 && (buffer[start]! & 0xc0) === 0x80) start += 1
    const textOut = `${buffer.subarray(0, headBytes).toString('utf8')}\n… [truncated] …\n${buffer.subarray(start).toString('utf8')}`
    return {
      text: textOut,
      bytes: Buffer.byteLength(textOut, 'utf8'),
      totalBytes: this.totalBytes,
      truncated: true,
    }
  }
}
