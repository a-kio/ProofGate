import path from "node:path";
import {
  type AcceptanceFile,
  buildInitialAcceptance,
  buildInitialConfig,
  type CheckConfig,
  commandCheckSchema,
  ensureProofGateDirs,
  loadConfig,
  type ProofGateConfig,
  readAcceptanceDocument,
  renderAcceptanceYaml,
  resolveAcceptanceApproval,
  secretScanCheckSchema,
  writeAcceptanceLock,
  writeAcceptanceTemplate,
  writeConfig,
} from "@proofgate/config";
import { EvidenceWriter } from "@proofgate/evidence";
import {
  type DetectedProject,
  detectProject,
  getGitInfo,
  readChangesAgainstBase,
  readWorkingTreeChanges,
  type SuggestedCheck,
  suggestChecks,
} from "@proofgate/project-detection";
import {
  type ChangedFilesSummary,
  type CheckResult,
  deriveOverallStatus,
  nowIso,
  overallFromExit,
  PROOFGATE_DIR,
  type Profile,
  ProofGateError,
  type RunListItem,
  type RunProjectInfo,
  type RunReport,
  type RunSummaryCounts,
  runId,
  statusGlyph,
  TOOL_NAME,
  TOOL_VERSION,
  type VerificationMode,
} from "@proofgate/shared";
import { openRunStore } from "@proofgate/storage";
import {
  createPlan,
  type EngineHooks,
  executePlan,
  type ManualSignoff,
  type VerificationPlan,
} from "@proofgate/verification";
import { captureEnvironment } from "./environment.js";

export interface VerifyOptions {
  root: string;
  profile?: Profile;
  mode?: VerificationMode;
  changed?: boolean;
  full?: boolean;
  base?: string;
  task?: string;
  noCache?: boolean;
  signal?: AbortSignal;
  signoffs?: ManualSignoff[];
  trigger?: "manual" | "agent" | "hook" | "ci" | "mcp";
  provider?: string;
  sessionId?: string;
  hooks?: EngineHooks;
}

export interface VerifyResult {
  report: RunReport;
  exitCode: number;
  summary: RunSummaryCounts;
  evidenceDir: string;
  manifestHash: string;
}

export type VerificationOutcome =
  | { kind: "success"; run: RunReport; exitCode: number }
  | { kind: "error"; error: string }
  | { kind: "deduplicated"; holder: { pid: number } };

export interface ApproveCriteriaOptions {
  profile?: Profile;
  allProfiles?: boolean;
  approvedBy?: string;
}

export interface ApproveCriteriaResult {
  lockPath: string;
  approvedProfiles: Profile[];
}

export interface ExplainPlanOptions {
  profile?: Profile;
  mode?: VerificationMode;
  changed?: boolean;
  full?: boolean;
  base?: string;
  task?: string;
}

export interface InitProjectOptions {
  force?: boolean;
  projectName?: string;
}

export interface InitProjectResult {
  configPath: string;
  acceptancePath: string;
  lockPath: string;
  project: DetectedProject;
  suggestedChecks: SuggestedCheck[];
}

export async function explainPlan(
  root: string,
  options: ExplainPlanOptions = {},
): Promise<VerificationPlan> {
  const { config } = await loadConfig(root);
  const profile: Profile = options.profile ?? config.verification.profile ?? "balanced";
  const mode: VerificationMode = options.full
    ? "full"
    : (options.mode ?? (options.changed ? "changed" : "changed"));

  const git = await getGitInfo(root);
  let changed: ChangedFilesSummary;
  if (mode === "full") {
    changed = { source: "full", files: [], fingerprint: "", truncated: false };
  } else if (options.base) {
    const gitChanges = await readChangesAgainstBase(root, options.base);
    changed = {
      source: "git-base",
      base: options.base,
      files: gitChanges.files,
      fingerprint: gitChanges.fingerprint,
      truncated: gitChanges.truncated,
    };
  } else if (git.available) {
    const gitChanges = await readWorkingTreeChanges(root);
    changed = {
      source: "git-working-tree",
      files: gitChanges.files,
      fingerprint: gitChanges.fingerprint,
      truncated: gitChanges.truncated,
    };
  } else {
    changed = { source: "unavailable", files: [], fingerprint: "", truncated: false };
  }

  const acceptanceDoc = await readAcceptanceDocument(root);
  const acceptanceFile = acceptanceDoc.kind === "valid" ? acceptanceDoc.data : null;
  const intentSummary = await resolveAcceptanceApproval(root, acceptanceFile, config, profile);

  return createPlan({
    root,
    config,
    mode,
    profile,
    changed,
    intentHash: intentSummary.hash,
    acceptanceApproved: intentSummary.approved,
    ...(intentSummary.reason ? { acceptanceReason: intentSummary.reason } : {}),
    ...(options.task
      ? { task: options.task }
      : acceptanceFile?.task
        ? { task: acceptanceFile.task }
        : {}),
  });
}

export async function verify(options: VerifyOptions): Promise<VerifyResult> {
  const root = path.resolve(options.root);
  const startedAt = nowIso();
  const startTime = Date.now();

  const loadedConfig = await loadConfig(root);
  const { config, hash: configHash } = loadedConfig;

  const profile: Profile = options.profile ?? config.verification.profile ?? "balanced";
  const mode: VerificationMode = options.full
    ? "full"
    : (options.mode ?? (options.changed ? "changed" : "changed"));

  const git = await getGitInfo(root);
  let changed: ChangedFilesSummary;
  if (mode === "full") {
    changed = { source: "full", files: [], fingerprint: "", truncated: false };
  } else if (options.base) {
    const gitChanges = await readChangesAgainstBase(root, options.base);
    changed = {
      source: "git-base",
      base: options.base,
      files: gitChanges.files,
      fingerprint: gitChanges.fingerprint,
      truncated: gitChanges.truncated,
    };
  } else if (git.available) {
    const gitChanges = await readWorkingTreeChanges(root);
    changed = {
      source: "git-working-tree",
      files: gitChanges.files,
      fingerprint: gitChanges.fingerprint,
      truncated: gitChanges.truncated,
    };
  } else {
    changed = { source: "unavailable", files: [], fingerprint: "", truncated: false };
  }

  const detectedProject = await detectProject(root);
  const project: RunProjectInfo = {
    root,
    name: config.project.name ?? path.basename(root),
    ecosystem: detectedProject.ecosystems.map((e) => e.id),
    ...(detectedProject.packageManager ? { packageManager: detectedProject.packageManager } : {}),
  };

  const acceptanceDoc = await readAcceptanceDocument(root);
  const acceptanceFile = acceptanceDoc.kind === "valid" ? acceptanceDoc.data : null;
  const intentSummary = await resolveAcceptanceApproval(root, acceptanceFile, config, profile);

  const plan = createPlan({
    root,
    config,
    mode,
    profile,
    changed,
    intentHash: intentSummary.hash,
    acceptanceApproved: intentSummary.approved,
    ...(intentSummary.reason ? { acceptanceReason: intentSummary.reason } : {}),
    ...(options.task
      ? { task: options.task }
      : acceptanceFile?.task
        ? { task: acceptanceFile.task }
        : {}),
  });

  await ensureProofGateDirs(root);
  const cacheDir = path.join(root, PROOFGATE_DIR, "cache");

  const execution = await executePlan({
    plan,
    criteria: acceptanceFile?.criteria ?? [],
    config,
    configHash,
    cacheDir,
    noCache: options.noCache,
    signal: options.signal,
    signoffs: options.signoffs,
    hooks: options.hooks,
  });

  const currentRunId = runId();
  const writer = new EvidenceWriter(root, currentRunId);

  const checksWithArtifacts: CheckResult[] = [];
  for (const check of execution.checks) {
    const written = await writer.writeCheck(check);
    checksWithArtifacts.push(written.result);
  }

  const overallStatus = deriveOverallStatus({
    checks: checksWithArtifacts,
    criteria: execution.criteria,
    acceptanceApproved: intentSummary.approved,
    blockedByPolicy: plan.guard.blocked,
    optionalFailures: config.policy.optionalFailures,
  });

  await writer.writeSummary({
    status: overallStatus,
    summary: execution.summary,
    criteria: execution.criteria,
    notes: execution.notes,
  });

  const evidenceSummary = await writer.finalize({ name: TOOL_NAME, version: TOOL_VERSION });

  const finishedAt = nowIso();
  const durationMs = Math.max(0, Date.now() - startTime);
  const environment = await captureEnvironment(root);

  const report: RunReport = {
    schemaVersion: 1,
    id: currentRunId,
    status: overallStatus,
    mode,
    profile,
    ...(plan.task ? { task: plan.task } : {}),
    project,
    startedAt,
    finishedAt,
    durationMs,
    environment,
    intent: intentSummary,
    changedFiles: changed,
    criteria: execution.criteria,
    checks: checksWithArtifacts,
    skippedChecks: execution.skippedChecks,
    cache: execution.cache,
    evidence: evidenceSummary,
    summary: execution.summary,
    notes: execution.notes,
    tool: { name: TOOL_NAME, version: TOOL_VERSION, schemaVersion: 1 },
  };

  const store = await openRunStore(root);
  try {
    await store.saveRun(report);
  } finally {
    await store.close();
  }

  const exitCode = overallFromExit(overallStatus);

  return {
    report,
    exitCode,
    summary: execution.summary,
    evidenceDir: evidenceSummary.dir,
    manifestHash: evidenceSummary.manifestHash,
  };
}

export async function runVerification(options: {
  root: string;
  config?: ProofGateConfig;
  profile?: Profile;
  changed?: boolean;
  full?: boolean;
  task?: string;
  trigger?: "manual" | "agent" | "hook" | "ci" | "mcp";
  provider?: string;
}): Promise<VerificationOutcome> {
  try {
    const result = await verify({
      root: options.root,
      profile: options.profile,
      changed: options.changed,
      full: options.full,
      task: options.task,
      trigger: options.trigger,
      provider: options.provider,
    });
    return { kind: "success", run: result.report, exitCode: result.exitCode };
  } catch (error) {
    return { kind: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

export async function approveCriteria(
  root: string,
  options: ApproveCriteriaOptions = {},
): Promise<ApproveCriteriaResult> {
  const { config } = await loadConfig(root);
  const doc = await readAcceptanceDocument(root);
  if (doc.kind === "missing") {
    throw new ProofGateError(
      "ACCEPTANCE_MISSING",
      `No acceptance criteria document found at ${doc.path}\nRun \`proofgate init\` to create one.`,
    );
  }
  if (doc.kind === "invalid") {
    throw new ProofGateError("CONFIG_INVALID", `Acceptance criteria are invalid:\n${doc.error}`);
  }

  const approvedProfiles: Profile[] = options.allProfiles
    ? ["fast", "balanced", "thorough"]
    : [options.profile ?? config.verification.profile ?? "balanced"];

  const { path: lockPath } = await writeAcceptanceLock(
    root,
    doc.data,
    config,
    approvedProfiles,
    options.approvedBy ?? "user",
  );

  return { lockPath, approvedProfiles };
}

export async function initProject(
  root: string,
  options: InitProjectOptions = {},
): Promise<InitProjectResult> {
  await ensureProofGateDirs(root);
  const project = await detectProject(root);
  const suggestedChecks = await suggestChecks(project);

  const checkConfigs: CheckConfig[] = suggestedChecks.map((s) => {
    if (s.type === "secret-scan") {
      return secretScanCheckSchema.parse({
        id: s.id,
        title: s.title,
        type: "secret-scan",
        paths: s.paths,
        required: s.required,
        profiles: s.profiles,
      });
    }
    return commandCheckSchema.parse({
      id: s.id,
      title: s.title,
      type: "command",
      run: s.run,
      required: s.required,
      profiles: s.profiles,
      ...(s.appliesTo ? { appliesTo: s.appliesTo } : {}),
    });
  });

  const configObj = buildInitialConfig({
    projectName: options.projectName ?? path.basename(root),
    checks: checkConfigs,
  });

  const configPath = await writeConfig(root, configObj);

  const acceptanceObj: AcceptanceFile = buildInitialAcceptance(
    `Initial task verification for ${path.basename(root)}`,
    checkConfigs,
  );

  const acceptancePath = await writeAcceptanceTemplate(root, renderAcceptanceYaml(acceptanceObj));

  const { config: reloadedConfig } = await loadConfig(root);
  const reloadedDoc = await readAcceptanceDocument(root);
  const finalAcceptance = reloadedDoc.kind === "valid" ? reloadedDoc.data : acceptanceObj;

  const { path: lockPath } = await writeAcceptanceLock(
    root,
    finalAcceptance,
    reloadedConfig,
    ["fast", "balanced", "thorough"],
    "init",
  );

  return {
    configPath,
    acceptancePath,
    lockPath,
    project,
    suggestedChecks,
  };
}

export async function getLatestRun(root: string): Promise<RunReport | null> {
  const store = await openRunStore(root);
  try {
    return await store.latestRun();
  } finally {
    await store.close();
  }
}

export async function getRun(root: string, runId: string): Promise<RunReport | null> {
  const store = await openRunStore(root);
  try {
    return await store.getRun(runId);
  } finally {
    await store.close();
  }
}

export async function listRuns(root: string, limit = 50): Promise<RunListItem[]> {
  const store = await openRunStore(root);
  try {
    return await store.listRuns(limit);
  } finally {
    await store.close();
  }
}

export async function deleteRun(root: string, runId: string): Promise<boolean> {
  const store = await openRunStore(root);
  try {
    return await store.deleteRun(runId);
  } finally {
    await store.close();
  }
}

export async function pruneRuns(
  root: string,
  options: { maxRuns?: number; maxAgeDays?: number } = {},
): Promise<{ removed: string[] }> {
  const store = await openRunStore(root);
  try {
    const removed = await store.prune({
      maxRuns: options.maxRuns ?? 100,
      maxAgeDays: options.maxAgeDays ?? 90,
    });
    return { removed };
  } finally {
    await store.close();
  }
}

export function summarizeRun(report: RunReport): string {
  const lines = [
    `Run: ${report.id}`,
    `Status: ${report.status} (${statusGlyph(report.status)})`,
    `Profile: ${report.profile} | Mode: ${report.mode}`,
    `Duration: ${report.durationMs}ms`,
    `Manifest SHA-256: ${report.evidence.manifestHash}`,
    "",
    "Checks:",
    ...report.checks.map(
      (c) =>
        `  ${statusGlyph(c.status)} ${c.status.padEnd(8)} ${(c.title || c.id).padEnd(24)} (${c.durationMs}ms)${
          c.findings.length > 0 ? ` [${c.findings.length} findings]` : ""
        }`,
    ),
  ];
  if (report.criteria.length > 0) {
    lines.push("", "Criteria:");
    for (const crit of report.criteria) {
      lines.push(
        `  ${statusGlyph(crit.status)} ${crit.status.padEnd(8)} ${crit.id} — ${crit.description}`,
      );
    }
  }
  return lines.join("\n");
}
