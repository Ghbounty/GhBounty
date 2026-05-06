/**
 * GHB-80: Supabase helpers for the bounty UI layer.
 *
 * `insertIssueAndMeta` is the post-tx persistence step — once the
 * `create_bounty` Solana transaction confirms, we record the bounty in two
 * tables:
 *   - `issues` — an off-chain index of every on-chain bounty (PDA, amount,
 *     state, etc.) used by the dashboards and the relayer.
 *   - `bounty_meta` — UI-only fields (title, description, release mode,
 *     reject threshold, evaluation criteria) keyed 1:1 to `issues.id`.
 *
 * Postgres has no cross-call transaction here, so we do a manual rollback
 * if the second insert fails. Same shape as the auth-privy persist helpers
 * (see `auth-privy.tsx::persistDevRow`) — keeps the DB clean across retries.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./db.types";

type DBClient = SupabaseClient<Database>;

export type ReleaseMode = "auto" | "assisted";

export type InsertIssueAndMetaParams = {
  /** Chain registry id, e.g. "solana-devnet". */
  chainId: string;
  /** Bounty PDA (base58). */
  pda: string;
  /** On-chain `bounty_id` used to derive the PDA. */
  bountyOnchainId: bigint;
  /** Creator wallet address (base58). */
  creator: string;
  /** Scorer wallet address (base58). */
  scorer: string;
  /** Mint address. `11111111111111111111111111111111` for native SOL. */
  mint: string;
  /** Amount in lamports / base units. */
  amount: bigint;
  /** GitHub issue URL the bounty references. */
  githubIssueUrl: string;
  /** Display title (typically the issue title). Optional. */
  title?: string;
  /** Long-form description. Optional. */
  description?: string;
  /** Release mode — "auto" releases on AI approval, "assisted" lets the
   * company pick the winner. Mirrors the `release_mode` enum in the DB
   * (`packages/db/src/schema.ts::releaseModeEnum`). */
  releaseMode: ReleaseMode;
  /** Submissions scoring below this are auto-rejected off-chain. Null = no
   * threshold (companies must triage every submission). */
  rejectThreshold?: number | null;
  /** Free-form criteria injected into the Opus prompt. Null = use default. */
  evaluationCriteria?: string | null;
  /** GHB-184: cap opcional de submissions. Null = sin cap. */
  maxSubmissions?: number | null;
  /** Privy DID of the company user — links the row to the profile. */
  createdByUserId: string;
};

export type InsertIssueAndMetaResult = {
  /** UUID of the new `issues` row. */
  issueId: string;
};

export async function insertIssueAndMeta(
  supabase: DBClient,
  p: InsertIssueAndMetaParams,
): Promise<InsertIssueAndMetaResult> {
  // Postgres `bigint` columns travel as strings over PostgREST; supabase-js
  // accepts both, but we pin to strings to dodge the JS Number 53-bit cap.
  const { data: issue, error: issueErr } = await supabase
    .from("issues")
    .insert({
      chain_id: p.chainId,
      pda: p.pda,
      bounty_onchain_id: p.bountyOnchainId.toString(),
      creator: p.creator,
      scorer: p.scorer,
      mint: p.mint,
      amount: p.amount.toString(),
      state: "open",
      submission_count: 0,
      winner: null,
      github_issue_url: p.githubIssueUrl,
    })
    .select("id")
    .single();
  if (issueErr || !issue) {
    throw new Error(
      `issues insert: ${issueErr?.message ?? "no row returned"}`,
    );
  }

  const { error: metaErr } = await supabase.from("bounty_meta").insert({
    issue_id: issue.id,
    title: p.title ?? null,
    description: p.description ?? null,
    release_mode: p.releaseMode,
    closed_by_user: false,
    created_by_user_id: p.createdByUserId,
    reject_threshold: p.rejectThreshold ?? null,
    evaluation_criteria: p.evaluationCriteria ?? null,
    max_submissions: p.maxSubmissions ?? null,
  });

  if (metaErr) {
    // Roll back the orphan issue row so the user can retry without
    // hitting a unique-PDA conflict on the next attempt.
    await supabase.from("issues").delete().eq("id", issue.id);
    throw new Error(`bounty_meta insert: ${metaErr.message}`);
  }

  return { issueId: issue.id };
}

/**
 * Hard-delete a bounty + its meta from Supabase (UI side only — the
 * on-chain account stays as is). Order matters because of RLS:
 * `bounty_meta_modify_creator` lets the owner delete their meta, then
 * `issues_delete_orphan` lets them delete the issue once no meta points
 * at it.
 *
 * This is for the company dashboard's "Delete bounty" action. The
 * underlying on-chain bounty PDA can't be removed; if the funds are
 * still escrowed the caller should `cancel_bounty` on-chain first.
 *
 * Submissions referencing this bounty (via `issue_pda`) become orphans
 * — they survive in the `submissions` table but won't be reachable
 * from the company side. We don't auto-clean them because the dev's
 * submission_meta is owner-scoped and a company-side delete would hit
 * RLS errors. Production cleanup belongs in a server-side admin path.
 */
export async function deleteIssueAndMeta(
  supabase: DBClient,
  issueId: string,
): Promise<void> {
  const { error: metaErr } = await supabase
    .from("bounty_meta")
    .delete()
    .eq("issue_id", issueId);
  if (metaErr) {
    throw new Error(`bounty_meta delete: ${metaErr.message}`);
  }
  const { error: issueErr } = await supabase
    .from("issues")
    .delete()
    .eq("id", issueId);
  if (issueErr) {
    // Roll forward best-effort: surface the error but the orphan issue
    // row will be cleaned by the orphan-delete RLS on retry.
    throw new Error(`issues delete: ${issueErr.message}`);
  }
}

/**
 * Mark a bounty as closed in `bounty_meta.closed_by_user`. The on-chain
 * bounty stays Open — funds remain locked until someone calls
 * `cancel_bounty` or `resolve_bounty`. UI hides closed rows from the
 * "Open" filter and stops accepting submissions.
 */
export async function closeIssue(
  supabase: DBClient,
  issueId: string,
): Promise<void> {
  const { error } = await supabase
    .from("bounty_meta")
    .update({ closed_by_user: true })
    .eq("issue_id", issueId);
  if (error) {
    throw new Error(`bounty_meta close: ${error.message}`);
  }
}

/**
 * List the bounties created by a given user. Joins `bounty_meta` with
 * `issues` and orders by newest first — the shape the company dashboard
 * needs for GHB-81.
 */
export async function listMyIssues(supabase: DBClient, userId: string) {
  const { data, error } = await supabase
    .from("bounty_meta")
    .select(
      `
      issue_id,
      title,
      description,
      release_mode,
      closed_by_user,
      reject_threshold,
      evaluation_criteria,
      created_at,
      issues (
        chain_id,
        pda,
        bounty_onchain_id,
        creator,
        scorer,
        mint,
        amount,
        state,
        submission_count,
        winner,
        github_issue_url,
        created_at
      )
    `,
    )
    .eq("created_by_user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listMyIssues: ${error.message}`);
  return data ?? [];
}
