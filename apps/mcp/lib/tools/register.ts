import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCreateAccountInit } from "./create-account/init";
import { registerCreateAccountPoll } from "./create-account/poll";

export async function registerAllTools(server: McpServer): Promise<void> {
  registerCreateAccountInit(server);
  registerCreateAccountPoll(server);
}
