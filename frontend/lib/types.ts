export type Role = "company" | "dev";

export type UserBase = {
  id: string;
  role: Role;
  email: string;
  wallet?: string;
  avatarUrl?: string;
  createdAt: number;
};

export type Company = UserBase & {
  role: "company";
  name: string;
  website?: string;
  industry?: string;
  description: string;
};

export type Dev = UserBase & {
  role: "dev";
  username: string;
  bio?: string;
  github?: string;
  skills: string[];
};

export type User = Company | Dev;

export type BountyStatus = "open" | "reviewing" | "approved" | "rejected" | "paid" | "closed";

export type ReleaseMode = "auto" | "assisted";

export type Bounty = {
  /**
   * Internal identifier. In the real Supabase backend this is `issues.id`
   * (a UUID); in the localStorage mock it's the bounty PDA. Always usable
   * as a stable React key + URL slug, never as a Solana address.
   */
  id: string;
  /**
   * On-chain bounty PDA (base58). Required to call `submit_solution` /
   * `resolve_bounty` / `cancel_bounty` against the right account.
   *
   * Optional only because the localStorage mock used to overload `id`
   * with the PDA — old mock rows survive without this field. In every
   * Supabase-backed path it's set.
   */
  pda?: string;
  companyId: string;
  repo: string;
  issueNumber: number;
  issueUrl: string;
  title?: string;
  amountUsdc: number;
  status: BountyStatus;
  releaseMode: ReleaseMode;
  /**
   * Number of submissions tied to this bounty (counted from the
   * `submissions` table, not `issues.submission_count` — that mirror
   * column never gets updated client-side because RLS forbids non-creator
   * UPDATEs on `issues`).
   *
   * Used by the company dashboard ("3 PRs") and to derive the
   * "reviewing" status. Optional for backwards compatibility with mock
   * data; treat missing as 0.
   */
  submissionCount?: number;
  /**
   * Score below which an evaluated submission is flagged "Recommended
   * to reject" in the company review modal. Null = no auto-recommendation,
   * the company triages every submission manually. Mirrors
   * `bounty_meta.reject_threshold`.
   */
  rejectThreshold?: number | null;
  /** GHB-184: optional submission cap. `null` = unlimited. */
  maxSubmissions?: number | null;
  /** GHB-184: count of submissions in `scored` or `winner` state. */
  reviewEligibleCount?: number;
  /**
   * GHB-184: off-chain flag set when the cap was hit. Drives the
   * `cap_reached` badge and disables Submit PR — `issues.state` stays
   * untouched so it keeps mirroring on-chain reality.
   */
  closedByCap?: boolean;
  createdAt: number;
};

/**
 * Coarse status the dev sees on their own submission.
 *
 *   pending  — relayer / company haven't acted on it yet
 *   accepted — this submission won the bounty
 *   rejected — explicitly rejected (manual or auto)
 *   lost     — a *different* submission on the same bounty was approved.
 *              The dev's own PR is neither the winner nor explicitly
 *              rejected; it just can't win anymore because escrow has
 *              paid out. We surface this as "Not selected" rather than
 *              leaving it stuck on "Pending".
 */
export type SubmissionStatus = "pending" | "accepted" | "rejected" | "lost";

/**
 * GHB-90: finer-grained lifecycle the dev sees on `/app/profile` and
 * `/app/submissions/[id]`. The coarse `SubmissionStatus` is what the
 * company-side dashboards filter on; this expands `pending` into the
 * three real waiting states the dev cares about, and splits `rejected`
 * by who rejected it.
 *
 *   submitted     — row exists, no `evaluations` row yet (relayer
 *                   hasn't touched it)
 *   evaluating    — eval row exists but score still null (Opus mid-flight)
 *   scored        — eval row + score, no `submission_reviews` row yet
 *                   (waiting for the company to triage)
 *   auto_rejected — `submission_reviews.auto_rejected = true` (GHB-85
 *                   gate: score < bounty.reject_threshold)
 *   rejected      — `submission_reviews.rejected = true` AND
 *                   `auto_rejected = false` (the company manually said
 *                   no — feedback in `reject_reason`)
 *   approved      — on-chain `submissions.state = 'winner'` OR off-chain
 *                   `submission_reviews.approved = true`
 *   lost          — bounty awarded to a different submission (mirrors
 *                   the coarse `lost` status)
 */
export type SubmissionGranularStatus =
  | "submitted"
  | "evaluating"
  | "scored"
  | "auto_rejected"
  | "rejected"
  | "approved"
  | "lost";

export type Submission = {
  id: string;
  bountyId: string;
  devId: string;
  prUrl: string;
  prRepo: string;
  prNumber: number;
  note?: string;
  status: SubmissionStatus;
  /**
   * Off-chain feedback the company wrote when rejecting this submission
   * (GHB-84). Only populated when `status === "rejected"`. Sourced from
   * the `submission_reviews` table; mirrors `submission_reviews.reject_reason`.
   * Empty string is normalized to undefined upstream.
   */
  rejectReason?: string;
  /**
   * GHB-85: distinguishes a submission auto-rejected by the relayer
   * (Opus score below the bounty's `reject_threshold`) from one
   * rejected manually by the company. Both share `status === "rejected"`
   * — this flag refines the kind so the dev-side and company-side
   * UI can render different copy + filter rules.
   */
  autoRejected?: boolean;
  /**
   * Optional feedback the company left when picking this dev as the
   * winner (GHB-83 follow-up). Only meaningful when
   * `status === "accepted"`. Mirrors
   * `submission_reviews.approval_feedback`. Empty string normalized to
   * undefined upstream.
   */
  approvalFeedback?: string;
  /**
   * GHB-90: refined status for the dev profile + submission detail page.
   * Always populated when reading from Supabase; mock paths may leave
   * this undefined — callers fall back to the coarse `status`.
   */
  granularStatus?: SubmissionGranularStatus;
  /**
   * Most-recent evaluation score (1-10) from the `evaluations` table.
   * `null` while the relayer pipeline hasn't scored yet, `undefined`
   * when the caller didn't fetch evaluations (mock paths).
   */
  score?: number | null;
  /** Source label of the score — "opus", "stub", "genlayer". */
  scoreSource?: string | null;
  /**
   * Rank within the bounty (1-indexed, lower is better). Mirrors
   * `submissions.rank`, written by the relayer alongside the score.
   * `null` until scored or for auto-rejected rows.
   */
  rank?: number | null;
  /**
   * Total submissions on the same bounty at fetch time. Used together
   * with `rank` to render "#2 of 5" in the row + detail page. `null`
   * when unknown (mock paths).
   */
  totalForBounty?: number | null;
  /**
   * GHB-93: on-chain payout signature, mirrored from `submissions.tx_hash`.
   * Set when the bounty resolved to this submission and the relayer
   * (or the company in `assisted` mode) executed `resolve_bounty` on
   * Solana. `null` while pending payout, `undefined` when the caller
   * didn't fetch tx_hash (mock paths, listings that don't need it).
   *
   * Used by the earnings dashboard to render explorer links per
   * payment, and to split "earned" vs "pending payout" totals.
   */
  payoutTxHash?: string | null;
  createdAt: number;
};
