import path from "node:path";
import type { Invoker } from "@proofgate/integration-sdk";
import {
  detectIntegrations,
  type IntegrationScope,
  installIntegration,
  integrationHealth,
  uninstallIntegration,
} from "@proofgate/integrations";
import pc from "picocolors";

const defaultInvoker: Invoker = { kind: "global" };

export async function integrationsListCommand(targetDir = "."): Promise<void> {
  const root = path.resolve(targetDir);
  const detections = await detectIntegrations(root);

  console.log("");
  console.log(pc.bold("Supported Agent Integrations:"));
  console.log("");

  for (const { adapter, detection } of detections) {
    const status = detection.installed
      ? pc.green("INSTALLED".padEnd(14))
      : pc.dim("NOT INSTALLED".padEnd(14));
    const id = pc.white(adapter.id.padEnd(18));
    const name = pc.bold(adapter.displayName.padEnd(20));
    const auto = adapter.capabilities.automaticCompletionChecks
      ? pc.cyan("[auto-check]")
      : pc.dim("[mcp-only]");

    console.log(`  • ${id} ${status} ${name} ${auto}`);
    if (detection.detail) {
      console.log(`    ${pc.dim(detection.detail)}`);
    }
  }
  console.log("");
  console.log(pc.dim("Install an integration: proofgate integrations install <id>"));
  console.log("");
}

export async function integrationsInstallCommand(
  id: string,
  targetDir = ".",
  options: { scope?: string } = {},
): Promise<void> {
  const root = path.resolve(targetDir);
  try {
    const scope = (options.scope as IntegrationScope) || undefined;
    const { adapter, changes } = await installIntegration(id, {
      root,
      scope: scope || "project",
      invoker: defaultInvoker,
    });

    console.log("");
    console.log(pc.green(`✔ Installed integration "${adapter.displayName}"`));
    console.log(`  ${pc.dim("Files modified:")}`);
    for (const f of changes.files) {
      const sym =
        f.action === "created"
          ? pc.green("+")
          : f.action === "updated"
            ? pc.yellow("~")
            : pc.red("-");
      console.log(`    ${sym} ${pc.dim(f.path)}`);
    }
    for (const note of changes.notes) {
      console.log(`  ${pc.cyan("ℹ")} ${note}`);
    }
    console.log("");
  } catch (error) {
    console.error(pc.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

export async function integrationsUninstallCommand(
  id: string,
  targetDir = ".",
  options: { scope?: string } = {},
): Promise<void> {
  const root = path.resolve(targetDir);
  try {
    const scope = (options.scope as IntegrationScope) || undefined;
    const { adapter, changes } = await uninstallIntegration(id, {
      root,
      scope: scope || "project",
    });

    console.log("");
    console.log(pc.green(`✔ Uninstalled integration "${adapter.displayName}"`));
    for (const f of changes.files) {
      const sym =
        f.action === "removed"
          ? pc.red("-")
          : f.action === "updated"
            ? pc.yellow("~")
            : pc.dim("•");
      console.log(`    ${sym} ${pc.dim(f.path)}`);
    }
    console.log("");
  } catch (error) {
    console.error(pc.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

export async function integrationsHealthCommand(
  id: string,
  targetDir = ".",
  options: { scope?: string } = {},
): Promise<void> {
  const root = path.resolve(targetDir);
  try {
    const scope = (options.scope as IntegrationScope) || undefined;
    const { adapter, rows } = await integrationHealth(id, {
      root,
      scope: scope || "project",
      invoker: defaultInvoker,
      includeMcp: true,
      includeHooks: true,
    });

    console.log("");
    console.log(pc.bold(`Health report for ${adapter.displayName}:`));
    for (const r of rows) {
      const sym =
        r.level === "ok" ? pc.green("✔") : r.level === "warn" ? pc.yellow("⚠") : pc.red("✖");
      console.log(`  ${sym} ${pc.dim(r.message)}`);
    }
    console.log("");
  } catch (error) {
    console.error(pc.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
