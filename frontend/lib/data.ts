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
import { useSupabaseBackend } from "./auth-context";
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
  if (!useSupabaseBackend) {
    return mockLoadUsers().filter((u): u is Company => u.role === "company");
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("companies")
    .select(
      "user_id, name, slug, description, website, industry, logo_url, profile:profiles!inner(email, created_at)",
    )
    .returns<CompanyRow[]>();
  if (error) {
    console.error("[fetchCompanies]", error);
    return [];
  }
  return (data ?? []).map(rowToCompany);
}

export async function fetchCompany(id: string): Promise<Company | null> {
  if (!useSupabaseBackend) {
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
      "user_id, name, slug, description, website, industry, logo_url, profile:profiles!inner(email, created_at)",
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
  if (!useSupabaseBackend) {
    return mockLoadUsers().filter((u): u is Dev => u.role === "dev");
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("developers")
    .select(
      "user_id, username, github_handle, bio, skills, avatar_url, profile:profiles!inner(email, created_at)",
    )
    .returns<DevRow[]>();
  if (error) {
    console.error("[fetchDevelopers]", error);
    return [];
  }
  return (data ?? []).map(rowToDev);
}

export async function fetchDeveloper(id: string): Promise<Dev | null> {
  if (!useSupabaseBackend) {
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
      "user_id, username, github_handle, bio, skills, avatar_url, profile:profiles!inner(email, created_at)",
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
  "id, github_issue_url, amount, state, submission_count, created_at, bounty_meta(title, description, release_mode, closed_by_user, created_by_user_id)";

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

/** USDC has 6 decimals; mock devnet token uses the same. */
const TOKEN_DECIMALS = 6;

function rowToBounty(row: IssueRow): Bounty {
  const { repo, issueNumber } = parseGithubIssueUrl(row.github_issue_url);
  const meta = row.bounty_meta;
  const amountRaw =
    typeof row.amount === "string" ? Number(row.amount) : row.amount;
  return {
    id: row.id,
    companyId: meta?.created_by_user_id ?? "",
    repo,
    issueNumber,
    issueUrl: row.github_issue_url,
    title: meta?.title ?? undefined,
    amountUsdc: amountRaw / 10 ** TOKEN_DECIMALS,
    status: deriveStatus(
      row.state,
      meta?.closed_by_user ?? false,
      row.submission_count,
    ),
    releaseMode: meta?.release_mode ?? "auto",
    createdAt: new Date(row.created_at).getTime(),
  };
}

export async function fetchBounties(): Promise<Bounty[]> {
  if (!useSupabaseBackend) {
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
  return (data ?? []).map(rowToBounty);
}

export async function fetchBounty(id: string): Promise<Bounty | null> {
  if (!useSupabaseBackend) {
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
  if (!useSupabaseBackend) {
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
  return (data ?? [])
    .filter((row) => row.bounty_meta?.created_by_user_id === companyId)
    .map(rowToBounty);
}

/* ---------------------------------------------------------------- */
/* Submissions                                                        */
/* ---------------------------------------------------------------- */

type SubmissionRow = {
  id: string;
  pr_url: string;
  state: "pending" | "scored" | "winner";
  created_at: string;
  // Join issues to resolve the bounty UUID from issue_pda.
  issue: { id: string } | null;
  submission_meta: {
    note: string | null;
    submitted_by_user_id: string | null;
  } | null;
};

const SUBMISSION_SELECT =
  "id, pr_url, state, created_at, issue:issues!submissions_issue_pda_fkey(id), submission_meta(note, submitted_by_user_id)";

function parseGithubPrUrl(url: string): { prRepo: string; prNumber: number } {
  const m = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!m) return { prRepo: url, prNumber: 0 };
  return { prRepo: m[1], prNumber: Number(m[2]) };
}

function rowToSubmission(row: SubmissionRow): Submission {
  const { prRepo, prNumber } = parseGithubPrUrl(row.pr_url);
  return {
    id: row.id,
    bountyId: row.issue?.id ?? "",
    devId: row.submission_meta?.submitted_by_user_id ?? "",
    prUrl: row.pr_url,
    prRepo,
    prNumber,
    note: row.submission_meta?.note ?? undefined,
    status: row.state === "winner" ? "accepted" : "pending",
    createdAt: new Date(row.created_at).getTime(),
  };
}

export async function fetchSubmissionsByBounty(
  bountyId: string,
): Promise<Submission[]> {
  if (!useSupabaseBackend) {
    return mockSubmissionsByBounty(bountyId);
  }
  const supabase = createClient();
  // Filter via the inner join on issues.id. The relayer stores the link
  // by issue_pda, so we go bountyId → issue → issue_pda → submissions.
  // PostgREST's resource embedding lets us do this in one query.
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
  return (data ?? []).map(rowToSubmission);
}

export async function fetchSubmissionsByDev(
  devId: string,
): Promise<Submission[]> {
  if (!useSupabaseBackend) {
    return mockSubmissionsByDev(devId);
  }
  const supabase = createClient();
  // Filter via submission_meta.submitted_by_user_id — the link to a profile
  // is set when the user submits via the UI; onchain-only submissions
  // (no profile linked) are excluded from the dev's "my submissions" view.
  const { data, error } = await supabase
    .from("submissions")
    .select(SUBMISSION_SELECT)
    .eq("submission_meta.submitted_by_user_id", devId)
    .order("created_at", { ascending: false })
    .returns<SubmissionRow[]>();
  if (error) {
    console.error("[fetchSubmissionsByDev]", error);
    return [];
  }
  return (data ?? [])
    .filter((row) => row.submission_meta?.submitted_by_user_id === devId)
    .map(rowToSubmission);
}

export async function hasDevSubmitted(
  devId: string,
  bountyId: string,
): Promise<boolean> {
  if (!useSupabaseBackend) {
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
  if (!useSupabaseBackend) {
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
