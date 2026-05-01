/**
 * GHB-83 + GHB-84: company-side review actions on individual submissions.
 *
 * Two orchestrators live here:
 *
 *   - `recordWinnerOnchain(...)` — DB-only mirror to run AFTER a confirmed
 *     `resolve_bounty` transaction. The on-chain tx itself is built by
 *     `buildResolveBountyIx` and signed by the React layer (Privy hooks
 *     can't be called from a non-component module). After the tx confirms,
 *     this helper bumps `issues.status_*` mirrors and (if applicable) the
 *     winning submission's `state` so the rest of the app sees the
 *     resolved bounty without waiting for the relayer to re-index.
 *
 *   - `rejectSubmission(...)` — pure DB write. The "reject" action has no
 *     on-chain counterpart (there's no `reject_submission` ix in the
 *     program — escrow custody only changes through `resolve_bounty` /
 *     `cancel_bounty`). It's a soft, off-chain decision the company can
 *     undo by re-submitting an upsert with `rejected: false`.
 *
 * Both helpers are idempotent: re-running `rejectSubmission` for the same
 * (submission_id) overwrites the existing `submission_reviews` row via
 * upsert, and `recordWinnerOnchain` is no-op-on-missing for the
 * issue/state mirrors.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./db.types";

type DBClient = SupabaseClient<Database>;

export type RejectSubmissionParams = {
  /** Supabase `submissions.id` (uuid). PK of the review row. */
  submissionId: string;
  /**
   * Free-form rejection feedback. The UI caps the textarea length, but
   * the DB column is unconstrained — we trim trailing whitespace here.
   * Empty string is normalized to null so the dev-side display can
   * distinguish "rejected with no reason" from a stray space.
   */
  reason: string;
  /**
   * Privy DID of the company user making the call. Stored for audit
   * purposes (`submission_reviews.decided_by`); the on-the-wire RLS
   * policy verifies the same identity owns the parent bounty.
   */
  reviewerUserId: string;
};

/**
 * Mark a submission rejected, with optional feedback. Upserts the
 * `submission_reviews` row keyed by `submission_id`.
 *
 * RLS-protected on the server side: only the company that owns the
 * parent bounty can write here (policy `submission_reviews_write_creator`
 * walks submissions → issues → bounty_meta). A failed RLS check surfaces
 * as an empty result or a permission error from PostgREST — we throw on
 * either so the UI can show "could not save" rather than silently
 * pretending the action succeeded.
 */
export async function rejectSubmission(
  supabase: DBClient,
  p: RejectSubmissionParams,
): Promise<void> {
  const trimmed = p.reason.trim();
  const reason = trimmed.length > 0 ? trimmed : null;

  // `submission_reviews` is post-0010 — not in the generated db.types.ts
  // yet. Cast through `as never` on the table name (same trick we use
  // for `evaluations` in lib/data.ts).
  const { error } = await supabase
    .from("submission_reviews" as never)
    .upsert(
      {
        submission_id: p.submissionId,
        rejected: true,
        reject_reason: reason,
        decided_by: p.reviewerUserId,
        decided_at: new Date().toISOString(),
      } as never,
      { onConflict: "submission_id" },
    );

  if (error) {
    throw new Error(
      `Could not save the rejection (${error.code ?? "?"}): ${error.message}`,
    );
  }
}

export type RecordWinnerParams = {
  /** Supabase `issues.id` (uuid) — the bounty whose escrow just resolved. */
  bountyId: string;
  /** Supabase `submissions.id` of the winning submission. */
  winnerSubmissionId: string;
  /** Solana tx signature, persisted alongside the submission for audit. */
  txSignature: string;
  /**
   * Optional free-form feedback the company wrote in the PickWinnerModal.
   * Persisted to `submission_reviews.approval_feedback` so the winning
   * dev sees it on `/app/profile`. Whitespace is trimmed; empty strings
   * are normalized to skipping the upsert (we don't want to insert a row
   * with all-null fields just for the audit timestamps).
   */
  approvalFeedback?: string;
  /**
   * Privy DID of the company user — persisted as `decided_by` for audit
   * symmetry with the reject path. Only used when there's actual
   * feedback to record (otherwise we skip the upsert entirely).
   */
  reviewerUserId?: string;
};

/**
 * Best-effort post-`resolve_bounty` mirror update. We do two things:
 *
 *   1. Persist tx_hash on the winning submission so the dev's payout
 *      reference shows up immediately.
 *
 *   2. Upsert the off-chain decision into `submission_reviews` with
 *      `approved=true` (and optional feedback). This is what unblocks
 *      the dev/company UI from waiting on the relayer to mirror
 *      `submissions.state = 'winner'`. Read-side precedence:
 *        on-chain Winner OR off-chain approved → "accepted" / Winner badge.
 *      Either signal is sufficient.
 *
 * What we deliberately DON'T do:
 *   - Set `bounty_meta.closed_by_user = true`. That field is the
 *     "company manually cancelled the bounty" flag and `deriveStatus`
 *     maps it to status="closed" — which is semantically wrong for a
 *     resolved bounty. The relayer flips `issues.state` to "resolved"
 *     when it catches up, which `deriveStatus` correctly maps to "paid".
 *
 *   - Update `submissions.state` directly. That's the on-chain mirror;
 *     RLS forbids non-relayer writes. Off-chain `approved` is our
 *     parallel signal.
 *
 * All branches are best-effort: log + move on. The on-chain tx already
 * succeeded, so showing a "DB sync failed" error here would mislead the
 * user into thinking the payout didn't happen.
 */
export async function recordWinnerOnchain(
  supabase: DBClient,
  p: RecordWinnerParams,
): Promise<void> {
  // 1. Persist tx_hash on the winning submission row.
  try {
    const { error: subErr } = await supabase
      .from("submissions")
      .update({ tx_hash: p.txSignature })
      .eq("id", p.winnerSubmissionId);
    if (subErr) {
      console.warn("[recordWinnerOnchain:submissions]", subErr);
    }
  } catch (err) {
    console.warn("[recordWinnerOnchain:submissions]", err);
  }

  // 2. Upsert submission_reviews with approved=true (always, even
  //    when there's no feedback — the flag is what the dev/company UI
  //    reads as the off-chain "this submission won" signal).
  if (p.reviewerUserId) {
    const trimmed = p.approvalFeedback?.trim() ?? "";
    try {
      const { error: revErr } = await supabase
        .from("submission_reviews" as never)
        .upsert(
          {
            submission_id: p.winnerSubmissionId,
            rejected: false,
            approved: true,
            approval_feedback: trimmed.length > 0 ? trimmed : null,
            decided_by: p.reviewerUserId,
            decided_at: new Date().toISOString(),
          } as never,
          { onConflict: "submission_id" },
        );
      if (revErr) {
        console.warn("[recordWinnerOnchain:submission_reviews]", revErr);
      }
    } catch (err) {
      console.warn("[recordWinnerOnchain:submission_reviews]", err);
    }
  }
}
