import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCreateAccountInit } from "./create-account/init";

export async function registerAllTools(server: McpServer): Promise<void> {
  registerCreateAccountInit(server);
  // More tools added in subsequent tasks
}
