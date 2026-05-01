"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Guard } from "@/components/Guard";
import { BountyRow } from "@/components/BountyRow";
import { SubmitPRModal } from "@/components/SubmitPRModal";
import { useAuth } from "@/lib/auth";
import { fetchMarketplace, fetchSubmissionsByDev } from "@/lib/data";
import type { Bounty, Company } from "@/lib/types";

type StatusFilter = "all" | "open" | "reviewing" | "approved";
const STATUS_FILTERS: StatusFilter[] = ["all", "open", "reviewing", "approved"];

/**
 * Decide whether a bounty matches a given UI filter for THIS dev.
 *
 * The filters are dev-perspective, not bounty-perspective: a bounty
 * the dev already submitted a PR to is "reviewing" for them and no
 * longer "open", regardless of whether the on-chain bounty itself is
 * still accepting new PRs from other devs. Likewise, "approved" tracks
 * the dev's OWN win, not whether someone else won the same bounty.
 *
 *   - "open"      → on-chain Open (or has-submissions Reviewing) AND
 *                   THIS dev has NOT submitted yet. The bounty is
 *                   actionable for them.
 *   - "reviewing" → this dev submitted, decision still pending. Drops
 *                   out once the dev wins (Approved) or is rejected.
 *   - "approved"  → THIS dev's submission won (review.approved or
 *                   on-chain Winner). The Supabase relayer mirror is
 *                   slow on devnet, so we rely on the off-chain
 *                   `submission_reviews.approved` flag set immediately
 *                   by `recordWinnerOnchain`.
 */
function matchesStatusFilter(
  b: Bounty,
  filter: StatusFilter,
  hasSubmitted: boolean,
  hasApproved: boolean,
  hasRejected: boolean,
): boolean {
  switch (filter) {
    case "open":
      return (
        (b.status === "open" || b.status === "reviewing") && !hasSubmitted
      );
    case "reviewing":
      return (
        hasSubmitted &&
        !hasApproved &&
        !hasRejected &&
        (b.status === "open" || b.status === "reviewing")
      );
    case "approved":
      return hasApproved;
    default:
      return true;
  }
}

export default function DevDashboard() {
  return (
    <Guard role="dev">
      <DevDashboardInner />
    </Guard>
  );
}

function DevDashboardInner() {
  const { user } = useAuth();
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState("");
  const [companyId, setCompanyId] = useState<string>("all");
  const [status, setStatus] = useState<StatusFilter>("open");
  const [modalFor, setModalFor] = useState<Bounty | null>(null);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [submittedBountyIds, setSubmittedBountyIds] = useState<Set<string>>(
    new Set(),
  );
  // GHB-84: bounties where the dev's own submission got rejected by the
  // company. Tracked separately from `submittedBountyIds` so the row
  // action can swap "PR submitted" for a "Rejected — see profile" link.
  // We deliberately do NOT surface the company's feedback text here —
  // it lives on /app/profile where the dev reads it in context.
  const [rejectedBountyIds, setRejectedBountyIds] = useState<Set<string>>(
    new Set(),
  );
  // GHB-83 follow-up: bounties where THIS dev was picked as the winner.
  // Mirror of `rejectedBountyIds` for the approval flow — same UX
  // pattern, different colour. Approval feedback lives on /app/profile.
  const [approvedBountyIds, setApprovedBountyIds] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchMarketplace(),
      user ? fetchSubmissionsByDev(user.id) : Promise.resolve([]),
    ]).then(([{ bounties: bs, companies: cs }, subs]) => {
      if (cancelled) return;
      setBounties(bs);
      setCompanies(cs);
      setSubmittedBountyIds(new Set(subs.map((s) => s.bountyId)));
      setRejectedBountyIds(
        new Set(
          subs
            .filter((s) => s.status === "rejected")
            .map((s) => s.bountyId),
        ),
      );
      setApprovedBountyIds(
        new Set(
          subs
            .filter((s) => s.status === "accepted")
            .map((s) => s.bountyId),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [tick, user]);

  const companyMap = useMemo(() => {
    const m = new Map<string, Company>();
    for (const c of companies) m.set(c.id, c);
    return m;
  }, [companies]);

  // Per-dev filter: a bounty the dev already submitted to is treated
  // as "reviewing" for them and disappears from "Open" — the bounty is
  // no longer actionable on their side. Other devs may still see it as
  // open. See `matchesStatusFilter` for the exact rules.
  //
  // Tom's note (paraphrased): "if I as a dev already applied for a
  // bounty, in my state of dev the bounty shouldn't appear in open,
  // only in review. The company has different rules — they still see
  // it as open until the max-submissions cap is hit (separate ticket)."
  const filtered = bounties.filter((b) => {
    const submitted = submittedBountyIds.has(b.id);
    const approved = approvedBountyIds.has(b.id);
    const rejected = rejectedBountyIds.has(b.id);
    if (companyId !== "all" && b.companyId !== companyId) return false;
    if (
      status !== "all" &&
      !matchesStatusFilter(b, status, submitted, approved, rejected)
    ) {
      return false;
    }
    if (search) {
      const s = search.toLowerCase();
      const hit =
        b.repo.toLowerCase().includes(s) ||
        (b.title ?? "").toLowerCase().includes(s) ||
        String(b.issueNumber).includes(s);
      if (!hit) return false;
    }
    return true;
  });

  const totalAvailable = bounties
    .filter((b) => b.status === "open")
    .reduce((s, b) => s + b.amountUsdc, 0);

  return (
    <div className="dash">
      <section className="dash-hero">
        <div>
          <div className="eyebrow">Developer dashboard</div>
          <h1 className="dash-title">Find your next bounty</h1>
          <p className="dash-sub">
            Filter by company, claim an issue, submit a PR — get paid the moment
            validators approve.
          </p>
        </div>
        <div className="dash-stats">
          <div className="stat-pill">
            <span className="stat-val">{bounties.length}</span>
            <span className="stat-lbl">Total bounties</span>
          </div>
          <div className="stat-pill">
            <span className="stat-val">{companies.length}</span>
            <span className="stat-lbl">Companies</span>
          </div>
          <div className="stat-pill">
            <span className="stat-val">{totalAvailable.toLocaleString()}</span>
            <span className="stat-lbl">Open SOL</span>
          </div>
        </div>
      </section>

      <section className="dash-toolbar tight">
        <div className="search-wrap">
          <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            className="search"
            placeholder="Search repo, issue or title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="select"
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
        >
          <option value="all">All companies</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="filter-pills">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              className={`filter-pill ${status === s ? "active" : ""}`}
              onClick={() => setStatus(s)}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </section>

      {filtered.length === 0 ? (
        <div className="empty">
          <p>No bounties match your filters.</p>
        </div>
      ) : (
        <div className="bounty-stack">
          {filtered.map((b) => {
            const submitted = submittedBountyIds.has(b.id);
            const rejected = rejectedBountyIds.has(b.id);
            const approved = approvedBountyIds.has(b.id);
            // Four-way action gate, in priority order (later states are
            // strictly newer — picked sub also matches submitted, etc.):
            //   approved  → green "You won — see profile" (Link)
            //   rejected  → red "Rejected — see profile" (Link)
            //   submitted → "PR submitted" pill (still pending decision)
            //   neither   → "Submit PR" button
            let action: React.ReactNode;
            if (approved) {
              action = (
                <Link href="/app/profile" className="approved-pill">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  You won — see profile
                </Link>
              );
            } else if (rejected) {
              action = (
                <Link href="/app/profile" className="rejected-pill">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                  Rejected — see profile
                </Link>
              );
            } else if (submitted) {
              action = (
                <span className="submitted-pill">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  PR submitted
                </span>
              );
            } else {
              action = (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setModalFor(b)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="6" cy="6" r="3" />
                    <circle cx="18" cy="18" r="3" />
                    <path d="M6 9v6a6 6 0 006 6h3" />
                  </svg>
                  Submit PR
                </button>
              );
            }
            return (
              <BountyRow
                key={b.id}
                bounty={b}
                company={companyMap.get(b.companyId)}
                showCompany
                action={action}
              />
            );
          })}
        </div>
      )}

      {modalFor && user && (
        <SubmitPRModal
          bounty={modalFor}
          devId={user.id}
          onClose={() => setModalFor(null)}
          onSubmitted={() => {
            setModalFor(null);
            setTick((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}
