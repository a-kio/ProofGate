import path from "node:path";
import { startMcpServer } from "@proofgate/mcp-server";

export async function mcpCommand(targetDir = "."): Promise<void> {
  const root = path.resolve(targetDir);
  // Ensure stdout is preserved strictly for stdio protocol
  await startMcpServer(root);
}
