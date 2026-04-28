"use client";

import { useEffect, useMemo, useState } from "react";
import { Guard } from "@/components/Guard";
import { BountyRow } from "@/components/BountyRow";
import { BountyEditMenu } from "@/components/BountyEditMenu";
import { BulkBountyFlow } from "@/components/BulkBountyFlow";
import { CreateBountyForm } from "@/components/CreateBountyForm";
import { ReleaseModeBadge } from "@/components/ReleaseModePicker";
import { useAuth } from "@/lib/auth";
import { fetchBountiesByCompany } from "@/lib/data";
import type { Bounty, Company } from "@/lib/types";

type Filter = "all" | "open" | "reviewing" | "approved" | "rejected" | "paid" | "closed";
const FILTERS: Filter[] = ["all", "open", "reviewing", "approved", "paid", "closed"];

export default function CompanyDashboard() {
  return (
    <Guard role="company">
      <CompanyDashboardInner />
    </Guard>
  );
}

function CompanyDashboardInner() {
  const { user } = useAuth();
  const company = user as Company;
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [bulkOpen, setBulkOpen] = useState(false);

  const [bounties, setBounties] = useState<Bounty[]>([]);

  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchBountiesByCompany(company.id).then((bs) => {
      if (!cancelled) setBounties(bs);
    });
    return () => {
      cancelled = true;
    };
  }, [company.id, tick]);

  const counts = useMemo(() => {
    const base: Record<Filter, number> = {
      all: bounties.length,
      open: 0,
      reviewing: 0,
      approved: 0,
      rejected: 0,
      paid: 0,
      closed: 0,
    };
    for (const b of bounties) base[b.status]++;
    return base;
  }, [bounties]);

  const filtered =
    filter === "all" ? bounties : bounties.filter((b) => b.status === filter);

  const totalFunded = bounties.reduce((s, b) => s + b.amountUsdc, 0);
  const totalPaid = bounties
    .filter((b) => b.status === "paid")
    .reduce((s, b) => s + b.amountUsdc, 0);

  return (
    <div className="dash">
      <section className="dash-hero">
        <div>
          <div className="eyebrow">Company dashboard</div>
          <h1 className="dash-title">Welcome back, {company.name}</h1>
          <p className="dash-sub">{company.description}</p>
        </div>
        <div className="dash-stats">
          <Stat label="Bounties" value={bounties.length.toString()} />
          <Stat label="Open" value={counts.open.toString()} />
          <Stat label="Paid" value={counts.paid.toString()} />
          <Stat label="Funded" value={`${totalFunded.toLocaleString()} mUSDC`} />
          <Stat label="Released" value={`${totalPaid.toLocaleString()} mUSDC`} />
        </div>
      </section>

      <div className="dash-grid">
        <section className="dash-col">
          <div className="dash-col-head">
            <h2>
              Bounties <span className="muted">({bounties.length})</span>
            </h2>
            <div className="filter-pills">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  className={`filter-pill ${filter === f ? "active" : ""}`}
                  onClick={() => setFilter(f)}
                >
                  {cap(f)} ({counts[f]})
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="empty">
              <p>No bounties {filter === "all" ? "yet" : `with status "${filter}"`}.</p>
              <p className="muted">Create one on the right to get started.</p>
            </div>
          ) : (
            <div className="bounty-stack">
              {filtered.map((b) => (
                <BountyRow
                  key={b.id}
                  bounty={b}
                  meta={<ReleaseModeBadge mode={b.releaseMode} />}
                  action={
                    <BountyEditMenu
                      bounty={b}
                      onChanged={() => setTick((t) => t + 1)}
                    />
                  }
                />
              ))}
            </div>
          )}
        </section>

        <aside className="dash-aside">
          <button
            type="button"
            className="bulk-cta"
            onClick={() => setBulkOpen(true)}
            disabled={!company.wallet}
            title={!company.wallet ? "Connect a wallet first" : undefined}
          >
            <span className="bulk-cta-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
                <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z" />
              </svg>
            </span>
            <div className="bulk-cta-body">
              <div className="bulk-cta-title">Bulk import with AI</div>
              <div className="bulk-cta-desc">
                Paste a repo URL — AI scores issues and proposes bounties.
              </div>
            </div>
            <span className="bulk-cta-arrow">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            </span>
          </button>
          <CreateBountyForm company={company} onCreated={() => setTick((t) => t + 1)} />
        </aside>
      </div>

      {bulkOpen && (
        <BulkBountyFlow
          company={company}
          onClose={() => setBulkOpen(false)}
          onCreated={() => setTick((t) => t + 1)}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-pill">
      <span className="stat-val">{value}</span>
      <span className="stat-lbl">{label}</span>
    </div>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
