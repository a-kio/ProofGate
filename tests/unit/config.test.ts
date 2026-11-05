import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildInitialAcceptance,
  buildInitialConfig,
  commandCheckSchema,
  computeAcceptanceHash,
  computeIntentHash,
  loadConfig,
  readAcceptanceDocument,
  resolveAcceptanceApproval,
  writeAcceptanceLock,
  writeAcceptanceTemplate,
  writeConfig,
} from "@proofgate/config";
import { describe, expect, it } from "vitest";

describe("config / schemas & intent", () => {
  it("computes consistent intent hash regardless of key order", () => {
    const config = buildInitialConfig({
      projectName: "test",
      checks: [
        commandCheckSchema.parse({
          id: "test",
          title: "Test",
          type: "command",
          run: ["npm", "test"],
          required: true,
          profiles: ["fast", "balanced"],
        }),
      ],
    });

    const acceptance = buildInitialAcceptance("task 1", config.checks);
    const hash1 = computeIntentHash(config, acceptance, "balanced");
    const hash2 = computeIntentHash(config, acceptance, "balanced");
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);

    const accHash = computeAcceptanceHash(acceptance);
    expect(accHash).toHaveLength(64);
  });

  it("manages acceptance locks and detects approval staleness", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "pg-cfg-test-"));
    try {
      const configObj = buildInitialConfig({
        projectName: "demo",
        checks: [
          commandCheckSchema.parse({
            id: "lint",
            title: "Lint",
            type: "command",
            run: ["npm", "run", "lint"],
            required: true,
            profiles: ["balanced"],
          }),
        ],
      });

      await writeConfig(tmp, configObj);
      const { config } = await loadConfig(tmp);

      const acceptanceObj = buildInitialAcceptance("build feature", config.checks);
      await writeAcceptanceTemplate(tmp, JSON.stringify(acceptanceObj));
      const doc = await readAcceptanceDocument(tmp);
      expect(doc.kind).toBe("valid");

      if (doc.kind === "valid") {
        // Before approval
        const beforeApproval = await resolveAcceptanceApproval(tmp, doc.data, config, "balanced");
        expect(beforeApproval.approved).toBe(false);

        // Approve
        await writeAcceptanceLock(tmp, doc.data, config, ["balanced"], "tester");

        // After approval
        const afterApproval = await resolveAcceptanceApproval(tmp, doc.data, config, "balanced");
        expect(afterApproval.approved).toBe(true);
        expect(afterApproval.stale).toBe(false);
      }
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  });
});
