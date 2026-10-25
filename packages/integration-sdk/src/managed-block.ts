export const BLOCK_START = '<!-- proofgate:start -->'
export const BLOCK_END = '<!-- proofgate:end -->'

export function upsertManagedBlock(existing: string | null, content: string, options: {
  start?: string
  end?: string
  /** Insert at the top when the block is new. */
  prepend?: boolean
} = {}): string {
  const start = options.start ?? BLOCK_START
  const end = options.end ?? BLOCK_END
  const block = `${start}\n${content.trim()}\n${end}\n`
  const text = existing ?? ''
  const startIndex = text.indexOf(start)
  const endIndex = text.indexOf(end)
  if (startIndex >= 0 && endIndex > startIndex) {
    const before = text.slice(0, startIndex)
    const after = text.slice(endIndex + end.length)
    const normalizedBefore = before.endsWith('\n') || before === '' ? before : `${before}\n`
    const normalizedAfter = after.startsWith('\n') || after === '' ? after.replace(/^\n/, '') : after
    return `${normalizedBefore}${block}${normalizedAfter}`
  }
  if (!text.trim()) return block
  if (options.prepend) return `${block}\n${text.replace(/^\n+/, '')}`
  return `${text.replace(/\s+$/, '')}\n\n${block}`
}

export function removeManagedBlock(existing: string | null, options: { start?: string; end?: string } = {}): string {
  if (!existing) return ''
  const start = options.start ?? BLOCK_START
  const end = options.end ?? BLOCK_END
  const startIndex = existing.indexOf(start)
  const endIndex = existing.indexOf(end)
  if (startIndex < 0 || endIndex <= startIndex) return existing
  const before = existing.slice(0, startIndex).replace(/\s+$/, '')
  const after = existing.slice(endIndex + end.length).replace(/^\s+/, '')
  if (!before) return after ? `${after}\n` : ''
  if (!after) return `${before}\n`
  return `${before}\n\n${after}\n`
}

export function hasManagedBlock(existing: string | null, start = BLOCK_START, end = BLOCK_END): boolean {
  if (!existing) return false
  const startIndex = existing.indexOf(start)
  const endIndex = existing.indexOf(end)
  return startIndex >= 0 && endIndex > startIndex
}
