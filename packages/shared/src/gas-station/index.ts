/**
 * GHB-172 — gas-station barrel + chain router.
 *
 * `getGasStation(chainId)` returns the per-chain implementation of the
 * `GasStation` interface. The route handler at
 * `frontend/app/api/gas-station/sponsor/route.ts` calls this with the
 * `chainId` from the request and never has to know about the actual
 * implementation.
 *
 * Today the router throws `not_implemented` for every chain — the
 * Solana impl ships in GHB-174. Once that lands, the relevant
 * `case` flips to `return new SolanaGasStation(chainId, ...deps)`.
 * Adding EVM (GHB-178) is the same shape: new case, new impl, no
 * caller changes.
 */

import type { ChainId } from "../chains.js";
import { GasStation, GasStationError } from "./types.js";

export function getGasStation(chainId: ChainId): GasStation {
  switch (chainId) {
    case "solana-devnet":
    case "solana-mainnet":
      // Filled by GHB-174. Throwing now keeps the contract honest:
      // any caller that imports getGasStation today is forced to
      // handle the not_implemented path — which they will keep
      // handling once a real impl exists, because RPC failures are
      // a real runtime case anyway.
      throw new GasStationError(
        "not_implemented",
        `Solana gas station not wired yet (GHB-174 fills this). chainId=${chainId}`,
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
} from "./types.js";

export { GasStationError } from "./types.js";
