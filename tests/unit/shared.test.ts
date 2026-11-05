import {
  type CheckResult,
  type CriterionResult,
  deriveOverallStatus,
  isRunId,
  overallFromExit,
  redactSecrets,
  runId,
  sha256Hex,
  sha256Json,
  shortHash,
  statusGlyph,
  ulid,
} from "@proofgate/shared";
import { describe, expect, it } from "vitest";

describe("shared / status", () => {
  const dummyStdout = { text: "", bytes: 0, totalBytes: 0, truncated: false };
  const dummyStderr = { text: "", bytes: 0, totalBytes: 0, truncated: false };

  const makeCheck = (id: string, status: CheckResult["status"], required = true): CheckResult => ({
    id,
    title: id,
    type: "command",
    status,
    required,
    profiles: ["balanced"],
    durationMs: 10,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    cached: false,
    summary: "ok",
    stdout: dummyStdout,
    stderr: dummyStderr,
    findings: [],
  });

  const makeCrit = (
    id: string,
    status: CriterionResult["status"],
    required = true,
  ): CriterionResult => ({
    id,
    description: id,
    kind: "check",
    required,
    status,
    reason: "ok",
    evidence: [],
  });

  it("derives VERIFIED when all required checks and criteria pass", () => {
    const checks = [makeCheck("t1", "PASS"), makeCheck("t2", "PASS", false)];
    const criteria = [makeCrit("c1", "PASS")];
    const status = deriveOverallStatus({ checks, criteria, acceptanceApproved: true });
    expect(status).toBe("VERIFIED");
  });

  it("derives FAILED when any required check fails", () => {
    const checks = [makeCheck("t1", "FAIL"), makeCheck("t2", "PASS")];
    const criteria = [makeCrit("c1", "PASS")];
    const status = deriveOverallStatus({ checks, criteria, acceptanceApproved: true });
    expect(status).toBe("FAILED");
  });

  it("derives UNVERIFIABLE when acceptance is not approved", () => {
    const checks = [makeCheck("t1", "PASS")];
    const criteria = [makeCrit("c1", "PASS")];
    const status = deriveOverallStatus({ checks, criteria, acceptanceApproved: false });
    expect(status).toBe("UNVERIFIABLE");
  });

  it("maps overall status to expected CLI exit codes", () => {
    expect(overallFromExit("VERIFIED")).toBe(0);
    expect(overallFromExit("FAILED")).toBe(1);
    expect(overallFromExit("INCOMPLETE")).toBe(2);
    expect(overallFromExit("UNVERIFIABLE")).toBe(3);
  });

  it("provides correct status glyphs", () => {
    expect(statusGlyph("VERIFIED")).toBe("✔");
    expect(statusGlyph("FAILED")).toBe("✖");
    expect(statusGlyph("INCOMPLETE")).toBe("◐");
    expect(statusGlyph("UNVERIFIABLE")).toBe("⊘");
  });
});

describe("shared / ids & hashing", () => {
  it("generates valid 26-char ULID and runId matching regex", () => {
    const u = ulid();
    expect(u.length).toBe(26);
    const r = runId();
    expect(isRunId(r)).toBe(true);
  });

  it("computes sha256Hex and shortHash deterministically", () => {
    const hash = sha256Hex("test payload");
    expect(hash).toHaveLength(64);
    expect(shortHash("test payload", 8)).toHaveLength(8);
    expect(sha256Json({ a: 1, b: 2 })).toBe(sha256Json({ b: 2, a: 1 }));
  });
});

describe("shared / redact", () => {
  it("redacts tokens and keys before persistence", () => {
    const secret = "ghp_123456789012345678901234567890123456";
    const result = redactSecrets(`My token is ${secret}`);
    expect(result.redacted).toBe(true);
    expect(result.text).not.toContain(secret);
  });
});
