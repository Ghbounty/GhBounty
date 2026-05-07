import { describe, it, expect } from "vitest";
import {
  generateKeyPairSigner,
  address,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  pipe,
  compileTransaction,
  getBase64EncodedWireTransaction,
  blockhash,
} from "@solana/kit";
import { getInitStakeDepositInstruction } from "../src/generated";

describe("Codama-generated init_stake_deposit builder", () => {
  it("produces a serializable transaction message", async () => {
    const owner = await generateKeyPairSigner();
    // Use a fixed valid stake address so we avoid PDA derivation
    // (GHBOUNTY_ESCROW_PROGRAM_ADDRESS is a placeholder "" in generated code).
    const stakeAddress = address("11111111111111111111111111111111");

    // Pass a mock program address so compileTransaction does not choke on the
    // empty-string GHBOUNTY_ESCROW_PROGRAM_ADDRESS placeholder from the IDL.
    const mockProgramAddress = address("11111111111111111111111111111112");
    const ix = getInitStakeDepositInstruction(
      {
        owner,
        stake: stakeAddress,
        amount: 35_000_000n,
      },
      { programAddress: mockProgramAddress },
    );

    const fakeBlockhash = {
      blockhash: blockhash("11111111111111111111111111111111"),
      lastValidBlockHeight: 1n,
    };

    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(owner.address, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(fakeBlockhash, m),
      (m) => appendTransactionMessageInstructions([ix], m),
    );

    const compiled = compileTransaction(message);
    const wireB64 = getBase64EncodedWireTransaction(compiled);
    expect(wireB64.length).toBeGreaterThan(0);
  });
});
