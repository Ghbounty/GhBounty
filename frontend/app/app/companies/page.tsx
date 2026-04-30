"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Guard } from "@/components/Guard";
import { Avatar } from "@/components/Avatar";
import { fetchBounties, fetchCompanies } from "@/lib/data";
import type { Bounty, Company } from "@/lib/types";

export default function CompaniesDirectory() {
  return (
    <Guard role="dev">
      <Inner />
    </Guard>
  );
}

function Inner() {
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [bounties, setBounties] = useState<Bounty[]>([]);

  useEffect(() => {
    // Mock backend syncs cross-tab via localStorage events; the Supabase
    // backend won't fire these so the listener is a no-op there. Cheap
    // enough to keep for parity until we wire realtime subscriptions.
    const h = () => setTick((t) => t + 1);
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchCompanies(), fetchBounties()]).then(([c, b]) => {
      if (cancelled) return;
      setCompanies(c);
      setBounties(b);
    });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const cards = companies
    .map((c) => {
      const own = bounties.filter((b) => b.companyId === c.id);
      return {
        company: c,
        total: own.length,
        open: own.filter((b) => b.status === "open").length,
        funded: own.reduce((s, b) => s + b.amountUsdc, 0),
      };
    })
    .filter((x) => {
      if (!q) return true;
      const s = q.toLowerCase();
      return (
        x.company.name.toLowerCase().includes(s) ||
        (x.company.industry ?? "").toLowerCase().includes(s) ||
        (x.company.description ?? "").toLowerCase().includes(s)
      );
    })
    .sort((a, b) => b.open - a.open);

  return (
    <div className="dash">
      <section className="dash-hero">
        <div>
          <div className="eyebrow">Company directory</div>
          <h1 className="dash-title">Companies funding open source</h1>
          <p className="dash-sub">
            Explore every organization running bounties on GH Bounty, and the
            issues they&apos;re paying to fix.
          </p>
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
            placeholder="Search by name, industry, description…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </section>

      <div className="company-grid">
        {cards.map(({ company, total, open, funded }) => (
          <Link
            key={company.id}
            href={`/app/companies/${company.id}`}
            className="company-card"
          >
            <div className="company-card-head">
              <Avatar
                src={company.avatarUrl}
                name={company.name}
                size={44}
                rounded={false}
              />
              <div>
                <div className="company-card-name">{company.name}</div>
                {company.industry && (
                  <div className="company-card-industry">{company.industry}</div>
                )}
              </div>
            </div>
            <p className="company-card-desc">{company.description}</p>
            <div className="company-card-stats">
              <span>
                <b>{open}</b> open
              </span>
              <span>
                <b>{total}</b> total
              </span>
              <span>
                <b>{funded.toLocaleString()}</b> SOL funded
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
