import { atomicWrite, readTextIfExists } from './fsx.js'

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Remove JSONC comments and trailing commas without touching string contents. */
export function stripJsonComments(input: string): string {
  let output = ''
  let inString = false
  let quote = ''
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!
    const next = input[i + 1]

    if (lineComment) {
      if (char === '\n') {
        lineComment = false
        output += char
      }
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        i += 1
      }
      continue
    }
    if (inString) {
      output += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) inString = false
      continue
    }
    if (char === '"' || char === "'") {
      inString = true
      quote = char
      output += char
      continue
    }
    if (char === '/' && next === '/') {
      lineComment = true
      i += 1
      continue
    }
    if (char === '/' && next === '*') {
      blockComment = true
      i += 1
      continue
    }
    output += char
  }

  // Remove trailing commas outside strings.
  let cleaned = ''
  inString = false
  escaped = false
  quote = ''
  for (let i = 0; i < output.length; i++) {
    const char = output[i]!
    if (inString) {
      cleaned += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) inString = false
      continue
    }
    if (char === '"' || char === "'") {
      inString = true
      quote = char
      cleaned += char
      continue
    }
    if (char === ',') {
      let j = i + 1
      while (j < output.length && /\s/.test(output[j]!)) j += 1
      if (output[j] === '}' || output[j] === ']') continue
    }
    cleaned += char
  }
  return cleaned
}

export function parseJsonc(text: string, source = 'JSON'): unknown {
  const withoutBom = text.replace(/^\uFEFF/, '')
  if (withoutBom.trim() === '') return {}
  try {
    return JSON.parse(stripJsonComments(withoutBom))
  } catch (error) {
    throw new Error(`${source} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function readJsonObject(target: string): Promise<{ value: Record<string, unknown>; text: string | null; error?: string }> {
  const text = await readTextIfExists(target)
  if (text === null) return { value: {}, text: null }
  try {
    const parsed = parseJsonc(text, target)
    if (!isPlainObject(parsed)) return { value: {}, text, error: `${target} must contain a JSON object` }
    return { value: parsed, text }
  } catch (error) {
    return { value: {}, text, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function writeJson(target: string, value: unknown): Promise<void> {
  await atomicWrite(target, `${JSON.stringify(value, null, 2)}\n`)
}

/** Deep-merge plain objects; arrays and primitives in `override` win. */
export function mergeJson(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key]
    if (isPlainObject(existing) && isPlainObject(value)) result[key] = mergeJson(existing, value)
    else result[key] = value
  }
  return result
}

/** Remove only the keys this integration owns, preserving everything else. */
export function removeKeys(base: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }
  for (const key of keys) delete result[key]
  return result
}
