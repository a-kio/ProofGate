import path from "node:path";
import { getLatestRun } from "@proofgate/core";
import pc from "picocolors";
import { renderRunSummaryBox } from "../ui/format.js";

export async function statusCommand(targetDir = "."): Promise<void> {
  const root = path.resolve(targetDir);
  const run = await getLatestRun(root);

  if (!run) {
    console.log("");
    console.log(pc.yellow("No verification run recorded yet."));
    console.log(pc.dim("Run `proofgate verify` to perform a verification run."));
    console.log("");
    return;
  }

  console.log(renderRunSummaryBox(run));
}
