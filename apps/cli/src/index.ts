import { PROOFGATE_VERSION } from "@proofgate/core";
import { Command } from "commander";
import { criteriaApproveCommand, criteriaListCommand } from "./commands/criteria.js";
import { initCommand } from "./commands/init.js";
import {
  integrationsHealthCommand,
  integrationsInstallCommand,
  integrationsListCommand,
  integrationsUninstallCommand,
} from "./commands/integrations.js";
import { listCommand } from "./commands/list.js";
import { mcpCommand } from "./commands/mcp.js";
import { planCommand } from "./commands/plan.js";
import { pruneCommand } from "./commands/prune.js";
import { showCommand } from "./commands/show.js";
import { statusCommand } from "./commands/status.js";
import { uiCommand } from "./commands/ui.js";
import { verifyCommand } from "./commands/verify.js";

const program = new Command();

program
  .name("proofgate")
  .description("ProofGate — Independent verification for AI coding agents")
  .version(PROOFGATE_VERSION, "-v, --version");

// verify / run command
program
  .command("verify [dir]", { isDefault: true })
  .alias("run")
  .description("Run verification against the project")
  .option("-p, --profile <profile>", "verification profile (fast, balanced, thorough)")
  .option("-c, --changed", "only run checks matching changed files")
  .option("--full", "run all checks regardless of changes")
  .option("-b, --base <ref>", "compare changes against git base ref")
  .option("-t, --task <task>", "task description context")
  .option("-f, --format <format>", "report format (terminal, json, markdown, html, github)")
  .option("--no-cache", "disable check result cache")
  .option("--open", "open HTML report or dashboard upon finish")
  .option("-o, --output <file>", "write report output to file")
  .action((dir, opts) => verifyCommand(dir, opts));

// criteria
const criteriaCmd = program
  .command("criteria")
  .description("Manage human-owned acceptance criteria and approval locks");

criteriaCmd
  .command("approve [dir]")
  .description("Approve acceptance criteria and record hash in acceptance.lock.json")
  .option("-p, --profile <profile>", "specific profile to approve")
  .option("-a, --all", "approve all profiles")
  .action((dir, opts) => criteriaApproveCommand(dir, opts));

criteriaCmd
  .command("list [dir]")
  .alias("show")
  .description("List configured acceptance criteria and approval state")
  .action((dir) => criteriaListCommand(dir));

// shortcut for criteria approve
program
  .command("accept [dir]")
  .description("Shortcut for `proofgate criteria approve`")
  .option("-p, --profile <profile>", "specific profile to approve")
  .option("-a, --all", "approve all profiles")
  .action((dir, opts) => criteriaApproveCommand(dir, opts));

// init
program
  .command("init [dir]")
  .description("Initialize ProofGate in a project (config, acceptance, directories)")
  .option("--force", "overwrite existing configuration")
  .action((dir, opts) => initCommand(dir, opts));

// status
program
  .command("status [dir]")
  .description("Display status and summary of the latest verification run")
  .action((dir) => statusCommand(dir));

// list
program
  .command("list [dir]")
  .description("List previous verification runs")
  .option("-l, --limit <n>", "maximum runs to show", "20")
  .action((dir, opts) => listCommand(dir, opts));

// show
program
  .command("show <runId>")
  .description("Show full details of a specific verification run")
  .option("-f, --format <format>", "output format (terminal, json, markdown, html)")
  .option("-r, --root <dir>", "project root directory")
  .action((runId, opts) => showCommand(runId, opts));

// plan
program
  .command("plan [dir]")
  .alias("explain")
  .description("Show which checks would execute without running them")
  .option("-p, --profile <profile>", "verification profile")
  .option("-c, --changed", "evaluate changed files mode")
  .option("--full", "evaluate full mode")
  .option("-b, --base <ref>", "diff against git base")
  .action((dir, opts) => planCommand(dir, opts));

// prune
program
  .command("prune [dir]")
  .description("Prune old verification runs according to retention limits")
  .option("--max-runs <n>", "maximum runs to keep")
  .option("--max-age-days <n>", "maximum age in days")
  .action((dir, opts) => pruneCommand(dir, opts));

// integrations
const integrationsCmd = program
  .command("integrations")
  .description("Manage agent integrations (Claude Code, Cursor, Codex, OpenCode, Gemini, etc.)");

integrationsCmd
  .command("list [dir]")
  .description("List supported agent integrations and install status")
  .action((dir) => integrationsListCommand(dir));

integrationsCmd
  .command("install <id> [dir]")
  .description("Install integration for an agent")
  .option("-s, --scope <scope>", "scope: project or user")
  .action((id, dir, opts) => integrationsInstallCommand(id, dir, opts));

integrationsCmd
  .command("uninstall <id> [dir]")
  .description("Uninstall integration for an agent")
  .option("-s, --scope <scope>", "scope: project or user")
  .action((id, dir, opts) => integrationsUninstallCommand(id, dir, opts));

integrationsCmd
  .command("health <id> [dir]")
  .description("Check health and configuration of an agent integration")
  .action((id, dir, opts) => integrationsHealthCommand(id, dir, opts));

// mcp
program
  .command("mcp [dir]")
  .description("Start the ProofGate stdio Model Context Protocol (MCP) server")
  .action((dir) => mcpCommand(dir));

// ui / dashboard
program
  .command("ui [dir]")
  .alias("dashboard")
  .description("Launch the local ProofGate interactive web dashboard")
  .option("-p, --port <port>", "port to listen on", "3942")
  .option("--no-open", "do not open browser automatically")
  .action((dir, opts) => uiCommand(dir, opts));

program.parse(process.argv);
