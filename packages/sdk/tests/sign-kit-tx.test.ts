import { describe, it, expect } from "vitest";
import {
  generateKeyPairSigner,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  pipe,
  compileTransaction,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  blockhash,
} from "@solana/kit";
import { signKitTx } from "../src/sign-kit-tx";

describe("signKitTx", () => {
  it("signs a base64-encoded unsigned transaction and returns a base64-encoded signed transaction", async () => {
    const signer = await generateKeyPairSigner();

    const fakeBlockhash = {
      blockhash: blockhash("11111111111111111111111111111111"),
      lastValidBlockHeight: 1n,
    };

    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(signer.address, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(fakeBlockhash, m),
      (m) => appendTransactionMessageInstructions([], m),
    );

    const compiled = compileTransaction(message);
    const unsignedB64 = getBase64EncodedWireTransaction(compiled);

    const signedB64 = await signKitTx(unsignedB64, signer);

    // Must be valid base64
    expect(signedB64).toMatch(/^[A-Za-z0-9+/]+=*$/);

    // Decode and verify the signer's signature is present and non-null
    const decoded = getTransactionDecoder().decode(
      Buffer.from(signedB64, "base64"),
    );
    expect(Object.keys(decoded.signatures)).toContain(signer.address);
    expect(decoded.signatures[signer.address]).not.toBeNull();
  });
});
