import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type RunReport, runId } from "@proofgate/shared";
import { openRunStore } from "@proofgate/storage";
import { describe, expect, it } from "vitest";

describe("storage / RunStore", () => {
  it("saves, retrieves, lists and prunes runs", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "pg-store-test-"));
    const store = await openRunStore(tmp);

    try {
      const rId = runId();
      const report: RunReport = {
        schemaVersion: 1,
        id: rId,
        status: "VERIFIED",
        mode: "full",
        profile: "balanced",
        project: { root: tmp, name: "store-test", ecosystem: ["node"] },
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 150,
        environment: {
          platform: "win32",
          arch: "x64",
          osRelease: "10.0",
          nodeVersion: "v22.0.0",
          cwd: tmp,
          hostname: "localhost",
          ci: false,
          git: { available: false },
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
          dir: `.proofgate/runs/${rId}`,
          manifestPath: `.proofgate/runs/${rId}/manifest.json`,
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

      await store.saveRun(report);

      const fetched = await store.getRun(rId);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(rId);
      expect(fetched?.status).toBe("VERIFIED");

      const list = await store.listRuns(10);
      expect(list.length).toBe(1);
      expect(list[0]?.id).toBe(rId);

      const latest = await store.latestRun();
      expect(latest?.id).toBe(rId);
    } finally {
      await store.close();
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  });
});
