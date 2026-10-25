import type { RunReport } from '@proofgate/shared'
import { renderTerminalReport, type RenderOptions } from './terminal.js'
import { renderJsonReport } from './json.js'
import { renderMarkdownReport } from './markdown.js'
import { renderHtmlReport } from './html.js'
import { renderGitHubAnnotations, renderGitHubSummary } from './github.js'

export * from './terminal.js'
export * from './json.js'
export * from './markdown.js'
export * from './html.js'
export * from './github.js'
export * from './schemas.js'

export const REPORT_FORMATS = ['terminal', 'json', 'markdown', 'html', 'github', 'github-summary'] as const
export type ReportFormat = (typeof REPORT_FORMATS)[number]

export function renderReport(report: RunReport, format: ReportFormat, options: RenderOptions = {}): string {
  switch (format) {
    case 'terminal':
      return renderTerminalReport(report, options)
    case 'json':
      return renderJsonReport(report)
    case 'markdown':
      return renderMarkdownReport(report)
    case 'html':
      return renderHtmlReport(report)
    case 'github':
      return renderGitHubAnnotations(report)
    case 'github-summary':
      return renderGitHubSummary(report)
    default: {
      const exhaustive: never = format
      throw new Error(`unknown report format: ${String(exhaustive)}`)
    }
  }
}

export function extensionFor(format: ReportFormat): string {
  switch (format) {
    case 'markdown':
      return 'md'
    case 'html':
      return 'html'
    case 'json':
      return 'json'
    default:
      return 'txt'
  }
}

export function isReportFormat(value: string): value is ReportFormat {
  return (REPORT_FORMATS as readonly string[]).includes(value)
}
