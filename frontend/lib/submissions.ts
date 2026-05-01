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

/**
 * Postgres SQLSTATE 23505 = unique_violation. PostgREST surfaces it as
 * a string error code on the response body. We intercept that specific
 * code to make the insert idempotent — see comment on the catch path.
 */
const PG_UNIQUE_VIOLATION = "23505";

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

  // Idempotency for the submission row.
  //
  // The on-chain `submit_solution` instruction is the source of truth: by
  // the time we reach this insert, we've confirmed the tx and the
  // submission account exists at `p.pda`. Anything that retries this
  // insert path with the same PDA (Supabase JS auto-retry on a flaky
  // POST, React StrictMode double-effect in dev, Next Fast Refresh
  // re-mounting the modal mid-flow, …) would otherwise surface a
  // confusing 409 to the user even though the row IS already persisted.
  //
  // So: when Postgres rejects with 23505 / `submissions_pda_unique`,
  // re-fetch the existing row keyed on the same PDA and treat the call
  // as if it had inserted. Same for the meta row below.
  let submissionId: string | undefined = submission?.id;
  if (subErr) {
    if (subErr.code === PG_UNIQUE_VIOLATION) {
      const { data: existing } = await supabase
        .from("submissions")
        .select("id")
        .eq("pda", p.pda)
        .single();
      if (!existing) {
        // Constraint fired but no matching row — should be impossible,
        // surface the original error instead of pretending success.
        throw new Error(
          `submissions insert: unique violation but row not found for pda=${p.pda}`,
        );
      }
      submissionId = existing.id;
    } else {
      throw new Error(`submissions insert: ${subErr.message}`);
    }
  }
  if (!submissionId) {
    throw new Error("submissions insert: no row returned");
  }

  const { error: metaErr } = await supabase.from("submission_meta").insert({
    submission_id: submissionId,
    note: p.note ?? null,
    submitted_by_user_id: p.submittedByUserId,
  });

  if (metaErr) {
    // Same idempotency story: a duplicate meta insert (PK is
    // `submission_id`) means a previous attempt already wrote it. Treat
    // as success.
    if (metaErr.code === PG_UNIQUE_VIOLATION) {
      return { submissionId };
    }
    // Real failure on the meta insert. Only roll back the submission row
    // if we just created it — if we recovered an existing one above,
    // someone else (or a previous attempt) owns it and we must not nuke
    // their state.
    if (submission?.id) {
      await supabase.from("submissions").delete().eq("id", submission.id);
    }
    throw new Error(`submission_meta insert: ${metaErr.message}`);
  }

  return { submissionId };
}
