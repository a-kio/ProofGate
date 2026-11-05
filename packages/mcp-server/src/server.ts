import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, readAcceptanceDocument, readAcceptanceLock } from "@proofgate/config";
import {
  getLatestRun,
  getRun,
  PROOFGATE_VERSION,
  type Profile,
  summarizeRun,
  verify,
} from "@proofgate/core";
import { listIntegrationsStatus } from "@proofgate/integrations";
import { detectProject, suggestChecks } from "@proofgate/project-detection";
import { z } from "zod";

export interface McpServerOptions {
  /** The single authorized project root; requests target this root only */
  root: string;
  /** Hard cap for verification wall time started via MCP (ms) */
  verifyTimeoutMs?: number;
}

function text(content: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: typeof content === "string" ? content : JSON.stringify(content, null, 2),
      },
    ],
  };
}

function errText(message: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return { ...text(message), isError: true };
}

/**
 * Local ProofGate MCP server (stdio transport).
 * It exposes verification against ONE authorized project root — the directory
 * the server was started in. It never grants arbitrary filesystem or shell access.
 */
export function createProofGateMcpServer(options: McpServerOptions): {
  server: McpServer;
  start: () => Promise<void>;
} {
  const root = options.root;
  const server = new McpServer(
    { name: "proofgate", version: PROOFGATE_VERSION },
    {
      instructions: "ProofGate verifies completed AI coding work with real, reproducible evidence.",
    },
  );

  server.registerTool(
    "proofgate_verify",
    {
      title: "Run ProofGate verification",
      description:
        "Run the configured verification suite for the authorized project. Use the default profile unless the user asked otherwise. Results are evidence-backed, not model-generated.",
      inputSchema: {
        profile: z
          .enum(["fast", "balanced", "thorough"])
          .optional()
          .describe("verification profile"),
        changed: z.boolean().optional().describe("restrict to checks relevant to changed files"),
        full: z.boolean().optional().describe("run all checks across the entire repository"),
        task: z.string().max(300).optional().describe("task context for the report"),
      },
    },
    async (input) => {
      try {
        const result = await verify({
          root,
          profile: input.profile as Profile | undefined,
          changed: input.changed,
          full: input.full,
          task: input.task,
          trigger: "mcp",
          provider: "mcp",
        });
        return text(summarizeRun(result.report));
      } catch (e) {
        return errText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "proofgate_get_status",
    {
      title: "Latest verification status",
      description: "Return the latest verification run status and check breakdown.",
      inputSchema: {},
    },
    async () => {
      const run = await getLatestRun(root);
      if (!run) return text("No verification run recorded yet. Run `proofgate verify` first.");
      return text(summarizeRun(run));
    },
  );

  server.registerTool(
    "proofgate_get_report",
    {
      title: "Full verification report",
      description:
        "Return the complete JSON report for the latest (or specified) verification run.",
      inputSchema: {
        runId: z.string().optional().describe("Optional run ID; defaults to latest run"),
      },
    },
    async (input) => {
      const run = input.runId ? await getRun(root, input.runId) : await getLatestRun(root);
      if (!run)
        return errText(
          input.runId ? `Run "${input.runId}" not found` : "No verification run recorded yet",
        );
      return text(JSON.stringify(run, null, 2));
    },
  );

  server.registerTool(
    "proofgate_list_checks",
    {
      title: "List checks",
      description: "List verification checks configured in .proofgate/config.yaml.",
      inputSchema: {},
    },
    async () => {
      try {
        const { config } = await loadConfig(root);
        if (config.checks.length === 0) return text("(no checks configured)");
        return text(
          config.checks
            .map((c) => {
              const cmd = c.type === "command" ? JSON.stringify(c.run) : c.type;
              return `${c.id.padEnd(20)} [${c.profiles.join(",")}] required=${c.required} type=${c.type} spec=${cmd}`;
            })
            .join("\n"),
        );
      } catch (e) {
        return errText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "proofgate_get_failures",
    {
      title: "List failures",
      description:
        "Return actionable failed checks with findings and evidence paths from the latest run.",
      inputSchema: {},
    },
    async () => {
      const run = await getLatestRun(root);
      if (!run) return errText("No verification run recorded yet");
      const failures = run.checks.filter(
        (c) => c.status === "FAIL" || c.status === "ERROR" || c.status === "BLOCKED",
      );
      if (failures.length === 0) return text("No failed checks in the latest run.");
      return text(
        failures
          .map((c) => {
            const header = `${c.id}: ${c.status} (exit ${c.exitCode ?? "?"})`;
            const findings = c.findings.map(
              (f) => `  - ${f.message}${f.file ? ` (${f.file}:${f.line ?? 1})` : ""}`,
            );
            const tail = c.stderr.text
              ? `\n  stderr tail:\n  ${c.stderr.text.slice(-500).replace(/\n/g, "\n  ")}`
              : "";
            return [header, ...findings, tail].join("\n");
          })
          .join("\n\n"),
      );
    },
  );

  server.registerTool(
    "proofgate_get_acceptance_criteria",
    {
      title: "Acceptance criteria",
      description: "Read configured acceptance criteria and human approval state.",
      inputSchema: {},
    },
    async () => {
      try {
        const loaded = await readAcceptanceDocument(root);
        if (loaded.kind === "missing")
          return text("No acceptance criteria defined (.proofgate/acceptance.yaml)");
        if (loaded.kind === "invalid")
          return errText(`Acceptance criteria invalid:\n${loaded.error}`);
        const { lock } = await readAcceptanceLock(root);
        const isApproved = lock && lock.acceptanceFileHash === loaded.hash;
        return text(
          [
            `Task: ${loaded.data.task ?? "(unspecified)"}`,
            "Criteria:",
            ...loaded.data.criteria.map(
              (c) =>
                `  - [${c.id}] ${c.description} (${c.kind}${c.required ? ", required" : ", optional"})`,
            ),
            "",
            `Approved by human: ${isApproved ? "YES" : "NO — run `proofgate criteria approve`"}`,
            `Document hash: ${loaded.hash}`,
          ].join("\n"),
        );
      } catch (e) {
        return errText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "proofgate_detect_project",
    {
      title: "Detect project",
      description:
        "Return detected project type, package manager, and suggested verification checks.",
      inputSchema: {},
    },
    async () => {
      try {
        const det = await detectProject(root);
        const suggestions = await suggestChecks(det);
        return text(
          JSON.stringify(
            {
              ecosystems: det.ecosystems.map((e) => e.id),
              tools: det.tools.map((t) => t.id),
              packageManager: det.packageManager,
              suggestedChecks: suggestions.map((s) => ({
                id: s.id,
                type: s.type,
                run: s.type === "command" ? s.run : undefined,
                profiles: s.profiles,
              })),
            },
            null,
            2,
          ),
        );
      } catch (e) {
        return errText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "proofgate_get_integration_status",
    {
      title: "Integration status",
      description: "Return which agent integrations are configured in this project.",
      inputSchema: {},
    },
    async () => {
      try {
        const rows = await listIntegrationsStatus(root);
        return text(
          rows
            .map(
              (r) =>
                `${r.id.padEnd(16)} ${r.installed ? "installed" : "not installed"}  (auto-checks: ${
                  r.capabilities.automaticCompletionChecks ? "yes" : "no"
                })`,
            )
            .join("\n"),
        );
      } catch (e) {
        return errText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  const start = async (): Promise<void> => {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  };

  return { server, start };
}

/** Entry used by `proofgate mcp`; keeps stdout clean for the protocol. */
export async function startMcpServer(root: string): Promise<void> {
  const { start } = createProofGateMcpServer({ root, verifyTimeoutMs: 10 * 60_000 });
  await start();
}
