export type {
  AcceptanceCriterion,
  CheckResult,
  CheckStatus,
  CriterionResult,
  EvidenceSummary,
  IntentSummary,
  OverallStatus,
  Profile,
  RunListItem,
  RunReport,
} from "@proofgate/shared";
// Also re-export core shared contracts
export {
  deriveOverallStatus,
  overallFromExit,
  PROOFGATE_DIR,
  statusGlyph,
  statusLabel,
  TOOL_NAME,
  TOOL_VERSION,
} from "@proofgate/shared";
export * from "./environment.js";
export * from "./events.js";
export * from "./evidence.js";
export * from "./glob.js";
export * from "./hash.js";
export * from "./ids.js";
export * from "./orchestration.js";
export * from "./paths.js";
export * from "./redact.js";
export * from "./status.js";
export * from "./version.js";
