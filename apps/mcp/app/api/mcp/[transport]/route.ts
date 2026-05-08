// Public MCP endpoint. The dynamic route segment `[transport]` is
// `sse` for Streamable HTTP transport. Tools are registered by
// `lib/tools/register.ts`; this file is just the framework shell.

import { createMcpHandler } from "mcp-handler";
import { registerAllTools } from "@/lib/tools/register";

const handler = createMcpHandler(
  async (server) => {
    await registerAllTools(server);
  },
  {
    capabilities: {
      tools: {},
    },
  },
  {
    basePath: "/api/mcp",
  }
);

export { handler as GET, handler as POST, handler as DELETE };

export const dynamic = "force-dynamic";
export const maxDuration = 60;
