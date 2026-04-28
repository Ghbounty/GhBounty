/**
 * GHB-95: per-issue auto-rejection threshold.
 *
 * After Opus scores a submission, the relayer compares the score against the
 * issue's `reject_threshold`. Submissions below the threshold are flagged as
 * `auto_rejected` off-chain and hidden from the company's main view. Onchain
 * `set_score` still runs (transparency), so on/off-chain state may diverge —
 * onchain says "scored=N", off-chain says "auto_rejected".
 *
 * Threshold is null when companies want to triage every submission manually.
 */

export type ThresholdOutcome = "pass" | "auto_rejected";

/**
 * Decide whether a submission passes the threshold.
 *
 * - `score`: integer in [1, 10] returned by `analyzeSubmission`.
 * - `threshold`: integer in [1, 10] or null if unset.
 *
 * Pass-through (`"pass"`) if no threshold is configured, otherwise
 * `auto_rejected` when `score < threshold`. Equality passes (consistent with
 * the ticket: "score < reject_threshold").
 */
export function classifyByThreshold(
  score: number,
  threshold: number | null | undefined,
): ThresholdOutcome {
  if (threshold == null) return "pass";
  if (!Number.isFinite(threshold)) return "pass";
  return score < threshold ? "auto_rejected" : "pass";
}
