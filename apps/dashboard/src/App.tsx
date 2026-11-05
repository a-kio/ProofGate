import { useCallback, useEffect, useState } from "react";

interface RunReport {
  id: string;
  status: "VERIFIED" | "FAILED" | "INCOMPLETE" | "UNVERIFIABLE";
  mode: string;
  profile: string;
  task?: string;
  project: { root: string; name?: string; ecosystem: string[]; packageManager?: string };
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  environment: {
    platform: string;
    nodeVersion: string;
    git: { available: boolean; branch?: string; head?: string; dirty?: boolean };
  };
  intent: {
    hash: string;
    approved: boolean;
    stale: boolean;
    approvedBy?: string;
    approvedAt?: string;
  };
  criteria: Array<{
    id: string;
    description: string;
    kind: "check" | "artifact" | "manual";
    required: boolean;
    status: "PASS" | "FAIL" | "UNKNOWN" | "SKIPPED";
    reason: string;
    evidence: string[];
  }>;
  checks: Array<{
    id: string;
    title?: string;
    status: "PASS" | "FAIL" | "UNKNOWN" | "SKIPPED" | "BLOCKED" | "ERROR";
    required: boolean;
    durationMs: number;
    cached: boolean;
    command?: string[];
    summary: string;
    stdout: { text: string; truncated: boolean };
    stderr: { text: string; truncated: boolean };
    findings: Array<{ kind: string; message: string; file?: string; line?: number }>;
  }>;
  skippedChecks: Array<{ id: string; title: string; reason: string; detail: string }>;
  evidence: {
    dir: string;
    manifestHash: string;
    manifestPath: string;
    entries: Array<{ path: string; sha256: string; bytes: number; kind: string }>;
    totalBytes: number;
    redacted: boolean;
  };
  summary: { total: number; passed: number; failed: number; unknown: number; skipped: number };
  notes: string[];
}

interface RunListItem {
  id: string;
  status: "VERIFIED" | "FAILED" | "INCOMPLETE" | "UNVERIFIABLE";
  mode: string;
  profile: string;
  startedAt: string;
  durationMs: number;
  summary: { total: number; passed: number; failed: number };
}

interface IntegrationRow {
  id: string;
  name: string;
  installed: boolean;
  capabilities: { automaticCompletionChecks: boolean; mcpVerification: boolean };
  detail?: string;
}

const LOGO_PATH_D =
  "M 493,200 L 479,202 L 463,206 L 449,211 L 436,217 L 420,227 L 410,235 L 396,249 L 389,258 L 382,269 L 376,281 L 370,298 L 368,307 L 366,327 L 365,389 L 356,390 L 343,394 L 334,395 L 321,399 L 312,400 L 303,403 L 298,403 L 284,407 L 279,407 L 274,409 L 275,414 L 274,490 L 275,522 L 278,555 L 282,576 L 287,595 L 295,618 L 301,632 L 313,655 L 329,680 L 342,697 L 355,712 L 377,734 L 392,747 L 423,771 L 442,784 L 473,803 L 510,823 L 513,823 L 550,803 L 581,784 L 616,759 L 638,741 L 668,712 L 681,697 L 694,680 L 714,648 L 722,632 L 731,610 L 738,588 L 745,555 L 748,522 L 749,490 L 748,408 L 739,407 L 725,403 L 720,403 L 711,400 L 702,399 L 689,395 L 680,394 L 657,388 L 657,327 L 656,314 L 653,298 L 647,281 L 641,269 L 634,258 L 627,249 L 607,230 L 594,221 L 583,215 L 569,209 L 553,204 L 530,200 Z M 430,306 L 438,292 L 449,280 L 465,269 L 480,263 L 495,260 L 528,260 L 543,263 L 554,267 L 563,272 L 574,280 L 585,292 L 593,306 L 596,315 L 598,330 L 597,373 L 589,372 L 575,367 L 554,362 L 513,349 L 502,351 L 469,362 L 462,363 L 455,366 L 448,367 L 434,372 L 430,372 L 429,373 L 425,372 L 425,330 L 427,315 Z M 689,453 L 689,530 L 687,553 L 683,574 L 674,601 L 664,622 L 654,639 L 641,657 L 615,686 L 596,703 L 572,722 L 550,737 L 522,754 L 511,759 L 501,754 L 458,727 L 427,703 L 407,685 L 382,657 L 369,639 L 353,610 L 345,590 L 340,574 L 335,546 L 334,530 L 335,452 L 357,448 L 404,437 L 408,435 L 420,433 L 483,416 L 510,407 L 513,407 L 540,416 L 607,434 L 615,435 L 619,437 L 644,443 L 684,451 Z M 492,486 L 484,490 L 472,501 L 466,510 L 461,527 L 462,542 L 468,557 L 474,565 L 486,575 L 486,578 L 484,582 L 483,589 L 479,600 L 477,611 L 471,629 L 469,640 L 466,647 L 465,654 L 558,654 L 557,647 L 554,640 L 552,629 L 546,611 L 544,600 L 540,589 L 537,575 L 549,565 L 555,557 L 558,551 L 561,542 L 562,535 L 562,527 L 559,515 L 557,510 L 551,501 L 543,493 L 531,486 L 521,483 L 513,482 L 502,483 Z";

function ProofGateLogo({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="currentColor"
      fillRule="evenodd"
      viewBox="0 0 1024 1024"
      role="img"
      aria-label="ProofGate Logo"
    >
      <title>ProofGate Logo</title>
      <path d={LOGO_PATH_D} />
    </svg>
  );
}

export default function App() {
  const [report, setReport] = useState<RunReport | null>(null);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "checks" | "criteria" | "evidence" | "history" | "integrations"
  >("checks");
  const [selectedProfile, setSelectedProfile] = useState<"fast" | "balanced" | "thorough">(
    "balanced",
  );
  const [checkFilter, setCheckFilter] = useState<"all" | "pass" | "fail" | "skipped">("all");
  const [expandedCheck, setExpandedCheck] = useState<string | null>(null);
  const [selectedEvidenceFile, setSelectedEvidenceFile] = useState<string | null>(null);
  const [evidenceContent, setEvidenceContent] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const loadData = useCallback(async (runId?: string) => {
    try {
      setLoading(true);
      const statusRes = await fetch(runId ? `/api/runs/${runId}` : "/api/status").then((r) =>
        r.json(),
      );
      if (statusRes.ok && statusRes.run) {
        setReport(statusRes.run);
        if (["fast", "balanced", "thorough"].includes(statusRes.run.profile)) {
          setSelectedProfile(statusRes.run.profile as "fast" | "balanced" | "thorough");
        }
      }

      const runsRes = await fetch("/api/runs?limit=30").then((r) => r.json());
      if (runsRes.ok) setRuns(runsRes.runs || []);

      const intRes = await fetch("/api/integrations").then((r) => r.json());
      if (intRes.ok) setIntegrations(intRes.integrations || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const triggerVerify = async () => {
    try {
      setVerifying(true);
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: selectedProfile }),
      }).then((r) => r.json());
      if (res.ok && res.run) {
        setReport(res.run);
        loadData();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setVerifying(false);
    }
  };

  const triggerApprove = async () => {
    try {
      await fetch("/api/criteria/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: selectedProfile }),
      });
      loadData(report?.id);
    } catch (e) {
      console.error(e);
    }
  };

  const loadEvidenceFile = async (filePath: string) => {
    if (!report) return;
    setSelectedEvidenceFile(filePath);
    try {
      const res = await fetch(`/api/runs/${report.id}/evidence/${filePath}`).then((r) => r.json());
      if (res.ok && res.file) {
        setEvidenceContent(res.file.content);
      } else {
        setEvidenceContent("Could not read evidence file.");
      }
    } catch {
      setEvidenceContent("Failed to fetch evidence content.");
    }
  };

  const filteredChecks = report
    ? report.checks.filter((c) => {
        if (checkFilter === "pass") return c.status === "PASS";
        if (checkFilter === "fail")
          return c.status === "FAIL" || c.status === "ERROR" || c.status === "BLOCKED";
        if (checkFilter === "skipped") return c.status === "SKIPPED";
        return true;
      })
    : [];

  return (
    <div className="min-h-screen bg-[#09090b] text-[#fafafa] flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="border-b border-[#27272a] bg-[#0c0d12]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <ProofGateLogo className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold tracking-tight text-white text-base">ProofGate</span>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-[#27272a] text-zinc-400">
                  v1.0.0
                </span>
              </div>
              <span className="text-xs text-zinc-400 font-mono">
                {report?.project.name || "Local Workspace"}
                {report?.environment.git.branch && ` · ${report.environment.git.branch}`}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center rounded-lg bg-[#18181b] border border-[#27272a] p-0.5 text-xs">
              {(["fast", "balanced", "thorough"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setSelectedProfile(p)}
                  className={`px-3 py-1.5 rounded-md capitalize transition-all ${
                    selectedProfile === p
                      ? "bg-[#27272a] text-white font-medium shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            <button
              onClick={triggerVerify}
              disabled={verifying}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-xs transition-all shadow-sm shadow-emerald-500/20 disabled:opacity-50 cursor-pointer"
            >
              {verifying ? (
                <>
                  <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Verifying...
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Run Verify
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 flex flex-col gap-8">
        {loading && !report ? (
          <div className="flex-1 flex items-center justify-center py-32 text-zinc-500">
            <svg
              className="animate-spin w-6 h-6 mr-3 text-emerald-500"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Loading ProofGate workspace data...
          </div>
        ) : !report ? (
          <div className="border border-dashed border-[#27272a] rounded-2xl p-16 text-center max-w-xl mx-auto my-12 bg-[#0c0d12]">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center mb-4">
              <ProofGateLogo className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">No Verification Run Found</h2>
            <p className="text-sm text-zinc-400 mb-6">
              ProofGate has not recorded a verification run in this project yet. Trigger one
              directly or run{" "}
              <code className="text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded font-mono">
                proofgate verify
              </code>
              .
            </p>
            <button
              onClick={triggerVerify}
              className="px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-xs shadow-md transition-all cursor-pointer"
            >
              Start First Verification Run
            </button>
          </div>
        ) : (
          <>
            {/* Verdict Hero Card */}
            <div
              className={`relative overflow-hidden rounded-2xl border p-6 transition-all ${
                report.status === "VERIFIED"
                  ? "bg-gradient-to-br from-[#0c1813] to-[#09090b] border-emerald-500/30"
                  : report.status === "FAILED"
                    ? "bg-gradient-to-br from-[#1a0f0f] to-[#09090b] border-red-500/30"
                    : report.status === "INCOMPLETE"
                      ? "bg-gradient-to-br from-[#1a150c] to-[#09090b] border-amber-500/30"
                      : "bg-gradient-to-br from-[#120f1a] to-[#09090b] border-purple-500/30"
              }`}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-start md:items-center gap-4">
                  <div
                    className={`w-14 h-14 rounded-2xl flex items-center justify-center font-bold text-2xl shadow-lg ${
                      report.status === "VERIFIED"
                        ? "bg-emerald-500 text-black shadow-emerald-500/30"
                        : report.status === "FAILED"
                          ? "bg-red-500 text-white shadow-red-500/30"
                          : report.status === "INCOMPLETE"
                            ? "bg-amber-500 text-black shadow-amber-500/30"
                            : "bg-purple-500 text-white shadow-purple-500/30"
                    }`}
                  >
                    {report.status === "VERIFIED"
                      ? "✔"
                      : report.status === "FAILED"
                        ? "✖"
                        : report.status === "INCOMPLETE"
                          ? "◐"
                          : "⊘"}
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-bold tracking-tight text-white">
                        {report.status}
                      </span>
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-mono bg-white/5 border border-white/10 text-zinc-300">
                        {report.profile}
                      </span>
                      <span className="text-xs text-zinc-400 font-mono">
                        {report.durationMs < 1000
                          ? `${report.durationMs}ms`
                          : `${(report.durationMs / 1000).toFixed(2)}s`}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-300 mt-1 font-mono">
                      {report.task || `Verified on ${new Date(report.finishedAt).toLocaleString()}`}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap md:flex-col md:items-end gap-2 text-xs font-mono text-zinc-400">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500">Run ID:</span>
                    <span className="text-zinc-200">{report.id}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500">Manifest:</span>
                    <button
                      onClick={() => copyToClipboard(report.evidence.manifestHash, "manifest")}
                      className="text-zinc-200 hover:text-emerald-400 flex items-center gap-1 cursor-pointer transition-colors"
                      title="Copy full SHA-256 hash"
                    >
                      <span>{report.evidence.manifestHash.slice(0, 16)}...</span>
                      <span className="text-[10px] text-zinc-500">
                        {copiedKey === "manifest" ? "copied!" : "⧉"}
                      </span>
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500">Intent Hash:</span>
                    <button
                      onClick={() => copyToClipboard(report.intent.hash, "intent")}
                      className="text-zinc-200 hover:text-emerald-400 flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <span>{report.intent.hash.slice(0, 16)}...</span>
                      <span className="text-[10px] text-zinc-500">
                        {copiedKey === "intent" ? "copied!" : "⧉"}
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Stats Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-white/5">
                <div className="bg-black/20 rounded-xl p-3 border border-white/5">
                  <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-medium">
                    Passed Checks
                  </div>
                  <div className="text-2xl font-bold font-mono text-emerald-400 mt-0.5">
                    {report.summary.passed}
                  </div>
                </div>
                <div className="bg-black/20 rounded-xl p-3 border border-white/5">
                  <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-medium">
                    Failed Checks
                  </div>
                  <div
                    className={`text-2xl font-bold font-mono mt-0.5 ${report.summary.failed > 0 ? "text-red-400" : "text-zinc-500"}`}
                  >
                    {report.summary.failed}
                  </div>
                </div>
                <div className="bg-black/20 rounded-xl p-3 border border-white/5">
                  <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-medium">
                    Skipped Checks
                  </div>
                  <div className="text-2xl font-bold font-mono text-zinc-400 mt-0.5">
                    {report.skippedChecks.length}
                  </div>
                </div>
                <div className="bg-black/20 rounded-xl p-3 border border-white/5">
                  <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-medium">
                    Evidence Size
                  </div>
                  <div className="text-2xl font-bold font-mono text-cyan-400 mt-0.5">
                    {(report.evidence.totalBytes / 1024).toFixed(1)} KB
                  </div>
                </div>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center gap-2 border-b border-[#27272a] pb-px text-sm">
              <button
                onClick={() => setActiveTab("checks")}
                className={`px-4 py-2 font-medium border-b-2 transition-all cursor-pointer ${
                  activeTab === "checks"
                    ? "border-emerald-500 text-white font-semibold"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Checks ({report.checks.length})
              </button>
              <button
                onClick={() => setActiveTab("criteria")}
                className={`px-4 py-2 font-medium border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
                  activeTab === "criteria"
                    ? "border-emerald-500 text-white font-semibold"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Criteria ({report.criteria.length})
                {!report.intent.approved && (
                  <span className="w-2 h-2 rounded-full bg-amber-500" title="Approval required" />
                )}
              </button>
              <button
                onClick={() => setActiveTab("evidence")}
                className={`px-4 py-2 font-medium border-b-2 transition-all cursor-pointer ${
                  activeTab === "evidence"
                    ? "border-emerald-500 text-white font-semibold"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Evidence ({report.evidence.entries.length})
              </button>
              <button
                onClick={() => setActiveTab("history")}
                className={`px-4 py-2 font-medium border-b-2 transition-all cursor-pointer ${
                  activeTab === "history"
                    ? "border-emerald-500 text-white font-semibold"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Run History ({runs.length})
              </button>
              <button
                onClick={() => setActiveTab("integrations")}
                className={`px-4 py-2 font-medium border-b-2 transition-all cursor-pointer ${
                  activeTab === "integrations"
                    ? "border-emerald-500 text-white font-semibold"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Integrations ({integrations.filter((i) => i.installed).length}/{integrations.length}
                )
              </button>
            </div>

            {/* Tab 1: Checks View */}
            {activeTab === "checks" && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    {(["all", "pass", "fail", "skipped"] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setCheckFilter(f)}
                        className={`text-xs px-3 py-1.5 rounded-lg capitalize border transition-all cursor-pointer ${
                          checkFilter === f
                            ? "bg-[#27272a] text-white border-zinc-600 font-medium"
                            : "bg-transparent text-zinc-400 border-transparent hover:text-zinc-200"
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs text-zinc-500 font-mono">
                    Showing {filteredChecks.length} of {report.checks.length} checks
                  </span>
                </div>

                <div className="flex flex-col gap-3">
                  {filteredChecks.map((check) => {
                    const isExpanded = expandedCheck === check.id;
                    return (
                      <div
                        key={check.id}
                        className="rounded-xl border border-[#27272a] bg-[#0c0d12] hover:border-zinc-700 transition-all overflow-hidden"
                      >
                        <div
                          onClick={() => setExpandedCheck(isExpanded ? null : check.id)}
                          className="p-4 flex items-center justify-between cursor-pointer select-none"
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className={`w-6 h-6 rounded-md flex items-center justify-center font-bold text-xs ${
                                check.status === "PASS"
                                  ? "bg-emerald-500/20 text-emerald-400"
                                  : check.status === "FAIL" || check.status === "ERROR"
                                    ? "bg-red-500/20 text-red-400"
                                    : "bg-zinc-800 text-zinc-400"
                              }`}
                            >
                              {check.status === "PASS" ? "✔" : check.status === "FAIL" ? "✖" : "–"}
                            </span>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-white text-sm">
                                  {check.title || check.id}
                                </span>
                                {check.cached && (
                                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                    cached
                                  </span>
                                )}
                                {!check.required && (
                                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                                    optional
                                  </span>
                                )}
                              </div>
                              <span className="text-xs text-zinc-400 font-mono">
                                {check.summary}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-4">
                            <span className="text-xs font-mono text-zinc-400">
                              {check.durationMs}ms
                            </span>
                            <span className="text-zinc-500 text-sm">{isExpanded ? "▲" : "▼"}</span>
                          </div>
                        </div>

                        {/* Collapsible Details */}
                        {isExpanded && (
                          <div className="border-t border-[#27272a] p-4 bg-black/40 flex flex-col gap-4">
                            {check.command && (
                              <div>
                                <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold font-mono block mb-1">
                                  Command Arguments
                                </span>
                                <code className="block text-xs font-mono bg-black p-2.5 rounded-lg border border-[#27272a] text-zinc-300 overflow-x-auto">
                                  {JSON.stringify(check.command)}
                                </code>
                              </div>
                            )}

                            {check.findings.length > 0 && (
                              <div>
                                <span className="text-[11px] uppercase tracking-wider text-red-400 font-semibold font-mono block mb-1">
                                  Findings ({check.findings.length})
                                </span>
                                <div className="flex flex-col gap-1.5">
                                  {check.findings.map((f, i) => (
                                    <div
                                      key={i}
                                      className="text-xs p-2.5 rounded-lg bg-red-950/20 border border-red-500/20 text-red-300 font-mono"
                                    >
                                      <span className="font-bold">[{f.kind}]</span> {f.message}
                                      {f.file && ` (${f.file}:${f.line ?? 1})`}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {check.stdout.text && (
                              <div>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold font-mono">
                                    Standard Output
                                  </span>
                                  <button
                                    onClick={() =>
                                      copyToClipboard(check.stdout.text, `${check.id}-out`)
                                    }
                                    className="text-[11px] text-zinc-400 hover:text-white cursor-pointer font-mono"
                                  >
                                    {copiedKey === `${check.id}-out` ? "Copied!" : "Copy"}
                                  </button>
                                </div>
                                <pre className="text-xs font-mono bg-black p-3 rounded-lg border border-[#27272a] text-zinc-300 max-h-64 overflow-y-auto whitespace-pre-wrap">
                                  {check.stdout.text}
                                </pre>
                              </div>
                            )}

                            {check.stderr.text && (
                              <div>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-[11px] uppercase tracking-wider text-red-400 font-semibold font-mono">
                                    Standard Error
                                  </span>
                                  <button
                                    onClick={() =>
                                      copyToClipboard(check.stderr.text, `${check.id}-err`)
                                    }
                                    className="text-[11px] text-zinc-400 hover:text-white cursor-pointer font-mono"
                                  >
                                    {copiedKey === `${check.id}-err` ? "Copied!" : "Copy"}
                                  </button>
                                </div>
                                <pre className="text-xs font-mono bg-black p-3 rounded-lg border border-red-900/30 text-red-300 max-h-64 overflow-y-auto whitespace-pre-wrap">
                                  {check.stderr.text}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tab 2: Acceptance Criteria View */}
            {activeTab === "criteria" && (
              <div className="flex flex-col gap-6">
                <div className="rounded-xl border border-[#27272a] p-5 bg-[#0c0d12] flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-white text-base">Human Definition of Done</h3>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Acceptance criteria are signed and locked to prevent silent criteria drift by
                      AI coding agents.
                    </p>
                  </div>
                  <div>
                    {report.intent.approved ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono font-medium">
                        ✔ APPROVED ({report.intent.approvedBy || "human"})
                      </span>
                    ) : (
                      <button
                        onClick={triggerApprove}
                        className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs transition-all shadow-sm cursor-pointer"
                      >
                        Approve Criteria Now
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  {report.criteria.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-xl border border-[#27272a] bg-[#0c0d12] p-4 flex items-start justify-between"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`w-6 h-6 mt-0.5 rounded-md flex items-center justify-center font-bold text-xs ${
                            c.status === "PASS"
                              ? "bg-emerald-500/20 text-emerald-400"
                              : "bg-zinc-800 text-zinc-400"
                          }`}
                        >
                          {c.status === "PASS" ? "✔" : "–"}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white text-sm">{c.id}</span>
                            <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                              {c.kind}
                            </span>
                            {c.required && (
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-950/40 text-red-400 border border-red-500/20">
                                required
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-zinc-300 mt-1">{c.description}</p>
                          {c.reason && (
                            <p className="text-xs text-zinc-500 font-mono mt-0.5">{c.reason}</p>
                          )}
                        </div>
                      </div>

                      <span
                        className={`text-xs font-mono font-medium ${
                          c.status === "PASS" ? "text-emerald-400" : "text-zinc-500"
                        }`}
                      >
                        {c.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab 3: Evidence Bundle View */}
            {activeTab === "evidence" && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="flex flex-col gap-2">
                  <span className="text-xs uppercase tracking-wider text-zinc-500 font-mono font-semibold">
                    Bundle Files ({report.evidence.entries.length})
                  </span>
                  <div className="rounded-xl border border-[#27272a] bg-[#0c0d12] overflow-hidden divide-y divide-[#27272a]">
                    {report.evidence.entries.map((entry) => (
                      <button
                        key={entry.path}
                        onClick={() => loadEvidenceFile(entry.path)}
                        className={`w-full p-3 text-left flex items-center justify-between text-xs transition-colors cursor-pointer ${
                          selectedEvidenceFile === entry.path
                            ? "bg-emerald-500/10 text-emerald-300"
                            : "text-zinc-300 hover:bg-zinc-900/50"
                        }`}
                      >
                        <span className="font-mono truncate">{entry.path}</span>
                        <span className="text-zinc-500 font-mono ml-2">
                          {(entry.bytes / 1024).toFixed(1)}k
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="md:col-span-2 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wider text-zinc-500 font-mono font-semibold">
                      {selectedEvidenceFile || "Select a file to preview"}
                    </span>
                    {selectedEvidenceFile && evidenceContent && (
                      <button
                        onClick={() => copyToClipboard(evidenceContent, "evidence-file")}
                        className="text-xs text-zinc-400 hover:text-white cursor-pointer font-mono"
                      >
                        {copiedKey === "evidence-file" ? "Copied!" : "Copy Contents"}
                      </button>
                    )}
                  </div>
                  <pre className="flex-1 min-h-[360px] rounded-xl border border-[#27272a] bg-black p-4 text-xs font-mono text-zinc-300 overflow-auto whitespace-pre-wrap">
                    {evidenceContent || (
                      <span className="text-zinc-600">
                        Click any evidence file on the left to inspect its raw, redacted contents.
                      </span>
                    )}
                  </pre>
                </div>
              </div>
            )}

            {/* Tab 4: Run History View */}
            {activeTab === "history" && (
              <div className="flex flex-col gap-3">
                <div className="rounded-xl border border-[#27272a] bg-[#0c0d12] overflow-hidden divide-y divide-[#27272a]">
                  {runs.map((r) => (
                    <div
                      key={r.id}
                      onClick={() => loadData(r.id)}
                      className={`p-4 flex items-center justify-between cursor-pointer transition-colors ${
                        report.id === r.id ? "bg-zinc-800/40" : "hover:bg-zinc-900/50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs ${
                            r.status === "VERIFIED"
                              ? "bg-emerald-500/20 text-emerald-400"
                              : r.status === "FAILED"
                                ? "bg-red-500/20 text-red-400"
                                : "bg-amber-500/20 text-amber-400"
                          }`}
                        >
                          {r.status === "VERIFIED" ? "✔" : r.status === "FAILED" ? "✖" : "◐"}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-white text-sm font-semibold">
                              {r.id}
                            </span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                              {r.profile}
                            </span>
                          </div>
                          <span className="text-xs text-zinc-500 font-mono">
                            {new Date(r.startedAt).toLocaleString()}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-xs font-mono">
                        <span className="text-emerald-400">{r.summary.passed} pass</span>
                        {r.summary.failed > 0 && (
                          <span className="text-red-400">{r.summary.failed} fail</span>
                        )}
                        <span className="text-zinc-500">{r.durationMs}ms</span>
                        <span className="text-zinc-400">→</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab 5: Agent Integrations View */}
            {activeTab === "integrations" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {integrations.map((i) => (
                  <div
                    key={i.id}
                    className="rounded-xl border border-[#27272a] bg-[#0c0d12] p-5 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-white text-base">{i.name}</span>
                        <span
                          className={`text-xs px-2.5 py-0.5 rounded-full font-mono ${
                            i.installed
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-zinc-800 text-zinc-400"
                          }`}
                        >
                          {i.installed ? "Installed" : "Available"}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 mb-4">
                        {i.detail || `Agent integration for ${i.name}`}
                      </p>
                    </div>

                    <div className="flex items-center gap-4 text-xs font-mono text-zinc-400 border-t border-[#27272a] pt-3">
                      <span>
                        Auto-Check: {i.capabilities.automaticCompletionChecks ? "Yes" : "No"}
                      </span>
                      <span>MCP: {i.capabilities.mcpVerification ? "Yes" : "No"}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#27272a] py-6 text-center text-xs text-zinc-500 font-mono">
        ProofGate · Real commands. Human-owned acceptance. Hash-manifested evidence. · Apache-2.0
        License
      </footer>
    </div>
  );
}
