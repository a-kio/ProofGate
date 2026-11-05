import fsp from "node:fs/promises";
import path from "node:path";
import { type Profile, verify } from "@proofgate/core";
import { isReportFormat, type ReportFormat, renderReport } from "@proofgate/reporting";
import open from "open";
import ora from "ora";
import pc from "picocolors";
import { renderRunSummaryBox } from "../ui/format.js";

export interface VerifyCommandOptions {
  profile?: string;
  changed?: boolean;
  full?: boolean;
  base?: string;
  task?: string;
  format?: string;
  cache?: boolean;
  open?: boolean;
  output?: string;
}

export async function verifyCommand(
  targetDir = ".",
  options: VerifyCommandOptions = {},
): Promise<void> {
  const root = path.resolve(targetDir);
  const profile = options.profile as Profile | undefined;

  const spinner = ora({
    text: pc.dim(`Verifying ${path.basename(root)} with ProofGate...`),
    color: "cyan",
  });

  // Only start spinner if not in json or pipe output
  const format = options.format?.toLowerCase() || "terminal";
  const isTerminal = format === "terminal";
  if (isTerminal) {
    spinner.start();
  }

  try {
    const result = await verify({
      root,
      profile,
      changed: options.changed,
      full: options.full,
      base: options.base,
      task: options.task,
      noCache: options.cache === false,
      trigger: "manual",
      hooks: {
        onCheckStart: (check) => {
          if (isTerminal) {
            spinner.text = pc.dim(`Running check: ${check.title || check.id}`);
          }
        },
      },
    });

    if (isTerminal) {
      spinner.stop();
      console.log(renderRunSummaryBox(result.report));
    } else if (isReportFormat(format)) {
      const rendered = renderReport(result.report, format as ReportFormat);
      if (options.output) {
        await fsp.writeFile(path.resolve(options.output), rendered, "utf8");
        console.log(pc.green(`Report written to ${options.output}`));
      } else {
        console.log(rendered);
      }
    } else {
      console.log(JSON.stringify(result.report, null, 2));
    }

    if (options.open) {
      const html = renderReport(result.report, "html");
      const tmpHtmlPath = path.join(root, ".proofgate", "runs", result.report.id, "report.html");
      await fsp.writeFile(tmpHtmlPath, html, "utf8");
      await open(tmpHtmlPath);
    }

    process.exit(result.exitCode);
  } catch (error) {
    if (isTerminal) spinner.fail(pc.red("Verification failed to start"));
    console.error(pc.red(error instanceof Error ? error.message : String(error)));
    process.exit(2);
  }
}
