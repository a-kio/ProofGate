import pc from 'picocolors'
import {
  formatDuration,
  pluralize,
  sanitizeForTerminal,
  shortRunId,
  statusGlyph,
  truncateLine,
  type CheckResult,
  type CheckStatus,
  type OverallStatus,
  type RunReport,
} from '@proofgate/shared'

export interface RenderOptions {
  color?: boolean
  /** Show full stdout/stderr tails in terminal output. */
  verbose?: boolean
}

function colorizer(enabled: boolean) {
  const wrap = (fn: (value: string) => string) => (value: string): string => (enabled ? fn(value) : value)
  return {
    bold: wrap(pc.bold),
    dim: wrap(pc.dim),
    red: wrap(pc.red),
    green: wrap(pc.green),
    yellow: wrap(pc.yellow),
    magenta: wrap(pc.magenta),
    cyan: wrap(pc.cyan),
    gray: wrap(pc.gray),
  }
}

function statusColor(status: CheckStatus | OverallStatus, c: ReturnType<typeof colorizer>): (value: string) => string {
  switch (status) {
    case 'PASS':
    case 'VERIFIED':
      return c.green
    case 'FAIL':
    case 'FAILED':
      return c.red
    case 'ERROR':
      return c.red
    case 'BLOCKED':
      return c.yellow
    case 'UNKNOWN':
      return c.magenta
    case 'SKIPPED':
      return c.gray
    case 'INCOMPLETE':
      return c.yellow
    case 'UNVERIFIABLE':
      return c.magenta
    default:
      return (value: string) => value
  }
}

function checkLine(check: CheckResult, c: ReturnType<typeof colorizer>, verbose: boolean): string[] {
  const glyph = statusGlyph(check.status)
  const label = check.status.padEnd(8)
  const required = check.required ? '' : c.dim(' (optional)')
  const cached = check.cached ? c.cyan(' [cached]') : ''
  const duration = check.durationMs > 0 ? c.dim(` ${formatDuration(check.durationMs)}`) : ''
  const lines = [
    `  ${statusColor(check.status, c)(glyph)} ${statusColor(check.status, c)(label)} ${check.title}${required}${cached}${duration}`,
  ]
  if (check.summary) lines.push(`    ${c.dim(truncateLine(sanitizeForTerminal(check.summary), 240))}`)
  if (check.errorMessage) lines.push(`    ${c.red(truncateLine(sanitizeForTerminal(check.errorMessage), 240))}`)
  if (check.skipReason) lines.push(`    ${c.gray(truncateLine(sanitizeForTerminal(check.skipReason), 240))}`)
  if (check.status === 'FAIL' || check.status === 'ERROR') {
    for (const finding of check.findings.slice(0, 5)) {
      const location = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ''}: ` : ''
      lines.push(`    ${c.red('•')} ${location}${truncateLine(sanitizeForTerminal(finding.message), 220)}`)
    }
    if (check.findings.length > 5) lines.push(`    ${c.dim(`… ${check.findings.length - 5} more findings`)}`)
  }
  if (verbose && check.stdout.text.trim()) {
    lines.push(c.dim('    stdout:'))
    for (const line of check.stdout.text.trimEnd().split('\n').slice(-25)) lines.push(`      ${sanitizeForTerminal(line)}`)
  }
  if (verbose && check.stderr.text.trim()) {
    lines.push(c.dim('    stderr:'))
    for (const line of check.stderr.text.trimEnd().split('\n').slice(-25)) lines.push(`      ${sanitizeForTerminal(line)}`)
  }
  return lines
}

export function renderTerminalReport(report: RunReport, options: RenderOptions = {}): string {
  const color = options.color ?? (pc.isColorSupported && process.env.NO_COLOR === undefined)
  const c = colorizer(color)
  const out: string[] = []

  out.push('')
  out.push(`  ${c.bold('PROOFGATE')} ${c.dim('· independent verification')}`)
  out.push(`  ${c.dim('─'.repeat(64))}`)
  out.push(`  ${c.bold('Run')}      ${report.id}  ${c.dim(`(${shortRunId(report.id)})`)}`)
  out.push(`  ${c.bold('Project')}  ${report.project.name ?? report.project.root}`)
  out.push(`  ${c.bold('Profile')}  ${report.profile}   ${c.bold('Mode')} ${report.mode}`)
  if (report.task) out.push(`  ${c.bold('Task')}     ${truncateLine(report.task, 160)}`)
  out.push(`  ${c.bold('Started')}  ${report.startedAt}   ${c.bold('Duration')} ${formatDuration(report.durationMs)}`)
  out.push('')

  const banner = ` ${statusGlyph(report.status)} ${report.status} `
  const colored = statusColor(report.status, c)(banner)
  out.push(`  ${colored}`)
  switch (report.status) {
    case 'VERIFIED':
      out.push(`  ${c.green('Every required check and criterion produced passing evidence.')}`)
      break
    case 'FAILED':
      out.push(`  ${c.red('Required work failed. The claim of completion is not supported.')}`)
      break
    case 'INCOMPLETE':
      out.push(`  ${c.yellow('Some required evidence is missing, skipped, or optional checks failed.')}`)
      break
    case 'UNVERIFIABLE':
      out.push(`  ${c.magenta('ProofGate cannot verify this run. Acceptance may be unapproved or blockers prevented execution.')}`)
      break
  }
  out.push('')

  out.push(`  ${c.bold('Checks')} ${c.dim(`(${report.summary.passed}/${report.summary.total} passed)`)}`)
  if (report.checks.length === 0) {
    out.push(`  ${c.gray('No checks ran.')}`)
  } else {
    const ordered = [...report.checks].sort((a, b) => {
      const rank: Record<CheckStatus, number> = { FAIL: 0, ERROR: 1, BLOCKED: 2, UNKNOWN: 3, SKIPPED: 4, PASS: 5 }
      return rank[a.status] - rank[b.status]
    })
    for (const check of ordered) out.push(...checkLine(check, c, options.verbose ?? false))
  }
  out.push('')

  if (report.criteria.length > 0) {
    out.push(`  ${c.bold('Acceptance criteria')}`)
    for (const criterion of report.criteria) {
      const required = criterion.required ? '' : c.dim(' (optional)')
      out.push(
        `  ${statusColor(criterion.status, c)(statusGlyph(criterion.status))} ${criterion.description}${required} ${c.dim(`— ${criterion.reason}`)}`,
      )
    }
    out.push('')
  }

  out.push(
    `  ${c.bold('Summary')}  ${report.summary.requiredPassed}/${report.summary.requiredTotal} required passed` +
      (report.summary.failed > 0 ? `  ${c.red(`${report.summary.failed} failed`)}` : '') +
      (report.summary.error > 0 ? `  ${c.red(`${report.summary.error} errored`)}` : '') +
      (report.summary.skipped > 0 ? `  ${c.gray(`${report.summary.skipped} skipped`)}` : '') +
      (report.summary.unknown > 0 ? `  ${c.magenta(`${report.summary.unknown} unknown`)}` : ''),
  )
  if (report.cache.enabled) {
    out.push(`  ${c.bold('Cache')}    ${report.cache.hits} ${pluralize(report.cache.hits, 'hit')}, ${report.cache.misses} ${pluralize(report.cache.misses, 'miss')}`)
  }
  out.push(`  ${c.bold('Evidence')} ${report.evidence.dir} ${c.dim(`(${report.evidence.entries.length} files, manifest ${report.evidence.manifestHash.slice(0, 12)}…)`)}`)
  if (report.evidence.redacted) out.push(`  ${c.yellow('Secrets detected in captured output were redacted before persistence.')}`)

  const notes = [...report.notes, ...report.skippedChecks.map((skip) => `${skip.title}: ${skip.detail}`)]
  if (notes.length > 0) {
    out.push('')
    out.push(`  ${c.bold('Notes')}`)
    for (const note of notes.slice(0, 20)) out.push(`  ${c.dim('•')} ${truncateLine(sanitizeForTerminal(note), 220)}`)
    if (notes.length > 20) out.push(`  ${c.dim(`… ${notes.length - 20} more notes`)}`)
  }

  out.push('')
  return `${out.join('\n')}\n`
}

export { renderTerminalReport as renderTerminal }
