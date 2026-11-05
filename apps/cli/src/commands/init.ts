import path from "node:path";
import { initProject } from "@proofgate/core";
import ora from "ora";
import pc from "picocolors";

export async function initCommand(
  targetDir = ".",
  options: { force?: boolean } = {},
): Promise<void> {
  const root = path.resolve(targetDir);
  const spinner = ora(pc.dim("Detecting project and initializing ProofGate...")).start();

  try {
    const result = await initProject(root, { force: options.force });
    spinner.succeed(pc.green("ProofGate initialized successfully."));

    console.log("");
    const ecosystems =
      result.project.ecosystems
        .map((e: { id?: string; name?: string } | string) =>
          typeof e === "string" ? e : e.id || e.name || "unknown",
        )
        .join(", ") || "generic";
    console.log(`  ${pc.dim("Project:")}     ${pc.white(path.basename(root))}`);
    console.log(`  ${pc.dim("Ecosystems:")} ${pc.cyan(ecosystems)}`);
    console.log(`  ${pc.dim("Config:")}      ${pc.white(result.configPath)}`);
    console.log(`  ${pc.dim("Acceptance:")}  ${pc.white(result.acceptancePath)}`);
    console.log(`  ${pc.dim("Lockfile:")}    ${pc.white(result.lockPath)}`);
    console.log("");
    console.log(pc.bold("Configured verification checks:"));
    for (const c of result.suggestedChecks) {
      const cmd = c.type === "command" ? c.run.join(" ") : "secret-scan";
      console.log(`  ✔ ${pc.cyan(c.id.padEnd(20))} ${pc.dim(cmd)}`);
    }
    console.log("");
    console.log(pc.green("Initial criteria are approved and ready."));
    console.log(pc.dim("Run `proofgate verify` to verify your project."));
    console.log("");
  } catch (error) {
    spinner.fail(pc.red("Initialization failed"));
    console.error(pc.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
