"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "./Avatar";
import { PickWinnerModal } from "./PickWinnerModal";
import { RejectSubmissionModal } from "./RejectSubmissionModal";
import {
  fetchSubmissionsForBountyDetailed,
  type EnrichedSubmission,
} from "@/lib/data";
import { useAuth } from "@/lib/auth-context";
import type { Bounty } from "@/lib/types";

/**
 * Company-side review modal — shows every PR submitted for a bounty,
 * with the dev's profile, the AI score (if computed), and a "recommended
 * to reject" hint when the score is below the bounty's
 * `reject_threshold`.
 *
 * GHB-83 + GHB-84: each card now has two action buttons — "Reject" (DB
 * only, opens a feedback textarea) and "Select winner" (signs
 * resolve_bounty on-chain via Privy). Both are gated on the bounty
 * still being open AND the submission not already being decided.
 */

export function SubmissionsListModal({
  bounty,
  onClose,
}: {
  bounty: Bounty;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [items, setItems] = useState<EnrichedSubmission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickFor, setPickFor] = useState<EnrichedSubmission | null>(null);
  const [rejectFor, setRejectFor] = useState<EnrichedSubmission | null>(null);
  // Bumped after every successful pick/reject so we re-fetch the
  // submissions list (the EnrichedSubmission rows carry the review state
  // we want to render on the cards).
  const [refreshTick, setRefreshTick] = useState(0);

  // Lock body scroll + ESC handler. No "busy" gating because nothing
  // here mutates state we'd lose by closing the OUTER modal — the inner
  // modals (PickWinner / Reject) own their own busy-locks.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setItems(null);
    fetchSubmissionsForBountyDetailed(bounty.id, bounty.rejectThreshold ?? null)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((err) => {
        console.error("[SubmissionsListModal] fetch failed:", err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load submissions.");
          setItems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bounty.id, bounty.rejectThreshold, refreshTick]);

  // A bounty is "settled" once any submission is the winner OR the
  // bounty's status reflects a payout/cancellation. Both action buttons
  // disappear from every card in that case — no second pick allowed.
  // Same on-chain-OR-off-chain check as `isWinner` below.
  const hasWinner =
    items?.some(
      (s) => s.state === "winner" || s.review?.approved === true,
    ) ?? false;
  const settledStatus =
    bounty.status === "approved" ||
    bounty.status === "paid" ||
    bounty.status === "closed";
  const settled = hasWinner || settledStatus;

  // Gate the action buttons on the viewer being the bounty creator. A
  // dev who somehow opens this modal (unlikely; the entry point is the
  // company dashboard) never sees Pick/Reject.
  const isOwner =
    !!user && user.role === "company" && user.id === bounty.companyId;
  const canAct = isOwner && !settled;

  const onPickWinner = useCallback((s: EnrichedSubmission) => {
    setPickFor(s);
  }, []);
  const onReject = useCallback((s: EnrichedSubmission) => {
    setRejectFor(s);
  }, []);
  const bumpRefresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="modal-head">
          <div className="eyebrow">Submissions</div>
          <h2 className="modal-title">
            <span className="mono-inline">{bounty.repo}</span>{" "}
            <span className="bounty-hash">#{bounty.issueNumber}</span>
          </h2>
          {bounty.title && <p className="modal-note">{bounty.title}</p>}
          <div className="submissions-meta">
            <span>
              {(items?.length ?? 0)} PR{(items?.length ?? 0) === 1 ? "" : "s"}
            </span>
            <span className="submissions-meta-sep">·</span>
            <span>
              {bounty.rejectThreshold != null
                ? `Auto-reject below ${bounty.rejectThreshold}/10`
                : "No auto-rejection"}
            </span>
          </div>
        </div>

        {error && <div className="form-error">{error}</div>}

        {items === null ? (
          <div className="submissions-loading">
            <span className="loading-dot" />
            <span>Loading submissions…</span>
          </div>
        ) : items.length === 0 ? (
          <div className="empty">
            <p>No submissions yet.</p>
            <p className="muted">
              When developers submit PRs against this bounty, they&apos;ll
              show up here with their AI scores.
            </p>
          </div>
        ) : (
          <ul className="submissions-list">
            {items.map((s) => (
              <SubmissionCard
                key={s.id}
                submission={s}
                canAct={canAct}
                onPickWinner={onPickWinner}
                onReject={onReject}
              />
            ))}
          </ul>
        )}

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {pickFor && user && (
        <PickWinnerModal
          bounty={bounty}
          submission={pickFor}
          reviewerUserId={user.id}
          onClose={() => setPickFor(null)}
          onResolved={() => {
            setPickFor(null);
            bumpRefresh();
          }}
        />
      )}

      {rejectFor && user && (
        <RejectSubmissionModal
          submission={rejectFor}
          reviewerUserId={user.id}
          onClose={() => setRejectFor(null)}
          onRejected={() => {
            setRejectFor(null);
            bumpRefresh();
          }}
        />
      )}
    </div>,
    document.body,
  );
}

function SubmissionCard({
  submission: s,
  canAct,
  onPickWinner,
  onReject,
}: {
  submission: EnrichedSubmission;
  /** When false, the action buttons disappear (bounty already settled,
   * or the viewer isn't the bounty creator). */
  canAct: boolean;
  onPickWinner: (s: EnrichedSubmission) => void;
  onReject: (s: EnrichedSubmission) => void;
}) {
  const displayName = s.dev.username || s.dev.email || "Anonymous dev";
  const score = s.evaluation?.score ?? null;
  // Winner = on-chain mirror caught up OR we have the off-chain
  // approved flag from `submission_reviews` (set immediately by
  // `recordWinnerOnchain`). The off-chain flag exists to bridge the
  // relayer lag on devnet so the Winner badge shows up right after
  // the company picks.
  const isWinner = s.state === "winner" || (s.review?.approved ?? false);
  const isRejected = s.review?.rejected ?? false;

  // Decided submissions don't get action buttons even when the bounty is
  // still nominally open — picking a rejected sub as winner would be
  // weird UX, and re-rejecting an already-rejected one is no-op.
  const showActions = canAct && !isWinner && !isRejected;

  return (
    <li
      className={`submission-card ${
        isWinner ? "submission-card-winner" : ""
      } ${isRejected ? "submission-card-rejected" : ""}`}
    >
      <div className="submission-card-head">
        <div className="submission-dev">
          <Avatar src={s.dev.avatarUrl} name={displayName} size={32} />
          <div className="submission-dev-meta">
            <span className="submission-dev-name">{displayName}</span>
            {s.dev.githubHandle && (
              <a
                href={`https://github.com/${s.dev.githubHandle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="submission-dev-handle"
              >
                @{s.dev.githubHandle}
              </a>
            )}
            <SolverWalletInfo solver={s.solver} />
          </div>
        </div>
        <div className="submission-card-badges">
          {isWinner && (
            <span className="submission-badge submission-badge-winner">
              ★ Winner
            </span>
          )}
          {isRejected && (
            <span className="submission-badge submission-badge-rejected">
              Rejected
            </span>
          )}
          {!isWinner && !isRejected && s.recommendedReject && (
            <span className="submission-badge submission-badge-reject">
              Recommended to reject
            </span>
          )}
          {score !== null ? (
            <span
              className={`submission-score ${
                s.recommendedReject ? "submission-score-low" : ""
              }`}
            >
              {score}/10
            </span>
          ) : (
            <span className="submission-score submission-score-pending">
              Pending review
            </span>
          )}
        </div>
      </div>

      <a
        href={s.prUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="submission-pr-link"
      >
        <span className="mono-inline">{s.prRepo}</span>{" "}
        <span className="bounty-hash">#{s.prNumber}</span>
      </a>

      {s.note && <p className="submission-note">{s.note}</p>}

      {s.evaluation?.reasoning && (
        <details className="submission-reasoning">
          <summary>AI reasoning</summary>
          <p>{s.evaluation.reasoning}</p>
        </details>
      )}

      {/* GHB-84: surface the company's reject feedback. We render even
        * when the reason is null so the dev sees the rejection itself
        * (the badge above isn't enough on its own — we want the explicit
        * "no reason was provided" footnote). */}
      {isRejected && (
        <div className="submission-reject-feedback">
          <span className="submission-reject-feedback-label">
            Rejection feedback
          </span>
          <p>
            {s.review?.rejectReason ??
              "No reason provided by the company."}
          </p>
        </div>
      )}

      <div className="submission-card-foot">
        <span className="submission-time">
          {timeAgo(s.createdAt)}
          {s.evaluation?.source && (
            <>
              {" · scored by "}
              <span className="mono-inline">{s.evaluation.source}</span>
            </>
          )}
        </span>
        <div className="submission-card-actions">
          <a
            href={s.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm"
          >
            View PR
          </a>
          {showActions && (
            <>
              <button
                type="button"
                className="btn btn-reject btn-sm"
                onClick={() => onReject(s)}
              >
                Reject
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => onPickWinner(s)}
              >
                Select winner
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Address chip for the dev's solver pubkey — clickable to copy the
 * full base58 to clipboard. Deliberately does NOT show the dev's SOL
 * balance: the company shouldn't see how much the dev holds (that's
 * the dev's private info; surfaced in their own dashboard instead).
 */
function SolverWalletInfo({ solver }: { solver: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(solver);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — silent fail. */
    }
  };

  return (
    <div className="solver-wallet">
      <button
        type="button"
        className="solver-wallet-addr"
        onClick={onCopy}
        title="Click to copy full address"
      >
        <span className="solver-wallet-dot" />
        <code>{copied ? "Copied!" : shortAddr(solver)}</code>
      </button>
    </div>
  );
}

function shortAddr(s: string): string {
  if (s.length < 12) return s;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
