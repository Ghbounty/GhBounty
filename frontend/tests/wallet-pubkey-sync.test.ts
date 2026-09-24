/**
 * GHB-167 — tests for `lib/wallet-pubkey-sync.ts`.
 *
 * Covers backfillWalletPubkey(supabase, input):
 *   - updates the row and reports updated:true when wallet was null
 *   - reports updated:false when a wallet was already set (no overwrite)
 *   - scopes the update to user_id + wallet_pubkey IS NULL
 *   - surfaces supabase errors as { ok:false, error:"internal" }
 *
 * Hand-rolled Supabase mocks, same pattern as agent-delegation-route-core.test.ts.
 */

import { describe, expect, test, vi } from "vitest";
import { backfillWalletPubkey, solanaWalletAddress } from "@/lib/wallet-pubkey-sync";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db.types";

const USER_ID = "did:privy:test_user";
const WALLET = "BPFLoaderUpgradeab1e11111111111111111111111";

type Chain = Record<string, unknown> & { then?: never };

function mockSupabase(result: { count?: number | null; error?: { message: string } }) {
  const chain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    // Terminal link in the chain — resolves the PostgrestBuilder result.
    is: vi.fn().mockResolvedValue(result),
  } as unknown as Chain;
  return { from: vi.fn().mockReturnValue(chain), chain };
}

describe("solanaWalletAddress", () => {
  test("returns the address of the linked solana wallet", () => {
    const accounts = [
      { type: "email", address: "a@b.c" },
      { type: "wallet", chainType: "ethereum", address: "0xabc" },
      { type: "wallet", chainType: "solana", address: WALLET },
    ] as never[];
    expect(solanaWalletAddress(accounts)).toBe(WALLET);
  });

  test("returns null when no solana wallet is linked", () => {
    const accounts = [
      { type: "email", address: "a@b.c" },
      { type: "wallet", chainType: "ethereum", address: "0xabc" },
    ] as never[];
    expect(solanaWalletAddress(accounts)).toBeNull();
    expect(solanaWalletAddress([])).toBeNull();
  });
});

describe("backfillWalletPubkey", () => {
  test("reports updated:true when the null wallet row is updated", async () => {
    const supabase = mockSupabase({ count: 1 });
    const result = await backfillWalletPubkey(
      supabase as unknown as SupabaseClient<Database>,
      { user_id: USER_ID, wallet_pubkey: WALLET },
    );
    expect(result).toEqual({ ok: true, updated: true });
  });

  test("reports updated:false when a wallet already existed", async () => {
    const supabase = mockSupabase({ count: 0 });
    const result = await backfillWalletPubkey(
      supabase as unknown as SupabaseClient<Database>,
      { user_id: USER_ID, wallet_pubkey: WALLET },
    );
    expect(result).toEqual({ ok: true, updated: false });
  });

  test("scopes the update to user_id and null wallet_pubkey", async () => {
    const supabase = mockSupabase({ count: 1 });
    await backfillWalletPubkey(supabase as unknown as SupabaseClient<Database>, {
      user_id: USER_ID,
      wallet_pubkey: WALLET,
    });
    expect(supabase.from).toHaveBeenCalledWith("profiles");
    expect(supabase.chain.update).toHaveBeenCalledWith(
      {
        wallet_pubkey: WALLET,
        updated_at: expect.any(String),
      },
      { count: "exact" },
    );
    expect(supabase.chain.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(supabase.chain.is).toHaveBeenCalledWith("wallet_pubkey", null);
  });

  test("returns internal error when supabase fails", async () => {
    const supabase = mockSupabase({ count: null, error: { message: "rls denied" } });
    const result = await backfillWalletPubkey(
      supabase as unknown as SupabaseClient<Database>,
      { user_id: USER_ID, wallet_pubkey: WALLET },
    );
    expect(result).toEqual({ ok: false, error: "internal", detail: "rls denied" });
  });
});
