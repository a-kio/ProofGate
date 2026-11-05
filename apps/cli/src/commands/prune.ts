import path from "node:path";
import { pruneRuns } from "@proofgate/core";
import pc from "picocolors";

export async function pruneCommand(
  targetDir = ".",
  options: { maxRuns?: string; maxAgeDays?: string } = {},
): Promise<void> {
  const root = path.resolve(targetDir);
  const maxRuns = options.maxRuns ? parseInt(options.maxRuns, 10) : 50;
  const maxAgeDays = options.maxAgeDays ? parseInt(options.maxAgeDays, 10) : 30;

  try {
    const result = await pruneRuns(root, { maxRuns, maxAgeDays });
    console.log("");
    if (result.removed.length === 0) {
      console.log(pc.green("✔ Run store is within retention limits. Nothing pruned."));
    } else {
      console.log(pc.green(`✔ Pruned ${result.removed.length} old verification runs.`));
      for (const id of result.removed) {
        console.log(`  - ${pc.dim(id)}`);
      }
    }
    console.log("");
  } catch (error) {
    console.error(pc.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
