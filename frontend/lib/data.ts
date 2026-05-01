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

import type { Bounty, BountyStatus, Company, Dev, Submission } from "./types";
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
  created_at: string;
  bounty_meta: {
    title: string | null;
    description: string | null;
    release_mode: "auto" | "assisted";
    closed_by_user: boolean;
    created_by_user_id: string | null;
  } | null;
};

const ISSUE_SELECT =
  "id, pda, github_issue_url, amount, state, submission_count, created_at, bounty_meta(title, description, release_mode, closed_by_user, created_by_user_id)";

/** Parse "https://github.com/<owner>/<repo>/issues/<n>" → repo + number. */
function parseGithubIssueUrl(url: string): { repo: string; issueNumber: number } {
  const m = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/);
  if (!m) return { repo: url, issueNumber: 0 };
  return { repo: m[1], issueNumber: Number(m[2]) };
}

/** Map onchain state + UI flag to the broader frontend status bucket. */
function deriveStatus(
  state: IssueRow["state"],
  closedByUser: boolean,
  submissionCount: number,
): BountyStatus {
  if (closedByUser) return "closed";
  if (state === "cancelled") return "closed";
  if (state === "resolved") return "paid";
  if (submissionCount > 0) return "reviewing";
  return "open";
}

/**
 * On-chain amounts are stored in lamports (native SOL has 9 decimals).
 * GHB-80 ships with SOL-only bounties; once SPL/USDC is added we'll need
 * to switch on `issues.mint` to pick the right decimals.
 */
const SOL_DECIMALS = 9;

function rowToBounty(row: IssueRow, submissionCount?: number): Bounty {
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
    ),
    releaseMode: meta?.release_mode ?? "auto",
    submissionCount: effectiveCount,
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
  const counts = await countSubmissionsByIssuePda(
    supabase,
    rows.map((r) => r.pda),
  );
  return rows.map((row) => rowToBounty(row, counts.get(row.pda) ?? 0));
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
  return data ? rowToBounty(data) : null;
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
  const counts = await countSubmissionsByIssuePda(
    supabase,
    ownRows.map((r) => r.pda),
  );
  return ownRows.map((row) => rowToBounty(row, counts.get(row.pda) ?? 0));
}

/* ---------------------------------------------------------------- */
/* Submissions                                                        */
/* ---------------------------------------------------------------- */

type SubmissionRow = {
  id: string;
  pr_url: string;
  issue_pda: string;
  state: "pending" | "scored" | "winner";
  created_at: string;
  submission_meta: {
    note: string | null;
    submitted_by_user_id: string | null;
  } | null;
};

// `submissions.issue_pda` is a plain text column with no FK constraint, so
// PostgREST can't auto-embed `issues`. We fetch submissions, then resolve
// the matching issue UUIDs in a second round-trip via `issues.pda`.
const SUBMISSION_SELECT =
  "id, pr_url, issue_pda, state, created_at, submission_meta(note, submitted_by_user_id)";

function parseGithubPrUrl(url: string): { prRepo: string; prNumber: number } {
  const m = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!m) return { prRepo: url, prNumber: 0 };
  return { prRepo: m[1], prNumber: Number(m[2]) };
}

function rowToSubmission(row: SubmissionRow, bountyId: string): Submission {
  const { prRepo, prNumber } = parseGithubPrUrl(row.pr_url);
  return {
    id: row.id,
    bountyId,
    devId: row.submission_meta?.submitted_by_user_id ?? "",
    prUrl: row.pr_url,
    prRepo,
    prNumber,
    note: row.submission_meta?.note ?? undefined,
    status: row.state === "winner" ? "accepted" : "pending",
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
  const idByPda = await resolveIssueIdsByPda(supabase, pdas);
  return rows.map((row) =>
    rowToSubmission(row, idByPda.get(row.issue_pda) ?? ""),
  );
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
