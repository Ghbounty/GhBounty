/**
 * GHB-175 — module-init singleton for the SolanaGasStation.
 *
 * Lazy on purpose: tests of `gas-station-route-core.ts` never touch
 * this file (they construct their own gas station with a stub RPC),
 * so importing the route file in unit tests doesn't crash on missing
 * env vars. Production calls `getSolanaSingleton()` on the first
 * request and reuses the result.
 *
 * `chainId` defaults to `solana-devnet`. Set `CHAIN_ID` in the env
 * to flip to `solana-mainnet` once we're ready.
 *
 * Required env at runtime:
 *   GAS_STATION_KEYPAIR_JSON | GAS_STATION_KEYPAIR_PATH
 *   RPC_URL  (defaults to https://api.devnet.solana.com)
 *
 * Optional:
 *   GAS_STATION_MIN_RESERVE_LAMPORTS  (default 50_000)
 *   GAS_STATION_CONFIRM_TIMEOUT_MS    (default 60_000)
 */

import { Connection, type PublicKey } from "@solana/web3.js";
import {
  loadGasStationKeypair,
  makeConnectionRpcSubmitter,
  SolanaGasStation,
} from "@ghbounty/shared";
import type { ChainId } from "@ghbounty/shared";

export interface SolanaSingleton {
  station: SolanaGasStation;
  connection: Connection;
  publicKey: PublicKey;
  minReserveLamports: number;
}

let cached: SolanaSingleton | null = null;

/**
 * Build (or return the cached) Solana gas-station singleton. Throws
 * if env config is missing or invalid — that surfaces at the route
 * boundary as a 500.
 */
export function getSolanaSingleton(): SolanaSingleton {
  if (cached) return cached;

  const keypair = loadGasStationKeypair();
  const rpcUrl = process.env.RPC_URL || "https://api.devnet.solana.com";
  const chainId = (process.env.CHAIN_ID as ChainId) || "solana-devnet";
  if (chainId !== "solana-devnet" && chainId !== "solana-mainnet") {
    throw new Error(
      `Unsupported CHAIN_ID for SolanaGasStation: ${String(chainId)}`,
    );
  }

  const minReserveLamports = parseIntEnv(
    "GAS_STATION_MIN_RESERVE_LAMPORTS",
    50_000,
  );
  const confirmTimeoutMs = parseIntEnv(
    "GAS_STATION_CONFIRM_TIMEOUT_MS",
    60_000,
  );

  const connection = new Connection(rpcUrl, "confirmed");
  const rpc = makeConnectionRpcSubmitter(connection, "confirmed");
  const station = new SolanaGasStation({
    chainId,
    keypair,
    rpc,
    confirmTimeoutMs,
  });

  cached = {
    station,
    connection,
    publicKey: keypair.publicKey,
    minReserveLamports,
  };
  return cached;
}

/**
 * Test-only escape hatch. Never call from production code.
 */
export function __resetSingletonForTesting(): void {
  cached = null;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`${name} must be a non-negative integer, got: ${raw}`);
  }
  return n;
}
