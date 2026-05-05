/**
 * GHB-180 — true 0-SOL user smoke test against devnet.
 *
 * Demonstrates the full sponsored flow with a freshly-generated user
 * keypair that has NEVER held SOL. The gas station pays:
 *   - the network fee (5_000 lamports)
 *   - the rent for the new Bounty PDA (~2.5M lamports)
 *   - the bounty escrow amount itself (1_000 lamports here for the
 *     smoke; in production the company wallet usually funds this
 *     part out of its own balance)
 *
 * Pipeline (per run):
 *   1. Generate a throwaway user keypair (0 SOL).
 *   2. Build [transfer(gas → user, topup), create_bounty(creator=user)].
 *   3. User partial-signs (their slot only) using the local secret —
 *      mirrors what Privy does in the browser.
 *   4. Hand the b64 tx to SolanaGasStation, which validates, signs as
 *      fee payer (slot 0), submits, and confirms.
 *   5. Verify on-chain: tx confirmed, gas-station balance dropped,
 *      user wallet ends with (topup - rent - amount) lamports.
 *
 * Required env:
 *   GAS_STATION_KEYPAIR_JSON | GAS_STATION_KEYPAIR_PATH — keypair source
 *   RPC_URL                  — defaults to devnet
 *
 * Run:
 *   pnpm --filter @ghbounty/shared smoke:gas-station
 *
 * Cost per run on devnet: ~3M lamports (~0.003 SOL). The keypair
 * needs ≥ ~0.005 SOL to be safe.
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
} from "../src/gas-station/index";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const COMMITMENT = "confirmed" as const;
const MIN_BALANCE_LAMPORTS = 5_000_000; // ~0.005 SOL — covers fee + topup + amount
// Bounty PDA rent on devnet is ~3.47M lamports + the escrow amount
// (1_000 in this smoke) needs to flow from user → bounty too. We
// over-fund by ~50% so the smoke is robust to small rent epoch
// fluctuations. The leftover stays in the throwaway user wallet.
const TOPUP_LAMPORTS = 5_000_000; // ~0.005 SOL

/**
 * Borsh-encode the create_bounty args. Hand-rolled to avoid pulling
 * Anchor's runtime into shared/.
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
  const user = Keypair.generate(); // FRESH — never held SOL
  const connection = new Connection(RPC_URL, COMMITMENT);

  console.log(`gas station: ${gasStation.publicKey.toBase58()}`);
  console.log(`user (new):  ${user.publicKey.toBase58()}`);
  console.log(`rpc:         ${RPC_URL}\n`);

  const gasBefore = await connection.getBalance(gasStation.publicKey);
  console.log(
    `gas station balance: ${gasBefore} lamports (${(gasBefore / 1e9).toFixed(6)} SOL)`,
  );
  if (gasBefore < MIN_BALANCE_LAMPORTS) {
    throw new Error(
      `gas station has only ${gasBefore} lamports; need at least ${MIN_BALANCE_LAMPORTS}.`,
    );
  }
  const userBefore = await connection.getBalance(user.publicKey);
  console.log(
    `user balance:        ${userBefore} lamports (${(userBefore / 1e9).toFixed(6)} SOL — should be 0)`,
  );
  if (userBefore !== 0) {
    console.warn("(user keypair was funded somehow — smoke still proceeds)");
  }

  // Build create_bounty args.
  const bountyId = BigInt(Date.now());
  const amount = 1_000n;
  const scorer = Keypair.generate().publicKey;
  const issueUrl = `https://github.com/ghbounty/smoke/issues/${bountyId}`;

  // Bounty PDA = ["bounty", creator, bounty_id_le].
  const idLe = Buffer.alloc(8);
  idLe.writeBigUInt64LE(bountyId);
  const [bountyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bounty"), user.publicKey.toBytes(), idLe],
    ESCROW_PROGRAM_ID,
  );

  // Ix #1: gas_station → user topup. The validator on the server
  // checks source == fee_payer (== gas station) AND dest is a
  // non-fee-payer signer (== user, since they sign the create_bounty).
  const topupIx = SystemProgram.transfer({
    fromPubkey: gasStation.publicKey,
    toPubkey: user.publicKey,
    lamports: TOPUP_LAMPORTS,
  });

  // Ix #2: create_bounty with creator = user.
  const createIx = new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      { pubkey: user.publicKey, isSigner: true, isWritable: true },
      { pubkey: bountyPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeCreateBountyData(bountyId, amount, scorer, issueUrl),
  });

  const blockhash = (await connection.getLatestBlockhash(COMMITMENT)).blockhash;
  const msg = new TransactionMessage({
    payerKey: gasStation.publicKey,
    recentBlockhash: blockhash,
    instructions: [topupIx, createIx],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);

  // User partial-signs FIRST (their slot only). The gas station
  // signs slot 0 inside SolanaGasStation. `tx.sign([user])` only
  // touches slots whose pubkey matches the user — slot 0 stays empty.
  tx.sign([user]);

  const txB64 = Buffer.from(tx.serialize()).toString("base64");

  console.log(`\nbuilt [topup(${TOPUP_LAMPORTS}), create_bounty(id=${bountyId}, amount=${amount})]`);
  console.log(`bounty pda:  ${bountyPda.toBase58()}`);

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

  const gasAfter = await connection.getBalance(gasStation.publicKey);
  const userAfter = await connection.getBalance(user.publicKey);
  const gasSpent = gasBefore - gasAfter;
  console.log(`\ngas station balance after: ${gasAfter} lamports`);
  console.log(`gas station spent:         ${gasSpent} lamports (${(gasSpent / 1e9).toFixed(6)} SOL)`);
  console.log(`  fee:                     5_000 lamports`);
  console.log(`  topup→user:              ${TOPUP_LAMPORTS} lamports`);
  console.log(`\nuser balance after: ${userAfter} lamports (${(userAfter / 1e9).toFixed(6)} SOL)`);
  console.log(`  = topup ${TOPUP_LAMPORTS} - rent for Bounty PDA - ${amount} escrow amount`);
  console.log(`\n✓ proved: a 0-SOL user wallet successfully created a bounty via the gas station.`);
}

main().catch((err) => {
  console.error("\n✗ smoke failed:", err);
  process.exit(1);
});
