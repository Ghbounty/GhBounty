/**
 * GHB-89: Supabase helpers for the submission UI layer.
 *
 * `insertSubmissionAndMeta` is the post-tx persistence step — once the
 * `submit_solution` Solana transaction confirms, we record the submission in
 * two tables:
 *   - `submissions` — onchain mirror (PDA, solver, pr_url, state, etc.).
 *   - `submission_meta` — UI-only fields (note, who submitted) keyed 1:1
 *     to `submissions.id`.
 *
 * Mirrors `bounties.ts::insertIssueAndMeta`: Postgres has no cross-call
 * transaction here, so we do a manual rollback if the second insert fails.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./db.types";

type DBClient = SupabaseClient<Database>;

export type InsertSubmissionAndMetaParams = {
  /** Chain registry id, e.g. "solana-devnet". */
  chainId: string;
  /** PDA of the parent bounty (matches `issues.pda`). */
  issuePda: string;
  /** Submission PDA (base58). Unique. */
  pda: string;
  /** Submitter's Solana wallet (base58). Equals on-chain `submission.solver`. */
  solver: string;
  /**
   * Index used to derive the submission PDA — `bounty.submission_count` at
   * submit time. Persist as-is; we re-derive the PDA from it during repair.
   */
  submissionIndex: number;
  /** GitHub PR URL the submission references. */
  prUrl: string;
  /**
   * Hex-encoded sha256 of the canonical Opus report, or empty string for
   * manual submissions where the report doesn't exist yet. The relayer
   * back-fills this when scoring runs (see `evaluations.report_hash`).
   */
  opusReportHash: string;
  /** Solana tx signature for the submit. Optional — caller may not have it yet. */
  txHash?: string;
  /** Free-form note from the dev to the reviewer. Optional. */
  note?: string;
  /** Privy DID of the developer — links the row to the profile. */
  submittedByUserId: string;
};

export type InsertSubmissionAndMetaResult = {
  /** UUID of the new `submissions` row. */
  submissionId: string;
};

export async function insertSubmissionAndMeta(
  supabase: DBClient,
  p: InsertSubmissionAndMetaParams,
): Promise<InsertSubmissionAndMetaResult> {
  const { data: submission, error: subErr } = await supabase
    .from("submissions")
    .insert({
      chain_id: p.chainId,
      issue_pda: p.issuePda,
      pda: p.pda,
      solver: p.solver,
      submission_index: p.submissionIndex,
      pr_url: p.prUrl,
      opus_report_hash: p.opusReportHash,
      tx_hash: p.txHash ?? null,
      state: "pending",
    })
    .select("id")
    .single();
  if (subErr || !submission) {
    throw new Error(
      `submissions insert: ${subErr?.message ?? "no row returned"}`,
    );
  }

  const { error: metaErr } = await supabase.from("submission_meta").insert({
    submission_id: submission.id,
    note: p.note ?? null,
    submitted_by_user_id: p.submittedByUserId,
  });

  if (metaErr) {
    // Roll back the orphan submission row so the user can retry without
    // hitting a unique-PDA conflict on the next attempt.
    await supabase.from("submissions").delete().eq("id", submission.id);
    throw new Error(`submission_meta insert: ${metaErr.message}`);
  }

  return { submissionId: submission.id };
}
