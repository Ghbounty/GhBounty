/**
 * GHB-174 — SolanaGasStation devnet smoke test.
 *
 * Runs the full SolanaGasStation pipeline against a live cluster:
 *   1. Build a real `create_bounty` tx (Anchor-shaped data, real PDA).
 *   2. Hand it to SolanaGasStation as a base64 partially-signed tx.
 *   3. The gas station validates → signs → submits → confirms.
 *   4. We check the on-chain balance delta matches expectations.
 *
 * To keep setup minimal, the gas-station is also the bounty creator.
 * That means a single funded keypair is enough: it pays both the
 * 5_000-lamport network fee AND the bounty rent + escrow amount.
 * In production those will be separate parties (gas station = us,
 * creator = a Privy embedded wallet), but the gas-station path
 * exercised here is identical either way: validate, fee_payer-sign,
 * submit, confirm.
 *
 * Required env:
 *   GAS_STATION_KEYPAIR_JSON | GAS_STATION_KEYPAIR_PATH — keypair source
 *   RPC_URL                  — defaults to devnet
 *
 * Run:
 *   pnpm --filter @ghbounty/shared smoke:gas-station
 *
 * Cost per run on devnet: ~0.003 SOL (rent + fee + 1000-lamport escrow).
 * The keypair needs ≥ ~0.005 SOL to be safe; fund with:
 *   solana airdrop 1 <pubkey> --url devnet
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  ESCROW_PROGRAM_ID,
  loadGasStationKeypair,
  makeConnectionRpcSubmitter,
  SolanaGasStation,
} from "../src/gas-station/index.js";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const COMMITMENT = "confirmed" as const;
const MIN_BALANCE_LAMPORTS = 5_000_000; // ~0.005 SOL — covers fee + rent + amount

/**
 * Borsh-encode the create_bounty args. We do this by hand to avoid
 * pulling Anchor's whole runtime into shared/. Layout (from the IDL):
 *   discriminator: [u8; 8]      → "7a5a0e8f087dc802"
 *   bounty_id:     u64 LE
 *   amount:        u64 LE
 *   scorer:        Pubkey (32 bytes)
 *   github_issue_url: string    → u32 LE length + UTF-8 bytes
 */
function encodeCreateBountyData(
  bountyId: bigint,
  amount: bigint,
  scorer: PublicKey,
  issueUrl: string,
): Buffer {
  const disc = Buffer.from("7a5a0e8f087dc802", "hex");
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(bountyId);
  const amtBuf = Buffer.alloc(8);
  amtBuf.writeBigUInt64LE(amount);
  const scorerBuf = Buffer.from(scorer.toBytes());
  const urlBytes = Buffer.from(issueUrl, "utf-8");
  const urlLen = Buffer.alloc(4);
  urlLen.writeUInt32LE(urlBytes.length);
  return Buffer.concat([disc, idBuf, amtBuf, scorerBuf, urlLen, urlBytes]);
}

async function main(): Promise<void> {
  const gasStation = loadGasStationKeypair();
  const connection = new Connection(RPC_URL, COMMITMENT);

  console.log(`gas station: ${gasStation.publicKey.toBase58()}`);
  console.log(`rpc:         ${RPC_URL}\n`);

  const balanceBefore = await connection.getBalance(gasStation.publicKey);
  console.log(
    `balance before: ${balanceBefore} lamports (${(balanceBefore / 1e9).toFixed(6)} SOL)`,
  );
  if (balanceBefore < MIN_BALANCE_LAMPORTS) {
    throw new Error(
      `gas station has only ${balanceBefore} lamports; need at least ${MIN_BALANCE_LAMPORTS}.\n` +
        `  Fund with:  solana airdrop 1 ${gasStation.publicKey.toBase58()} --url devnet`,
    );
  }

  // Unique bounty per run (PDA collision otherwise — `create_bounty`
  // calls `init` which fails if the PDA exists).
  const bountyId = BigInt(Date.now());
  const amount = 1_000n; // tiny escrow — minimizes per-run cost
  const scorer = Keypair.generate().publicKey;
  const issueUrl = `https://github.com/ghbounty/smoke/issues/${bountyId}`;

  // Derive the bounty PDA the same way the program will.
  const idLe = Buffer.alloc(8);
  idLe.writeBigUInt64LE(bountyId);
  const [bountyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bounty"), gasStation.publicKey.toBytes(), idLe],
    ESCROW_PROGRAM_ID,
  );

  const ix = new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      // creator — gas station here, doubles up as fee_payer
      { pubkey: gasStation.publicKey, isSigner: true, isWritable: true },
      // bounty PDA — init'd by the program
      { pubkey: bountyPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeCreateBountyData(bountyId, amount, scorer, issueUrl),
  });

  const blockhash = (await connection.getLatestBlockhash(COMMITMENT)).blockhash;
  const msg = new TransactionMessage({
    payerKey: gasStation.publicKey,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message();
  const txB64 = Buffer.from(new VersionedTransaction(msg).serialize()).toString(
    "base64",
  );

  console.log(
    `\nbuilt create_bounty(id=${bountyId}, amount=${amount} lamports)`,
  );
  console.log(`bounty pda:  ${bountyPda.toBase58()}`);
  console.log(`scorer:      ${scorer.toBase58()}`);

  const station = new SolanaGasStation({
    chainId: "solana-devnet",
    keypair: gasStation,
    rpc: makeConnectionRpcSubmitter(connection, COMMITMENT),
  });

  console.log(`\nsponsoring tx through SolanaGasStation...`);
  const result = await station.sponsor({
    chainId: "solana-devnet",
    payload: { kind: "solana", partiallySignedTxB64: txB64 },
  });

  console.log(`\n✓ tx confirmed: ${result.txHash}`);
  console.log(
    `  explorer:     https://explorer.solana.com/tx/${result.txHash}?cluster=devnet`,
  );
  console.log(`  duration:     ${result.durationMs}ms`);

  const balanceAfter = await connection.getBalance(gasStation.publicKey);
  const spent = balanceBefore - balanceAfter;
  console.log(
    `\nbalance after:  ${balanceAfter} lamports (${(balanceAfter / 1e9).toFixed(6)} SOL)`,
  );
  console.log(
    `total spent:    ${spent} lamports (${(spent / 1e9).toFixed(6)} SOL)`,
  );
  console.log(`  base fee:      5_000 lamports`);
  console.log(`  escrow amt:    ${amount} lamports (transferred to bounty PDA)`);
  console.log(
    `  bounty rent:   ~${spent - 5_000 - Number(amount)} lamports (PDA init)`,
  );
}

main().catch((err) => {
  console.error("\n✗ smoke failed:", err);
  process.exit(1);
});
