import type { AgentAdapter } from "@proofgate/integration-sdk";
import { detectIntegrations } from "./registry.js";

export * from "./common.js";
export * from "./registry.js";

export interface IntegrationStatusRow {
  id: string;
  name: string;
  installed: boolean;
  capabilities: AgentAdapter["capabilities"];
  detail?: string;
}

export async function listIntegrationsStatus(root: string): Promise<IntegrationStatusRow[]> {
  const detections = await detectIntegrations(root);
  return detections.map(({ adapter, detection }) => ({
    id: adapter.id,
    name: adapter.displayName,
    installed: detection.installed,
    capabilities: adapter.capabilities,
    detail: detection.detail,
  }));
}
