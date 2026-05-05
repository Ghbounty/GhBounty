/**
 * GHB-172 — chain-agnostic gas-station contract.
 *
 * The gas station sponsors transaction fees for users with no native
 * gas token (a Privy embedded wallet that has 0 SOL can't even submit
 * a solution; the bounty UX falls apart at the first click). The
 * implementation pattern is per-chain — Solana lets the relayer
 * co-sign as fee payer, EVM uses ERC-4337 paymasters / EIP-2771
 * forwarders — but the contract the frontend talks to is uniform.
 *
 * That uniformity is the whole point of this file. Adding Base / BNB
 * later means writing a new `GasStation` impl that satisfies these
 * types; the route, the frontend client, and the abuse logging all
 * stay identical.
 *
 * No runtime logic lives here. Implementations:
 *   - GHB-173 / GHB-174 — SolanaGasStation
 *   - GHB-178 (deferred) — EvmGasStation via ERC-4337 paymaster
 */

import type { ChainId } from "../chains.js";

/**
 * Solana sponsor payload. The user partial-signs a VersionedTransaction
 * client-side, base64-encodes it, and ships it here. The gas station
 * deserializes it, validates every constraint (single escrow ix, fee
 * payer == us, allowlisted discriminator, fee within budget), then
 * adds its own signature and submits.
 *
 * `partiallySignedTxB64` is the *whole* transaction (header + signers
 * array + message), not just the message. The empty signature slot
 * for the gas-station fee payer is the one we fill.
 */
export interface SolanaSponsorPayload {
  kind: "solana";
  /** Base64-encoded `VersionedTransaction.serialize()` output. */
  partiallySignedTxB64: string;
}

/**
 * Sponsor payloads form a discriminated union over `kind`. We only ship
 * Solana today — the EVM variant lands with GHB-178. Adding a new
 * variant here forces every consumer's switch to be exhaustive again.
 */
export type SponsorPayload = SolanaSponsorPayload;

/**
 * What the frontend posts. `chainId` is the canonical project chain
 * identifier; the payload is whatever shape that chain's gas station
 * expects. The route handler dispatches via `getGasStation(chainId)`.
 */
export interface SponsorRequest {
  chainId: ChainId;
  payload: SponsorPayload;
}

/**
 * What the gas station returns on success. `txHash` is the chain's
 * native transaction identifier (signature on Solana, txhash on EVM).
 * `durationMs` is for ops dashboards — every chain reports this so
 * we can compare wall-clock cost across implementations.
 */
export interface SponsorResult {
  txHash: string;
  durationMs: number;
}

/**
 * Typed error class with a stable `code` string. Code is what the
 * route handler uses to map to HTTP status:
 *   `validator_rejected` → 422
 *   `insufficient_reserve` → 503
 *   `rpc_error` / `not_implemented` / `unsupported_chain` → 500/501
 *
 * Implementations throw `GasStationError` for expected failure modes
 * and bubble unknown errors up unchanged so the route handler logs
 * them as 500s.
 */
export class GasStationError extends Error {
  constructor(
    public readonly code: GasStationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GasStationError";
  }
}

export type GasStationErrorCode =
  | "validator_rejected"
  | "insufficient_reserve"
  | "rpc_error"
  | "not_implemented"
  | "unsupported_chain";

/**
 * The contract every per-chain implementation must satisfy. Stays
 * intentionally narrow — anything chain-specific lives behind the
 * payload union.
 */
export interface GasStation {
  readonly chainId: ChainId;
  sponsor(req: SponsorRequest): Promise<SponsorResult>;
}
