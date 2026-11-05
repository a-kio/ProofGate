import path from "node:path";
import { explainPlan, type Profile } from "@proofgate/core";
import pc from "picocolors";

export async function planCommand(
  targetDir = ".",
  options: { profile?: string; changed?: boolean; full?: boolean; base?: string } = {},
): Promise<void> {
  const root = path.resolve(targetDir);
  try {
    const plan = await explainPlan(root, {
      profile: options.profile as Profile | undefined,
      changed: options.changed,
      full: options.full,
      base: options.base,
    });

    console.log("");
    console.log(
      pc.bold(`Verification Plan (${pc.magenta(plan.profile)} profile, ${plan.mode} mode):`),
    );
    console.log(`  ${pc.dim("Intent Hash:")}  ${pc.cyan(plan.intentHash || "none")}`);
    console.log(
      `  ${pc.dim("Acceptance:")}   ${plan.acceptanceApproved ? pc.green("✔ APPROVED") : pc.yellow(`⚠ ${plan.acceptanceReason || "Not approved"}`)}`,
    );
    if (plan.guard.blocked) {
      console.log(`  ${pc.dim("Guard:")}        ${pc.red(`BLOCKED: ${plan.guard.reason}`)}`);
    }
    console.log("");

    console.log(pc.bold("Selected Checks:"));
    if (plan.checks.length === 0) {
      console.log(pc.dim("  (none)"));
    } else {
      for (const c of plan.checks) {
        const deps =
          c.dependencies.length > 0 ? pc.dim(` [after: ${c.dependencies.join(", ")}]`) : "";
        const cmd = c.config.type === "command" ? c.config.run.join(" ") : c.config.type;
        console.log(`  • ${pc.white(c.id.padEnd(24))} ${pc.dim(cmd)}${deps}`);
      }
    }

    if (plan.omitted.length > 0) {
      console.log("");
      console.log(pc.bold(pc.dim("Omitted Checks:")));
      for (const o of plan.omitted) {
        console.log(`  - ${pc.dim(o.id.padEnd(24))} ${pc.dim(`(${o.reason}: ${o.detail})`)}`);
      }
    }

    if (plan.notes.length > 0) {
      console.log("");
      for (const note of plan.notes) {
        console.log(`  ${pc.yellow("ℹ")} ${pc.dim(note)}`);
      }
    }
    console.log("");
  } catch (error) {
    console.error(pc.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
