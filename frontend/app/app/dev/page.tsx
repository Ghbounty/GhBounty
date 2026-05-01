"use client";

import { useEffect, useMemo, useState } from "react";
import { Guard } from "@/components/Guard";
import { BountyRow } from "@/components/BountyRow";
import { SubmitPRModal } from "@/components/SubmitPRModal";
import { useAuth } from "@/lib/auth";
import { fetchMarketplace, fetchSubmissionsByDev } from "@/lib/data";
import type { Bounty, Company } from "@/lib/types";

type StatusFilter = "all" | "open" | "reviewing" | "approved";
const STATUS_FILTERS: StatusFilter[] = ["all", "open", "reviewing", "approved"];

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

  // GHB-170: `bounty.status` already arrives as "reviewing" whenever
  // any submission exists (the data fetcher backfills the count from the
  // `submissions` table — see `countSubmissionsByIssuePda`). So the
  // dev-side view doesn't need a client-side override anymore: their own
  // submitted bounty shows up as "Reviewing" because there IS a
  // submission for it, period.
  const filtered = bounties.filter((b) => {
    if (status !== "all" && b.status !== status) return false;
    if (companyId !== "all" && b.companyId !== companyId) return false;
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
            return (
              <BountyRow
                key={b.id}
                bounty={b}
                company={companyMap.get(b.companyId)}
                showCompany
                action={
                  submitted ? (
                    <span className="submitted-pill">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      PR submitted
                    </span>
                  ) : (
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
                  )
                }
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
