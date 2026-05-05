/**
 * GHB-173 — Solana sponsor-tx validator.
 *
 * Runs server-side BEFORE we sign anything with the gas-station
 * keypair. The job: decide whether the partially-signed tx the user
 * sent is something we're willing to pay fees for, and reject every
 * shape we haven't explicitly opted into.
 *
 * The validator NEVER throws on bad input. It returns a discriminated
 * union (`{ ok: true, ...meta }` / `{ ok: false, code, reason }`) so
 * the caller maps to HTTP 422 with a clean error body.
 *
 * Hard rules (each = a dedicated rejection code):
 *   - Fee payer == GAS_STATION_PUBKEY (otherwise the gas station has
 *     no business signing).
 *   - Exactly 1 instruction targeting ESCROW_PROGRAM_ID. Compute-budget
 *     instructions (limit + price) are allowed alongside; anything
 *     else is rejected.
 *   - Escrow ix discriminator (first 8 bytes of data) is in
 *     `ALLOWED_DISCRIMINATORS`.
 *   - Estimated fee (base + priority) ≤ `MAX_FEE_LAMPORTS`.
 */

import {
  PublicKey,
  VersionedTransaction,
  ComputeBudgetProgram,
  SystemProgram,
} from "@solana/web3.js";

/**
 * The Solana program we sponsor calls into. Keep in sync with the
 * relayer's `PROGRAM_ID` env (`relayer/.env.example`).
 */
export const ESCROW_PROGRAM_ID = new PublicKey(
  "CPZx26QXs3HjwGobr8cVAZEtF1qGzqnNbBdt7h1EwbBg",
);

/**
 * Anchor instruction discriminators (first 8 bytes of `ix.data`)
 * for the user-initiated escrow ixs we sponsor. Sourced from the
 * compiled IDL at `frontend/lib/idl/ghbounty_escrow.json`. If the
 * program ever rebuilds with renamed ixs, regenerate these by
 * snapshotting the IDL — discriminators change with the name.
 *
 * `set_score` is intentionally NOT in this list — that ix is signed
 * by the relayer's scorer keypair, not via gas-station sponsorship.
 */
export const ALLOWED_DISCRIMINATORS_HEX: ReadonlySet<string> = new Set([
  "7a5a0e8f087dc802", // create_bounty   (company)
  "cbe99dbf4625cd00", // submit_solution (dev)
  "cf2b5deedeb84fdb", // resolve_bounty  (company picks winner / payout)
  "4f416b8f80a5872e", // cancel_bounty   (company)
]);

/**
 * Per-tx fee budget. 50_000 lamports ≈ 0.00005 SOL ≈ \$0.01 at \$200/SOL.
 * Generous enough for a single ix + priority bump; tight enough that a
 * single drained gas-station wallet can sponsor thousands of txs before
 * needing a refill.
 */
export const MAX_FEE_LAMPORTS = 50_000;

/**
 * GHB-180 — per-tx cap on the optional rent-topup transfer that
 * funds a 0-SOL user wallet so it can pay rent for a freshly-init'd
 * PDA (Bounty / Submission). 50_000_000 lamports = 0.05 SOL —
 * generous (rent for either struct is < 0.003 SOL) but bounded so
 * a single malicious tx can't drain the gas-station wallet at once.
 *
 * Total drainage is still capped by `getBalanceLamports() <
 * minReserveLamports` in the route + the wallet balance itself, so
 * worst case is `wallet_balance / MAX_TOPUP_LAMPORTS` malicious
 * txs before sponsorship halts.
 */
export const MAX_TOPUP_LAMPORTS = 50_000_000;

/** Base signature fee on Solana (mainnet + devnet, unchanged for years). */
const BASE_FEE_LAMPORTS_PER_SIGNATURE = 5_000;

/** ComputeBudget program ID — public constant on Solana. */
const COMPUTE_BUDGET_PROGRAM_ID = ComputeBudgetProgram.programId;
/** System program ID — public constant on Solana. */
const SYSTEM_PROGRAM_ID = SystemProgram.programId;
/** SystemProgram.Transfer ix discriminator (u32 LE). */
const SYSTEM_TRANSFER_DISC = 2;
/** SystemProgram.Transfer ix data length: 4-byte disc + 8-byte u64 lamports. */
const SYSTEM_TRANSFER_DATA_LEN = 12;

/** Discriminator (first byte of ix data) for SetComputeUnitLimit. */
const COMPUTE_LIMIT_DISC = 0x02;
/** Discriminator (first byte of ix data) for SetComputeUnitPrice. */
const COMPUTE_PRICE_DISC = 0x03;

export type ValidatorRejectionCode =
  | "tx_decode_failed"
  | "no_instructions"
  | "wrong_fee_payer"
  | "extra_unknown_instruction"
  | "no_escrow_instruction"
  | "multiple_escrow_instructions"
  | "wrong_program_id"
  | "missing_discriminator"
  | "disallowed_discriminator"
  | "fee_exceeds_cap"
  | "topup_transfer_invalid"
  | "multiple_topup_transfers";

export type ValidatorResult =
  | {
      ok: true;
      /** Hex string (16 chars) of the matched escrow discriminator. */
      discriminatorHex: string;
      /** Estimated fee in lamports (base × signers + priority). */
      estimatedFeeLamports: number;
      /**
       * GHB-180 — lamports moved from the gas station to the user via the
       * optional bundled `SystemProgram.transfer`. 0 when no topup ix
       * was present. The route sums this with the fee for budget logging.
       */
      topupLamports: number;
    }
  | { ok: false; code: ValidatorRejectionCode; reason: string };

export interface ValidateOptions {
  /** Public key of the gas-station signer. Must match `staticAccountKeys[0]`. */
  expectedFeePayer: PublicKey;
  /** Optional override for tests. Defaults to `MAX_FEE_LAMPORTS`. */
  maxFeeLamports?: number;
  /**
   * Optional override for tests. Defaults to `MAX_TOPUP_LAMPORTS`.
   */
  maxTopupLamports?: number;
  /**
   * Optional override of the allowed program. Defaults to the project
   * escrow. Tests pass a fake to exercise the wrong-program path.
   */
  expectedProgramId?: PublicKey;
  /** Optional override of allowed discriminators. */
  allowedDiscriminators?: ReadonlySet<string>;
}

/**
 * Decode a base64-encoded VersionedTransaction and run every guard.
 *
 * Returns a typed result. Never throws — the route handler's path is
 * a clean `if (!result.ok) return 422`.
 */
export function validateSolanaSponsorTx(
  partiallySignedTxB64: string,
  opts: ValidateOptions,
): ValidatorResult {
  const max = opts.maxFeeLamports ?? MAX_FEE_LAMPORTS;
  const maxTopup = opts.maxTopupLamports ?? MAX_TOPUP_LAMPORTS;
  const programId = opts.expectedProgramId ?? ESCROW_PROGRAM_ID;
  const allowed = opts.allowedDiscriminators ?? ALLOWED_DISCRIMINATORS_HEX;

  let tx: VersionedTransaction;
  try {
    const buf = Buffer.from(partiallySignedTxB64, "base64");
    tx = VersionedTransaction.deserialize(buf);
  } catch (err) {
    return {
      ok: false,
      code: "tx_decode_failed",
      reason: `could not deserialize tx: ${(err as Error).message}`,
    };
  }

  const message = tx.message;
  const accountKeys = message.staticAccountKeys;
  if (accountKeys.length === 0) {
    return {
      ok: false,
      code: "tx_decode_failed",
      reason: "tx message has no account keys",
    };
  }

  // Rule 1: fee payer (the first signer) must be the gas station.
  const feePayer = accountKeys[0];
  if (!feePayer || !feePayer.equals(opts.expectedFeePayer)) {
    return {
      ok: false,
      code: "wrong_fee_payer",
      reason: `fee payer ${feePayer?.toBase58() ?? "<missing>"} is not the gas-station pubkey`,
    };
  }

  if (message.compiledInstructions.length === 0) {
    return {
      ok: false,
      code: "no_instructions",
      reason: "tx has no instructions",
    };
  }

  // Rule 2: separate instructions into:
  //   - compute-budget (allowed, parsed for fee estimation)
  //   - SystemProgram.transfer (allowed at most ONCE, must be a
  //     gas-station→user rent topup, GHB-180)
  //   - escrow (validated, exactly ONE)
  //   - anything else = reject
  let escrowIxIdx = -1;
  let computeUnitLimit: number | null = null;
  let computeUnitPriceMicroLamports: number | null = null;
  let topupLamports = 0;
  let sawTopup = false;

  // numRequiredSignatures gives us the count of signer slots in
  // `staticAccountKeys`. The fee payer is at index 0; user signers
  // (creator/solver) sit in [1, numRequiredSignatures). The topup
  // destination must be one of those — never the fee payer (would
  // be a no-op self-transfer) and never a non-signer (would let an
  // attacker exfiltrate to an arbitrary account they don't control).
  const numSigners = message.header.numRequiredSignatures;

  for (let i = 0; i < message.compiledInstructions.length; i += 1) {
    const ix = message.compiledInstructions[i]!;
    const ixProgram = accountKeys[ix.programIdIndex];
    if (!ixProgram) {
      return {
        ok: false,
        code: "tx_decode_failed",
        reason: `instruction ${i} references account index ${ix.programIdIndex} which is out of bounds`,
      };
    }

    if (ixProgram.equals(COMPUTE_BUDGET_PROGRAM_ID)) {
      const parsed = parseComputeBudgetIx(ix.data);
      if (parsed.kind === "limit") computeUnitLimit = parsed.value;
      else if (parsed.kind === "price") computeUnitPriceMicroLamports = parsed.value;
      // Unknown compute-budget ix variant → ignore (fee estimation just
      // uses defaults). Compute-budget ixs can't drain funds.
      continue;
    }

    if (ixProgram.equals(SYSTEM_PROGRAM_ID)) {
      // Only Transfer is allowed; CreateAccount / Assign / etc. are
      // rejected because they can move ownership of the gas-station
      // signer or assign new accounts to arbitrary programs.
      const parsedTopup = parseTopupTransferIx(
        ix.data,
        ix.accountKeyIndexes,
        accountKeys,
        numSigners,
      );
      if (!parsedTopup.ok) {
        return {
          ok: false,
          code: "topup_transfer_invalid",
          reason: `instruction ${i}: ${parsedTopup.reason}`,
        };
      }
      if (sawTopup) {
        return {
          ok: false,
          code: "multiple_topup_transfers",
          reason: `instruction ${i}: a second SystemProgram.transfer is not allowed`,
        };
      }
      if (parsedTopup.lamports > maxTopup) {
        return {
          ok: false,
          code: "topup_transfer_invalid",
          reason: `topup transfer ${parsedTopup.lamports} lamports exceeds cap ${maxTopup}`,
        };
      }
      sawTopup = true;
      topupLamports = parsedTopup.lamports;
      continue;
    }

    if (ixProgram.equals(programId)) {
      if (escrowIxIdx !== -1) {
        return {
          ok: false,
          code: "multiple_escrow_instructions",
          reason: "tx contains more than one escrow instruction",
        };
      }
      escrowIxIdx = i;
      continue;
    }

    return {
      ok: false,
      code: "extra_unknown_instruction",
      reason: `instruction ${i} targets ${ixProgram.toBase58()} which is neither escrow, compute-budget, nor system`,
    };
  }

  if (escrowIxIdx === -1) {
    return {
      ok: false,
      code: "no_escrow_instruction",
      reason: "no escrow instruction found in the tx",
    };
  }

  // Rule 3: the escrow ix's discriminator (first 8 bytes) must be in the allowlist.
  const escrowIx = message.compiledInstructions[escrowIxIdx]!;
  if (escrowIx.data.length < 8) {
    return {
      ok: false,
      code: "missing_discriminator",
      reason: `escrow instruction data is ${escrowIx.data.length} bytes, expected at least 8`,
    };
  }
  const discriminatorHex = Buffer.from(escrowIx.data.slice(0, 8)).toString("hex");
  if (!allowed.has(discriminatorHex)) {
    return {
      ok: false,
      code: "disallowed_discriminator",
      reason: `escrow ix discriminator ${discriminatorHex} not in allowlist`,
    };
  }

  // Rule 4: fee budget. Base fee × signature count, plus priority fee
  // if the tx set a compute price. We err on the high side — if the
  // user didn't set a limit we assume the Solana default of 200_000
  // CUs (the cap when no SetComputeUnitLimit ix is present).
  const numSignatures = tx.signatures.length;
  const baseFee = BASE_FEE_LAMPORTS_PER_SIGNATURE * numSignatures;
  const cuLimit = computeUnitLimit ?? 200_000;
  // computeUnitPrice is in micro-lamports per CU (1 lamport = 1e6 micro).
  const priorityFee = computeUnitPriceMicroLamports
    ? Math.ceil((computeUnitPriceMicroLamports * cuLimit) / 1_000_000)
    : 0;
  const estimatedFeeLamports = baseFee + priorityFee;

  if (estimatedFeeLamports > max) {
    return {
      ok: false,
      code: "fee_exceeds_cap",
      reason: `estimated fee ${estimatedFeeLamports} lamports exceeds cap ${max}`,
    };
  }

  return {
    ok: true,
    discriminatorHex,
    estimatedFeeLamports,
    topupLamports,
  };
}

/**
 * Parse a SystemProgram instruction and validate it's a Transfer of
 * the form `gas_station → user` within the allowed shape.
 *
 * Layout of a Transfer ix:
 *   data:    [u32 LE disc=2, u64 LE lamports]   → 12 bytes
 *   accounts: [from (signer, writable), to (writable)]
 *
 * We accept ONLY this shape — no CreateAccount, no Assign, etc.
 * Source must be the fee payer (= gas station, the validator's
 * caller is responsible for that equality check at rule 1). Dest
 * must be a signer slot OTHER than the fee payer (the user's wallet
 * — `creator` for create_bounty, `solver` for submit_solution).
 */
function parseTopupTransferIx(
  data: Uint8Array,
  accountKeyIndexes: readonly number[] | Uint8Array,
  accountKeys: readonly PublicKey[],
  numSigners: number,
):
  | { ok: true; lamports: number }
  | { ok: false; reason: string } {
  if (data.length !== SYSTEM_TRANSFER_DATA_LEN) {
    return {
      ok: false,
      reason: `system ix data is ${data.length} bytes, expected ${SYSTEM_TRANSFER_DATA_LEN} for Transfer`,
    };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const disc = view.getUint32(0, true);
  if (disc !== SYSTEM_TRANSFER_DISC) {
    return {
      ok: false,
      reason: `system ix discriminator ${disc} is not Transfer (${SYSTEM_TRANSFER_DISC}); CreateAccount/Assign/etc. are not sponsored`,
    };
  }
  if (accountKeyIndexes.length !== 2) {
    return {
      ok: false,
      reason: `system Transfer expects 2 accounts (from, to), got ${accountKeyIndexes.length}`,
    };
  }
  const fromIdx = accountKeyIndexes[0]!;
  const toIdx = accountKeyIndexes[1]!;
  if (fromIdx !== 0) {
    return {
      ok: false,
      reason: `topup transfer source must be the fee payer (account index 0), got index ${fromIdx}`,
    };
  }
  if (toIdx === 0 || toIdx >= numSigners) {
    // toIdx must point to a signer slot other than 0. accountKeys is
    // [feePayer, ...otherSigners, ...nonSigners] so a valid topup dest
    // sits in [1, numSigners). A non-signer destination would let a
    // crafted tx exfiltrate gas-station SOL to any pubkey.
    return {
      ok: false,
      reason: `topup transfer destination must be a non-fee-payer signer (index in [1, ${numSigners})), got index ${toIdx}`,
    };
  }
  // Sanity: both indices must be in bounds.
  if (fromIdx >= accountKeys.length || toIdx >= accountKeys.length) {
    return {
      ok: false,
      reason: `topup transfer references account index out of bounds`,
    };
  }
  const lo = view.getUint32(4, true);
  const hi = view.getUint32(8, true);
  // u64 LE → JS Number. Lamports caps live well within 2^53.
  const lamports = lo + hi * 0x1_0000_0000;
  return { ok: true, lamports };
}

/**
 * Parse a compute-budget instruction's data field.
 *
 * `SetComputeUnitLimit`  = `[0x02, u32 (LE)]`         → 5 bytes
 * `SetComputeUnitPrice`  = `[0x03, u64 (LE)]`         → 9 bytes
 *
 * Anything else = unknown. We accept unknown variants without
 * complaining because future Solana releases may add more compute-
 * budget ixs and they can't drain funds.
 */
function parseComputeBudgetIx(
  data: Uint8Array,
):
  | { kind: "limit"; value: number }
  | { kind: "price"; value: number }
  | { kind: "unknown" } {
  if (data.length === 0) return { kind: "unknown" };
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const disc = data[0];
  if (disc === COMPUTE_LIMIT_DISC && data.length >= 5) {
    return { kind: "limit", value: view.getUint32(1, true) };
  }
  if (disc === COMPUTE_PRICE_DISC && data.length >= 9) {
    // u64 little-endian. We stay in Number (max safe ~2^53) — values
    // in lamports for compute pricing don't exceed that range.
    const lo = view.getUint32(1, true);
    const hi = view.getUint32(5, true);
    return { kind: "price", value: lo + hi * 0x1_0000_0000 };
  }
  return { kind: "unknown" };
}
