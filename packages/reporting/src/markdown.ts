import {
  formatBytes,
  formatDuration,
  statusGlyph,
  sanitizeForTerminal,
  type CheckResult,
  type RunReport,
} from '@proofgate/shared'

function escapeCell(value: string | undefined): string {
  return sanitizeForTerminal(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim()
}

function codeBlock(value: string): string {
  const fence = value.includes('```') ? '````' : '```'
  return `${fence}text\n${sanitizeForTerminal(value).trimEnd()}\n${fence}`
}

function checkSection(check: CheckResult): string[] {
  const lines: string[] = []
  lines.push(`### ${statusGlyph(check.status)} ${escapeCell(check.title)} — ${check.status}${check.required ? '' : ' (optional)'}`)
  lines.push('')
  if (check.summary) lines.push(escapeCell(check.summary))
  if (check.errorMessage) lines.push(`**Error:** ${escapeCell(check.errorMessage)}`)
  if (check.skipReason) lines.push(`**Skipped:** ${escapeCell(check.skipReason)}`)
  lines.push('')
  const meta: string[] = []
  meta.push(`- Type: \`${check.type}\``)
  meta.push(`- Duration: ${formatDuration(check.durationMs)}`)
  if (check.command) meta.push(`- Command: \`${escapeCell(check.command.join(' '))}\``)
  if (check.exitCode !== undefined) meta.push(`- Exit code: ${check.exitCode ?? 'signal'}`)
  if (check.timedOut) meta.push('- Timed out: yes')
  if (check.cached) meta.push('- Cached: yes')
  if (check.artifacts?.length) meta.push(`- Evidence files: ${check.artifacts.map((file) => `\`${escapeCell(file)}\``).join(', ')}`)
  lines.push(...meta)
  if (check.findings.length > 0) {
    lines.push('', '**Findings**', '')
    for (const finding of check.findings.slice(0, 20)) {
      const location = finding.file ? `\`${escapeCell(finding.file)}${finding.line ? `:${finding.line}` : ''}\` ` : ''
      lines.push(`- ${location}${escapeCell(finding.message)}`)
    }
    if (check.findings.length > 20) lines.push(`- … ${check.findings.length - 20} more`)
  }
  if (check.stdout.text.trim() || check.stderr.text.trim()) {
    lines.push('', '<details><summary>Output tails</summary>', '')
    if (check.stdout.text.trim()) {
      lines.push('**stdout**', '', codeBlock(check.stdout.text))
    }
    if (check.stderr.text.trim()) {
      lines.push('**stderr**', '', codeBlock(check.stderr.text))
    }
    lines.push('', '</details>')
  }
  lines.push('')
  return lines
}

export function renderMarkdownReport(report: RunReport): string {
  const lines: string[] = []
  lines.push(`# ProofGate report — ${report.status}`)
  lines.push('')
  lines.push(`**${report.status === 'VERIFIED' ? 'Verified with evidence.' : report.status === 'FAILED' ? 'Required checks failed.' : 'Verification is not complete.'}**`)
  lines.push('')
  lines.push('| Field | Value |')
  lines.push('| --- | --- |')
  lines.push(`| Run | \`${report.id}\` |`)
  lines.push(`| Status | **${report.status}** |`)
  lines.push(`| Profile | ${report.profile} |`)
  lines.push(`| Mode | ${report.mode} |`)
  if (report.task) lines.push(`| Task | ${escapeCell(report.task)} |`)
  lines.push(`| Project | ${escapeCell(report.project.name ?? report.project.root)} |`)
  lines.push(`| Started | ${report.startedAt} |`)
  lines.push(`| Duration | ${formatDuration(report.durationMs)} |`)
  lines.push(`| Intent hash | \`${report.intent.hash}\` |`)
  lines.push(`| Evidence | \`${report.evidence.dir}\` (${report.evidence.entries.length} files, ${formatBytes(report.evidence.totalBytes)}) |`)
  lines.push('')

  lines.push('## Checks')
  lines.push('')
  lines.push('| Status | Check | Required | Duration | Summary |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const check of report.checks) {
    lines.push(
      `| ${statusGlyph(check.status)} ${check.status} | ${escapeCell(check.title)} | ${check.required ? 'yes' : 'no'} | ${formatDuration(check.durationMs)} | ${escapeCell(check.summary)} |`,
    )
  }
  lines.push('')

  if (report.criteria.length > 0) {
    lines.push('## Acceptance criteria')
    lines.push('')
    lines.push('| Status | Criterion | Required | Reason |')
    lines.push('| --- | --- | --- | --- |')
    for (const criterion of report.criteria) {
      lines.push(
        `| ${statusGlyph(criterion.status)} ${criterion.status} | ${escapeCell(criterion.description)} | ${criterion.required ? 'yes' : 'no'} | ${escapeCell(criterion.reason)} |`,
      )
    }
    lines.push('')
  }

  if (report.skippedChecks.length > 0) {
    lines.push('## Skipped checks')
    lines.push('')
    for (const skip of report.skippedChecks) lines.push(`- **${escapeCell(skip.title)}** — ${skip.reason}: ${escapeCell(skip.detail)}`)
    lines.push('')
  }

  if (report.notes.length > 0) {
    lines.push('## Notes')
    lines.push('')
    for (const note of report.notes) lines.push(`- ${escapeCell(note)}`)
    lines.push('')
  }

  lines.push('## Check details')
  lines.push('')
  for (const check of report.checks) lines.push(...checkSection(check))

  lines.push('## Evidence integrity')
  lines.push('')
  lines.push(`- Directory: \`${report.evidence.dir}\``)
  lines.push(`- Manifest: \`${report.evidence.manifestPath}\``)
  lines.push(`- Manifest SHA-256: \`${report.evidence.manifestHash}\``)
  lines.push(`- Redacted: ${report.evidence.redacted ? 'yes' : 'no'}`)
  lines.push('')
  if (report.evidence.entries.length > 0) {
    lines.push('| File | Kind | Bytes | SHA-256 |')
    lines.push('| --- | --- | --- | --- |')
    for (const entry of report.evidence.entries) {
      lines.push(`| \`${escapeCell(entry.path)}\` | ${entry.kind} | ${entry.bytes} | \`${entry.sha256.slice(0, 16)}…\` |`)
    }
    lines.push('')
  }

  lines.push('---')
  lines.push(`Generated by ${report.tool.name} ${report.tool.version}. Local-first; no data was uploaded.`)
  return `${lines.join('\n')}\n`
}
