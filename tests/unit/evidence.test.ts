import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EvidenceWriter, verifyEvidence } from "@proofgate/evidence";
import { type CheckResult, runId } from "@proofgate/shared";
import { describe, expect, it } from "vitest";

describe("evidence / bundles and manifests", () => {
  it("writes redacted logs and verifiable manifest hash", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "pg-evi-test-"));
    const rId = runId();

    try {
      const writer = new EvidenceWriter(tmp, rId);

      const dummyCheck: CheckResult = {
        id: "test-check",
        title: "Sample Test Check",
        type: "command",
        status: "PASS",
        required: true,
        profiles: ["balanced"],
        durationMs: 25,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        cached: false,
        summary: "All assertions satisfied",
        stdout: {
          text: "Bearer sk-ant-secretkey1234567890123456 output passed",
          bytes: 40,
          totalBytes: 40,
          truncated: false,
        },
        stderr: { text: "", bytes: 0, totalBytes: 0, truncated: false },
        findings: [],
      };

      const written = await writer.writeCheck(dummyCheck);
      expect(written.result.stdout.text).not.toContain("secretkey1234567890123456");

      await writer.writeSummary({
        status: "VERIFIED",
        summary: {
          total: 1,
          passed: 1,
          failed: 0,
          unknown: 0,
          skipped: 0,
          blocked: 0,
          error: 0,
          requiredTotal: 1,
          requiredPassed: 1,
          requiredFailed: 0,
        },
        criteria: [],
        notes: [],
      });

      const summary = await writer.finalize();
      expect(summary.manifestHash).toHaveLength(64);
      expect(summary.entries.length).toBeGreaterThan(0);

      // Verification of raw evidence bundle
      const verification = await verifyEvidence(tmp, rId);
      expect(verification.ok).toBe(true);
      expect(verification.problems).toHaveLength(0);
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  });
});
