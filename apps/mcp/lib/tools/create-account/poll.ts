// apps/mcp/lib/tools/create-account/poll.ts
//
// Tool: create_account.poll
// Public (no auth).
//
// Steps (full algorithm in spec section 7):
//   1. SELECT agent_accounts row by id, must be status=pending_oauth.
//   2. Decrypt the stored device_code.
//   3. POST GitHub /login/oauth/access_token with device_code.
//   4. If pending → return { status: "pending" }.
//   5. If ok:
//      a. GET /user with the access_token to extract login (handle).
//      b. UPDATE agent_accounts: github_handle, status=pending_stake,
//         github_oauth_token_encrypted=encrypted access_token.
//      c. Build unsigned tx: init_stake_deposit(35M lamports), with
//         GAS_STATION_PUBKEY as fee_payer, agent's pubkey as signer.
//      d. Compute message hash; INSERT pending_txs row.
//      e. Return { status: "ready_to_stake", github_handle, tx_to_sign_b64,
//                  expected_signers, expected_program_id, stake_amount_sol }.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  pollAccessToken,
  fetchUserHandle,
  decryptAccessToken,
  encryptAccessToken,
} from "@/lib/github/device-flow";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { solanaRpc } from "@/lib/solana/rpc";
import { mcpError, type McpError } from "@/lib/errors";
import {
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  compileTransaction,
  getBase64EncodedWireTransaction,
} from "@solana/kit";
import {
  getInitStakeDepositInstruction,
  findStakePda,
} from "@ghbounty/sdk";
import { createHash } from "node:crypto";

const PollInput = z.object({
  account_id: z.string().uuid(),
});

const STAKE_AMOUNT = 35_000_000n; // 0.035 SOL
const PENDING_TX_TTL_SECONDS = 50;

interface PollPending { status: "pending" }
interface PollReady {
  status: "ready_to_stake";
  github_handle: string;
  tx_to_sign_b64: string;
  expected_signers: string[];
  expected_program_id: string;
  stake_amount_sol: string;
}
type PollResult = PollPending | PollReady | { error: McpError };

function getProgramAddress(): string {
  // The IDL-generated GHBOUNTY_ESCROW_PROGRAM_ADDRESS is "" (empty).
  // Read the real address from env; fall back to the devnet address from Anchor.toml.
  return (
    process.env.GHBOUNTY_PROGRAM_ADDRESS ??
    "CPZx26QXs3HjwGobr8cVAZEtF1qGzqnNbBdt7h1EwbBg"
  );
}

export async function handleCreateAccountPoll(raw: unknown): Promise<PollResult> {
  const parsed = PollInput.safeParse(raw);
  if (!parsed.success) {
    return { error: mcpError("InvalidInput", parsed.error.message) };
  }
  const { account_id } = parsed.data;

  const supabase = supabaseAdmin();

  // Fetch the agent row.
  const { data: agent, error: agentErr } = await supabase
    .from("agent_accounts")
    .select("id, status, role, wallet_pubkey, github_oauth_token_encrypted")
    .eq("id", account_id)
    .single();

  if (agentErr || !agent) {
    return { error: mcpError("NotFound", "Agent account not found") };
  }
  const a = agent as any;
  if (a.status === "active") {
    return { error: mcpError("Conflict", "Account already active") };
  }
  if (a.status !== "pending_oauth") {
    return { error: mcpError("Forbidden", `Cannot poll account with status ${a.status}`) };
  }
  if (!a.github_oauth_token_encrypted) {
    return { error: mcpError("InternalError", "Device code missing on account") };
  }

  // Decrypt + poll.
  let device_code: string;
  try {
    device_code = decryptAccessToken(a.github_oauth_token_encrypted);
  } catch {
    return { error: mcpError("InternalError", "Failed to decrypt device code") };
  }

  const pollResult = await pollAccessToken(device_code);
  if (pollResult.kind === "pending") {
    return { status: "pending" };
  }
  if (pollResult.kind === "error") {
    return { error: mcpError("Forbidden", `GitHub Device Flow error: ${pollResult.error}`) };
  }

  // Got access_token — fetch user, update agent, build tx.
  const handle = await fetchUserHandle(pollResult.access_token);

  const { error: updErr } = await supabase
    .from("agent_accounts")
    .update({
      github_handle: handle,
      status: "pending_stake",
      github_oauth_token_encrypted: encryptAccessToken(pollResult.access_token),
    })
    .eq("id", account_id);

  if (updErr) {
    if ((updErr as any).code === "23505") {
      return { error: mcpError("Conflict", "GitHub handle already used by another agent") };
    }
    return { error: mcpError("InternalError", `agent update: ${(updErr as any).message}`) };
  }

  // Build the init_stake_deposit transaction.
  // Use the sync builder + explicitly derive the stake PDA ourselves,
  // passing the real program address (IDL placeholder is "").
  const programAddr = address(getProgramAddress());
  const ownerAddr = address(a.wallet_pubkey);

  // Derive stake PDA using the real program address.
  const [stakePdaAddr] = await findStakePda(
    { owner: ownerAddr },
    { programAddress: programAddr },
  );

  // Build a partial signer shape (address-only); signing happens later in `complete`.
  const ownerSigner = { address: ownerAddr } as any;

  const ix = getInitStakeDepositInstruction(
    {
      owner: ownerSigner,
      stake: stakePdaAddr,
      amount: STAKE_AMOUNT,
    },
    { programAddress: programAddr },
  );

  const rpc = solanaRpc();
  const { value: blockhash } = await rpc.getLatestBlockhash().send();

  const gasStationPubkey = process.env.NEXT_PUBLIC_GAS_STATION_PUBKEY;
  if (!gasStationPubkey) {
    return { error: mcpError("InternalError", "NEXT_PUBLIC_GAS_STATION_PUBKEY must be set") };
  }

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(gasStationPubkey), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions([ix], m),
  );

  const compiled = compileTransaction(message);
  const tx_to_sign_b64 = getBase64EncodedWireTransaction(compiled);

  // Compute message hash for anti-tamper validation in `complete`.
  const wireBytes = Buffer.from(tx_to_sign_b64, "base64");
  const message_hash = createHash("sha256").update(wireBytes).digest("hex");

  // INSERT pending_txs row.
  await supabase.from("pending_txs").insert({
    agent_account_id: account_id,
    tool_name: "create_account.complete",
    resource_id: null,
    message_hash,
    expected_signer: a.wallet_pubkey,
    expires_at: new Date(Date.now() + PENDING_TX_TTL_SECONDS * 1000).toISOString(),
  });

  return {
    status: "ready_to_stake",
    github_handle: handle,
    tx_to_sign_b64,
    expected_signers: [a.wallet_pubkey],
    expected_program_id: getProgramAddress(),
    stake_amount_sol: "0.035",
  };
}

export function registerCreateAccountPoll(server: McpServer): void {
  server.tool(
    "create_account.poll",
    { account_id: z.string().uuid() },
    async (input) => {
      const result = await handleCreateAccountPoll(input);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
