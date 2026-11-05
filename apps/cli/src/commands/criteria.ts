import path from "node:path";
import { readAcceptanceDocument, readAcceptanceLock } from "@proofgate/config";
import { approveCriteria, type Profile } from "@proofgate/core";
import pc from "picocolors";

export async function criteriaApproveCommand(
  targetDir = ".",
  options: { profile?: string; all?: boolean } = {},
): Promise<void> {
  const root = path.resolve(targetDir);
  try {
    const result = await approveCriteria(root, {
      profile: options.profile as Profile | undefined,
      allProfiles: options.all ?? true,
      approvedBy: process.env.USER || process.env.USERNAME || "operator",
    });

    console.log("");
    console.log(pc.green("✔ Acceptance criteria approved successfully."));
    console.log(`  ${pc.dim("Lockfile:")} ${pc.cyan(result.lockPath)}`);
    console.log(`  ${pc.dim("Profiles:")} ${pc.magenta(result.approvedProfiles.join(", "))}`);
    console.log("");
  } catch (error) {
    console.error(pc.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

export async function criteriaListCommand(targetDir = "."): Promise<void> {
  const root = path.resolve(targetDir);
  try {
    const doc = await readAcceptanceDocument(root);
    if (doc.kind === "missing") {
      console.log(pc.yellow("No acceptance criteria file found (.proofgate/acceptance.yaml)."));
      console.log(pc.dim("Run `proofgate init` to create one."));
      return;
    }
    if (doc.kind === "invalid") {
      console.error(pc.red(`Acceptance criteria file is invalid:\n${doc.error}`));
      process.exit(1);
    }

    const { lock } = await readAcceptanceLock(root);
    const isApproved = lock && lock.acceptanceFileHash === doc.hash;

    console.log("");
    console.log(pc.bold("Acceptance Criteria:"));
    console.log(`  ${pc.dim("Task:")}   ${pc.white(doc.data.task || "(no task specified)")}`);
    console.log(
      `  ${pc.dim("Status:")} ${isApproved ? pc.green("✔ APPROVED") : pc.yellow("⚠ UNAPPROVED (run `proofgate criteria approve`)")}`,
    );
    console.log(`  ${pc.dim("Hash:")}   ${pc.dim(doc.hash)}`);
    console.log("");

    for (const c of doc.data.criteria) {
      const kind = pc.cyan(`[${c.kind}]`);
      const req = c.required ? pc.bold("required") : pc.dim("optional");
      console.log(`  • ${pc.bold(c.id)} ${kind} (${req})`);
      console.log(`    ${pc.dim(c.description)}`);
      if (c.check) console.log(`    ${pc.dim("check:")} ${pc.white(c.check)}`);
      if (c.artifacts)
        console.log(`    ${pc.dim("artifacts:")} ${pc.white(c.artifacts.join(", "))}`);
    }
    console.log("");
  } catch (error) {
    console.error(pc.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
