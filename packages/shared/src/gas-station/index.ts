/**
 * GHB-172 — gas-station barrel + chain router.
 *
 * `getGasStation(chainId)` returns the per-chain implementation of the
 * `GasStation` interface. The route handler at
 * `frontend/app/api/gas-station/sponsor/route.ts` calls this with the
 * `chainId` from the request and never has to know about the actual
 * implementation.
 *
 * The `SolanaGasStation` impl ships in GHB-174 but the router stays
 * `not_implemented` for now: it has no way to obtain the runtime
 * deps (keypair + RPC submitter) without leaking knowledge of those
 * deps to every caller. The wiring lands in GHB-175 (the api route),
 * which is the right layer to own boot-time singleton construction.
 * Until then, callers import `SolanaGasStation` directly.
 * Adding EVM (GHB-178) follows the same pattern.
 */

import type { ChainId } from "../chains";
import { GasStation, GasStationError } from "./types";

export function getGasStation(chainId: ChainId): GasStation {
  switch (chainId) {
    case "solana-devnet":
    case "solana-mainnet":
      // Wiring lands in GHB-175 (api route's boot-time DI). Until
      // then, consumers import `SolanaGasStation` directly. Throwing
      // here keeps any accidental router-based caller loud.
      throw new GasStationError(
        "not_implemented",
        `Solana gas station router not wired (GHB-175). Import SolanaGasStation directly. chainId=${chainId}`,
      );
    default: {
      // Exhaustiveness guard. Adding a new ChainId variant in
      // chains.ts without adding a case here is a compile error.
      const _exhaustive: never = chainId;
      throw new GasStationError(
        "unsupported_chain",
        `Unsupported chainId: ${String(_exhaustive)}`,
      );
    }
  }
}

export type {
  GasStation,
  SponsorRequest,
  SponsorResult,
  SponsorPayload,
  SolanaSponsorPayload,
  GasStationErrorCode,
} from "./types";

export { GasStationError } from "./types";

// GHB-174 — Solana implementation. Exposed at the barrel level so
// the route handler in GHB-175 can `new SolanaGasStation({...})`
// directly without going through the chain router. The router
// itself stays `not_implemented` until that wiring lands.
export {
  SolanaGasStation,
  loadGasStationKeypair,
  loadTreasuryKeypair,
  makeConnectionRpcSubmitter,
} from "./solana";
export type {
  SolanaGasStationDeps,
  SolanaRpcSubmitter,
  SponsorLogEntry,
} from "./solana";

// GHB-173 — validator (used by SolanaGasStation but also exported
// for tests / ops scripts that want to dry-run the rules).
export {
  validateSolanaSponsorTx,
  ESCROW_PROGRAM_ID,
  ALLOWED_DISCRIMINATORS_HEX,
  MAX_FEE_LAMPORTS,
  MAX_TOPUP_LAMPORTS,
  MAX_REVIEW_FEE_LAMPORTS,
} from "./solana-validator";
export type {
  ValidateOptions,
  ValidatorResult,
  ValidatorRejectionCode,
} from "./solana-validator";
