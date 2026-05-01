/**
 * Shared frontend constants. Keep this module side-effect-free so it
 * can be imported anywhere (server components, client components, lib
 * helpers, tests).
 */

/**
 * GHB-85: default reject threshold applied when a bounty doesn't set
 * its own `reject_threshold`. Submissions whose Opus score lands below
 * this value are auto-rejected — the relayer flips `rejected=true,
 * auto_rejected=true` on the `submission_reviews` row, and the
 * company-side review modal filters them out by default.
 *
 * 8 is generous enough that it only catches obvious noise (a 7/10 PR
 * still reaches a human). When the company wants to widen or narrow
 * the gate they set it per-bounty in the create form.
 *
 * If we ever need per-company defaults (e.g. an enterprise SaaS tier
 * configuring stricter triage), this constant becomes a column on the
 * `companies` or `settings` table — only the *fallback* changes, every
 * call site that reads `effectiveRejectThreshold` keeps working.
 */
export const DEFAULT_REJECT_THRESHOLD = 8;

/**
 * Resolve the effective threshold for a bounty: explicit per-issue
 * value if set, otherwise the global default. Returns `null` only when
 * the caller intentionally passed `false` — used by tests / mock paths
 * that want to opt out of auto-rejection entirely.
 */
export function effectiveRejectThreshold(
  perIssue: number | null | undefined,
  /** Pass `false` to opt out (no threshold at all). */
  fallback: number | false = DEFAULT_REJECT_THRESHOLD,
): number | null {
  if (typeof perIssue === "number") return perIssue;
  return fallback === false ? null : fallback;
}
