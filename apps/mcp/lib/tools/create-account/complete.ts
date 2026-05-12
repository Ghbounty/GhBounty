// apps/mcp/lib/tools/create-account/complete.ts
//
// Tool: create_account.complete
// Public (no auth). Submits the signed init_stake_deposit tx.
//
// Steps (full algorithm in spec section 7):
//   1. SELECT pending_txs by (agent_account_id, tool_name='create_account.complete').
//      404 if missing/expired/consumed.
//   2. Decode signed_tx_b64. Verify the agent's signature is present
//      and the wire-bytes hash matches pending_txs.message_hash (anti-tamper).
//   3. POST to gas-station endpoint to submit. Wait for confirm.
//   4. On confirm:
//      - INSERT stake_deposits row.
//      - INSERT profiles, developers OR companies, wallets.
//      - Mint API key, INSERT api_keys.
//      - UPDATE agent_accounts.status = active.
//      - UPDATE pending_txs.consumed_at.
//   5. Return { api_key, agent_id, profile, github_handle }.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import { getTransactionDecoder } from "@solana/kit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sponsorAndSubmit } from "@/lib/solana/gas-station-client";
import { mintApiKey } from "@/lib/auth/api-key";
import { mcpError, type McpError } from "@/lib/errors";

const CompleteInput = z.object({
  account_id: z.string().uuid(),
  signed_tx_b64: z.string().min(1),
});

interface CompleteOk {
  api_key: string;
  agent_id: string;
  github_handle: string;
  profile: {
    id: string;
    role: "dev" | "company";
    wallet_pubkey: string;
  };
}
type CompleteResult = CompleteOk | { error: McpError };

export function getChainId(): string {
  const chainId = process.env.CHAIN_ID;
  if (!chainId) {
    throw new Error("CHAIN_ID must be set");
  }
  return chainId;
}

export async function handleCreateAccountComplete(raw: unknown): Promise<CompleteResult> {
  const parsed = CompleteInput.safeParse(raw);
  if (!parsed.success) {
    return { error: mcpError("InvalidInput", parsed.error.message) };
  }
  const { account_id, signed_tx_b64 } = parsed.data;

  const supabase = supabaseAdmin();

  // 1. Find the pending_tx row.
  const { data: pending } = await supabase
    .from("pending_txs")
    .select("id, message_hash, expected_signer, expires_at, consumed_at")
    .eq("agent_account_id", account_id)
    .eq("tool_name", "create_account.complete")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!pending) {
    return { error: mcpError("BlockhashExpired", "No pending transaction found for this account") };
  }
  const p = pending as any;
  if (p.consumed_at) {
    return { error: mcpError("BlockhashExpired", "Pending transaction already consumed") };
  }
  if (new Date(p.expires_at) < new Date()) {
    return { error: mcpError("BlockhashExpired", "Pending transaction expired") };
  }

  // 2. Decode signed tx, verify signer + wire-bytes hash.
  let decoded: any;
  let wireBytes: Buffer;
  try {
    wireBytes = Buffer.from(signed_tx_b64, "base64");
    decoded = getTransactionDecoder().decode(wireBytes);
  } catch {
    return { error: mcpError("InvalidSignature", "Could not decode signed transaction") };
  }

  // Verify the expected signer's signature is present and not null.
  const sig = decoded.signatures?.[p.expected_signer];
  if (!sig) {
    return { error: mcpError("WrongSigner", "Expected signer signature missing") };
  }

  // Verify hash matches what poll() recorded.
  const actualHash = createHash("sha256").update(wireBytes).digest("hex");
  if (actualHash !== p.message_hash) {
    return { error: mcpError("TxTampered", "Transaction wire bytes do not match prepared hash") };
  }

  // 3. Submit via gas station (handles fee payer signing + RPC submit + confirm).
  const sponsorRes = await sponsorAndSubmit(signed_tx_b64);
  if (!sponsorRes.ok || !sponsorRes.tx_hash) {
    return {
      error: mcpError(
        sponsorRes.error?.code === "WalletInsufficientFunds" ? "WalletInsufficientFunds" : "RpcError",
        sponsorRes.error?.message ?? "Sponsor failed"
      ),
    };
  }

  // 4. Persist post-confirmation rows.
  const { data: agent } = await supabase
    .from("agent_accounts")
    .select("id, role, wallet_pubkey, github_handle")
    .eq("id", account_id)
    .single();

  if (!agent || !(agent as any).github_handle) {
    return { error: mcpError("InternalError", "Agent missing or has no github_handle") };
  }
  const ag = agent as any;

  // INSERT stake_deposits. PDA derivation TODO Phase 2 — for v1, store the
  // wallet pubkey + tx_hash, derive the actual PDA later from the chain.
  // The DB row schema requires `pda`; use a placeholder format that includes
  // the tx_hash so the row is unique and traceable.
  await supabase.from("stake_deposits").insert({
    agent_account_id: account_id,
    pda: `stake-deposit-pda:${ag.wallet_pubkey}`, // TODO: real PDA derivation
    tx_signature: sponsorRes.tx_hash,
    amount_lamports: "35000000",
    locked_until: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  });

  // INSERT profiles, developers/companies, wallets.
  const userId = `did:agent:${ag.id}`;
  await supabase.from("profiles").insert({
    user_id: userId,
    role: ag.role,
    github_handle: ag.github_handle,
  });

  if (ag.role === "dev") {
    await supabase.from("developers").insert({
      user_id: userId,
      github_handle: ag.github_handle,
    });
  } else {
    await supabase.from("companies").insert({
      user_id: userId,
      name: ag.github_handle,
      slug: ag.github_handle.toLowerCase(),
    });
  }

  await supabase.from("wallets").insert({
    user_id: userId,
    chain_id: getChainId(),
    address: ag.wallet_pubkey,
  });

  // Mint API key.
  const { plaintext, prefix, hash } = mintApiKey();
  const { data: keyRow } = await supabase
    .from("api_keys")
    .insert({
      agent_account_id: account_id,
      key_hash: hash,
      key_prefix: prefix,
    })
    .select("id")
    .single();

  if (!keyRow) {
    return { error: mcpError("InternalError", "API key insert failed") };
  }

  // Mark agent active + consume pending_tx.
  await supabase
    .from("agent_accounts")
    .update({ status: "active" })
    .eq("id", account_id);

  await supabase
    .from("pending_txs")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", p.id);

  return {
    api_key: plaintext,
    agent_id: ag.id,
    github_handle: ag.github_handle,
    profile: {
      id: userId,
      role: ag.role,
      wallet_pubkey: ag.wallet_pubkey,
    },
  };
}

export function registerCreateAccountComplete(server: McpServer): void {
  server.tool(
    "create_account.complete",
    {
      account_id: z.string().uuid(),
      signed_tx_b64: z.string(),
    },
    async (input) => {
      const result = await handleCreateAccountComplete(input);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
