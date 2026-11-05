import { extensionFor, REPORT_FORMATS, renderReport } from "@proofgate/reporting";
import type { RunReport } from "@proofgate/shared";
import { describe, expect, it } from "vitest";

describe("reporting / formats", () => {
  const dummyReport: RunReport = {
    schemaVersion: 1,
    id: "run_01m6ngjt6cfazsqg8pbfams5fh",
    status: "VERIFIED",
    mode: "full",
    profile: "balanced",
    task: "Reporting format unit test",
    project: { root: ".", name: "report-test", ecosystem: ["node"] },
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 120,
    environment: {
      platform: "win32",
      arch: "x64",
      osRelease: "10.0",
      nodeVersion: "v22.0.0",
      cwd: ".",
      hostname: "localhost",
      ci: false,
      git: { available: true, branch: "main" },
      toolVersions: {},
      capturedAt: new Date().toISOString(),
    },
    intent: { hash: "h1", approved: true, stale: false, lockPath: "lock.json" },
    changedFiles: { source: "full", files: [], fingerprint: "", truncated: false },
    criteria: [],
    checks: [],
    skippedChecks: [],
    cache: { enabled: false, hits: 0, misses: 0 },
    evidence: {
      dir: ".proofgate/runs/r1",
      manifestPath: ".proofgate/runs/r1/manifest.json",
      manifestHash: "m1",
      entries: [],
      totalBytes: 0,
      redacted: false,
    },
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      unknown: 0,
      skipped: 0,
      blocked: 0,
      error: 0,
      requiredTotal: 0,
      requiredPassed: 0,
      requiredFailed: 0,
    },
    notes: [],
    tool: { name: "ProofGate", version: "1.0.0", schemaVersion: 1 },
  };

  it("renders all supported report formats", () => {
    for (const fmt of REPORT_FORMATS) {
      const output = renderReport(dummyReport, fmt);
      expect(output).toBeDefined();
      expect(output.length).toBeGreaterThan(0);
    }
  });

  it("resolves correct file extensions for formats", () => {
    expect(extensionFor("markdown")).toBe("md");
    expect(extensionFor("html")).toBe("html");
    expect(extensionFor("json")).toBe("json");
  });
});
