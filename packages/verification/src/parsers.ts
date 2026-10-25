import type { CheckMetrics, Finding } from '@proofgate/shared'
import { normalizeNewlines } from '@proofgate/shared'

export interface ParsedCommandOutput {
  findings: Finding[]
  metrics?: CheckMetrics
  summary?: string
}

const MAX_FINDINGS = 60

function pushUnique(findings: Finding[], finding: Finding): void {
  if (findings.length >= MAX_FINDINGS) return
  const key = `${finding.kind}|${finding.file ?? ''}|${finding.line ?? ''}|${finding.message}`
  if (findings.some((existing) => `${existing.kind}|${existing.file ?? ''}|${existing.line ?? ''}|${existing.message}` === key)) {
    return
  }
  findings.push(finding)
}

function parseTypeScript(text: string, findings: Finding[]): void {
  const pattern = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/gm
  for (const match of text.matchAll(pattern)) {
    pushUnique(findings, {
      kind: 'type-error',
      message: `${match[4]}: ${match[5]}`.slice(0, 500),
      file: match[1],
      line: Number(match[2]),
      column: Number(match[3]),
    })
  }
}

function parseEslint(text: string, findings: Finding[]): void {
  const pattern = /^(.+?):(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}([@\w/-]+))?$/gm
  for (const match of text.matchAll(pattern)) {
    pushUnique(findings, {
      kind: match[4] === 'error' ? 'lint-error' : 'warning',
      message: `${match[5]}${match[6] ? ` (${match[6]})` : ''}`.slice(0, 500),
      file: match[1],
      line: Number(match[2]),
      column: Number(match[3]),
    })
  }
}

function extractTrailingErrors(text: string, findings: Finding[]): void {
  const lines = normalizeNewlines(text).split('\n')
  let added = 0
  for (let index = lines.length - 1; index >= 0 && added < 5; index--) {
    const line = lines[index]?.trim() ?? ''
    if (!line) continue
    if (/\b(error|exception|failed|failure|fatal)\b/i.test(line) && line.length <= 500) {
      pushUnique(findings, { kind: 'runtime-error', message: line })
      added += 1
    }
  }
  if (added === 0) {
    const last = [...lines].reverse().find((line) => line.trim().length > 0)
    if (last && last.trim().length <= 500) {
      pushUnique(findings, { kind: 'runtime-error', message: last.trim() })
    }
  }
}

function parseVitest(text: string, findings: Finding[]): CheckMetrics | undefined {
  const summary = /Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed(?:\s*\|\s*(\d+)\s+skipped)?\s*\((\d+)\)/i.exec(text)
  if (!summary) return undefined
  const failed = Number(summary[1] ?? 0)
  const passed = Number(summary[2] ?? 0)
  const skipped = Number(summary[3] ?? 0)
  const total = Number(summary[4] ?? passed + failed + skipped)
  for (const match of text.matchAll(/^\s*(?:FAIL|×|✕)\s+(.+)$/gm)) {
    pushUnique(findings, { kind: 'test-failure', message: match[1]!.trim().slice(0, 500) })
  }
  return { testsTotal: total, testsPassed: passed, testsFailed: failed, testsSkipped: skipped }
}

function parseJest(text: string, findings: Finding[]): CheckMetrics | undefined {
  const summary = /Tests:\s+(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+skipped,\s*)?(\d+)\s+passed,\s*(\d+)\s+total/i.exec(text)
  if (!summary) return undefined
  const failed = Number(summary[1] ?? 0)
  const skipped = Number(summary[2] ?? 0)
  const passed = Number(summary[3] ?? 0)
  const total = Number(summary[4] ?? passed + failed + skipped)
  for (const match of text.matchAll(/^\s*●\s+(.+)$/gm)) {
    pushUnique(findings, { kind: 'test-failure', message: match[1]!.trim().slice(0, 500) })
  }
  return { testsTotal: total, testsPassed: passed, testsFailed: failed, testsSkipped: skipped }
}

function parsePytest(text: string, findings: Finding[]): CheckMetrics | undefined {
  const summary = /(?:(\d+)\s+failed,\s*)?(?:(\d+)\s+passed)?(?:,\s*(\d+)\s+skipped)?\s+in\s+[\d.]+s/i.exec(text)
  if (!summary || (!summary[1] && !summary[2] && !summary[3])) return undefined
  const failed = Number(summary[1] ?? 0)
  const passed = Number(summary[2] ?? 0)
  const skipped = Number(summary[3] ?? 0)
  for (const match of text.matchAll(/^FAILED\s+(.+?)(?:\s+-\s+(.+))?$/gm)) {
    pushUnique(findings, {
      kind: 'test-failure',
      message: `${match[1]}${match[2] ? ` — ${match[2]}` : ''}`.slice(0, 500),
    })
  }
  return { testsTotal: passed + failed + skipped, testsPassed: passed, testsFailed: failed, testsSkipped: skipped }
}

export function parseCommandOutput(stdout: string, stderr: string, exitCode: number | null): ParsedCommandOutput {
  const text = normalizeNewlines(`${stdout}\n${stderr}`)
  const findings: Finding[] = []
  let metrics: CheckMetrics | undefined

  const vitest = parseVitest(text, findings)
  const jest = vitest ? undefined : parseJest(text, findings)
  const pytest = vitest || jest ? undefined : parsePytest(text, findings)
  metrics = vitest ?? jest ?? pytest
  parseTypeScript(text, findings)
  parseEslint(text, findings)
  if (exitCode !== 0 && findings.length === 0) extractTrailingErrors(stderr || stdout, findings)

  const summary = Object.entries((metrics ?? {}) as Record<string, number>)
    .filter(([, value]) => typeof value === 'number')
    .map(([key, value]) => `${key}=${value}`)
    .join(', ')

  return {
    findings,
    ...(metrics ? { metrics } : {}),
    ...(summary ? { summary } : {}),
  }
}
