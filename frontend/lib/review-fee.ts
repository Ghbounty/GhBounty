/**
 * Review fee math.
 *
 * The fee a company pays at bounty-creation time is sized in USD ($0.10
 * per Sonnet review × 2 markup) but charged in SOL. We lock the SOL/USD
 * rate at creation so refunds always use the same lamport unit and the
 * user is never exposed to FX swings between create and cancel.
 *
 * Two derived values get persisted to `bounty_meta`:
 *   - review_fee_lamports_per_review = USD-cost / SOL-price (lamports)
 *   - review_fee_lamports_paid       = perReview × cap × MARKUP
 *
 * Refunds use `perReview × unusedSlots` (cost only, no markup — Tom's call).
 *
 * Live in `lib/` so both the bounty-creation flow (browser) and the
 * cancel-refund route (server) can import without a build cycle.
 */
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

/** Sonnet 4.5 cost per review in USD. Bumped manually if Anthropic re-prices. */
export const REVIEW_COST_USD_PER_REVIEW = 0.1;

/** Markup multiplier on the cost. Tom's pricing decision: charge 2× cost. */
export const REVIEW_FEE_MARKUP = 2;

/** Cap UI input limits. Required field; default 20, max 50. */
export const MAX_SUBMISSIONS_DEFAULT = 20;
export const MAX_SUBMISSIONS_MIN = 1;
export const MAX_SUBMISSIONS_MAX = 50;

/**
 * Convert a USD amount to lamports given a SOL/USD rate.
 *
 * Returns an integer (Math.floor) — fee math always rounds in the user's
 * favour for the per-review unit so the refund formula stays exact.
 */
export function usdToLamports(usd: number, solPriceUsd: number): number {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error(`usdToLamports: invalid usd ${usd}`);
  }
  if (!Number.isFinite(solPriceUsd) || solPriceUsd <= 0) {
    throw new Error(`usdToLamports: invalid solPriceUsd ${solPriceUsd}`);
  }
  return Math.floor((usd / solPriceUsd) * LAMPORTS_PER_SOL);
}

export interface ReviewFeeBreakdown {
  /** Locked-in cost-per-review in lamports. Persisted for refunds. */
  perReviewLamports: number;
  /** Total upfront charge in lamports. = perReviewLamports × cap × markup */
  totalLamports: number;
  /** Pre-conversion sanity values for UI display. */
  costUsdPerReview: number;
  totalUsd: number;
}

/**
 * Size the review fee for a given cap + SOL price.
 *
 * Pure function; no I/O. The caller fetches `solPriceUsd` from Pyth once
 * (at create time) and the result lives on the bounty forever.
 */
export function computeReviewFee(args: {
  maxSubmissions: number;
  solPriceUsd: number;
  costUsdPerReview?: number;
  markup?: number;
}): ReviewFeeBreakdown {
  const cap = args.maxSubmissions;
  if (!Number.isInteger(cap) || cap < MAX_SUBMISSIONS_MIN || cap > MAX_SUBMISSIONS_MAX) {
    throw new Error(
      `computeReviewFee: cap ${cap} outside [${MAX_SUBMISSIONS_MIN}, ${MAX_SUBMISSIONS_MAX}]`,
    );
  }
  const costUsd = args.costUsdPerReview ?? REVIEW_COST_USD_PER_REVIEW;
  const markup = args.markup ?? REVIEW_FEE_MARKUP;
  const perReviewLamports = usdToLamports(costUsd, args.solPriceUsd);
  // Cap fits in <= 50 → no overflow risk anywhere near 2^53.
  const totalLamports = perReviewLamports * cap * markup;
  return {
    perReviewLamports,
    totalLamports,
    costUsdPerReview: costUsd,
    totalUsd: costUsd * cap * markup,
  };
}

/**
 * Refund size in lamports for an `unusedSlots` count, using the
 * locked-in `perReviewLamports` from `bounty_meta`. Markup-free per Tom's
 * spec — refund only the cost portion of the fee.
 */
export function computeRefundLamports(args: {
  maxSubmissions: number;
  reviewEligibleCount: number;
  perReviewLamports: number;
}): number {
  const unused = Math.max(
    0,
    args.maxSubmissions - args.reviewEligibleCount,
  );
  return unused * args.perReviewLamports;
}
