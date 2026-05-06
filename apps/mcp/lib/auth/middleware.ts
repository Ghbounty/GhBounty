// Bearer token authentication for MCP tool calls.
//
// Flow:
//   1. Parse `Authorization: Bearer <plaintext>` header.
//   2. Extract first 22 chars (prefix) for indexed DB lookup.
//   3. Fetch api_keys row + joined agent_accounts row.
//   4. bcrypt-verify the plaintext against key_hash.
//   5. Reject if revoked OR agent_account.status is not 'active'.
//   6. Return the agent for the tool to use.

import { extractPrefix, verifyApiKey } from "./api-key";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AuthResult, AgentAccount } from "@/lib/tools/types";

export async function authenticate(
  authorizationHeader: string | undefined
): Promise<AuthResult> {
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    return { ok: false, error: { code: "Unauthorized", message: "Missing or malformed Authorization header" } };
  }

  const plaintext = authorizationHeader.slice("Bearer ".length).trim();

  let prefix: string;
  try {
    prefix = extractPrefix(plaintext);
  } catch {
    return { ok: false, error: { code: "Unauthorized", message: "Invalid API key format" } };
  }

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, key_hash, agent_account_id, agent_accounts(id, role, status, wallet_pubkey, github_handle)")
    .eq("key_prefix", prefix)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) {
    return { ok: false, error: { code: "Unauthorized", message: "Authentication lookup failed" } };
  }
  if (!data) {
    return { ok: false, error: { code: "Unauthorized", message: "API key not found" } };
  }

  if (!verifyApiKey(plaintext, (data as any).key_hash)) {
    return { ok: false, error: { code: "Unauthorized", message: "API key mismatch" } };
  }

  // The Supabase typed-join syntax returns agent_accounts as either an object
  // or a single-element array depending on the relationship. Normalize.
  const rawAgent = (data as any).agent_accounts;
  const agentRow = Array.isArray(rawAgent) ? rawAgent[0] : rawAgent;
  if (!agentRow) {
    return { ok: false, error: { code: "Unauthorized", message: "Agent record missing" } };
  }

  if (agentRow.status !== "active") {
    return {
      ok: false,
      error: {
        code: "Forbidden",
        message: `Agent account is ${agentRow.status}, not active`,
      },
    };
  }

  const agent: AgentAccount = {
    id: agentRow.id,
    role: agentRow.role,
    status: agentRow.status,
    wallet_pubkey: agentRow.wallet_pubkey,
    github_handle: agentRow.github_handle,
  };

  // Async: update last_used_at without blocking the response.
  supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", (data as any).id)
    .then(() => {});

  return { ok: true, agent, apiKeyId: (data as any).id };
}
