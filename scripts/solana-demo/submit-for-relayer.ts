/**
 * Create a bounty + submit a solution, with scorer = ghbounty-dev keypair.
 * The relayer (running in the background with that same keypair) should
 * pick up the submission and write the score automatically.
 *
 * Usage (from this dir):
 *   npm install && npx tsx submit-for-relayer.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import idlJson from "./idl.json" with { type: "json" };

const RPC_URL = "https://api.devnet.solana.com";
const KEYPAIR_PATH = path.join(os.homedir(), ".config/solana/ghbounty-dev.json");
const BOUNTY_AMOUNT = 0.03 * LAMPORTS_PER_SOL;
const BOUNTY_ID = new BN(Date.now());

function loadKeypair(p: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function bountyPda(creator: PublicKey, id: BN, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bounty"), creator.toBuffer(), id.toArrayLike(Buffer, "le", 8)],
    programId,
  );
  return pda;
}

function submissionPda(bounty: PublicKey, idx: number, programId: PublicKey): PublicKey {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(idx, 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("submission"), bounty.toBuffer(), buf],
    programId,
  );
  return pda;
}

async function main(): Promise<void> {
  const conn = new Connection(RPC_URL, "confirmed");
  const creator = loadKeypair(KEYPAIR_PATH);
  const scorer = creator; // relayer uses this same keypair as scorer
  const solver = Keypair.generate();

  console.log(`Creator/Scorer: ${creator.publicKey.toBase58()}`);
  console.log(`Solver:         ${solver.publicKey.toBase58()}`);
  console.log(`Bounty ID:      ${BOUNTY_ID.toString()}\n`);

  // Fund solver with rent + fees.
  const solverBal = await conn.getBalance(solver.publicKey);
  if (solverBal < 0.02 * LAMPORTS_PER_SOL) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: creator.publicKey,
        toPubkey: solver.publicKey,
        lamports: 0.02 * LAMPORTS_PER_SOL,
      }),
    );
    const sig = await conn.sendTransaction(tx, [creator]);
    await conn.confirmTransaction(sig, "confirmed");
    console.log(`  funded solver: ${sig}`);
  }

  const provider = new AnchorProvider(conn, new Wallet(creator), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program(idlJson as anchor.Idl, provider);
  const programId = program.programId;

  const bounty = bountyPda(creator.publicKey, BOUNTY_ID, programId);
  const submission = submissionPda(bounty, 0, programId);

  console.log(`Bounty PDA:     ${bounty.toBase58()}`);
  console.log(`Submission PDA: ${submission.toBase58()}\n`);

  console.log("1. create_bounty (scorer = creator)");
  const methods = program.methods as any;
  const sig1 = await methods
    .createBounty(BOUNTY_ID, new BN(BOUNTY_AMOUNT), scorer.publicKey, "relayer-test")
    .accounts({
      creator: creator.publicKey,
      bounty,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`  ${sig1}`);

  console.log("\n2. submit_solution");
  const hash = new Uint8Array(32).fill(3);
  const sig2 = await methods
    .submitSolution("https://github.com/x/y/pull/42", Array.from(hash))
    .accounts({
      solver: solver.publicKey,
      bounty,
      submission,
      systemProgram: SystemProgram.programId,
    })
    .signers([solver])
    .rpc();
  console.log(`  ${sig2}`);

  console.log("\nWaiting for relayer to pick this up and call set_score...");
  console.log(`Watch: ${submission.toBase58()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
