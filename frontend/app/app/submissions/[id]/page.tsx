"use client";

/**
 * GHB-91 — full submission detail page.
 *
 * Layout:
 *   1. Hero: company logo + bounty title + payout amount + status badge
 *   2. Two cards side-by-side:
 *      a. Issue / PR meta (links + dates + note)
 *      b. Evaluation report (4 dimensions + reasoning + ranking)
 *   3. Decision panel (auto-reject reason / company feedback / win note)
 *   4. Payment row (tx hash + explorer link, when paid out)
 *
 * Loaded client-side via `fetchSubmissionDetail` so it stays consistent
 * with the rest of `/app/*` (SSR-shaped pages would need a separate
 * Privy-aware Supabase client). The page handles four loading states:
 *   - loading (spinner)
 *   - not found (404 panel + back link)
 *   - evaluating (no eval row yet — friendly placeholder, no metrics)
 *   - normal (full report)
 */

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Guard } from "@/components/Guard";
import { Avatar } from "@/components/Avatar";
import {
  fetchSubmissionDetail,
  type OpusReport,
  type SubmissionDetail,
} from "@/lib/data";
import type { SubmissionGranularStatus } from "@/lib/types";

const GRANULAR_LABELS: Record<SubmissionGranularStatus, string> = {
  submitted: "Submitted",
  evaluating: "Evaluating",
  scored: "Scored",
  auto_rejected: "Auto-rejected",
  rejected: "Rejected",
  approved: "Won",
  lost: "Not selected",
};

/** Documented weights from `relayer/src/opus.ts:DIMENSION_WEIGHTS`. We
 *  duplicate them here so the detail page can render the contribution
 *  of each dimension to the overall score without a round-trip. */
const DIMENSION_WEIGHTS = {
  code_quality: 0.30,
  test_coverage: 0.25,
  requirements_match: 0.30,
  security: 0.15,
} as const;
const DIMENSION_LABELS: Record<keyof typeof DIMENSION_WEIGHTS, string> = {
  code_quality: "Code quality",
  test_coverage: "Test coverage",
  requirements_match: "Requirements match",
  security: "Security",
};

export default function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Next 15 unwraps params asynchronously — `use()` blocks until the
  // promise resolves. Keeps the component synchronous after that.
  const { id } = use(params);
  return (
    <Guard>
      <Inner id={id} />
    </Guard>
  );
}

function Inner({ id }: { id: string }) {
  const [data, setData] = useState<SubmissionDetail | null | "loading">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;
    fetchSubmissionDetail(id).then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (data === "loading") {
    return (
      <div className="dash">
        <div className="empty">Loading…</div>
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="dash">
        <section className="profile-hero">
          <div className="profile-hero-text">
            <div className="eyebrow">Submission</div>
            <h1 className="dash-title">Not found</h1>
            <p className="dash-sub">
              We couldn&apos;t load this submission. It may have been deleted
              or you may not have access.
            </p>
          </div>
        </section>
        <Link href="/app/profile" className="btn btn-ghost btn-sm">
          ← Back to profile
        </Link>
      </div>
    );
  }

  const { submission, bounty, company, report, reasoning, scoreSource,
    passedCount, payoutTxHash } = data;
  const granular = submission.granularStatus ?? "submitted";
  const score = submission.score;
  const rank = submission.rank;
  const total = submission.totalForBounty;
  const threshold = bounty?.rejectThreshold ?? null;

  return (
    <div className="dash">
      {/* ---- Hero ---- */}
      <section className="profile-hero">
        <div className="profile-hero-main">
          {company && (
            <Avatar
              src={company.avatarUrl}
              name={company.name}
              size={56}
              rounded={false}
            />
          )}
          <div className="profile-hero-text">
            <div className="eyebrow">Submission</div>
            <h1 className="dash-title">
              {bounty?.title ??
                `${submission.prRepo} #${submission.prNumber}`}
            </h1>
            {company && (
              <Link
                href={`/app/companies/${encodeURIComponent(company.id)}`}
                className="profile-hero-handle accent"
              >
                {company.name}
              </Link>
            )}
          </div>
        </div>
        <div className="profile-actions">
          <span className={`status-badge granular-${granular.replace("_", "-")}`}>
            ● {GRANULAR_LABELS[granular]}
          </span>
        </div>
      </section>

      {/* ---- Top stats ---- */}
      <div className="dash-stats profile-stats">
        <div className="stat-pill">
          <span className="stat-val">
            {bounty ? bounty.amountUsdc.toLocaleString() : "—"}
          </span>
          <span className="stat-lbl">Bounty SOL</span>
        </div>
        <div className="stat-pill">
          <span className="stat-val">
            {typeof score === "number" ? `${score}/10` : "—"}
          </span>
          <span className="stat-lbl">Overall score</span>
        </div>
        <div className="stat-pill">
          <span className="stat-val">
            {typeof rank === "number"
              ? `#${rank}${typeof total === "number" ? ` of ${total}` : ""}`
              : "—"}
          </span>
          <span className="stat-lbl">Rank</span>
        </div>
        <div className="stat-pill">
          <span className="stat-val">
            {typeof passedCount === "number" && threshold != null
              ? passedCount
              : "—"}
          </span>
          <span className="stat-lbl">
            {threshold != null ? `Above threshold ${threshold}` : "Above threshold"}
          </span>
        </div>
      </div>

      {/* ---- Two-column body ---- */}
      <div className="submission-detail-grid">
        {/* Issue + PR card */}
        <div className="profile-card">
          <h2 className="section-label">Pull request</h2>
          <ReadRow
            label="Repo"
            value={submission.prRepo}
          />
          <ReadRow
            label="PR"
            value={`#${submission.prNumber}`}
            link={submission.prUrl}
          />
          {bounty && (
            <ReadRow
              label="Issue"
              value={`${bounty.repo} #${bounty.issueNumber}`}
              link={bounty.issueUrl}
            />
          )}
          <ReadRow
            label="Submitted"
            value={new Date(submission.createdAt).toLocaleString()}
          />
          {submission.note && (
            <ReadRow label="Note" value={`“${submission.note}”`} />
          )}
        </div>

        {/* Evaluation card */}
        <div className="profile-card">
          <h2 className="section-label">Evaluation</h2>
          {!report && typeof score !== "number" && (
            <EvalPlaceholder granular={granular} />
          )}
          {!report && typeof score === "number" && (
            <p className="modal-note">
              Score: <strong>{score}/10</strong>
              {scoreSource && (
                <span className="field-label-aux"> ({scoreSource})</span>
              )}
              {reasoning && (
                <>
                  <br />
                  <br />
                  {reasoning}
                </>
              )}
            </p>
          )}
          {report && (
            <ReportPanel
              report={report}
              source={scoreSource ?? "opus"}
            />
          )}
        </div>
      </div>

      {/* ---- Decision panel ---- */}
      {granular === "auto_rejected" && (
        <div className="submission-reject-feedback submission-auto-reject">
          <span className="submission-reject-feedback-label">
            Auto-rejected by the relayer
          </span>
          <p>
            {submission.rejectReason ??
              "Score below the bounty's threshold."}
          </p>
        </div>
      )}
      {granular === "rejected" && (
        <div className="submission-reject-feedback">
          <span className="submission-reject-feedback-label">
            Feedback from the company
          </span>
          <p>{submission.rejectReason ?? "No reason provided."}</p>
        </div>
      )}
      {granular === "approved" && (
        <div className="submission-approve-feedback">
          <span className="submission-approve-feedback-label">
            ★ You won this bounty
          </span>
          <p>
            {submission.approvalFeedback ??
              "No specific note from the company. The bounty payout has been released to your wallet."}
          </p>
        </div>
      )}
      {granular === "lost" && (
        <div className="submission-lost-feedback">
          <span className="submission-lost-feedback-label">
            Another submission won this bounty
          </span>
          <p>
            The escrow has been released to a different developer. Your PR
            wasn&apos;t selected this time.
          </p>
        </div>
      )}

      {/* ---- Payment ---- */}
      {payoutTxHash && (
        <div className="profile-card">
          <h2 className="section-label">Payment</h2>
          <ReadRow
            label="Tx"
            value={shortAddr(payoutTxHash)}
            link={`https://explorer.solana.com/tx/${payoutTxHash}?cluster=devnet`}
            mono
          />
          {bounty && (
            <ReadRow
              label="Amount"
              value={`${bounty.amountUsdc.toLocaleString()} SOL`}
            />
          )}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <Link href="/app/profile" className="btn btn-ghost btn-sm">
          ← Back to profile
        </Link>
      </div>
    </div>
  );
}

function EvalPlaceholder({
  granular,
}: {
  granular: SubmissionGranularStatus;
}) {
  if (granular === "submitted") {
    return (
      <p className="modal-note">
        Waiting for the relayer to start evaluating your PR. This usually
        takes under a minute once the on-chain submission lands.
      </p>
    );
  }
  if (granular === "evaluating") {
    return (
      <p className="modal-note">
        Sonnet is reading the diff and scoring it on 4 dimensions
        (code quality, tests, requirements, security). Refresh in a few
        seconds — the score lands here when it&apos;s ready.
      </p>
    );
  }
  return (
    <p className="modal-note">
      No evaluation has been recorded for this submission yet.
    </p>
  );
}

function ReportPanel({
  report,
  source,
}: {
  report: OpusReport;
  source: string;
}) {
  const dims = (Object.keys(DIMENSION_WEIGHTS) as Array<
    keyof typeof DIMENSION_WEIGHTS
  >).map((k) => ({
    key: k,
    label: DIMENSION_LABELS[k],
    weight: DIMENSION_WEIGHTS[k],
    score: report[k]?.score ?? 0,
    reasoning: report[k]?.reasoning ?? "",
  }));

  return (
    <div className="report-panel">
      <div className="report-panel-meta">
        <span className="field-label">Evaluator</span>
        <span className="mono-inline">{source}</span>
      </div>
      <ul className="report-dims">
        {dims.map((d) => (
          <li key={d.key} className="report-dim">
            <div className="report-dim-head">
              <span className="report-dim-label">{d.label}</span>
              <span className="report-dim-weight">
                weight {Math.round(d.weight * 100)}%
              </span>
              <span className="report-dim-score">{d.score}/10</span>
            </div>
            <div className="report-dim-bar">
              <span
                className="report-dim-bar-fill"
                style={{ width: `${(d.score / 10) * 100}%` }}
              />
            </div>
            {d.reasoning && (
              <p className="report-dim-reasoning">{d.reasoning}</p>
            )}
          </li>
        ))}
      </ul>
      {report.summary && (
        <div className="report-summary">
          <span className="field-label">Summary</span>
          <p>{report.summary}</p>
        </div>
      )}
    </div>
  );
}

function ReadRow({
  label,
  value,
  link,
  mono,
}: {
  label: string;
  value: string;
  link?: string;
  mono?: boolean;
}) {
  return (
    <div className="read-row">
      <span className="field-label">{label}</span>
      <span className={`read-value ${mono ? "mono" : ""}`}>
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="read-value-text accent"
          >
            {value}
          </a>
        ) : (
          <span className="read-value-text">{value}</span>
        )}
      </span>
    </div>
  );
}

function shortAddr(s: string): string {
  if (s.length < 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}
