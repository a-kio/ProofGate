import path from "node:path";
import { getRun } from "@proofgate/core";
import { isReportFormat, type ReportFormat, renderReport } from "@proofgate/reporting";
import pc from "picocolors";
import { renderRunSummaryBox } from "../ui/format.js";

export async function showCommand(
  runId: string,
  options: { format?: string; root?: string } = {},
): Promise<void> {
  const root = path.resolve(options.root || ".");
  const run = await getRun(root, runId);

  if (!run) {
    console.error(pc.red(`Verification run "${runId}" not found in ${root}`));
    process.exit(1);
  }

  const format = options.format?.toLowerCase() || "terminal";
  if (format === "terminal") {
    console.log(renderRunSummaryBox(run));
  } else if (isReportFormat(format)) {
    console.log(renderReport(run, format as ReportFormat));
  } else {
    console.log(JSON.stringify(run, null, 2));
  }
}
