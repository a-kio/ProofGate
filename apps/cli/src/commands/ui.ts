import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { loadConfig, readAcceptanceDocument, readAcceptanceLock } from "@proofgate/config";
import {
  approveCriteria,
  getLatestRun,
  getRun,
  listRuns,
  type Profile,
  verify,
} from "@proofgate/core";
import { readEvidenceFile, readManifest } from "@proofgate/evidence";
import { listIntegrationsStatus } from "@proofgate/integrations";
import { Hono } from "hono";
import open from "open";
import pc from "picocolors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface UiCommandOptions {
  port?: string;
  open?: boolean;
}

function findUiDir(root: string): string | null {
  const candidates = [
    path.join(__dirname, "ui"),
    path.join(__dirname, "..", "ui"),
    path.join(__dirname, "..", "..", "dashboard", "dist"),
    path.join(__dirname, "..", "..", "..", "apps", "dashboard", "dist"),
    path.join(root, "apps", "dashboard", "dist"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "index.html"))) {
      return c;
    }
  }
  return null;
}

export async function uiCommand(targetDir = ".", options: UiCommandOptions = {}): Promise<void> {
  const root = path.resolve(targetDir);
  const port = options.port ? parseInt(options.port, 10) : 3942;
  const shouldOpen = options.open !== false;

  const app = new Hono();

  // API Routes
  app.get("/api/status", async (c) => {
    const latest = await getLatestRun(root);
    return c.json({ ok: true, run: latest });
  });

  app.get("/api/runs", async (c) => {
    const limitQuery = c.req.query("limit");
    const limit = limitQuery ? parseInt(limitQuery, 10) : 50;
    const runs = await listRuns(root, limit);
    return c.json({ ok: true, runs });
  });

  app.get("/api/runs/:id", async (c) => {
    const runId = c.req.param("id");
    const run = await getRun(root, runId);
    if (!run) return c.json({ ok: false, error: "Run not found" }, 404);
    return c.json({ ok: true, run });
  });

  app.get("/api/runs/:id/manifest", async (c) => {
    const runId = c.req.param("id");
    const { manifest, error } = await readManifest(root, runId);
    if (!manifest) return c.json({ ok: false, error }, 404);
    return c.json({ ok: true, manifest });
  });

  app.get("/api/runs/:id/evidence/*", async (c) => {
    const runId = c.req.param("id");
    const relPath = c.req.path.replace(`/api/runs/${runId}/evidence/`, "");
    try {
      const file = await readEvidenceFile(root, runId, relPath);
      return c.json({ ok: true, file });
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 404);
    }
  });

  app.post("/api/verify", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        profile?: string;
        changed?: boolean;
        full?: boolean;
        task?: string;
      };
      const result = await verify({
        root,
        profile: body.profile as Profile | undefined,
        changed: body.changed,
        full: body.full,
        task: body.task,
        trigger: "manual",
      });
      return c.json({ ok: true, run: result.report, exitCode: result.exitCode });
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.get("/api/config", async (c) => {
    try {
      const { config, path: cfgPath } = await loadConfig(root);
      return c.json({ ok: true, config, path: cfgPath });
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.get("/api/acceptance", async (c) => {
    try {
      const doc = await readAcceptanceDocument(root);
      const { lock } = await readAcceptanceLock(root);
      return c.json({
        ok: true,
        document: doc.kind === "valid" ? doc.data : null,
        lock,
        isApproved: lock && doc.kind === "valid" && lock.acceptanceFileHash === doc.hash,
        error: doc.kind === "invalid" ? doc.error : undefined,
      });
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.post("/api/criteria/approve", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { profile?: string };
      const res = await approveCriteria(root, {
        profile: body.profile as Profile | undefined,
        allProfiles: true,
      });
      return c.json({ ok: true, ...res });
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  app.get("/api/integrations", async (c) => {
    try {
      const rows = await listIntegrationsStatus(root);
      return c.json({ ok: true, integrations: rows });
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  // Static Assets Fallback for Dashboard
  const uiDir = findUiDir(root);
  app.get("*", async (c) => {
    if (!uiDir)
      return c.text("ProofGate Dashboard UI bundle not found. Run pnpm build first.", 404);
    let reqPath = c.req.path;
    if (reqPath === "/" || reqPath === "") reqPath = "/index.html";
    const fullPath = path.join(uiDir, reqPath);
    try {
      const content = await fsp.readFile(fullPath);
      const ext = path.extname(fullPath).toLowerCase();
      const mimeMap: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".json": "application/json",
        ".png": "image/png",
        ".ico": "image/x-icon",
      };
      return c.body(content, 200, {
        "Content-Type": mimeMap[ext] || "application/octet-stream",
      });
    } catch {
      // SPA Fallback: serve index.html for client-side routing
      try {
        const indexHtml = await fsp.readFile(path.join(uiDir, "index.html"), "utf8");
        return c.html(indexHtml);
      } catch {
        return c.text("ProofGate Dashboard: build artifacts not found.", 404);
      }
    }
  });

  serve({ fetch: app.fetch, port }, () => {
    const url = `http://localhost:${port}`;
    console.log("");
    console.log(pc.bold(pc.green("● ProofGate Dashboard is running")));
    console.log(`  ${pc.dim("Local:")}   ${pc.cyan(url)}`);
    console.log(`  ${pc.dim("Target:")}  ${pc.white(root)}`);
    console.log(pc.dim("  Press Ctrl+C to stop."));
    console.log("");

    if (shouldOpen) {
      open(url).catch(() => {
        // ignore open errors
      });
    }
  });
}
