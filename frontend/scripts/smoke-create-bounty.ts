/**
 * Smoke test for `lib/solana.buildCreateBountyIx` end-to-end on devnet.
 *
 * Loads the Solana CLI keypair (`solana config get` → `Keypair Path`),
 * builds a real `create_bounty` instruction via the same helper the
 * frontend uses, signs it, sends it to devnet, and waits for confirmation.
 *
 * Run: `pnpm exec tsx scripts/smoke-create-bounty.ts`
 *
 * Requires:
 *   - Solana CLI with a keypair at ~/.config/solana/<file>.json
 *   - That wallet funded with at least ~0.02 SOL on devnet
 *
 * Does NOT touch Supabase — that path requires a Privy JWT and is exercised
 * end-to-end through the React UI.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { buildCreateBountyIx, getConnection, PROGRAM_ID } from "../lib/solana";

function loadCliKeypair(): Keypair {
  // `solana config get` prints lines like:
  //   Keypair Path: /Users/tom/.config/solana/ghbounty-dev.json
  const out = execSync("solana config get", { encoding: "utf8" });
  const match = out.match(/Keypair Path:\s*(\S+)/);
  if (!match) {
    throw new Error(
      "Could not parse Solana CLI config — run `solana config get` to inspect.",
    );
  }
  let path = match[1];
  if (path.startsWith("~")) path = path.replace("~", homedir());
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const kp = loadCliKeypair();
  console.log("Creator:", kp.publicKey.toBase58());

  const connection: Connection = getConnection();
  const balance = await connection.getBalance(kp.publicKey);
  console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  if (balance < 0.02 * LAMPORTS_PER_SOL) {
    throw new Error(
      "Need at least 0.02 SOL on devnet. Run: solana airdrop 1 --url devnet",
    );
  }

  const amountLamports = BigInt(0.005 * LAMPORTS_PER_SOL);
  const githubIssueUrl =
    "https://github.com/genlayerlabs/genlayer-studio/issues/1609";

  console.log("Building create_bounty instruction…");
  const { ix, bountyPda, bountyId } = await buildCreateBountyIx(
    {
      creator: kp.publicKey,
      amountLamports,
      githubIssueUrl,
    },
    connection,
  );
  console.log(`  bounty_id = ${bountyId}`);
  console.log(`  bounty PDA = ${bountyPda.toBase58()}`);
  console.log(`  program  = ${PROGRAM_ID.toBase58()}`);

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: kp.publicKey,
    recentBlockhash: blockhash,
  }).add(ix);
  tx.sign(kp);

  console.log("Sending…");
  const sig = await connection.sendRawTransaction(tx.serialize());
  console.log(`  txSig = ${sig}`);
  console.log("  encoded =", bs58.encode(bs58.decode(sig))); // sanity round-trip

  console.log("Confirming…");
  const conf = await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (conf.value.err) {
    throw new Error(`tx failed on-chain: ${JSON.stringify(conf.value.err)}`);
  }

  console.log("\n✅ Bounty created on devnet.");
  console.log(`  Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  console.log(`  PDA:      https://explorer.solana.com/address/${bountyPda.toBase58()}?cluster=devnet`);
}

main().catch((err) => {
  console.error("\n❌ FAILED:", err);
  process.exit(1);
});
