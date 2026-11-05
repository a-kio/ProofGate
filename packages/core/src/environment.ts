import os from "node:os";
import { runCommand } from "@proofgate/executor";
import { getGitInfo } from "@proofgate/project-detection";
import { type EnvironmentInfo, nowIso } from "@proofgate/shared";

export async function captureEnvironment(root: string): Promise<EnvironmentInfo> {
  const [git, gitVer, pnpmVer] = await Promise.all([
    getGitInfo(root),
    runCommand({ argv: ["git", "--version"], cwd: root, timeoutMs: 3000 }).catch(() => null),
    runCommand({ argv: ["pnpm", "--version"], cwd: root, timeoutMs: 3000 }).catch(() => null),
  ]);

  const toolVersions: Record<string, string> = {
    node: process.version,
  };
  if (gitVer && gitVer.exitCode === 0) {
    toolVersions.git = gitVer.stdout.text.trim();
  }
  if (pnpmVer && pnpmVer.exitCode === 0) {
    toolVersions.pnpm = pnpmVer.stdout.text.trim();
  }

  return {
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    nodeVersion: process.version,
    cwd: root,
    hostname: os.hostname(),
    ci: Boolean(process.env.CI && process.env.CI !== "false" && process.env.CI !== "0"),
    git,
    toolVersions,
    capturedAt: nowIso(),
  };
}
