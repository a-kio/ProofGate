export type TomlValue = string | number | boolean | string[]

export function escapeTomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function serializeTomlValue(value: TomlValue): string {
  if (typeof value === 'string') return `"${escapeTomlString(value)}"`
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return `[${value.map((entry) => `"${escapeTomlString(entry)}"`).join(', ')}]`
}

function splitLines(text: string): string[] {
  if (text === '') return []
  const normalized = text.replace(/\r\n/g, '\n')
  return normalized.endsWith('\n') ? normalized.slice(0, -1).split('\n') : normalized.split('\n')
}

function tableHeader(path: string[]): string {
  return `[${path.join('.')}]`
}

function findTable(lines: string[], path: string[]): { start: number; end: number } | null {
  const header = tableHeader(path)
  const start = lines.findIndex((line) => line.trim() === header)
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[i]!)) {
      end = i
      break
    }
  }
  return { start, end }
}

/**
 * Upsert keys inside a TOML table while preserving unrelated content and
 * comments. This is deliberately a small, conservative editor for agent config
 * files, not a general TOML serializer.
 */
export function upsertTomlTable(text: string, path: string[], values: Record<string, TomlValue>): string {
  const lines = splitLines(text)
  const range = findTable(lines, path)
  const keys = new Set(Object.keys(values))
  const rendered = Object.entries(values).map(([key, value]) => `${key} = ${serializeTomlValue(value)}`)

  if (!range) {
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop()
    if (lines.length > 0) lines.push('')
    lines.push(tableHeader(path), ...rendered)
    return `${lines.join('\n')}\n`
  }

  const section = lines.slice(range.start + 1, range.end)
  const kept = section.filter((line) => {
    const match = /^\s*([A-Za-z0-9_.-]+)\s*=/.exec(line)
    return !(match?.[1] && keys.has(match[1]))
  })
  while (kept.length > 0 && kept[kept.length - 1]!.trim() === '') kept.pop()
  const rebuilt = [lines[range.start]!, ...kept, ...(kept.length > 0 ? [''] : []), ...rendered, '']
  while (rebuilt.length > 0 && rebuilt[rebuilt.length - 1] === '') rebuilt.pop()
  const before = lines.slice(0, range.start)
  const after = lines.slice(range.end)
  const next = [...before, ...rebuilt]
  if (after.length > 0) {
    if (next[next.length - 1]?.trim() !== '') next.push('')
    next.push(...after)
  }
  return `${next.join('\n')}\n`
}

export function removeTomlTable(text: string, path: string[]): string {
  const lines = splitLines(text)
  const range = findTable(lines, path)
  if (!range) return text
  const before = lines.slice(0, range.start)
  while (before.length > 0 && before[before.length - 1]!.trim() === '') before.pop()
  const after = lines.slice(range.end)
  while (after.length > 0 && after[0]!.trim() === '') after.shift()
  const combined = [...before, ...(before.length > 0 && after.length > 0 ? [''] : []), ...after]
  if (combined.length === 0) return ''
  return `${combined.join('\n')}\n`
}

export function hasTomlTable(text: string, path: string[]): boolean {
  return findTable(splitLines(text), path) !== null
}
