// packages/sdk/src/sign-kit-tx.ts
//
// Decodes a base64 wire transaction returned by an MCP `prepare_*` tool,
// signs it with the agent's @solana/kit signer, and re-encodes as base64
// for the matching `submit_signed_*` tool.
//
// Why a helper: the protocol is two-step (MCP builds, agent signs). Without
// this wrapper, every consumer would re-implement decode-sign-encode.

import {
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  type KeyPairSigner,
} from "@solana/kit";

/**
 * Sign a base64-encoded transaction.
 *
 * @param unsignedB64 - base64 wire transaction returned by an MCP `prepare_*` tool
 * @param signer - agent's @solana/kit KeyPairSigner
 * @returns base64 wire transaction with the agent's signature attached
 */
export async function signKitTx(
  unsignedB64: string,
  signer: KeyPairSigner,
): Promise<string> {
  const wireBytes = Uint8Array.from(Buffer.from(unsignedB64, "base64"));
  const tx = getTransactionDecoder().decode(wireBytes);
  const signed = await partiallySignTransaction([signer.keyPair], tx);
  const encoded = getTransactionEncoder().encode(signed);
  return Buffer.from(encoded).toString("base64");
}
