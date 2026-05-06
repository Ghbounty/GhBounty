import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCreateAccountInit } from "./create-account/init";
import { registerCreateAccountPoll } from "./create-account/poll";
import { registerCreateAccountComplete } from "./create-account/complete";
import { registerWhoami } from "./whoami";
import { registerBountiesList } from "./bounties/list";
import { registerBountiesGet } from "./bounties/get";

export async function registerAllTools(server: McpServer): Promise<void> {
  registerCreateAccountInit(server);
  registerCreateAccountPoll(server);
  registerCreateAccountComplete(server);
  registerWhoami(server);
  registerBountiesList(server);
  registerBountiesGet(server);
}
