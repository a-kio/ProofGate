import { sanitizeForTerminal, statusGlyph, type RunReport } from '@proofgate/shared'

function escapeData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C')
}

/**
 * Emit GitHub Actions workflow commands. Findings that carry a file and line
 * become inline annotations; check-level failures become job-level errors.
 */
export function renderGitHubAnnotations(report: RunReport): string {
  const lines: string[] = []
  lines.push(`::notice title=ProofGate ${report.status}::${escapeData(`${report.summary.requiredPassed}/${report.summary.requiredTotal} required checks passed. Evidence: ${report.evidence.dir}`)}`)
  for (const check of report.checks) {
    if (check.status === 'PASS' || check.status === 'SKIPPED') continue
    const level = check.status === 'FAIL' || check.status === 'ERROR' ? 'error' : 'warning'
    let annotated = false
    for (const finding of check.findings) {
      if (!finding.file) continue
      annotated = true
      const properties = [
        `file=${escapeProperty(finding.file)}`,
        finding.line ? `line=${finding.line}` : '',
        finding.column ? `col=${finding.column}` : '',
        `title=${escapeProperty(`${check.title}: ${check.status}`)}`,
      ].filter(Boolean)
      lines.push(`::${level} ${properties.join(',')}::${escapeData(sanitizeForTerminal(finding.message))}`)
    }
    if (!annotated) {
      lines.push(`::${level} title=${escapeProperty(check.title)}::${escapeData(sanitizeForTerminal(`${check.status}: ${check.summary}`))}`)
    }
  }
  for (const criterion of report.criteria) {
    if (criterion.status === 'PASS' || criterion.status === 'SKIPPED') continue
    const level = criterion.status === 'FAIL' ? 'error' : 'warning'
    lines.push(`::${level} title=${escapeProperty(`Criterion: ${criterion.id}`)}::${escapeData(`${criterion.description} — ${criterion.reason}`)}`)
  }
  lines.push('')
  return lines.join('\n')
}

/** Markdown suitable for `$GITHUB_STEP_SUMMARY`. */
export function renderGitHubSummary(report: RunReport): string {
  const lines: string[] = []
  lines.push(`## ${statusGlyph(report.status)} ProofGate: ${report.status}`)
  lines.push('')
  lines.push(`${report.summary.requiredPassed}/${report.summary.requiredTotal} required checks passed · profile \`${report.profile}\` · run \`${report.id}\``)
  lines.push('')
  lines.push('| Status | Check | Required | Summary |')
  lines.push('| --- | --- | --- | --- |')
  for (const check of report.checks) {
    lines.push(
      `| ${statusGlyph(check.status)} ${check.status} | ${check.title.replace(/\|/g, '\\|')} | ${check.required ? 'yes' : 'no'} | ${check.summary.replace(/\|/g, '\\|')} |`,
    )
  }
  lines.push('')
  lines.push(`Evidence: \`${report.evidence.dir}\` (manifest \`${report.evidence.manifestHash.slice(0, 16)}…\`)`)
  lines.push('')
  return lines.join('\n')
}
