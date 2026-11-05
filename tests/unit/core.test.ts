import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { approveCriteria, explainPlan, initProject, verify } from "@proofgate/core";
import { describe, expect, it } from "vitest";

describe("core / orchestration", () => {
  it("executes end-to-end init, plan, verify and approval workflow", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "pg-core-test-"));

    try {
      // create a sample code file
      await fsp.mkdir(path.join(tmp, "src"), { recursive: true });
      await fsp.writeFile(path.join(tmp, "src", "index.js"), 'console.log("pg-test");\n', "utf8");

      // init
      const initRes = await initProject(tmp);
      expect(initRes.configPath).toContain(".proofgate");
      expect(initRes.acceptancePath).toContain(".proofgate");

      // plan
      const plan = await explainPlan(tmp, { full: true });
      expect(plan.acceptanceApproved).toBe(true);
      expect(plan.checks.length).toBeGreaterThan(0);

      // verify
      const verifyRes = await verify({ root: tmp, full: true });
      expect(verifyRes.report.status).toBe("VERIFIED");
      expect(verifyRes.exitCode).toBe(0);
      expect(verifyRes.manifestHash).toHaveLength(64);

      // re-approve criteria
      const approveRes = await approveCriteria(tmp, { allProfiles: true });
      expect(approveRes.approvedProfiles.length).toBe(3);
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  });
});
