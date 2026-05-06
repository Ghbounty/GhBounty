// apps/mcp/lib/tools/create-account/init.ts
//
// Tool: create_account.init
// Public (no auth). Rate-limited per IP.
//
// Steps:
//   1. Validate input (role + wallet_pubkey shape).
//   2. Rate-limit by IP via createAccountLimiter.
//   3. POST GitHub /login/device/code to get user_code.
//   4. INSERT agent_accounts row with status=pending_oauth, store device_code in
//      github_oauth_token_encrypted (gets overwritten with the access_token in poll).
//   5. Return account_id, user_code, verification_uri, expires_at.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { startDeviceFlow, encryptAccessToken } from "@/lib/github/device-flow";
import { createAccountLimiter } from "@/lib/rate-limit/upstash";
import { mcpError, type McpError } from "@/lib/errors";

const InitInput = z.object({
  role: z.enum(["dev", "company"]),
  wallet_pubkey: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid Solana pubkey"),
  ip: z.string().optional(),
  company_info: z
    .object({
      name: z.string().min(1).max(80),
      slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
      website: z.string().url().optional(),
      github_org: z.string().optional(),
    })
    .optional(),
});

interface InitOk {
  account_id: string;
  user_code: string;
  verification_uri: string;
  expires_at: string;
}
type InitResult = InitOk | { error: McpError };

export async function handleCreateAccountInit(raw: unknown): Promise<InitResult> {
  const parsed = InitInput.safeParse(raw);
  if (!parsed.success) {
    return { error: mcpError("InvalidInput", parsed.error.message) };
  }
  const { role, wallet_pubkey, ip = "unknown" } = parsed.data;

  // Rate limit by IP.
  const rl = await createAccountLimiter().limit(ip);
  if (!rl.success) {
    return { error: mcpError("RateLimited", "Too many account creation attempts from this IP") };
  }

  // Start GitHub Device Flow.
  let dev: Awaited<ReturnType<typeof startDeviceFlow>>;
  try {
    dev = await startDeviceFlow();
  } catch (err) {
    return { error: mcpError("RpcError", `GitHub Device Flow failed: ${(err as Error).message}`) };
  }

  // INSERT agent_accounts.
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("agent_accounts")
    .insert({
      role,
      wallet_pubkey,
      status: "pending_oauth",
      github_oauth_token_encrypted: encryptAccessToken(dev.device_code),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: mcpError("Conflict", "An agent with this wallet_pubkey already exists") };
    }
    return { error: mcpError("InternalError", `agent_accounts insert: ${error.message}`) };
  }

  return {
    account_id: (data as any).id,
    user_code: dev.user_code,
    verification_uri: dev.verification_uri,
    expires_at: new Date(Date.now() + dev.expires_in * 1000).toISOString(),
  };
}

// Tool registration glue.
export function registerCreateAccountInit(server: McpServer): void {
  server.tool(
    "create_account.init",
    {
      role: z.enum(["dev", "company"]),
      wallet_pubkey: z.string(),
      company_info: z
        .object({
          name: z.string(),
          slug: z.string(),
          website: z.string().optional(),
          github_org: z.string().optional(),
        })
        .optional(),
    },
    async (input, extra) => {
      const ip =
        (extra as any)?.requestInfo?.headers?.["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
        (extra as any)?.requestInfo?.headers?.["x-real-ip"] ||
        "unknown";
      const result = await handleCreateAccountInit({ ...input, ip });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
