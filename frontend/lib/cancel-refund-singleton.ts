/**
 * Module-init singleton for the cancel-refund route deps.
 *
 * Mirrors `gas-station-singleton.ts` but for the cancel-refund flow:
 * loads the treasury keypair, shares the same RPC connection, and
 * reuses the service-role Supabase client.
 *
 * Required env at runtime:
 *   TREASURY_KEYPAIR_JSON | TREASURY_KEYPAIR_PATH
 *   RPC_URL  (defaults to https://api.devnet.solana.com)
 *   SUPABASE_SERVICE_ROLE_KEY + (NEXT_PUBLIC_SUPABASE_URL | SUPABASE_URL)
 */

import { Connection, type Keypair } from "@solana/web3.js";
import { loadTreasuryKeypair } from "@ghbounty/shared";

export interface CancelRefundSingleton {
  treasuryKeypair: Keypair;
  connection: Connection;
}

let cached: CancelRefundSingleton | null = null;

export function getCancelRefundSingleton(): CancelRefundSingleton {
  if (cached) return cached;
  const keypair = loadTreasuryKeypair();
  const rpcUrl = process.env.RPC_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");
  cached = { treasuryKeypair: keypair, connection };
  return cached;
}

/** Test-only escape hatch. Never call from production code. */
export function __resetSingletonForTesting(): void {
  cached = null;
}
