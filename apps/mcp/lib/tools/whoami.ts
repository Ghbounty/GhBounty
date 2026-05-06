import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { authenticate } from "@/lib/auth/middleware";
import { solanaRpc } from "@/lib/solana/rpc";
import { address } from "@solana/kit";

interface WhoamiInput {
  authorization?: string;
}

export async function handleWhoami(input: WhoamiInput) {
  const auth = await authenticate(input.authorization);
  if (!auth.ok) {
    return { error: auth.error };
  }
  const { agent } = auth;

  const rpc = solanaRpc();
  let balanceLamports = 0n;
  try {
    const { value } = await rpc.getBalance(address(agent.wallet_pubkey)).send();
    balanceLamports = value;
  } catch {
    // Soft fail — RPC hiccup; return 0 balance instead of erroring.
  }

  return {
    agent_id: agent.id,
    role: agent.role,
    status: agent.status,
    github_handle: agent.github_handle,
    wallet_pubkey: agent.wallet_pubkey,
    balances: {
      sol_lamports: balanceLamports.toString(),
    },
  };
}

export function registerWhoami(server: McpServer): void {
  server.tool("whoami", {}, async (_input, extra) => {
    const authorization = (extra as any)?.requestInfo?.headers?.authorization;
    const result = await handleWhoami({ authorization });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });
}
