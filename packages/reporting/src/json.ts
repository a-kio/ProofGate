import type { RunReport } from '@proofgate/shared'

export function renderJsonReport(report: RunReport): string {
  return `${JSON.stringify(report, null, 2)}\n`
}

export function renderRunListJson(runs: unknown): string {
  return `${JSON.stringify(runs, null, 2)}\n`
}
