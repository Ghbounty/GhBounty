import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Authoritative bounty status bucket, mirroring the dashboard's
 * `deriveStatus` (frontend/lib/data.ts). The on-chain `issues.state`
 * mirror lags behind reality on devnet (no relayer to flip
 * `resolved`), and `issues.submission_count` lags forever because only
 * the bounty creator can UPDATE it under RLS — so MCP callers must not
 * trust either raw column for claimability decisions.
 */
export type McpBountyStatus = "open" | "reviewing" | "capped" | "closed" | "paid";

export interface DeriveBountyStatusInput {
  state: "open" | "resolved" | "cancelled";
  closedByUser: boolean;
  closedByCap: boolean;
  submissionCount: number;
  hasApprovedSubmission: boolean;
}

/**
 * Derive the dashboard-equivalent status bucket from the on-chain state
 * plus off-chain flags: `bounty_meta.closed_by_user` (manual close),
 * `bounty_meta.closed_by_cap_at` (submission cap reached), the live
 * submission count from the `submissions` table, and any
 * `submission_reviews.approved = true` row (company picked a winner →
 * escrow has paid out).
 */
export function deriveBountyStatus(input: DeriveBountyStatusInput): McpBountyStatus {
  if (input.closedByUser || input.state === "cancelled") return "closed";
  if (input.closedByCap) return "capped";
  if (input.state === "resolved" || input.hasApprovedSubmission) return "paid";
  if (input.submissionCount > 0) return "reviewing";
  return "open";
}

export interface BountyEnrichment {
  /** Live submission counts keyed by issue PDA. */
  counts: Map<string, number>;
  /** PDAs with at least one approved submission (winner picked, paid). */
  approvedPdas: Set<string>;
}

const EMPTY_ENRICHMENT: BountyEnrichment = { counts: new Map(), approvedPdas: new Set() };

/**
 * Fetch live per-bounty submission counts and approved-submission flags.
 *
 * Two-step like the frontend: `submissions` rows for the PDAs first,
 * then `submission_reviews` for the resulting submission ids. Both
 * queries soft-fail to empty on error — the caller falls back to the
 * lagging `issues.submission_count` mirror column instead of erroring
 * the whole listing.
 */
export async function fetchBountyEnrichment(pdas: string[]): Promise<BountyEnrichment> {
  if (pdas.length === 0) return EMPTY_ENRICHMENT;

  const supabase = supabaseAdmin();
  const { data: subs, error: subErr } = await supabase
    .from("submissions")
    .select("id, issue_pda")
    .in("issue_pda", pdas);
  if (subErr || !subs) return EMPTY_ENRICHMENT;

  const counts = new Map<string, number>();
  for (const row of subs) {
    counts.set(row.issue_pda, (counts.get(row.issue_pda) ?? 0) + 1);
  }

  const approvedPdas = new Set<string>();
  if (subs.length > 0) {
    const { data: reviews, error: revErr } = await supabase
      .from("submission_reviews")
      .select("submission_id, approved")
      .in("submission_id", subs.map((r) => r.id))
      .eq("approved", true);
    if (revErr || !reviews) return { counts, approvedPdas };
    const approvedIds = new Set(reviews.map((r) => r.submission_id));
    for (const row of subs) {
      if (approvedIds.has(row.id)) approvedPdas.add(row.issue_pda);
    }
  }
  return { counts, approvedPdas };
}

/** Map a user-supplied `filter.status` value onto a derived status bucket. */
export function filterStatusToBucket(
  status: string,
): "open" | "reviewing" | "capped" | "closed" | "paid" {
  switch (status) {
    case "open":
    case "reviewing":
    case "capped":
    case "closed":
    case "paid":
      return status;
    // Legacy on-chain state names accepted for backwards compatibility.
    case "resolved":
      return "paid";
    case "cancelled":
      return "closed";
    default:
      return "open";
  }
}
