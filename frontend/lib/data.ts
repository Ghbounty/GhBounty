/**
 * Data access layer that branches between mock (localStorage) and real
 * Supabase queries based on NEXT_PUBLIC_USE_SUPABASE.
 *
 * Components consume async functions from here and don't care about the
 * backend. As pieces migrate from localStorage to Supabase, the dispatcher
 * stays put — only the implementations evolve.
 *
 * Bounty mapping:
 *   `issues` (onchain mirror) + `bounty_meta` (UI fields) → frontend `Bounty`
 *   - issues.id → Bounty.id
 *   - bounty_meta.created_by_user_id → Bounty.companyId
 *   - issues.github_issue_url → repo + issueNumber (parsed)
 *   - issues.amount (raw token units, 6-decimal USDC) → Bounty.amountUsdc
 *   - state + closed_by_user + submission_count → Bounty.status
 *
 * Submission mapping:
 *   `submissions` + `submission_meta` (+ join through `issues` for bountyId).
 */

import type {
  Bounty,
  BountyStatus,
  Company,
  Dev,
  Submission,
  SubmissionGranularStatus,
  SubmissionStatus,
} from "./types";
import { effectiveRejectThreshold } from "./constants";
import { useSupabaseBackend, usePrivyBackend } from "./auth-context";

/**
 * GHB-81: Privy mode also persists into Supabase via the JWT bridge, so
 * the dashboard reads from Supabase whenever EITHER flag is on. Mock
 * (localStorage) is reserved for the dev-bypass path.
 */
const useRealBackend = useSupabaseBackend || usePrivyBackend;
import {
  bountiesByCompany as mockBountiesByCompany,
  hasDevSubmitted as mockHasDevSubmitted,
  loadBounties as mockLoadBounties,
  loadSubmissions as mockLoadSubmissions,
  loadUsers as mockLoadUsers,
  submissionsByBounty as mockSubmissionsByBounty,
  submissionsByDev as mockSubmissionsByDev,
} from "./store";
import { createClient } from "@/utils/supabase/client";

/* ---------------------------------------------------------------- */
/* Companies                                                          */
/* ---------------------------------------------------------------- */

type CompanyRow = {
  user_id: string;
  name: string;
  slug: string;
  description: string;
  website: string | null;
  industry: string | null;
  logo_url: string | null;
  profile: { email: string; created_at: string } | null;
};

function rowToCompany(row: CompanyRow): Company {
  return {
    id: row.user_id,
    role: "company",
    email: row.profile?.email ?? "",
    name: row.name,
    description: row.description,
    website: row.website ?? undefined,
    industry: row.industry ?? undefined,
    avatarUrl: row.logo_url ?? undefined,
    createdAt: row.profile?.created_at
      ? new Date(row.profile.created_at).getTime()
      : Date.now(),
  };
}

export async function fetchCompanies(): Promise<Company[]> {
  if (!useRealBackend) {
    return mockLoadUsers().filter((u): u is Company => u.role === "company");
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("companies")
    .select(
      "user_id, name, slug, description, website, industry, logo_url, profile:profiles!left(email, created_at)",
    )
    .returns<CompanyRow[]>();
  if (error) {
    console.error("[fetchCompanies]", error);
    return [];
  }
  return (data ?? []).map(rowToCompany);
}

export async function fetchCompany(id: string): Promise<Company | null> {
  if (!useRealBackend) {
    return (
      (mockLoadUsers().find((u) => u.role === "company" && u.id === id) as
        | Company
        | undefined) ?? null
    );
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("companies")
    .select(
      "user_id, name, slug, description, website, industry, logo_url, profile:profiles!left(email, created_at)",
    )
    .eq("user_id", id)
    .single<CompanyRow>();
  if (error) {
    console.error("[fetchCompany]", error);
    return null;
  }
  return data ? rowToCompany(data) : null;
}

/* ---------------------------------------------------------------- */
/* Developers                                                         */
/* ---------------------------------------------------------------- */

type DevRow = {
  user_id: string;
  username: string;
  github_handle: string | null;
  bio: string | null;
  skills: string[];
  avatar_url: string | null;
  profile: { email: string; created_at: string } | null;
};

function rowToDev(row: DevRow): Dev {
  return {
    id: row.user_id,
    role: "dev",
    email: row.profile?.email ?? "",
    username: row.username,
    bio: row.bio ?? undefined,
    github: row.github_handle ?? undefined,
    skills: row.skills ?? [],
    avatarUrl: row.avatar_url ?? undefined,
    createdAt: row.profile?.created_at
      ? new Date(row.profile.created_at).getTime()
      : Date.now(),
  };
}

export async function fetchDevelopers(): Promise<Dev[]> {
  if (!useRealBackend) {
    return mockLoadUsers().filter((u): u is Dev => u.role === "dev");
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("developers")
    .select(
      "user_id, username, github_handle, bio, skills, avatar_url, profile:profiles!left(email, created_at)",
    )
    .returns<DevRow[]>();
  if (error) {
    console.error("[fetchDevelopers]", error);
    return [];
  }
  return (data ?? []).map(rowToDev);
}

export async function fetchDeveloper(id: string): Promise<Dev | null> {
  if (!useRealBackend) {
    return (
      (mockLoadUsers().find((u) => u.role === "dev" && u.id === id) as
        | Dev
        | undefined) ?? null
    );
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("developers")
    .select(
      "user_id, username, github_handle, bio, skills, avatar_url, profile:profiles!left(email, created_at)",
    )
    .eq("user_id", id)
    .single<DevRow>();
  if (error) {
    console.error("[fetchDeveloper]", error);
    return null;
  }
  return data ? rowToDev(data) : null;
}

/* ---------------------------------------------------------------- */
/* Bounties                                                           */
/* ---------------------------------------------------------------- */

type IssueRow = {
  id: string;
  pda: string;
  github_issue_url: string;
  amount: number | string; // bigint may come over wire as string
  state: "open" | "resolved" | "cancelled";
  submission_count: number;
  // GHB-184: scored+winner counter; null in mocks, treat as 0.
  review_eligible_count: number | null;
  created_at: string;
  bounty_meta: {
    title: string | null;
    description: string | null;
    release_mode: "auto" | "assisted";
    closed_by_user: boolean;
    created_by_user_id: string | null;
    reject_threshold: number | null;
    max_submissions: number | null;
    closed_by_cap_at: string | null;
  } | null;
};

// `cap_warning_sent_at` lives only in `bounty_meta` for relayer-side gating
// — the frontend never reads it, so we keep it out of the public select.
const ISSUE_SELECT =
  "id, pda, github_issue_url, amount, state, submission_count, review_eligible_count, created_at, bounty_meta(title, description, release_mode, closed_by_user, created_by_user_id, reject_threshold, max_submissions, closed_by_cap_at)";

/** Parse "https://github.com/<owner>/<repo>/issues/<n>" → repo + number. */
function parseGithubIssueUrl(url: string): { repo: string; issueNumber: number } {
  const m = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/);
  if (!m) return { repo: url, issueNumber: 0 };
  return { repo: m[1], issueNumber: Number(m[2]) };
}

/**
 * Map onchain state + UI flag to the broader frontend status bucket.
 *
 * `hasApprovedSubmission` is the off-chain shortcut: any
 * `submission_reviews.approved=true` for this bounty means the company
 * picked a winner, the on-chain `resolve_bounty` ix succeeded, and the
 * escrow has paid out. The relayer eventually flips
 * `issues.state = 'resolved'` to reflect the same fact, but on devnet
 * (no relayer) that flip never happens — so we treat the approved flag
 * as the immediate "this bounty is paid" signal. Same trick we use on
 * the submission side to flip a card to Winner without relayer lag.
 */
function deriveStatus(
  state: IssueRow["state"],
  closedByUser: boolean,
  submissionCount: number,
  hasApprovedSubmission: boolean,
  closedByCap: boolean,
): BountyStatus {
  if (closedByUser) return "closed";
  // GHB-184: cap-closed bounties surface as "closed" at the BountyStatus level.
  // The dedicated "cap_reached" badge is computed downstream in BountyRow.
  if (closedByCap) return "closed";
  if (state === "cancelled") return "closed";
  if (state === "resolved" || hasApprovedSubmission) return "paid";
  if (submissionCount > 0) return "reviewing";
  return "open";
}

/**
 * On-chain amounts are stored in lamports (native SOL has 9 decimals).
 * GHB-80 ships with SOL-only bounties; once SPL/USDC is added we'll need
 * to switch on `issues.mint` to pick the right decimals.
 */
const SOL_DECIMALS = 9;

function rowToBounty(
  row: IssueRow,
  submissionCount?: number,
  hasApprovedSubmission = false,
): Bounty {
  const { repo, issueNumber } = parseGithubIssueUrl(row.github_issue_url);
  const meta = row.bounty_meta;
  const amountRaw =
    typeof row.amount === "string" ? Number(row.amount) : row.amount;
  // Prefer the live count from the `submissions` table when the caller
  // gives us one — `issues.submission_count` lags forever because the
  // frontend can't UPDATE it (creator-only RLS). Fall back to the
  // mirror column for callers that haven't joined yet (mock data,
  // single-row fetch where the join would be wasteful).
  const effectiveCount = submissionCount ?? row.submission_count;
  const closedByCap = meta?.closed_by_cap_at != null;
  return {
    id: row.id,
    pda: row.pda,
    companyId: meta?.created_by_user_id ?? "",
    repo,
    issueNumber,
    issueUrl: row.github_issue_url,
    title: meta?.title ?? undefined,
    amountUsdc: amountRaw / 10 ** SOL_DECIMALS,
    status: deriveStatus(
      row.state,
      meta?.closed_by_user ?? false,
      effectiveCount,
      hasApprovedSubmission,
      closedByCap,
    ),
    releaseMode: meta?.release_mode ?? "auto",
    submissionCount: effectiveCount,
    rejectThreshold: meta?.reject_threshold ?? null,
    maxSubmissions: meta?.max_submissions ?? null,
    reviewEligibleCount: row.review_eligible_count ?? 0,
    closedByCap,
    createdAt: new Date(row.created_at).getTime(),
  };
}

/**
 * Group-count of `submissions` rows by `issue_pda`. Used by the
 * marketplace + company-dashboard fetchers to backfill a real
 * submission count per bounty (rather than the stale
 * `issues.submission_count` mirror).
 *
 * PostgREST has no direct `GROUP BY count(*)` over the REST surface, so
 * we fetch the raw `issue_pda` values and tally in JS. For the
 * dashboards' typical sizes (tens of bounties, low-hundreds of
 * submissions) this is plenty cheap; revisit if it ever shows up in
 * profiling.
 */
async function countSubmissionsByIssuePda(
  supabase: ReturnType<typeof createClient>,
  pdas: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (pdas.length === 0) return counts;
  const { data, error } = await supabase
    .from("submissions")
    .select("issue_pda")
    .in("issue_pda", pdas);
  if (error) {
    console.error("[countSubmissionsByIssuePda]", error);
    return counts;
  }
  for (const row of data ?? []) {
    counts.set(row.issue_pda, (counts.get(row.issue_pda) ?? 0) + 1);
  }
  return counts;
}

/**
 * Map `bountyPda → winningSubmissionId` for every bounty in the input
 * that has an approved submission. Returns an empty map when none.
 *
 * Used by `fetchSubmissionsByDev` to derive the "lost" status: if a
 * dev's submission's bounty has a winner that isn't them, their PR is
 * effectively closed — escrow paid out, can't win anymore.
 *
 * Reuses the same two-step query as `fetchPdasWithApprovedSubmission`
 * but keeps the winning submission_id around (instead of collapsing to
 * a Set of PDAs).
 */
async function findApprovedSubmissionByPda(
  supabase: ReturnType<typeof createClient>,
  pdas: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (pdas.length === 0) return out;

  const { data: subs, error: subErr } = await supabase
    .from("submissions")
    .select("id, issue_pda")
    .in("issue_pda", pdas);
  if (subErr) {
    console.error("[findApprovedSubmissionByPda:subs]", subErr);
    return out;
  }
  const subRows = subs ?? [];
  if (subRows.length === 0) return out;

  const subIds = subRows.map((r) => r.id);
  const { data: reviews, error: revErr } = await supabase
    .from("submission_reviews" as never)
    .select("submission_id, approved")
    .in("submission_id", subIds)
    .eq("approved", true);
  if (revErr) {
    console.error("[findApprovedSubmissionByPda:reviews]", revErr);
    return out;
  }
  const approvedIds = new Set(
    ((reviews as unknown as Array<{ submission_id: string }>) ?? []).map(
      (r) => r.submission_id,
    ),
  );

  // First approved submission per PDA wins the slot; in practice there
  // should only ever be one (the program enforces a single
  // `resolve_bounty` call per bounty), so the precedence doesn't matter.
  for (const row of subRows) {
    if (!approvedIds.has(row.id)) continue;
    if (!out.has(row.issue_pda)) out.set(row.issue_pda, row.id);
  }
  return out;
}

/**
 * Set of bounty PDAs that have AT LEAST ONE submission with an off-chain
 * `submission_reviews.approved = true`. Used by `deriveStatus` to mark a
 * bounty as paid the moment the company picks a winner, without waiting
 * for the relayer to flip `issues.state = 'resolved'`.
 *
 * Two-step: fetch approved submission ids for the bounty's PDAs (via the
 * `submissions.issue_pda` plain-text column — no FK), then look up which
 * issue_pdas they belong to.
 */
async function fetchPdasWithApprovedSubmission(
  supabase: ReturnType<typeof createClient>,
  pdas: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  if (pdas.length === 0) return out;

  // 1. Submissions for the requested bounties — id + issue_pda.
  const { data: subs, error: subErr } = await supabase
    .from("submissions")
    .select("id, issue_pda")
    .in("issue_pda", pdas);
  if (subErr) {
    console.error("[fetchPdasWithApprovedSubmission:subs]", subErr);
    return out;
  }
  const subRows = subs ?? [];
  if (subRows.length === 0) return out;

  // 2. Of those, which have approved=true in submission_reviews.
  // `submission_reviews` isn't in db.types.ts — `as never` cast keeps
  // the typed builder quiet.
  const subIds = subRows.map((r) => r.id);
  const { data: reviews, error: revErr } = await supabase
    .from("submission_reviews" as never)
    .select("submission_id, approved")
    .in("submission_id", subIds)
    .eq("approved", true);
  if (revErr) {
    console.error("[fetchPdasWithApprovedSubmission:reviews]", revErr);
    return out;
  }
  const approvedIds = new Set(
    ((reviews as unknown as Array<{ submission_id: string }>) ?? []).map(
      (r) => r.submission_id,
    ),
  );

  // 3. Map approved sub ids back to their bounty PDAs.
  for (const row of subRows) {
    if (approvedIds.has(row.id)) out.add(row.issue_pda);
  }
  return out;
}

export async function fetchBounties(): Promise<Bounty[]> {
  if (!useRealBackend) {
    return mockLoadBounties();
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("issues")
    .select(ISSUE_SELECT)
    .order("created_at", { ascending: false })
    .returns<IssueRow[]>();
  if (error) {
    console.error("[fetchBounties]", error);
    return [];
  }
  const rows = data ?? [];
  const pdas = rows.map((r) => r.pda);
  const [counts, approvedSet] = await Promise.all([
    countSubmissionsByIssuePda(supabase, pdas),
    fetchPdasWithApprovedSubmission(supabase, pdas),
  ]);
  return rows.map((row) =>
    rowToBounty(row, counts.get(row.pda) ?? 0, approvedSet.has(row.pda)),
  );
}

export async function fetchBounty(id: string): Promise<Bounty | null> {
  if (!useRealBackend) {
    return mockLoadBounties().find((b) => b.id === id) ?? null;
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("issues")
    .select(ISSUE_SELECT)
    .eq("id", id)
    .single<IssueRow>();
  if (error) {
    console.error("[fetchBounty]", error);
    return null;
  }
  if (!data) return null;
  // Single-row read still needs the approved-flag lookup so the bounty
  // detail page reflects the paid status the moment a winner is picked.
  const approvedSet = await fetchPdasWithApprovedSubmission(supabase, [data.pda]);
  return rowToBounty(data, undefined, approvedSet.has(data.pda));
}

export async function fetchBountiesByCompany(
  companyId: string,
): Promise<Bounty[]> {
  if (!useRealBackend) {
    return mockBountiesByCompany(companyId);
  }
  const supabase = createClient();
  // companyId = profiles.user_id, joined onto bounty_meta.created_by_user_id
  const { data, error } = await supabase
    .from("issues")
    .select(ISSUE_SELECT)
    .eq("bounty_meta.created_by_user_id", companyId)
    .order("created_at", { ascending: false })
    .returns<IssueRow[]>();
  if (error) {
    console.error("[fetchBountiesByCompany]", error);
    return [];
  }
  // PostgREST inner-filter on a related table doesn't always exclude rows
  // whose meta is null — filter client-side as a belt-and-suspenders.
  const ownRows = (data ?? []).filter(
    (row) => row.bounty_meta?.created_by_user_id === companyId,
  );
  const pdas = ownRows.map((r) => r.pda);
  const [counts, approvedSet] = await Promise.all([
    countSubmissionsByIssuePda(supabase, pdas),
    fetchPdasWithApprovedSubmission(supabase, pdas),
  ]);
  return ownRows.map((row) =>
    rowToBounty(row, counts.get(row.pda) ?? 0, approvedSet.has(row.pda)),
  );
}

/* ---------------------------------------------------------------- */
/* Submissions                                                        */
/* ---------------------------------------------------------------- */

type SubmissionRow = {
  id: string;
  pda: string;
  pr_url: string;
  issue_pda: string;
  state: "pending" | "scored" | "winner" | "auto_rejected";
  rank: number | null;
  tx_hash: string | null;
  created_at: string;
  submission_meta: {
    note: string | null;
    submitted_by_user_id: string | null;
  } | null;
};

// `submissions.issue_pda` is a plain text column with no FK constraint, so
// PostgREST can't auto-embed `issues`. We fetch submissions, then resolve
// the matching issue UUIDs in a second round-trip via `issues.pda`.
//
// GHB-90 added `pda` (to join evaluations) and `rank` (for "#N of M").
// GHB-93 added `tx_hash` so the earnings dashboard can show the payout
// explorer link per submission without an extra round-trip.
// `rank`, `tx_hash` and the `auto_rejected` enum value aren't in the
// generated db.types.ts yet — `as string` cast on the select string
// keeps the typed builder quiet without regenerating types here.
const SUBMISSION_SELECT =
  "id, pda, pr_url, issue_pda, state, rank, tx_hash, created_at, submission_meta(note, submitted_by_user_id)";

function parseGithubPrUrl(url: string): { prRepo: string; prNumber: number } {
  const m = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!m) return { prRepo: url, prNumber: 0 };
  return { prRepo: m[1], prNumber: Number(m[2]) };
}

/** GHB-84 + GHB-83 + GHB-85 review shape from `submission_reviews`.
 * Optional — passing `null` (no row in the table) means "not decided
 * yet". Column history:
 *   0010 → rejected, reject_reason
 *   0011 → approval_feedback
 *   0012 → approved
 *   0013 → auto_rejected
 */
type SubmissionReviewRow = {
  rejected: boolean;
  approved: boolean;
  auto_rejected: boolean;
  reject_reason: string | null;
  approval_feedback: string | null;
};

/**
 * GHB-90: derive the dev-facing granular lifecycle. Order matters — we
 * collapse to the strongest signal:
 *
 *   approved > lost > auto_rejected > rejected > scored > evaluating > submitted
 *
 * `lost` ranks above the rejection states because if both a winner exists
 * AND the company also wrote a manual reject for this row, the bounty
 * being closed is the more useful headline (the dev knows they can't win
 * regardless). `lost` ranks below `approved` because the dev's own win
 * trumps everything.
 */
function deriveGranularStatus(
  status: SubmissionStatus,
  review: SubmissionReviewRow | null | undefined,
  hasEvalRow: boolean,
  hasScore: boolean,
): SubmissionGranularStatus {
  if (status === "accepted") return "approved";
  if (status === "lost") return "lost";
  if (status === "rejected") {
    return review?.auto_rejected ? "auto_rejected" : "rejected";
  }
  // pending: split on whether the relayer pipeline has touched it yet.
  if (hasScore) return "scored";
  if (hasEvalRow) return "evaluating";
  return "submitted";
}

function rowToSubmission(
  row: SubmissionRow,
  bountyId: string,
  review?: SubmissionReviewRow | null,
  /**
   * When the dev's bounty has an approved winner that ISN'T this row,
   * pass `true` to mark the submission as "lost" — escrow paid out, no
   * longer eligible to win. Defaults to `false` so callers that don't
   * fetch the winner map (e.g. mock paths, single-bounty company-side
   * lookups) keep their existing behaviour.
   */
  bountyAwardedToOther = false,
  /**
   * GHB-90 hydration. Pass `null` when the caller didn't fetch
   * evaluations — `granularStatus` collapses to "submitted" but the UI
   * still works with the coarse `status`.
   */
  evaluation: SubmissionScore | null = null,
  totalForBounty: number | null = null,
): Submission {
  const { prRepo, prNumber } = parseGithubPrUrl(row.pr_url);
  // Status precedence: Accepted > Rejected > Lost > Pending.
  //
  // "Accepted" comes from EITHER the on-chain mirror (relayer caught up
  // to `submissions.state = 'winner'`) OR the off-chain
  // `submission_reviews.approved` flag — set immediately when the
  // company picks the winner, so the UI reflects it without relayer
  // lag (devnet runs without a relayer hit this).
  //
  // "Lost" only fires when the bounty has an approved winner that isn't
  // this submission. Without the winner-map lookup the flag is false
  // and we fall through to the legacy three-way derivation.
  const onchainWinner = row.state === "winner";
  const offchainApproved = review?.approved === true;
  let status: SubmissionStatus = "pending";
  if (onchainWinner || offchainApproved) status = "accepted";
  else if (review?.rejected) status = "rejected";
  else if (bountyAwardedToOther) status = "lost";

  const hasEvalRow = !!evaluation;
  const hasScore = typeof evaluation?.score === "number";
  const granularStatus = deriveGranularStatus(
    status,
    review,
    hasEvalRow,
    hasScore,
  );

  return {
    id: row.id,
    bountyId,
    devId: row.submission_meta?.submitted_by_user_id ?? "",
    prUrl: row.pr_url,
    prRepo,
    prNumber,
    note: row.submission_meta?.note ?? undefined,
    status,
    rejectReason:
      review?.rejected && review.reject_reason
        ? review.reject_reason
        : undefined,
    approvalFeedback:
      status === "accepted" && review?.approval_feedback
        ? review.approval_feedback
        : undefined,
    autoRejected: review?.auto_rejected ?? false,
    granularStatus,
    score: evaluation?.score ?? null,
    scoreSource: evaluation?.source ?? null,
    rank: row.rank ?? null,
    totalForBounty,
    payoutTxHash: row.tx_hash ?? null,
    createdAt: new Date(row.created_at).getTime(),
  };
}

async function resolveIssueIdsByPda(
  supabase: ReturnType<typeof createClient>,
  pdas: string[],
): Promise<Map<string, string>> {
  if (pdas.length === 0) return new Map();
  const { data, error } = await supabase
    .from("issues")
    .select("id, pda")
    .in("pda", pdas);
  if (error) {
    console.error("[resolveIssueIdsByPda]", error);
    return new Map();
  }
  return new Map((data ?? []).map((r) => [r.pda, r.id]));
}

export async function fetchSubmissionsByBounty(
  bountyId: string,
): Promise<Submission[]> {
  if (!useRealBackend) {
    return mockSubmissionsByBounty(bountyId);
  }
  const supabase = createClient();
  const { data: issue } = await supabase
    .from("issues")
    .select("pda")
    .eq("id", bountyId)
    .single();
  if (!issue) return [];
  const { data, error } = await supabase
    .from("submissions")
    .select(SUBMISSION_SELECT)
    .eq("issue_pda", issue.pda)
    .order("created_at", { ascending: false })
    .returns<SubmissionRow[]>();
  if (error) {
    console.error("[fetchSubmissionsByBounty]", error);
    return [];
  }
  return (data ?? []).map((row) => rowToSubmission(row, bountyId));
}

export async function fetchSubmissionsByDev(
  devId: string,
): Promise<Submission[]> {
  if (!useRealBackend) {
    return mockSubmissionsByDev(devId);
  }
  const supabase = createClient();
  // Look up submission_meta first to get the submission ids for this user,
  // then fetch the submissions themselves. We can't filter directly on a
  // related table without an !inner hint, and the inverse query is simpler.
  const { data: metaRows, error: metaErr } = await supabase
    .from("submission_meta")
    .select("submission_id")
    .eq("submitted_by_user_id", devId);
  if (metaErr) {
    console.error("[fetchSubmissionsByDev:meta]", metaErr);
    return [];
  }
  const ids = (metaRows ?? []).map((r) => r.submission_id);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("submissions")
    .select(SUBMISSION_SELECT)
    .in("id", ids)
    .order("created_at", { ascending: false })
    .returns<SubmissionRow[]>();
  if (error) {
    console.error("[fetchSubmissionsByDev]", error);
    return [];
  }
  const rows = data ?? [];
  const pdas = Array.from(new Set(rows.map((r) => r.issue_pda)));
  const [idByPda, winnerByPda, totalByPda] = await Promise.all([
    resolveIssueIdsByPda(supabase, pdas),
    // GHB-92 follow-up: per-bounty "who won?" so we can flip the dev's
    // own submission to "lost" when the bounty has been awarded to
    // somebody else. Cheap (one extra query, scoped to the dev's PDAs).
    findApprovedSubmissionByPda(supabase, pdas),
    // GHB-90: total competing submissions per bounty so the row can
    // render "Rank #2 of 5". We already had `countSubmissionsByIssuePda`
    // for the marketplace; reuse it here scoped to the dev's PDAs.
    countSubmissionsByIssuePda(supabase, pdas),
  ]);
  // GHB-84: hydrate the company's review decision so the dev sees the
  // "Rejected" status + feedback on their own submissions list. The
  // submission_reviews table isn't in the generated db.types.ts —
  // bypass the typed builder via `as never` (same pattern as the
  // company-side fetcher and `evaluations`).
  const subIds = rows.map((r) => r.id);
  const reviewById = new Map<string, SubmissionReviewRow>();
  if (subIds.length > 0) {
    const { data: reviews } = await supabase
      .from("submission_reviews" as never)
      .select(
        "submission_id, rejected, approved, auto_rejected, reject_reason, approval_feedback",
      )
      .in("submission_id", subIds);
    const reviewRows = (reviews as unknown as Array<{
      submission_id: string;
      rejected: boolean;
      approved: boolean;
      auto_rejected: boolean;
      reject_reason: string | null;
      approval_feedback: string | null;
    }>) ?? [];
    for (const r of reviewRows) {
      reviewById.set(r.submission_id, {
        rejected: r.rejected,
        approved: r.approved,
        auto_rejected: r.auto_rejected,
        reject_reason: r.reject_reason,
        approval_feedback: r.approval_feedback,
      });
    }
  }
  // GHB-90: pull evaluations for the dev's submission PDAs so we can
  // surface the score, source and granular status. One IN query, keep
  // the newest row per PDA (matches the company-side fetcher's "newest
  // wins" rule). `evaluations` isn't in db.types.ts — `as never` cast.
  const subPdas = rows.map((r) => r.pda);
  const evalByPda = new Map<string, SubmissionScore>();
  if (subPdas.length > 0) {
    const { data: evalRows } = await supabase
      .from("evaluations" as never)
      .select("submission_pda, source, score, reasoning, created_at")
      .in("submission_pda", subPdas)
      .order("created_at", { ascending: false });
    const list = (evalRows as unknown as Array<{
      submission_pda: string;
      source: string | null;
      score: number | null;
      reasoning: string | null;
      created_at: string;
    }>) ?? [];
    for (const e of list) {
      if (evalByPda.has(e.submission_pda)) continue; // newest wins
      evalByPda.set(e.submission_pda, {
        score: typeof e.score === "number" ? e.score : null,
        source: e.source ?? null,
        reasoning: e.reasoning ?? null,
      });
    }
  }
  return rows.map((row) => {
    const winnerSubId = winnerByPda.get(row.issue_pda);
    const bountyAwardedToOther =
      winnerSubId != null && winnerSubId !== row.id;
    return rowToSubmission(
      row,
      idByPda.get(row.issue_pda) ?? "",
      reviewById.get(row.id) ?? null,
      bountyAwardedToOther,
      evalByPda.get(row.pda) ?? null,
      totalByPda.get(row.issue_pda) ?? null,
    );
  });
}

/* ---------------------------------------------------------------- */
/* GHB-91: submission detail page                                     */
/* ---------------------------------------------------------------- */

/** One Opus dimension. Mirrors `relayer/src/opus.ts:DimensionScore`. */
export type OpusDimension = {
  score: number;
  reasoning: string;
};

/** Structured Opus report shape — what the relayer writes into
 *  `evaluations.report` (jsonb). Mirrors `OpusReport` in the relayer. */
export type OpusReport = {
  code_quality: OpusDimension;
  test_coverage: OpusDimension;
  requirements_match: OpusDimension;
  security: OpusDimension;
  summary: string;
};

/**
 * Full submission detail for `/app/submissions/[id]` (GHB-91). Combines
 * the dev's submission + the parent bounty + company branding + the
 * full Opus evaluation report (4 dimensions + summary) + payment info
 * (tx_hash if won, derived from `submissions.tx_hash`).
 *
 * `null` is returned when the row doesn't exist or the caller isn't
 * authorized to read it (RLS).
 */
export type SubmissionDetail = {
  submission: Submission;
  bounty: Bounty | null;
  company: Company | null;
  /** Full report (4 dimensions + summary). null when no eval row. */
  report: OpusReport | null;
  /** Free-form reasoning column from `evaluations`. Falls back to the
   *  report's summary when present. */
  reasoning: string | null;
  /** "opus", "stub", "genlayer". */
  scoreSource: string | null;
  /** Number of submissions on this bounty whose score >= reject_threshold.
   *  Used to render "#X above threshold". null when no threshold set. */
  passedCount: number | null;
  /** On-chain tx signature for the payout, when the bounty resolved
   *  to this submission. null otherwise. */
  payoutTxHash: string | null;
  /**
   * GHB-58: GenLayer second-opinion verdict. Null when the relayer
   * didn't call GenLayer for this submission (feature disabled,
   * consensus timed out, etc.). When present, the page renders a side-
   * by-side comparison: Sonnet score vs GenLayer score + per-dimension
   * deltas + a deep-link to the GenLayer tx.
   */
  genlayer: {
    score: number;
    status: "passed" | "rejected_by_genlayer";
    dimensions: {
      code_quality: number;
      test_coverage: number;
      requirements_match: number;
      security: number;
    };
    txHash: string;
  } | null;
};

export async function fetchSubmissionDetail(
  submissionId: string,
): Promise<SubmissionDetail | null> {
  if (!useRealBackend) {
    // Mock path: best-effort lookup from localStorage. We don't have
    // evaluations/reports in the mock, so the detail page degrades to
    // "Pending evaluation". Sufficient for dev-bypass screens.
    const all = mockLoadSubmissions();
    const sub = all.find((s) => s.id === submissionId);
    if (!sub) return null;
    const bounties = mockLoadBounties();
    const bounty = bounties.find((b) => b.id === sub.bountyId) ?? null;
    return {
      submission: sub,
      bounty,
      company: null,
      report: null,
      reasoning: null,
      scoreSource: null,
      passedCount: null,
      payoutTxHash: null,
      genlayer: null,
    };
  }

  const supabase = createClient();

  // 1. Submission row + meta. `tx_hash` is now part of SUBMISSION_SELECT
  //    (GHB-93) so the payment row + earnings dashboard share one query
  //    shape. We refetch via `id` instead of routing through
  //    fetchSubmissionsByDev so the page works for any submission the
  //    viewer has SELECT access to.
  const { data: subRaw, error: subErr } = await supabase
    .from("submissions")
    .select(SUBMISSION_SELECT)
    .eq("id", submissionId)
    .single();
  if (subErr || !subRaw) {
    if (subErr) console.error("[fetchSubmissionDetail:submission]", subErr);
    return null;
  }
  const subRow = subRaw as unknown as SubmissionRow;

  // 2. Resolve issue uuid + bounty + winner + total + threshold.
  const idByPda = await resolveIssueIdsByPda(supabase, [subRow.issue_pda]);
  const bountyId = idByPda.get(subRow.issue_pda) ?? "";
  const [winnerByPda, totalByPda, bounty] = await Promise.all([
    findApprovedSubmissionByPda(supabase, [subRow.issue_pda]),
    countSubmissionsByIssuePda(supabase, [subRow.issue_pda]),
    bountyId ? fetchBounty(bountyId) : Promise.resolve(null),
  ]);

  // 3. Review row + evaluation (with full report). Same `as never`
  //    cast pattern used elsewhere for relayer-managed tables.
  const [reviewQ, evalQ] = await Promise.all([
    supabase
      .from("submission_reviews" as never)
      .select(
        "submission_id, rejected, approved, auto_rejected, reject_reason, approval_feedback",
      )
      .eq("submission_id", submissionId)
      .maybeSingle(),
    supabase
      .from("evaluations" as never)
      .select(
        "submission_pda, source, score, reasoning, report, genlayer_score, genlayer_status, genlayer_dimensions, genlayer_tx_hash, created_at",
      )
      .eq("submission_pda", subRow.pda)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const reviewRow = (reviewQ.data as unknown as SubmissionReviewRow | null) ?? null;
  const evalRow = (evalQ.data as unknown as {
    source: string | null;
    score: number | null;
    reasoning: string | null;
    report: OpusReport | null;
    genlayer_score: number | null;
    genlayer_status: string | null;
    genlayer_dimensions: SubmissionDetail["genlayer"] extends infer T
      ? T extends { dimensions: infer D }
        ? D | null
        : never
      : never;
    genlayer_tx_hash: string | null;
  } | null) ?? null;

  const winnerSubId = winnerByPda.get(subRow.issue_pda);
  const bountyAwardedToOther =
    winnerSubId != null && winnerSubId !== subRow.id;
  const evaluation: SubmissionScore | null = evalRow
    ? {
        score: evalRow.score,
        source: evalRow.source,
        reasoning: evalRow.reasoning,
      }
    : null;

  const submission = rowToSubmission(
    subRow,
    bountyId,
    reviewRow,
    bountyAwardedToOther,
    evaluation,
    totalByPda.get(subRow.issue_pda) ?? null,
  );

  // 4. Company branding via the bounty's owner. Cheap single-row read.
  const company =
    bounty?.companyId ? await fetchCompany(bounty.companyId) : null;

  // 5. "Above threshold" count: how many submissions on this bounty
  //    scored >= bounty.reject_threshold (or >= DEFAULT when not set).
  //    Skipped when the bounty doesn't exist; surfaces as null in the
  //    UI which renders "—".
  let passedCount: number | null = null;
  if (bounty) {
    const threshold = bounty.rejectThreshold ?? null;
    if (threshold != null) {
      const { data: pass } = await supabase
        .from("evaluations" as never)
        .select("submission_pda, score")
        .gte("score", threshold);
      const passList = (pass as unknown as Array<{
        submission_pda: string;
        score: number;
      }>) ?? [];
      // Filter to submissions on THIS bounty (one query, JS filter is
      // cheaper than two joins for the small N we have here).
      const ourPdas = new Set([subRow.pda]);
      // Refetch the bounty's submission PDAs — already implied by
      // countSubmissionsByIssuePda, but we need the pdas not the count.
      const { data: subList } = await supabase
        .from("submissions")
        .select("pda")
        .eq("issue_pda", subRow.issue_pda);
      for (const r of subList ?? []) ourPdas.add(r.pda);
      passedCount = passList.filter((p) => ourPdas.has(p.submission_pda)).length;
    }
  }

  // GHB-58: build the GenLayer verdict block when all four columns are
  // present. Partial fills shouldn't happen (the relayer writes them
  // atomically) but we treat any missing field as "no verdict" to be
  // resilient.
  const glScore = evalRow?.genlayer_score ?? null;
  // Narrow status at the declaration so the discriminated union below
  // gets the right literal type — a Next.js build on Vercel (stricter
  // TS than our root pnpm typecheck) refused to carry the narrow
  // through the multi-`&&` truthy guard otherwise.
  const glStatus: "passed" | "rejected_by_genlayer" | null =
    evalRow?.genlayer_status === "passed" ||
    evalRow?.genlayer_status === "rejected_by_genlayer"
      ? evalRow.genlayer_status
      : null;
  const glDims = evalRow?.genlayer_dimensions ?? null;
  const glTx = evalRow?.genlayer_tx_hash ?? null;
  const genlayer =
    typeof glScore === "number" && glStatus !== null && glDims && glTx
      ? {
          score: glScore,
          status: glStatus,
          dimensions: glDims,
          txHash: glTx,
        }
      : null;

  return {
    submission,
    bounty,
    company,
    report: evalRow?.report ?? null,
    reasoning: evalRow?.reasoning ?? null,
    scoreSource: evalRow?.source ?? null,
    passedCount,
    payoutTxHash: subRow.tx_hash ?? null,
    genlayer,
  };
}

/* ---------------------------------------------------------------- */
/* Submissions list view (company-side review UI)                     */
/* ---------------------------------------------------------------- */

export type SubmissionScore = {
  /** Integer 1-10, set by the relayer/Opus pipeline. Null while pending. */
  score: number | null;
  /** Source of the score — "opus" (Sonnet/Opus pipeline), "stub", "genlayer". */
  source: string | null;
  /** Free-form reasoning surfaced from the evaluator. Null for stubs. */
  reasoning: string | null;
};

/**
 * Submission with everything the company needs to decide what to do
 * with each PR: dev profile, score (if evaluated), state on-chain.
 *
 * `recommendedReject` is computed against the bounty's `reject_threshold`
 * — the field name is intentionally a verb / suggestion, not a hard
 * gate. The company always has final say in `assisted` mode; the flag
 * just steers their attention to the obvious noise.
 */
export type EnrichedSubmission = {
  id: string;
  pda: string;
  prUrl: string;
  prRepo: string;
  prNumber: number;
  /**
   * On-chain solver pubkey (base58). Mirrored verbatim from
   * `submissions.solver`, which the program writes during `submit_solution`.
   * Used as the `winner` account when calling `resolve_bounty` — the
   * program enforces `winner.key() == submission.solver` so we MUST pass
   * this exact value, not the dev's profile wallet (the dev may have
   * multiple wallets; only the one that signed `submit_solution` is the
   * legal recipient).
   */
  solver: string;
  state: "pending" | "scored" | "winner";
  rank: number | null;
  createdAt: number;
  note: string | undefined;
  /** Developer profile, when we can resolve it (the dev row exists). */
  dev: {
    id: string;
    username: string | undefined;
    githubHandle: string | undefined;
    avatarUrl: string | undefined;
    email: string | undefined;
  };
  evaluation: SubmissionScore | null;
  /** `score < bounty.rejectThreshold` — only meaningful when scored. */
  recommendedReject: boolean;
  /**
   * Company-side review decision (GHB-83 / GHB-84 / GHB-85). Mirrors
   * the `submission_reviews` row when present; `null` otherwise —
   * meaning the company hasn't acted on this submission yet.
   *
   * `rejected: true` is a soft, off-chain decision: the dev's submission
   * is hidden from the active review queue, but the on-chain Submission
   * account stays in `Pending` / `Scored`.
   *
   * `approved: true` is the off-chain "this submission won" mirror,
   * written immediately by `recordWinnerOnchain` so the UI doesn't have
   * to wait for the relayer to flip `submissions.state = 'winner'`.
   * Read-side: either signal flips the card into the Winner state.
   *
   * `autoRejected: true` refines the rejection: `true` means the
   * relayer auto-rejected because the score landed below the bounty's
   * threshold (the rejection reason holds the score-vs-threshold
   * message). `false` means a human at the company manually rejected.
   */
  review: {
    rejected: boolean;
    approved: boolean;
    autoRejected: boolean;
    rejectReason: string | null;
    approvalFeedback: string | null;
    decidedAt: number | null;
  } | null;
};

/**
 * Pull the full submissions view for a single bounty (company-side
 * review modal). Three queries, joined client-side:
 *
 *   1. `submissions` rows (with `submission_meta` embedded for note +
 *      submitter id).
 *   2. `developers` profiles for the unique solver ids.
 *   3. `evaluations` (one per submission_pda — we surface the most
 *      recent if multiple exist).
 *
 * The relayer side may not have written evaluations yet (pipeline is
 * blocked on INFRA-1) — submissions without an evaluation come back
 * with `evaluation: null` and the UI shows "Pending review" instead
 * of a numeric score.
 */
export async function fetchSubmissionsForBountyDetailed(
  bountyId: string,
  rejectThreshold: number | null,
): Promise<EnrichedSubmission[]> {
  if (!useRealBackend) return [];
  const supabase = createClient();

  // 1. Look up the bounty's PDA (`submissions.issue_pda` is plain text,
  //    no FK). Cheap single-row read.
  const { data: issue, error: issueErr } = await supabase
    .from("issues")
    .select("pda")
    .eq("id", bountyId)
    .single();
  if (issueErr || !issue) {
    console.error("[fetchSubmissionsForBountyDetailed:issue]", issueErr);
    return [];
  }

  // 2. Submissions with the meta row embedded (FK exists on
  //    `submission_meta.submission_id`). Newest first.
  // `db.types.ts` is stale — it doesn't know about the `rank` column or the
  // GHB-83 `submission_reviews` table, so we cast through `unknown` to
  // keep TS quiet without regenerating types here. Same trick for
  // `evaluations` below.
  const { data: subs, error: subErr } = await supabase
    .from("submissions")
    .select(
      "id, pda, solver, pr_url, state, rank, created_at, submission_meta(note, submitted_by_user_id)" as string,
    )
    .eq("issue_pda", issue.pda)
    .order("created_at", { ascending: false });
  if (subErr) {
    console.error("[fetchSubmissionsForBountyDetailed:subs]", subErr);
    return [];
  }
  const subRows = (subs as unknown as Array<{
    id: string;
    pda: string;
    solver: string;
    pr_url: string;
    state: "pending" | "scored" | "winner";
    rank: number | null;
    created_at: string;
    submission_meta: {
      note: string | null;
      submitted_by_user_id: string | null;
    } | null;
  }>) ?? [];
  if (subRows.length === 0) return [];

  // 3. Resolve dev profiles in one IN query, keyed by user_id.
  const devIds = Array.from(
    new Set(
      subRows
        .map((r) => r.submission_meta?.submitted_by_user_id)
        .filter((x): x is string => !!x),
    ),
  );
  const devsById = new Map<
    string,
    {
      username: string | null;
      github_handle: string | null;
      avatar_url: string | null;
    }
  >();
  const profilesById = new Map<string, { email: string }>();
  if (devIds.length > 0) {
    const [{ data: devs }, { data: profs }] = await Promise.all([
      supabase
        .from("developers")
        .select("user_id, username, github_handle, avatar_url")
        .in("user_id", devIds),
      supabase.from("profiles").select("user_id, email").in("user_id", devIds),
    ]);
    for (const d of devs ?? []) {
      devsById.set(d.user_id, {
        username: d.username ?? null,
        github_handle: d.github_handle ?? null,
        avatar_url: d.avatar_url ?? null,
      });
    }
    for (const p of profs ?? []) {
      profilesById.set(p.user_id, { email: p.email ?? "" });
    }
  }

  // 4. Pull evaluations for the submission PDAs in one IN query. Keep
  //    the newest row per submission as the "current" evaluation
  //    (Opus may have run multiple times after retries).
  //
  // `evaluations` isn't in the generated `db.types.ts` yet — bypass the
  // typed builder via an `as never` cast on the table name. Same
  // safety as a typed query at runtime. We do the same below for
  // `submission_reviews` (added in migration 0010).
  const subPdas = subRows.map((r) => r.pda);
  const subIds = subRows.map((r) => r.id);
  const [evalQ, reviewQ] = await Promise.all([
    supabase
      .from("evaluations" as never)
      .select("submission_pda, source, score, reasoning, created_at")
      .in("submission_pda", subPdas)
      .order("created_at", { ascending: false }),
    supabase
      .from("submission_reviews" as never)
      .select(
        "submission_id, rejected, approved, auto_rejected, reject_reason, approval_feedback, decided_at",
      )
      .in("submission_id", subIds),
  ]);
  const evalRows = (evalQ.data as unknown as Array<{
    submission_pda: string;
    source: string | null;
    score: number | null;
    reasoning: string | null;
    created_at: string;
  }>) ?? [];
  const evalByPda = new Map<string, SubmissionScore>();
  for (const e of evalRows) {
    if (evalByPda.has(e.submission_pda)) continue; // newest wins
    evalByPda.set(e.submission_pda, {
      score: typeof e.score === "number" ? e.score : null,
      source: e.source ?? null,
      reasoning: e.reasoning ?? null,
    });
  }

  // GHB-83+84+85: review decisions, keyed by submission_id (PK in the
  // review table). Missing row → no decision yet.
  const reviewRows = (reviewQ.data as unknown as Array<{
    submission_id: string;
    rejected: boolean;
    approved: boolean;
    auto_rejected: boolean;
    reject_reason: string | null;
    approval_feedback: string | null;
    decided_at: string;
  }>) ?? [];
  const reviewById = new Map<string, EnrichedSubmission["review"]>();
  for (const r of reviewRows) {
    reviewById.set(r.submission_id, {
      rejected: r.rejected,
      approved: r.approved,
      autoRejected: r.auto_rejected,
      rejectReason: r.reject_reason,
      approvalFeedback: r.approval_feedback,
      decidedAt: r.decided_at ? new Date(r.decided_at).getTime() : null,
    });
  }

  return subRows.map((row) => {
    const { prRepo, prNumber } = parseGithubPrUrl(row.pr_url);
    const devId = row.submission_meta?.submitted_by_user_id ?? "";
    const devProfile = devId ? devsById.get(devId) : undefined;
    const profile = devId ? profilesById.get(devId) : undefined;
    const evaluation = evalByPda.get(row.pda) ?? null;
    // GHB-85: fall back to the global default if the bounty doesn't
    // declare a per-issue threshold. Pass `false` to opt out entirely
    // (e.g. tests that want pure manual triage).
    const effective = effectiveRejectThreshold(rejectThreshold);
    const recommendedReject =
      evaluation?.score != null &&
      effective != null &&
      evaluation.score < effective;
    return {
      id: row.id,
      pda: row.pda,
      solver: row.solver,
      prUrl: row.pr_url,
      prRepo,
      prNumber,
      state: row.state,
      rank: row.rank,
      createdAt: new Date(row.created_at).getTime(),
      note: row.submission_meta?.note ?? undefined,
      dev: {
        id: devId,
        username: devProfile?.username ?? undefined,
        githubHandle: devProfile?.github_handle ?? undefined,
        avatarUrl: devProfile?.avatar_url ?? undefined,
        email: profile?.email ?? undefined,
      },
      evaluation,
      recommendedReject,
      review: reviewById.get(row.id) ?? null,
    };
  });
}

export async function hasDevSubmitted(
  devId: string,
  bountyId: string,
): Promise<boolean> {
  if (!useRealBackend) {
    return mockHasDevSubmitted(devId, bountyId);
  }
  const subs = await fetchSubmissionsByBounty(bountyId);
  return subs.some((s) => s.devId === devId);
}

/* ---------------------------------------------------------------- */
/* Aggregate fetcher used by the dev marketplace                      */
/* ---------------------------------------------------------------- */

export interface MarketplaceData {
  bounties: Bounty[];
  companies: Company[];
}

export async function fetchMarketplace(): Promise<MarketplaceData> {
  if (!useRealBackend) {
    return {
      bounties: mockLoadBounties(),
      companies: mockLoadUsers().filter(
        (u): u is Company => u.role === "company",
      ),
    };
  }
  const [bounties, companies] = await Promise.all([
    fetchBounties(),
    fetchCompanies(),
  ]);
  return { bounties, companies };
}

/* ---------------------------------------------------------------- */
/* Re-export types so callers don't have to import from store + types */
/* ---------------------------------------------------------------- */

export type { Bounty, Company, Dev, Submission } from "./types";
