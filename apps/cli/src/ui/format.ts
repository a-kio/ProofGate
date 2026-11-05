import {
  type CheckResult,
  type CheckStatus,
  type OverallStatus,
  type RunReport,
  statusGlyph,
} from "@proofgate/shared";
import pc from "picocolors";

export function banner(): string {
  return pc.dim("⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯");
}

export function formatHeader(title: string, subtitle?: string): string {
  const parts = [pc.bold(pc.white(title))];
  if (subtitle) parts.push(pc.dim(`· ${subtitle}`));
  return parts.join(" ");
}

export function formatStatusBadge(status: OverallStatus | CheckStatus): string {
  switch (status) {
    case "VERIFIED":
    case "PASS":
      return pc.bgGreen(pc.black(` ${status} `));
    case "FAILED":
    case "FAIL":
      return pc.bgRed(pc.white(` ${status} `));
    case "INCOMPLETE":
    case "UNKNOWN":
      return pc.bgYellow(pc.black(` ${status} `));
    case "UNVERIFIABLE":
    case "ERROR":
    case "BLOCKED":
      return pc.bgMagenta(pc.white(` ${status} `));
    default:
      return pc.bgBlack(pc.dim(` ${status} `));
  }
}

export function formatStatusGlyph(status: OverallStatus | CheckStatus): string {
  const glyph = statusGlyph(status);
  switch (status) {
    case "VERIFIED":
    case "PASS":
      return pc.green(glyph);
    case "FAILED":
    case "FAIL":
      return pc.red(glyph);
    case "INCOMPLETE":
    case "UNKNOWN":
      return pc.yellow(glyph);
    case "UNVERIFIABLE":
    case "ERROR":
    case "BLOCKED":
      return pc.magenta(glyph);
    default:
      return pc.dim(glyph);
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatCheckLine(check: CheckResult): string {
  const glyph = formatStatusGlyph(check.status);
  const statusStr = pc.bold(
    check.status === "PASS"
      ? pc.green(check.status.padEnd(6))
      : check.status === "FAIL"
        ? pc.red(check.status.padEnd(6))
        : pc.yellow(check.status.padEnd(6)),
  );
  const idStr = pc.white((check.title || check.id).padEnd(28));
  const timeStr = pc.dim(formatDuration(check.durationMs).padStart(8));
  const cachedStr = check.cached ? pc.dim(" (cached)") : "";
  const requiredStr = check.required ? "" : pc.dim(" [optional]");

  let line = `  ${glyph} ${statusStr} ${idStr} ${timeStr}${cachedStr}${requiredStr}`;

  if (check.status === "FAIL" || check.status === "ERROR") {
    const errorMsg = check.errorMessage || check.summary;
    if (errorMsg) {
      line += `\n    ${pc.red("↳")} ${pc.dim(errorMsg.slice(0, 120))}`;
    }
    for (const finding of check.findings.slice(0, 3)) {
      const loc = finding.file ? ` (${finding.file}:${finding.line ?? 1})` : "";
      line += `\n    ${pc.red("•")} ${finding.message}${pc.dim(loc)}`;
    }
  }

  return line;
}

export function renderRunSummaryBox(report: RunReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${formatStatusBadge(report.status)}  ${pc.bold(pc.white(`Run ${report.id}`))}`);
  lines.push(`  ${pc.dim("Target:")}   ${pc.cyan(report.project.name || report.project.root)}`);
  lines.push(
    `  ${pc.dim("Profile:")}  ${pc.magenta(report.profile)}  ${pc.dim("| Mode:")} ${report.mode}  ${pc.dim("| Time:")} ${formatDuration(report.durationMs)}`,
  );
  lines.push(`  ${pc.dim("Evidence:")} ${pc.dim(report.evidence.dir)}`);
  lines.push(`  ${pc.dim("Manifest:")} ${pc.dim(report.evidence.manifestHash.slice(0, 32))}...`);
  lines.push("");

  if (report.criteria.length > 0) {
    lines.push(pc.bold(pc.dim("  ACCEPTANCE CRITERIA")));
    for (const crit of report.criteria) {
      const glyph = formatStatusGlyph(crit.status);
      const req = crit.required ? "" : pc.dim(" (optional)");
      lines.push(`  ${glyph} ${crit.id}: ${crit.description}${req}`);
    }
    lines.push("");
  }

  lines.push(pc.bold(pc.dim("  CHECKS")));
  for (const check of report.checks) {
    lines.push(formatCheckLine(check));
  }

  for (const skipped of report.skippedChecks) {
    lines.push(
      `  ${pc.dim("–")} ${pc.dim("SKIP  ")} ${pc.dim(skipped.id.padEnd(28))} ${pc.dim(`(${skipped.reason}: ${skipped.detail})`)}`,
    );
  }

  lines.push("");
  const summary = report.summary;
  lines.push(
    `  ${pc.dim("Summary:")} ${pc.green(`${summary.passed} passed`)} · ${summary.failed > 0 ? pc.red(`${summary.failed} failed`) : "0 failed"} · ${summary.skipped > 0 ? pc.dim(`${summary.skipped} skipped`) : "0 skipped"} · ${summary.total} total`,
  );

  if (report.notes.length > 0) {
    lines.push("");
    for (const note of report.notes) {
      lines.push(`  ${pc.yellow("ℹ")} ${pc.dim(note)}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}
