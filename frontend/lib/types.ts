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
  createdAt: number;
};
