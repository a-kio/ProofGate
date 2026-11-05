import { resolveCommand, runCommand } from "@proofgate/executor";
import { describe, expect, it } from "vitest";

describe("executor / process runner", () => {
  it("executes shell-free argv array safely", async () => {
    const res = await runCommand({
      argv: ["node", "-e", 'console.log("pg-executor-ok");'],
      cwd: process.cwd(),
      timeoutMs: 5000,
    });

    expect(res.exitCode).toBe(0);
    expect(res.stdout.text.trim()).toBe("pg-executor-ok");
    expect(res.timedOut).toBe(false);
  });

  it("captures non-zero exit codes accurately", async () => {
    const res = await runCommand({
      argv: ["node", "-e", "process.exit(42);"],
      cwd: process.cwd(),
      timeoutMs: 5000,
    });

    expect(res.exitCode).toBe(42);
  });

  it("handles timeouts honestly without hanging", async () => {
    const res = await runCommand({
      argv: ["node", "-e", "setTimeout(() => {}, 10000);"],
      cwd: process.cwd(),
      timeoutMs: 300,
    });

    expect(res.timedOut).toBe(true);
  });

  it("resolves binary on PATH", () => {
    const resolved = resolveCommand("node");
    expect(resolved).not.toBeNull();
  });
});
