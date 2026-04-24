import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import idlJson from "./idl.json" with { type: "json" };
import { log } from "./logger.js";

export interface ScorerClient {
  setScore(bounty: PublicKey, submission: PublicKey, score: number): Promise<string>;
  getProgramId(): PublicKey;
  getProgram(): Program;
}

export function createScorerClient(
  connection: Connection,
  scorerKeypair: Keypair,
  programId: PublicKey,
): ScorerClient {
  const provider = new AnchorProvider(connection, new Wallet(scorerKeypair), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const idl = { ...(idlJson as anchor.Idl), address: programId.toBase58() };
  const program = new Program(idl, provider);

  return {
    getProgramId: () => program.programId,
    getProgram: () => program,
    async setScore(bounty, submission, score) {
      const methods = program.methods as any;
      const sig = await methods
        .setScore(score)
        .accounts({
          scorer: scorerKeypair.publicKey,
          bounty,
          submission,
        })
        .rpc();
      log.info("set_score confirmed", {
        submission: submission.toBase58(),
        score,
        sig,
      });
      return sig;
    },
  };
}
