/**
 * GHB-167 — backfill `profiles.wallet_pubkey` from the Privy wallet that
 * already exists on the account.
 *
 * Issue #167: a dev authenticates via MCP and `whoami` reports
 * `wallet_pubkey: null` even though Privy provisioned (or linked) a Solana
 * wallet at sign-in, and `submissions.list` rejects with "Profile has no
 * wallet pubkey". The existing backfill (agent-delegation-route-core) only
 * fires when the user enables signing delegation — issue #167 explicitly
 * wants the wallet mapped without delegation.
 *
 * The update is scoped to rows where `wallet_pubkey IS NULL`, so it is
 * idempotent and never overwrites a wallet set by delegation or signup.
 */

import type {
  LinkedAccountWithMetadata,
  WalletWithMetadata,
} from "@privy-io/react-auth";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db.types";

type Supabase = SupabaseClient<Database>;

/**
 * Solana address of the first wallet account linked to the Privy user
 * (embedded wallets created on login are included), or null when the user
 * has no Solana wallet.
 */
export function solanaWalletAddress(
  linkedAccounts: readonly LinkedAccountWithMetadata[],
): string | null {
  const wallet = linkedAccounts.find(
    (a): a is WalletWithMetadata =>
      a.type === "wallet" && "chainType" in a && a.chainType === "solana",
  );
  return wallet?.address ?? null;
}

export interface BackfillInput {
  user_id: string;
  wallet_pubkey: string;
}

export type BackfillResult =
  | { ok: true; updated: boolean }
  | { ok: false; error: "internal"; detail: string };

/**
 * Set `profiles.wallet_pubkey` for `user_id` when it is still null.
 * @param updated true when a row changed, false when a wallet was already set.
 */
export async function backfillWalletPubkey(
  supabase: Supabase,
  input: BackfillInput,
): Promise<BackfillResult> {
  const now = new Date().toISOString();
  // The typed update builder loses the filter methods; same escape hatch as
  // oauth-token-core's consumed_at CAS. The `.is("wallet_pubkey", null)`
  // guard makes the backfill idempotent and non-overwriting.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error, count } = await (supabase as any)
    .from("profiles")
    .update({ wallet_pubkey: input.wallet_pubkey, updated_at: now }, { count: "exact" })
    .eq("user_id", input.user_id)
    .is("wallet_pubkey", null);
  if (error) return { ok: false, error: "internal", detail: error.message as string };
  return { ok: true, updated: (count ?? 0) > 0 };
}
