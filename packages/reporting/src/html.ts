import {
  formatBytes,
  formatDuration,
  sanitizeForTerminal,
  statusGlyph,
  type CheckResult,
  type RunReport,
} from '@proofgate/shared'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function statusClass(status: string): string {
  return `status-${status.toLowerCase()}`
}

function renderCheck(check: CheckResult): string {
  const optional = check.required ? '' : '<span class="optional">optional</span>'
  const cached = check.cached ? '<span class="chip">cached</span>' : ''
  const findings =
    check.findings.length === 0
      ? ''
      : `<ul class="findings">${check.findings
          .slice(0, 50)
          .map((finding) => {
            const location = finding.file
              ? `<span class="loc">${escapeHtml(sanitizeForTerminal(finding.file))}${finding.line ? `:${finding.line}` : ''}</span> `
              : ''
            return `<li>${location}${escapeHtml(sanitizeForTerminal(finding.message))}</li>`
          })
          .join('')}</ul>`
  const output =
    check.stdout.text.trim() || check.stderr.text.trim()
      ? `<details class="output"><summary>Output tails</summary>
          ${check.stdout.text.trim() ? `<h4>stdout</h4><pre>${escapeHtml(sanitizeForTerminal(check.stdout.text).trimEnd())}</pre>` : ''}
          ${check.stderr.text.trim() ? `<h4>stderr</h4><pre>${escapeHtml(sanitizeForTerminal(check.stderr.text).trimEnd())}</pre>` : ''}
        </details>`
      : ''
  return `<article class="check ${statusClass(check.status)}" data-status="${check.status}" data-required="${check.required}">
    <header>
      <span class="badge">${statusGlyph(check.status)} ${check.status}</span>
      <h3>${escapeHtml(check.title)}</h3>
      ${optional}${cached}
      <span class="duration">${formatDuration(check.durationMs)}</span>
    </header>
    <p class="summary">${escapeHtml(check.summary)}</p>
    ${check.errorMessage ? `<p class="error">${escapeHtml(check.errorMessage)}</p>` : ''}
    ${check.skipReason ? `<p class="skip">${escapeHtml(check.skipReason)}</p>` : ''}
    ${findings}
    ${output}
  </article>`
}

export function renderHtmlReport(report: RunReport): string {
  const checks = report.checks.map(renderCheck).join('\n')
  const criteria = report.criteria
    .map(
      (criterion) => `<tr class="${statusClass(criterion.status)}">
        <td>${statusGlyph(criterion.status)} ${criterion.status}</td>
        <td>${escapeHtml(criterion.description)}</td>
        <td>${criterion.required ? 'yes' : 'no'}</td>
        <td>${escapeHtml(criterion.reason)}</td>
      </tr>`,
    )
    .join('\n')
  const skipped = report.skippedChecks
    .map((skip) => `<li><strong>${escapeHtml(skip.title)}</strong> — ${escapeHtml(skip.reason)}: ${escapeHtml(skip.detail)}</li>`)
    .join('\n')
  const notes = report.notes.map((note) => `<li>${escapeHtml(sanitizeForTerminal(note))}</li>`).join('\n')
  const evidence = report.evidence.entries
    .map(
      (entry) => `<tr><td><code>${escapeHtml(entry.path)}</code></td><td>${entry.kind}</td><td>${entry.bytes}</td><td><code>${entry.sha256.slice(0, 16)}…</code></td></tr>`,
    )
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>ProofGate — ${escapeHtml(report.status)} — ${escapeHtml(report.id)}</title>
<style>
  :root {
    --bg: #0b0f14; --panel: #121923; --panel-2: #182230; --text: #e6edf5; --muted: #8b9bb0;
    --border: #243244; --accent: #7dd3fc; --pass: #4ade80; --fail: #f87171; --warn: #fbbf24;
    --unknown: #c084fc; --skip: #94a3b8; --blocked: #fb923c;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: radial-gradient(1200px 600px at 20% -10%, #10263a 0%, var(--bg) 55%); color: var(--text); }
  main { max-width: 1080px; margin: 0 auto; padding: 48px 24px 80px; }
  a { color: var(--accent); }
  .brand { display: flex; align-items: baseline; gap: 12px; letter-spacing: .14em; font-weight: 700; font-size: 13px; color: var(--muted); text-transform: uppercase; }
  .brand strong { color: var(--text); letter-spacing: .08em; font-size: 18px; }
  h1 { font-size: clamp(28px, 4vw, 44px); line-height: 1.1; margin: 18px 0 8px; }
  h2 { margin: 40px 0 14px; font-size: 18px; letter-spacing: .02em; }
  .status-banner { display: inline-flex; align-items: center; gap: 10px; padding: 10px 16px; border-radius: 999px; font-weight: 700; border: 1px solid var(--border); background: var(--panel); }
  .status-verified { color: var(--pass); border-color: color-mix(in srgb, var(--pass) 40%, var(--border)); }
  .status-failed { color: var(--fail); border-color: color-mix(in srgb, var(--fail) 40%, var(--border)); }
  .status-incomplete { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, var(--border)); }
  .status-unverifiable { color: var(--unknown); border-color: color-mix(in srgb, var(--unknown) 40%, var(--border)); }
  .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 24px 0 0; }
  .meta div { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; }
  .meta dt { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .09em; }
  .meta dd { margin: 6px 0 0; font-size: 14px; overflow-wrap: anywhere; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin: 28px 0 16px; }
  button { border: 1px solid var(--border); background: var(--panel); color: var(--text); border-radius: 8px; padding: 7px 12px; cursor: pointer; font: inherit; font-size: 13px; }
  button:hover, button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
  .check { background: linear-gradient(180deg, var(--panel), var(--panel-2)); border: 1px solid var(--border); border-left: 3px solid var(--skip); border-radius: 12px; padding: 14px 16px; margin: 10px 0; }
  .check.status-pass { border-left-color: var(--pass); }
  .check.status-fail, .check.status-error { border-left-color: var(--fail); }
  .check.status-blocked { border-left-color: var(--blocked); }
  .check.status-unknown { border-left-color: var(--unknown); }
  .check header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .check h3 { margin: 0; font-size: 15px; flex: 1 1 260px; }
  .badge { font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 999px; background: rgba(255,255,255,.06); }
  .status-pass .badge { color: var(--pass); }
  .status-fail .badge, .status-error .badge { color: var(--fail); }
  .status-blocked .badge { color: var(--blocked); }
  .status-unknown .badge { color: var(--unknown); }
  .optional, .chip { color: var(--muted); font-size: 11px; border: 1px solid var(--border); padding: 2px 7px; border-radius: 999px; }
  .duration { color: var(--muted); font-size: 12px; }
  .summary { color: var(--muted); margin: 8px 0 0; font-size: 13px; }
  .error { color: var(--fail); font-size: 13px; }
  .skip { color: var(--skip); font-size: 13px; }
  .loc { color: var(--accent); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; }
  .findings { margin: 10px 0 0; padding-left: 20px; color: #fecaca; font-size: 13px; }
  .findings li { margin: 4px 0; }
  details.output { margin-top: 10px; }
  details.output summary { cursor: pointer; color: var(--accent); font-size: 12px; }
  pre { background: #070b10; border: 1px solid var(--border); padding: 12px; border-radius: 8px; overflow: auto; font-size: 12px; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  th, td { text-align: left; padding: 9px 11px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; background: var(--panel-2); }
  tr:last-child td { border-bottom: 0; }
  .empty { color: var(--muted); font-size: 13px; }
  footer { margin-top: 48px; color: var(--muted); font-size: 12px; border-top: 1px solid var(--border); padding-top: 16px; }
  .hidden { display: none !important; }
  @media print { body { background: #fff; color: #111; } .toolbar { display: none; } .check, table, .meta div { background: #fff; } pre { background: #f6f8fa; } }
</style>
</head>
<body>
<main>
  <div class="brand"><strong>ProofGate</strong><span>independent verification</span></div>
  <h1>${escapeHtml(report.project.name ?? report.project.root)}</h1>
  <div class="status-banner ${statusClass(report.status)}">${statusGlyph(report.status)} ${escapeHtml(report.status)}</div>
  <p class="empty">${report.status === 'VERIFIED' ? 'Every required check and criterion produced passing evidence.' : report.status === 'FAILED' ? 'Required work failed. The claim of completion is not supported.' : report.status === 'INCOMPLETE' ? 'Some evidence is missing, skipped, or optional checks failed.' : 'ProofGate cannot verify this run.'}</p>
  <dl class="meta">
    <div><dt>Run</dt><dd><code>${escapeHtml(report.id)}</code></dd></div>
    <div><dt>Profile</dt><dd>${escapeHtml(report.profile)}</dd></div>
    <div><dt>Mode</dt><dd>${escapeHtml(report.mode)}</dd></div>
    <div><dt>Started</dt><dd>${escapeHtml(report.startedAt)}</dd></div>
    <div><dt>Duration</dt><dd>${formatDuration(report.durationMs)}</dd></div>
    <div><dt>Intent</dt><dd><code>${escapeHtml(report.intent.hash.slice(0, 24))}…</code></dd></div>
    ${report.task ? `<div style="grid-column: 1 / -1"><dt>Task</dt><dd>${escapeHtml(report.task)}</dd></div>` : ''}
  </dl>

  <h2>Checks</h2>
  <div class="toolbar" role="group" aria-label="Filter checks">
    <button data-filter="all" aria-pressed="true">All (${report.checks.length})</button>
    <button data-filter="failed" aria-pressed="false">Failed (${report.checks.filter((check) => check.status === 'FAIL' || check.status === 'ERROR').length})</button>
    <button data-filter="required" aria-pressed="false">Required</button>
    <button data-filter="optional" aria-pressed="false">Optional</button>
  </div>
  <section id="checks">${checks || '<p class="empty">No checks ran.</p>'}</section>

  <h2>Acceptance criteria</h2>
  ${report.criteria.length === 0 ? '<p class="empty">No acceptance criteria defined.</p>' : `<table><thead><tr><th>Status</th><th>Criterion</th><th>Required</th><th>Reason</th></tr></thead><tbody>${criteria}</tbody></table>`}

  ${report.skippedChecks.length > 0 ? `<h2>Skipped checks</h2><ul>${skipped}</ul>` : ''}
  ${report.notes.length > 0 ? `<h2>Notes</h2><ul>${notes}</ul>` : ''}

  <h2>Evidence</h2>
  <p class="empty">Directory <code>${escapeHtml(report.evidence.dir)}</code> · manifest <code>${escapeHtml(report.evidence.manifestPath)}</code> · SHA-256 <code>${escapeHtml(report.evidence.manifestHash)}</code> · ${report.evidence.redacted ? 'secrets redacted' : 'no secrets detected'}.</p>
  <table><thead><tr><th>File</th><th>Kind</th><th>Bytes</th><th>SHA-256</th></tr></thead><tbody>${evidence}</tbody></table>

  <footer>Generated by ${escapeHtml(report.tool.name)} ${escapeHtml(report.tool.version)} · ${formatBytes(report.evidence.totalBytes)} of evidence · local-first, nothing uploaded.</footer>
</main>
<script>
  (function () {
    var buttons = document.querySelectorAll('[data-filter]');
    var checks = Array.prototype.slice.call(document.querySelectorAll('.check'));
    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        buttons.forEach(function (other) { other.setAttribute('aria-pressed', String(other === button)); });
        var filter = button.getAttribute('data-filter');
        checks.forEach(function (check) {
          var show = filter === 'all'
            || (filter === 'failed' && (check.dataset.status === 'FAIL' || check.dataset.status === 'ERROR'))
            || (filter === 'required' && check.dataset.required === 'true')
            || (filter === 'optional' && check.dataset.required === 'false');
          check.classList.toggle('hidden', !show);
        });
      });
    });
  })();
</script>
</body>
</html>
`
}
