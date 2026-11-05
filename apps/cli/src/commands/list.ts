import path from "node:path";
import { listRuns } from "@proofgate/core";
import pc from "picocolors";
import { formatDuration, formatStatusBadge } from "../ui/format.js";

export async function listCommand(
  targetDir = ".",
  options: { limit?: string } = {},
): Promise<void> {
  const root = path.resolve(targetDir);
  const limit = options.limit ? parseInt(options.limit, 10) : 20;
  const runs = await listRuns(root, limit);

  if (runs.length === 0) {
    console.log("");
    console.log(pc.yellow("No verification runs recorded."));
    console.log(pc.dim("Run `proofgate verify` to start your first verification run."));
    console.log("");
    return;
  }

  console.log("");
  console.log(pc.bold(`Recent Verification Runs (${runs.length}):`));
  console.log("");

  for (const r of runs) {
    const badge = formatStatusBadge(r.status);
    const id = pc.white(r.id);
    const prof = pc.magenta(r.profile.padEnd(8));
    const time = pc.dim(formatDuration(r.durationMs).padStart(7));
    const date = pc.dim(new Date(r.startedAt).toLocaleString());
    const stats = pc.dim(
      `${r.summary.passed}/${r.summary.total} pass${r.summary.failed > 0 ? ` (${r.summary.failed} fail)` : ""}`,
    );

    console.log(`  ${badge}  ${id}  ${prof}  ${time}  ${stats.padEnd(16)}  ${date}`);
  }
  console.log("");
}
