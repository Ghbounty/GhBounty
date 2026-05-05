/**
 * Project-wide chain identifiers.
 *
 * The values are the canonical strings stored in the DB (`chains.chain_id`)
 * and read from the relayer config (`CHAIN_ID` env). New chains are added
 * here first — adding a value with no support elsewhere is a compile-time
 * error in the consuming code, which is the point.
 *
 * EVM chains will be added when GHB-178 (EvmGasStation) lands.
 */
export type ChainId = "solana-devnet" | "solana-mainnet";

/**
 * Runtime list of all supported chain ids. Useful for `Set` lookups,
 * `chainId in SUPPORTED_CHAINS` exhaustiveness checks, and tests that
 * iterate over every chain.
 */
export const SUPPORTED_CHAINS: readonly ChainId[] = [
  "solana-devnet",
  "solana-mainnet",
] as const;

export function isSupportedChain(value: string): value is ChainId {
  return (SUPPORTED_CHAINS as readonly string[]).includes(value);
}
