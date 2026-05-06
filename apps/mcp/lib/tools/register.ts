// Central registration of all MCP tools. Each subsequent task in Phase 1
// fills in the imports + calls below. For now, this is an empty registry
// so the route file at app/api/mcp/[transport]/route.ts can build.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export async function registerAllTools(server: McpServer): Promise<void> {
  // Public (no auth) — onboarding (Tasks 20, 22, 24)
  // registerCreateAccountInit(server);
  // registerCreateAccountPoll(server);
  // registerCreateAccountComplete(server);

  // Authenticated read-only (Tasks 26-29)
  // registerWhoami(server);
  // registerBountiesList(server);
  // registerBountiesGet(server);
  // registerSubmissionsGet(server);

  void server; // appease "unused parameter" until tools are registered
}
