import { describe, expect, test } from "vitest";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import {
  computeRefundLamports,
  computeReviewFee,
  MAX_SUBMISSIONS_DEFAULT,
  MAX_SUBMISSIONS_MAX,
  MAX_SUBMISSIONS_MIN,
  REVIEW_COST_USD_PER_REVIEW,
  REVIEW_FEE_MARKUP,
  usdToLamports,
} from "@/lib/review-fee";

/**
 * Pure-math unit tests. The interesting bits are the integer floor on
 * `usdToLamports` (so a refund computed against a per-review value
 * doesn't lose lamports to rounding) and the bounds enforcement on
 * `computeReviewFee`'s cap.
 */

describe("usdToLamports", () => {
  test("at $200 SOL, $1 == 5_000_000 lamports", () => {
    expect(usdToLamports(1, 200)).toBe(5_000_000);
  });

  test("at $100 SOL, $0.10 == 1_000_000 lamports", () => {
    expect(usdToLamports(0.1, 100)).toBe(1_000_000);
  });

  test("rounds DOWN (Math.floor) so refunds never overshoot", () => {
    // $0.10 / $89.50 SOL = 0.0011173... SOL = 1_117_318.x lamports
    // Floor → 1_117_318 (not 1_117_319). Refunds use the same floored
    // unit so cap*floor never exceeds total*floor.
    expect(usdToLamports(0.1, 89.5)).toBe(1_117_318);
  });

  test("zero USD → zero lamports", () => {
    expect(usdToLamports(0, 100)).toBe(0);
  });

  test("rejects invalid solPriceUsd (≤0)", () => {
    expect(() => usdToLamports(1, 0)).toThrow();
    expect(() => usdToLamports(1, -10)).toThrow();
    expect(() => usdToLamports(1, NaN)).toThrow();
  });

  test("rejects negative usd", () => {
    expect(() => usdToLamports(-0.01, 100)).toThrow();
  });
});

describe("computeReviewFee", () => {
  test("default cap × $0.10 × 2 markup at $200 SOL", () => {
    const r = computeReviewFee({
      maxSubmissions: 20,
      solPriceUsd: 200,
    });
    expect(r.costUsdPerReview).toBe(REVIEW_COST_USD_PER_REVIEW);
    expect(r.totalUsd).toBeCloseTo(0.1 * 20 * 2);
    // 0.10 / 200 = 0.0005 SOL/review = 500_000 lamports
    expect(r.perReviewLamports).toBe(500_000);
    // total = 500_000 × 20 × 2 = 20_000_000 lamports = 0.02 SOL
    expect(r.totalLamports).toBe(20_000_000);
    expect(r.totalLamports / LAMPORTS_PER_SOL).toBeCloseTo(0.02);
  });

  test("max cap (50) at $100 SOL", () => {
    const r = computeReviewFee({
      maxSubmissions: 50,
      solPriceUsd: 100,
    });
    // 0.10 / 100 = 0.001 SOL = 1_000_000 lamports per review
    // 50 × 1_000_000 × 2 = 100_000_000 lamports = 0.1 SOL = $10
    expect(r.totalLamports).toBe(100_000_000);
    expect(r.totalUsd).toBeCloseTo(10);
  });

  test("rejects cap below MIN", () => {
    expect(() =>
      computeReviewFee({ maxSubmissions: 0, solPriceUsd: 100 }),
    ).toThrow();
  });

  test("rejects cap above MAX", () => {
    expect(() =>
      computeReviewFee({
        maxSubmissions: MAX_SUBMISSIONS_MAX + 1,
        solPriceUsd: 100,
      }),
    ).toThrow();
  });

  test("rejects non-integer cap", () => {
    expect(() =>
      computeReviewFee({ maxSubmissions: 1.5, solPriceUsd: 100 }),
    ).toThrow();
  });
});

describe("computeRefundLamports", () => {
  test("(cap=10, used=3) × per_review = 7 unused × per_review", () => {
    const r = computeRefundLamports({
      maxSubmissions: 10,
      reviewEligibleCount: 3,
      perReviewLamports: 1_000_000,
    });
    expect(r).toBe(7_000_000);
  });

  test("zero unused → zero refund", () => {
    expect(
      computeRefundLamports({
        maxSubmissions: 10,
        reviewEligibleCount: 10,
        perReviewLamports: 1_000_000,
      }),
    ).toBe(0);
  });

  test("eligible > cap (over-claimed slot, race-loser scenario) → 0, never negative", () => {
    expect(
      computeRefundLamports({
        maxSubmissions: 10,
        reviewEligibleCount: 12,
        perReviewLamports: 1_000_000,
      }),
    ).toBe(0);
  });
});

describe("constants", () => {
  test("default is 20, range is [1, 50]", () => {
    expect(MAX_SUBMISSIONS_DEFAULT).toBe(20);
    expect(MAX_SUBMISSIONS_MIN).toBe(1);
    expect(MAX_SUBMISSIONS_MAX).toBe(50);
  });

  test("Sonnet 4.5 cost is $0.10 per review (matches Tom's pricing)", () => {
    expect(REVIEW_COST_USD_PER_REVIEW).toBe(0.1);
  });

  test("markup is 2x (cost + profit)", () => {
    expect(REVIEW_FEE_MARKUP).toBe(2);
  });
});
