/**
 * GHB-80: Solana client helpers for the bounty escrow program.
 *
 * Exposes pure functions to build the `create_bounty` instruction without
 * signing it. Signing is delegated to the caller (the React layer hands it
 * to Privy's Solana wallet hooks). Keeping this module signing-free makes
 * it trivial to unit-test against fixed inputs.
 *
 * Program: ghbounty_escrow @ CPZx26QXs3HjwGobr8cVAZEtF1qGzqnNbBdt7h1EwbBg
 * PDA seed: ["bounty", creator, bounty_id_LE_u64]
 */
import {
  AnchorProvider,
  BN,
  Program,
  type Wallet,
} from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import idlJson from "./idl/ghbounty_escrow.json";
import type { GhbountyEscrow } from "./idl/ghbounty_escrow";

/** On-chain program ID. Override per-environment via env var. */
export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_GHBOUNTY_PROGRAM_ID ??
    "CPZx26QXs3HjwGobr8cVAZEtF1qGzqnNbBdt7h1EwbBg",
);

export const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.devnet.solana.com";

/**
 * Pubkey of the off-chain scorer (the relayer key that writes scores onto
 * Submission accounts). Required at create time so the program enforces it
 * when the relayer later submits scores.
 */
export const DEFAULT_SCORER = new PublicKey(
  process.env.NEXT_PUBLIC_SCORER_PUBKEY ?? "11111111111111111111111111111111",
);

/**
 * Matches `BOUNTY_SEED` / `SUBMISSION_SEED` in the on-chain `constants.rs`.
 * Built with `TextEncoder` rather than `Buffer.from` — the latter relies on a
 * polyfill that Next.js doesn't ship to the browser by default.
 */
const BOUNTY_SEED = new TextEncoder().encode("bounty");
const SUBMISSION_SEED = new TextEncoder().encode("submission");

export function getConnection(rpc: string = SOLANA_RPC): Connection {
  return new Connection(rpc, "confirmed");
}

/**
 * Encode a u64 as little-endian bytes. Avoids `Buffer.writeBigUInt64LE`,
 * which isn't reliably present in the browser (the Node Buffer polyfill
 * shipped by webpack/Turbopack omits it). `DataView.setBigUint64` is
 * native ES2020 and works the same in Node and the browser.
 */
function u64LE(value: bigint): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigUint64(0, value, /* littleEndian */ true);
  return new Uint8Array(buf);
}

/**
 * Encode a u32 as little-endian bytes. Used for the `submission_count` part
 * of the submission PDA seed (the on-chain field is `u32`, not `u64`).
 */
function u32LE(value: number): Uint8Array {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, value >>> 0, /* littleEndian */ true);
  return new Uint8Array(buf);
}

/**
 * Derive the bounty PDA. Mirrors the program-side check
 *   seeds = [BOUNTY_SEED, creator.key().as_ref(), &bounty_id.to_le_bytes()]
 * so the front-end can compute the address without an RPC roundtrip.
 */
export function findBountyPda(
  creator: PublicKey,
  bountyId: bigint,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BOUNTY_SEED, creator.toBuffer(), u64LE(bountyId)],
    PROGRAM_ID,
  );
}

/**
 * Read-only Anchor wallet stub. Used solely to construct an `AnchorProvider`
 * so we can lean on Anchor's argument coder for `create_bounty`. The stub
 * throws if anything ever asks it to sign — signing always goes through the
 * caller-provided wallet.
 */
function readonlyWallet(): Wallet {
  return {
    publicKey: PublicKey.default,
    signTransaction: async () => {
      throw new Error("readonly wallet — sign through the caller's wallet");
    },
    signAllTransactions: async () => {
      throw new Error("readonly wallet — sign through the caller's wallet");
    },
  } as unknown as Wallet;
}

export function getProgram(
  connection: Connection = getConnection(),
): Program<GhbountyEscrow> {
  const provider = new AnchorProvider(
    connection,
    readonlyWallet(),
    AnchorProvider.defaultOptions(),
  );
  // Anchor 0.30+ wants the IDL typed as the program literal type, not the
  // generic `Idl`. The JSON we ship is structurally identical to the
  // `GhbountyEscrow` type emitted alongside it, so a single cast is safe.
  return new Program<GhbountyEscrow>(
    idlJson as unknown as GhbountyEscrow,
    provider,
  );
}

export type CreateBountyParams = {
  /** Creator (signer) — the company's Solana wallet. */
  creator: PublicKey;
  /** Bounty amount in lamports (or token base units; the contract treats it as raw). */
  amountLamports: bigint;
  /** GitHub issue URL. Max 200 chars (program-enforced). */
  githubIssueUrl: string;
  /** Override the default scorer (e.g. for tests or a per-bounty validator). */
  scorer?: PublicKey;
  /** Override the auto-generated `bounty_id`. Default: `BigInt(Date.now())`. */
  bountyId?: bigint;
};

export type CreateBountyTx = {
  /** Derived PDA where the funds will be locked. */
  bountyPda: PublicKey;
  /** The id used to derive the PDA. Persist alongside the row. */
  bountyId: bigint;
  /** Unsigned instruction. Caller wraps in a `Transaction` and signs+sends. */
  ix: TransactionInstruction;
};

/**
 * Build the `create_bounty` instruction. The caller is responsible for:
 *   1. Wrapping it in a `Transaction` with a recent blockhash.
 *   2. Sending it through the connected wallet (Privy embedded or external).
 *   3. Awaiting confirmation.
 *   4. Persisting `{bountyPda, bountyId, txSig}` via `bounties.insertIssueAndMeta`.
 */
export async function buildCreateBountyIx(
  params: CreateBountyParams,
  connection: Connection = getConnection(),
): Promise<CreateBountyTx> {
  const bountyId = params.bountyId ?? generateBountyId();
  const scorer = params.scorer ?? DEFAULT_SCORER;
  const [bountyPda] = findBountyPda(params.creator, bountyId);

  const program = getProgram(connection);
  const ix = await program.methods
    .createBounty(
      new BN(bountyId.toString()),
      new BN(params.amountLamports.toString()),
      scorer,
      params.githubIssueUrl,
    )
    .accountsStrict({
      creator: params.creator,
      bounty: bountyPda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  return { bountyPda, bountyId, ix };
}

/**
 * Generate a default `bounty_id` from the current timestamp.
 * `Date.now()` is well below 2^53 so it fits comfortably in u64; collisions
 * across creators are impossible (PDA includes the creator pubkey), and a
 * single creator clicking "create" twice within the same millisecond is the
 * kind of edge case the chain rejects with a duplicate PDA error anyway.
 */
function generateBountyId(): bigint {
  return BigInt(Date.now());
}

/* ================================================================
 * GHB-89: submit_solution helpers
 * ================================================================ */

/**
 * Derive the submission PDA. Mirrors the on-chain seeds
 *   seeds = [SUBMISSION_SEED, bounty.key().as_ref(), &bounty.submission_count.to_le_bytes()]
 *
 * `submissionIndex` is the value of `bounty.submission_count` *at the time of
 * the submit* — the program reads it pre-increment when initializing the
 * account, so the caller must fetch the current count and use that exact
 * number. Using the post-increment count yields a different PDA and the
 * `init` constraint on-chain will fail.
 */
export function findSubmissionPda(
  bountyPda: PublicKey,
  submissionIndex: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SUBMISSION_SEED, bountyPda.toBuffer(), u32LE(submissionIndex)],
    PROGRAM_ID,
  );
}

/**
 * Read the on-chain `Bounty` account and return its `submissionCount`.
 * Used to derive the next submission PDA. Returns `null` when the account
 * doesn't exist (the bounty was deleted or the PDA is wrong).
 */
export async function fetchBountySubmissionCount(
  bountyPda: PublicKey,
  connection: Connection = getConnection(),
): Promise<number | null> {
  const program = getProgram(connection);
  try {
    // `program.account.bounty` is camelCase — Anchor strips snake_case at
    // codegen time. The IDL field is `submission_count`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const acc = (await (program.account as any).bounty.fetch(bountyPda)) as {
      submissionCount: number;
    };
    return acc.submissionCount;
  } catch (err) {
    console.warn("[fetchBountySubmissionCount] miss:", err);
    return null;
  }
}

export type SubmitSolutionParams = {
  /** Solver (signer) — the developer's Solana wallet. */
  solver: PublicKey;
  /** PDA of the bounty being solved. Same string we persisted as `issues.pda`. */
  bountyPda: PublicKey;
  /** GitHub PR URL (max 200 chars, program-enforced). */
  prUrl: string;
  /**
   * 32-byte hash of the off-chain Opus report. For manual submissions this is
   * `[0; 32]` — the relayer/scorer fills in the real hash later via the
   * `set_score` flow. Pass an explicit hash when the caller has already run
   * Opus (e.g. preview UI).
   */
  opusReportHash?: Uint8Array;
};

export type SubmitSolutionTx = {
  /** PDA where the submission will live. Persist alongside the row. */
  submissionPda: PublicKey;
  /**
   * The submission index used to derive the PDA. Equal to the bounty's
   * `submission_count` at submit time. Persist as `submissions.submission_index`.
   */
  submissionIndex: number;
  /** Unsigned instruction. Caller wraps in a `Transaction` and signs+sends. */
  ix: TransactionInstruction;
};

/**
 * Build the `submit_solution` instruction. Reads the bounty's current
 * `submission_count` to derive the next submission PDA, then asks Anchor to
 * encode the call. Like `buildCreateBountyIx`, this stays signing-free so the
 * caller (React + Privy hooks) handles the wallet UX.
 *
 * Race note: between `fetchBountySubmissionCount` and the actual on-chain
 * include, another solver could grab the same index and our `init` will
 * fail with "account already exists". We surface that error verbatim — the
 * UI prompts the user to retry, which re-fetches the count.
 */
export async function buildSubmitSolutionIx(
  params: SubmitSolutionParams,
  connection: Connection = getConnection(),
): Promise<SubmitSolutionTx> {
  if (params.prUrl.length > 200) {
    throw new Error(`pr_url too long (${params.prUrl.length} chars, max 200)`);
  }

  const opusReportHash = params.opusReportHash ?? new Uint8Array(32);
  if (opusReportHash.length !== 32) {
    throw new Error(`opus_report_hash must be 32 bytes (got ${opusReportHash.length})`);
  }

  const submissionIndex = await fetchBountySubmissionCount(
    params.bountyPda,
    connection,
  );
  if (submissionIndex == null) {
    throw new Error(
      `Bounty PDA ${params.bountyPda.toBase58()} not found on-chain.`,
    );
  }

  const [submissionPda] = findSubmissionPda(params.bountyPda, submissionIndex);

  const program = getProgram(connection);
  const ix = await program.methods
    .submitSolution(
      params.prUrl,
      Array.from(opusReportHash) as unknown as number[],
    )
    .accountsStrict({
      solver: params.solver,
      bounty: params.bountyPda,
      submission: submissionPda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  return { submissionPda, submissionIndex, ix };
}
