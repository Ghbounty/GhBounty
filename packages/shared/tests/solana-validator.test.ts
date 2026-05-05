import { describe, expect, test } from "vitest";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  ALLOWED_DISCRIMINATORS_HEX,
  ESCROW_PROGRAM_ID,
  MAX_FEE_LAMPORTS,
  validateSolanaSponsorTx,
} from "../src/gas-station/solana-validator.js";

/**
 * GHB-173 — validator unit tests.
 *
 * Each rejection code has a dedicated test case (so a regression in
 * any single rule shows up as a focused failure). Plus a happy-path
 * test per allowed Anchor discriminator, matching the IDL.
 *
 * The tests build real `VersionedTransaction`s rather than mocking
 * the parser — that way the tests would catch any change to the
 * Solana wire format that breaks our deserialization assumptions.
 */

// ── fixtures ──────────────────────────────────────────────────────────

const GAS_STATION = Keypair.generate().publicKey;
const USER = Keypair.generate().publicKey;
const RANDOM_PROGRAM = new PublicKey(
  "11111111111111111111111111111112", // close-to-system; just needs to differ from escrow
);
const RECENT_BLOCKHASH = "FwRYtTPRk5N4wUeP87rTw9kQVSwigB6kbikGzzeCMrW5";

/**
 * Build an Anchor-shaped instruction: 8-byte discriminator + (no args).
 * For the validator's purposes the args don't matter — only the first
 * 8 bytes of `data` are inspected.
 */
function escrowIx(discriminatorHex: string, payer: PublicKey): TransactionInstruction {
  const disc = Buffer.from(discriminatorHex, "hex");
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [{ pubkey: payer, isSigner: true, isWritable: true }],
    data: disc,
  });
}

function buildTx(
  ixs: TransactionInstruction[],
  feePayer: PublicKey,
): VersionedTransaction {
  const msg = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: RECENT_BLOCKHASH,
    instructions: ixs,
  }).compileToV0Message();
  // Untouched signatures slot — the gas station would sign at index 0
  // for the payer, the user signs at their slot. The validator never
  // verifies signatures, only structure, so leaving them unsigned is fine.
  return new VersionedTransaction(msg);
}

function toB64(tx: VersionedTransaction): string {
  return Buffer.from(tx.serialize()).toString("base64");
}

const baseOpts = { expectedFeePayer: GAS_STATION };

// ── tx_decode_failed ─────────────────────────────────────────────────

describe("validateSolanaSponsorTx — decode failures", () => {
  test("garbage base64 → tx_decode_failed", () => {
    const r = validateSolanaSponsorTx("not-real-base64!!!", baseOpts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("tx_decode_failed");
  });

  test("base64 of random bytes that aren't a valid tx → tx_decode_failed", () => {
    const garbage = Buffer.from([1, 2, 3, 4, 5]).toString("base64");
    const r = validateSolanaSponsorTx(garbage, baseOpts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("tx_decode_failed");
  });
});

// ── wrong_fee_payer ──────────────────────────────────────────────────

describe("validateSolanaSponsorTx — fee payer", () => {
  test("rejects when fee payer is the user, not the gas station", () => {
    const tx = buildTx(
      [escrowIx("cbe99dbf4625cd00", USER)], // submit_solution
      USER, // user as fee payer instead of gas station
    );
    const r = validateSolanaSponsorTx(toB64(tx), baseOpts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("wrong_fee_payer");
  });
});

// ── happy paths (one per allowed discriminator) ──────────────────────

describe("validateSolanaSponsorTx — happy path per discriminator", () => {
  const cases = [
    ["create_bounty", "7a5a0e8f087dc802"],
    ["submit_solution", "cbe99dbf4625cd00"],
    ["resolve_bounty", "cf2b5deedeb84fdb"],
    ["cancel_bounty", "4f416b8f80a5872e"],
  ] as const;

  for (const [name, disc] of cases) {
    test(`accepts ${name} (${disc})`, () => {
      const tx = buildTx([escrowIx(disc, GAS_STATION)], GAS_STATION);
      const r = validateSolanaSponsorTx(toB64(tx), baseOpts);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.discriminatorHex).toBe(disc);
        expect(r.estimatedFeeLamports).toBeLessThanOrEqual(MAX_FEE_LAMPORTS);
      }
    });
  }
});

// ── instruction-shape rejections ─────────────────────────────────────

describe("validateSolanaSponsorTx — instruction shape", () => {
  test("disallowed discriminator (e.g. set_score, which is relayer-only)", () => {
    const SET_SCORE_DISC = "daa71979d0be0857"; // from the IDL
    expect(ALLOWED_DISCRIMINATORS_HEX.has(SET_SCORE_DISC)).toBe(false);
    const tx = buildTx([escrowIx(SET_SCORE_DISC, GAS_STATION)], GAS_STATION);
    const r = validateSolanaSponsorTx(toB64(tx), baseOpts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("disallowed_discriminator");
  });

  test("missing discriminator: ix data shorter than 8 bytes", () => {
    const ix = new TransactionInstruction({
      programId: ESCROW_PROGRAM_ID,
      keys: [{ pubkey: GAS_STATION, isSigner: true, isWritable: true }],
      data: Buffer.from([1, 2, 3]), // 3 bytes, not 8+
    });
    const tx = buildTx([ix], GAS_STATION);
    const r = validateSolanaSponsorTx(toB64(tx), baseOpts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("missing_discriminator");
  });

  test("multiple escrow instructions in a single tx", () => {
    const tx = buildTx(
      [
        escrowIx("cbe99dbf4625cd00", GAS_STATION), // submit_solution
        escrowIx("4f416b8f80a5872e", GAS_STATION), // cancel_bounty
      ],
      GAS_STATION,
    );
    const r = validateSolanaSponsorTx(toB64(tx), baseOpts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("multiple_escrow_instructions");
  });

  test("only compute-budget ixs, no escrow → no_escrow_instruction", () => {
    const tx = buildTx(
      [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
      ],
      GAS_STATION,
    );
    const r = validateSolanaSponsorTx(toB64(tx), baseOpts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("no_escrow_instruction");
  });

  test("instruction targeting an unrelated program → extra_unknown_instruction", () => {
    const otherIx = new TransactionInstruction({
      programId: RANDOM_PROGRAM,
      keys: [{ pubkey: GAS_STATION, isSigner: true, isWritable: true }],
      data: Buffer.from([0]),
    });
    const tx = buildTx(
      [otherIx, escrowIx("cbe99dbf4625cd00", GAS_STATION)],
      GAS_STATION,
    );
    const r = validateSolanaSponsorTx(toB64(tx), baseOpts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("extra_unknown_instruction");
  });
});

// ── compute-budget ixs are tolerated alongside escrow ────────────────

describe("validateSolanaSponsorTx — compute-budget interplay", () => {
  test("escrow + setComputeUnitLimit + setComputeUnitPrice → ok with priority fee counted", () => {
    const tx = buildTx(
      [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
        escrowIx("cbe99dbf4625cd00", GAS_STATION),
      ],
      GAS_STATION,
    );
    const r = validateSolanaSponsorTx(toB64(tx), baseOpts);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Base 5000 (1 sig) + priority 200_000 * 1000 / 1_000_000 = 200 → 5_200
      expect(r.estimatedFeeLamports).toBe(5_200);
    }
  });
});

// ── fee_exceeds_cap ─────────────────────────────────────────────────

describe("validateSolanaSponsorTx — fee budget", () => {
  test("priority fee that pushes total over MAX_FEE_LAMPORTS is rejected", () => {
    // 200_000 CU × 1_000_000 microLamports = 200_000 lamports priority.
    // Plus 5_000 base = 205_000 lamports total. Way above the 50_000 cap.
    const tx = buildTx(
      [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }),
        escrowIx("cbe99dbf4625cd00", GAS_STATION),
      ],
      GAS_STATION,
    );
    const r = validateSolanaSponsorTx(toB64(tx), baseOpts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("fee_exceeds_cap");
  });

  test("custom maxFeeLamports option lets tests dial the threshold", () => {
    const tx = buildTx([escrowIx("cbe99dbf4625cd00", GAS_STATION)], GAS_STATION);
    // Tx has 1 signature → base fee 5_000. Setting max=4_999 should reject.
    const r = validateSolanaSponsorTx(toB64(tx), {
      expectedFeePayer: GAS_STATION,
      maxFeeLamports: 4_999,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("fee_exceeds_cap");
  });
});

// ── exhaustive rejection-code coverage check ─────────────────────────

describe("validateSolanaSponsorTx — sanity", () => {
  test("ALLOWED_DISCRIMINATORS_HEX contains exactly the 4 user-initiated ixs", () => {
    expect(ALLOWED_DISCRIMINATORS_HEX.size).toBe(4);
    expect(ALLOWED_DISCRIMINATORS_HEX.has("7a5a0e8f087dc802")).toBe(true); // create_bounty
    expect(ALLOWED_DISCRIMINATORS_HEX.has("cbe99dbf4625cd00")).toBe(true); // submit_solution
    expect(ALLOWED_DISCRIMINATORS_HEX.has("cf2b5deedeb84fdb")).toBe(true); // resolve_bounty
    expect(ALLOWED_DISCRIMINATORS_HEX.has("4f416b8f80a5872e")).toBe(true); // cancel_bounty
  });

  test("ESCROW_PROGRAM_ID matches the value in relayer/.env.example", () => {
    expect(ESCROW_PROGRAM_ID.toBase58()).toBe(
      "CPZx26QXs3HjwGobr8cVAZEtF1qGzqnNbBdt7h1EwbBg",
    );
  });
});
