"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "./Avatar";
import { createClient } from "@/utils/supabase/client";
import { rejectSubmission } from "@/lib/review-actions";
import type { EnrichedSubmission } from "@/lib/data";
import type { Bounty } from "@/lib/types";

/**
 * GHB-84 — company-side modal for rejecting a submission with optional
 * feedback. No on-chain side effect: the rejection is a soft, off-chain
 * decision recorded in `submission_reviews`. The bounty's escrow stays
 * in the program until either `resolve_bounty` (a different submission
 * wins) or `cancel_bounty` (the company gives up entirely).
 *
 * The textarea is optional. We deliberately don't enforce a minimum
 * length: a company that wants to fast-reject a low-effort PR shouldn't
 * have to type filler. Empty / whitespace-only feedback is normalized
 * to null in `rejectSubmission`.
 */
const REJECT_REASON_MAX = 600;

export function RejectSubmissionModal({
  bounty,
  submission,
  reviewerUserId,
  onClose,
  onRejected,
}: {
  /** Parent bounty — used to enrich the GHB-92 notification payload so
   * the dev's bell can render "Acme rejected your PR for 'Fix migration'"
   * without an extra fetch. */
  bounty: Bounty;
  submission: EnrichedSubmission;
  /** Privy DID of the logged-in company user — passed to the DB layer
   * for audit (`submission_reviews.decided_by`). */
  reviewerUserId: string;
  onClose: () => void;
  /** Called after a successful upsert. The parent re-fetches the
   * submissions list to pick up the new `review` field. */
  onRejected: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Scroll-lock + ESC-to-close. `busy` gates ESC so we don't drop the
  // user mid-write when the upsert is in flight.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, busy]);

  // Auto-focus the textarea on open — the company is here to type a
  // reason, no point making them click first.
  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const onSubmit = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      await rejectSubmission(supabase, {
        submissionId: submission.id,
        reason,
        reviewerUserId,
        // GHB-92: ring the dev's bell. Empty dev id (mock paths) gracefully
        // skips the notification write inside the helper.
        recipientUserId: submission.dev.id || undefined,
        notificationPayload: {
          bountyTitle:
            bounty.title ?? `${bounty.repo} #${bounty.issueNumber}`,
          bountyAmount: bounty.amountUsdc,
        },
      });
      onRejected();
    } catch (err) {
      console.error("[RejectSubmissionModal] failed:", err);
      setError(err instanceof Error ? err.message : "Could not save the rejection.");
      setBusy(false);
    }
  }, [
    busy,
    reason,
    reviewerUserId,
    submission.id,
    submission.dev.id,
    bounty.title,
    bounty.repo,
    bounty.issueNumber,
    bounty.amountUsdc,
    onRejected,
  ]);

  const displayName =
    submission.dev.username || submission.dev.email || "Anonymous dev";
  const remaining = REJECT_REASON_MAX - reason.length;

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <button
          className="modal-close"
          aria-label="Close"
          onClick={onClose}
          disabled={busy}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="modal-head">
          <div className="eyebrow">Reject submission</div>
          <h2 className="modal-title">Reject this PR</h2>
        </div>

        <div className="reject-target">
          <Avatar src={submission.dev.avatarUrl} name={displayName} size={36} />
          <div className="reject-target-meta">
            <span className="reject-target-name">{displayName}</span>
            <a
              href={submission.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="reject-target-pr"
            >
              <span className="mono-inline">{submission.prRepo}</span>{" "}
              <span className="bounty-hash">#{submission.prNumber}</span>
            </a>
          </div>
        </div>

        <p className="modal-note">
          Rejection is off-chain — the escrow stays in the program. The dev
          will see your feedback (if any) in their submission detail. You
          can pick a different submission as winner, or cancel the bounty
          entirely, at any time.
        </p>

        <label className="field">
          <span className="field-label">
            Feedback for the dev{" "}
            <span className="field-label-aux">(optional, {remaining} left)</span>
          </span>
          <textarea
            ref={taRef}
            className="reject-textarea"
            rows={5}
            maxLength={REJECT_REASON_MAX}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Doesn't address the database migration step in the issue body, or pulls in scope creep we didn't ask for…"
            disabled={busy}
          />
        </label>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-foot">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-reject"
            onClick={onSubmit}
            disabled={busy}
          >
            {busy ? "Saving…" : "Reject submission"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
