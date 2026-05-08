/**
 * GHB-176 — frontend client for the gas-station route.
 *
 * `submitSponsored(args)` is the single entry point used by the four
 * user-initiated escrow flows (`create_bounty`, `submit_solution`,
 * `resolve_bounty`, `cancel_bounty`). It hides the partial-sign +
 * server-side-submit dance behind a Promise<{ txHash }> so callers
 * read like the legacy direct-send code.
 *
 * Pipeline (per call):
 *   1. Build a VersionedTransaction with `feePayer = GAS_STATION_PUBKEY`
 *      (NOT the user's wallet — the gas station pays the fee).
 *   2. Ask Privy's `useSignTransaction` to partial-sign — fills the
 *      user's signature slots, leaves slot 0 (fee payer) empty.
 *   3. Base64-encode the partially-signed bytes.
 *   4. Get the user's Privy access token via `getAccessToken()`.
 *   5. POST to `/api/gas-station/sponsor` with the token in
 *      `Authorization: Bearer ...` and the b64 tx in the body.
 *   6. Return `{ txHash }` on 200; throw `GasStationClientError` on
 *      anything else.
 *
 * Legacy mode: when `NEXT_PUBLIC_GAS_STATION_PUBKEY` is unset, the
 * `GAS_STATION_ENABLED` flag is false and callers are expected to
 * fall back to direct sign+send. This file does NOT throw at module
 * load — local devs without the env still load components fine.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";

/**
 * Privy's `SolanaChain` is a CAIP-2-flavoured string literal union but
 * it's not exported from `@privy-io/react-auth/solana`. We re-declare
 * the variants we actually use; an unrecognised chain would be caught
 * at the Privy hook boundary anyway.
 */
type SolanaChain = `solana:${"devnet" | "mainnet" | "testnet"}`;

// ── env-driven config ────────────────────────────────────────────────

const PUBKEY_ENV = process.env.NEXT_PUBLIC_GAS_STATION_PUBKEY?.trim();

/**
 * The gas-station's public key. Null when the feature is disabled (no
 * env var). Components MUST gate on `GAS_STATION_ENABLED` before
 * calling `submitSponsored`.
 */
export const GAS_STATION_PUBKEY: PublicKey | null = PUBKEY_ENV
  ? new PublicKey(PUBKEY_ENV)
  : null;

export const GAS_STATION_ENABLED = GAS_STATION_PUBKEY !== null;

const TREASURY_PUBKEY_ENV = process.env.NEXT_PUBLIC_TREASURY_PUBKEY?.trim();

/**
 * The review-fee treasury pubkey. Null when the review-fee feature is
 * disabled (env unset). Components compute a SystemProgram.transfer
 * to this address when creating a bounty; the server validates that
 * the destination matches its own configured treasury.
 */
export const TREASURY_PUBKEY: PublicKey | null = TREASURY_PUBKEY_ENV
  ? new PublicKey(TREASURY_PUBKEY_ENV)
  : null;

export const REVIEW_FEE_ENABLED = TREASURY_PUBKEY !== null;

type SponsoredChainId = "solana-devnet" | "solana-mainnet";

const CHAIN_ID_ENV = process.env.NEXT_PUBLIC_GAS_STATION_CHAIN_ID?.trim();

/**
 * Chain id sent in the route body. Defaults to `solana-devnet`. Set
 * `NEXT_PUBLIC_GAS_STATION_CHAIN_ID=solana-mainnet` once we ship.
 */
export const GAS_STATION_CHAIN_ID: SponsoredChainId =
  CHAIN_ID_ENV === "solana-mainnet" ? "solana-mainnet" : "solana-devnet";

const PRIVY_CHAIN: SolanaChain =
  GAS_STATION_CHAIN_ID === "solana-mainnet"
    ? "solana:mainnet"
    : "solana:devnet";

// ── error type ───────────────────────────────────────────────────────

/**
 * Thrown by `submitSponsored` for any non-200 response. Carries the
 * HTTP status (so callers can branch on 503 vs 422 etc.) and the
 * `reason` field from the route body when present (validator-rejected
 * reasons get surfaced verbatim so the dev console / UI can show them).
 */
export class GasStationClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly reason: string | null,
    message: string,
  ) {
    super(message);
    this.name = "GasStationClientError";
  }
}

// ── public API ───────────────────────────────────────────────────────

export type SignTransactionFn = (input: {
  transaction: Uint8Array;
  wallet: ConnectedStandardSolanaWallet;
  chain?: SolanaChain;
}) => Promise<{ signedTransaction: Uint8Array }>;

export interface SubmitSponsoredArgs {
  /** The unsigned escrow instruction. */
  ix: TransactionInstruction;
  /** User's Privy wallet for partial-signing. */
  wallet: ConnectedStandardSolanaWallet;
  /** From `useSignTransaction()` — partial-signs without sending. */
  signTransaction: SignTransactionFn;
  /** From `usePrivy().getAccessToken` — returns the Privy JWT. */
  getAccessToken: () => Promise<string | null>;
  /** Used only for `getLatestBlockhash`. */
  connection: Connection;
  /**
   * GHB-180 — bundle a `SystemProgram.transfer(gas_station → user, n)`
   * before the escrow ix so a 0-SOL Privy wallet can pay rent for an
   * `init`'d PDA (Bounty for create_bounty, Submission for
   * submit_solution). Pass `undefined` when no rent is needed
   * (cancel_bounty, resolve_bounty).
   *
   * The amount must be ≤ MAX_TOPUP_LAMPORTS server-side, otherwise
   * the route returns 422 `topup_transfer_invalid`.
   */
  topupLamports?: number;
  /**
   * Bundle a `SystemProgram.transfer(user → treasury, n)` immediately
   * after the topup so the user pays the upfront review fee in the
   * same atomic tx as `create_bounty`. Only valid alongside
   * `create_bounty`; the validator rejects review-fee transfers next
   * to other escrow ixs by virtue of "exactly one escrow ix" + the
   * review-fee discriminator never being a sibling shape.
   *
   * Requires `TREASURY_PUBKEY` to be configured (or `treasuryPubkey`
   * passed explicitly). The amount must be ≤ MAX_REVIEW_FEE_LAMPORTS
   * server-side.
   */
  reviewFeeLamports?: number;
  /**
   * Override the gas-station pubkey (tests). Defaults to the module
   * env-derived constant.
   */
  gasStationPubkey?: PublicKey;
  /**
   * Override the treasury pubkey (tests). Defaults to the module
   * env-derived constant. Required only when `reviewFeeLamports > 0`.
   */
  treasuryPubkey?: PublicKey;
  /** Override the chain id (tests). Defaults to env-derived constant. */
  chainId?: SponsoredChainId;
  /** Override `fetch` (tests). Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Override the Privy chain string (tests). */
  privyChain?: SolanaChain;
}

export interface SubmitSponsoredResult {
  txHash: string;
}

export async function submitSponsored(
  args: SubmitSponsoredArgs,
): Promise<SubmitSponsoredResult> {
  const gasStationPubkey = args.gasStationPubkey ?? GAS_STATION_PUBKEY;
  if (!gasStationPubkey) {
    throw new GasStationClientError(
      500,
      null,
      "gas station not configured (NEXT_PUBLIC_GAS_STATION_PUBKEY missing)",
    );
  }
  const chainId = args.chainId ?? GAS_STATION_CHAIN_ID;
  const privyChain = args.privyChain ?? PRIVY_CHAIN;
  const fetchFn = args.fetchImpl ?? fetch;

  // 1. Build the unsigned VersionedTransaction. Fee payer must be the
  //    gas station — the validator on the server checks `staticAccountKeys[0]`.
  //    GHB-180: optionally prepend a SystemProgram.transfer that
  //    funds the user's wallet so it can pay rent for an init'd PDA.
  const { blockhash } = await args.connection.getLatestBlockhash("confirmed");
  const instructions: TransactionInstruction[] = [];

  // Resolve the user pubkey once — both topup and review-fee transfers
  // need it (topup as dest, review fee as source).
  let userPubkey: PublicKey | null = null;
  const needsUserPubkey =
    (args.topupLamports !== undefined && args.topupLamports > 0) ||
    (args.reviewFeeLamports !== undefined && args.reviewFeeLamports > 0);
  if (needsUserPubkey) {
    try {
      userPubkey = new PublicKey(args.wallet.address);
    } catch (err) {
      throw new GasStationClientError(
        500,
        null,
        `wallet.address is not a valid pubkey: ${(err as Error).message}`,
      );
    }
  }

  if (args.topupLamports !== undefined && args.topupLamports > 0) {
    if (!Number.isFinite(args.topupLamports) || !Number.isInteger(args.topupLamports)) {
      throw new GasStationClientError(
        500,
        null,
        `topupLamports must be a non-negative integer, got: ${args.topupLamports}`,
      );
    }
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: gasStationPubkey,
        toPubkey: userPubkey!,
        lamports: args.topupLamports,
      }),
    );
  }

  // Review fee: user → treasury. Goes AFTER topup (so the user has
  // funded balance before the transfer fires) and BEFORE the escrow ix
  // (so create_bounty's atomicity covers both).
  if (args.reviewFeeLamports !== undefined && args.reviewFeeLamports > 0) {
    if (
      !Number.isFinite(args.reviewFeeLamports) ||
      !Number.isInteger(args.reviewFeeLamports)
    ) {
      throw new GasStationClientError(
        500,
        null,
        `reviewFeeLamports must be a non-negative integer, got: ${args.reviewFeeLamports}`,
      );
    }
    const treasury = args.treasuryPubkey ?? TREASURY_PUBKEY;
    if (!treasury) {
      throw new GasStationClientError(
        500,
        null,
        "review fee not configured: NEXT_PUBLIC_TREASURY_PUBKEY missing",
      );
    }
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: userPubkey!,
        toPubkey: treasury,
        lamports: args.reviewFeeLamports,
      }),
    );
  }

  instructions.push(args.ix);

  const message = new TransactionMessage({
    payerKey: gasStationPubkey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const unsignedBytes = tx.serialize();

  // 2. Partial-sign via Privy. The wallet fills only its own signer
  //    slot — slot 0 (fee payer = gas station) stays empty for the
  //    server to fill.
  const { signedTransaction } = await args.signTransaction({
    transaction: unsignedBytes,
    wallet: args.wallet,
    chain: privyChain,
  });

  // 3. Auth + 4. POST.
  const accessToken = await args.getAccessToken();
  if (!accessToken) {
    throw new GasStationClientError(
      401,
      null,
      "Privy access token not available — sign in again",
    );
  }

  const response = await fetchFn("/api/gas-station/sponsor", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      chainId,
      payload: {
        kind: "solana",
        partiallySignedTxB64: bytesToBase64(signedTransaction),
      },
    }),
  });

  // Body may not parse as JSON on weird errors (e.g. proxy HTML). Be
  // defensive — keep the empty default so we still produce a useful
  // GasStationClientError below.
  let body: { txHash?: string; error?: string; reason?: string } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // ignore — `body` stays empty
  }

  if (!response.ok) {
    throw new GasStationClientError(
      response.status,
      body.reason ?? null,
      body.error ?? `gas station returned HTTP ${response.status}`,
    );
  }
  if (!body.txHash || typeof body.txHash !== "string") {
    throw new GasStationClientError(
      500,
      null,
      "gas station response missing txHash",
    );
  }
  return { txHash: body.txHash };
}

/**
 * Map a `submitSponsored` failure to a user-visible string. Centralised
 * so every modal that calls the helper shows consistent copy.
 */
export function formatGasStationError(err: unknown): string {
  if (err instanceof GasStationClientError) {
    if (err.status === 503) {
      return "Sponsorship is temporarily unavailable. Please try again later.";
    }
    if (err.status === 422) {
      return err.reason
        ? `Transaction rejected by gas station: ${err.reason}.`
        : "Transaction rejected by gas station.";
    }
    if (err.status === 401) {
      return "Authentication expired. Please sign in again.";
    }
    if (err.status >= 500) {
      return "Gas station error. Please try again.";
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

// ── helpers ──────────────────────────────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  // Browser-safe encoding. `btoa` accepts a string of binary chars,
  // not bytes — chunk-build to dodge the "argument string too long"
  // perf cliff some browsers hit on very large strings (a Solana tx
  // is far below that, but still).
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }
  return btoa(bin);
}
