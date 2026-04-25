"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Guard } from "@/components/Guard";
import { Avatar } from "@/components/Avatar";
import { BountyRow } from "@/components/BountyRow";
import { SubmitPRModal } from "@/components/SubmitPRModal";
import { useAuth } from "@/lib/auth";
import { bountiesByCompany, hasDevSubmitted } from "@/lib/store";
import { fetchCompany } from "@/lib/data";
import type { Bounty, Company } from "@/lib/types";

export default function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <Guard role="dev">
      <Inner id={id} />
    </Guard>
  );
}

function Inner({ id }: { id: string }) {
  const { user } = useAuth();
  const [tick, setTick] = useState(0);
  const [modalFor, setModalFor] = useState<Bounty | null>(null);

  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }, []);

  const [company, setCompany] = useState<Company | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchCompany(id).then((c) => {
      if (cancelled) return;
      setCompany(c ?? undefined);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [id, tick]);

  const bounties = useMemo(() => bountiesByCompany(id), [id, tick]);

  if (!loaded) {
    return (
      <div className="app-loading">
        <span className="loading-dot" />
      </div>
    );
  }

  if (!company) {
    return (
      <div className="dash">
        <div className="empty">
          <p>Company not found.</p>
          <Link href="/app/companies" className="btn btn-ghost btn-sm">
            ← Back to directory
          </Link>
        </div>
      </div>
    );
  }

  const open = bounties.filter((b) => b.status === "open").length;
  const funded = bounties.reduce((s, b) => s + b.amountUsdc, 0);
  const paid = bounties
    .filter((b) => b.status === "paid")
    .reduce((s, b) => s + b.amountUsdc, 0);

  return (
    <div className="dash">
      <Link href="/app/companies" className="back-link">
        ← All companies
      </Link>
      <section className="company-detail-hero">
        <Avatar
          src={company.avatarUrl}
          name={company.name}
          size={72}
          rounded={false}
        />
        <div className="company-detail-meta">
          <h1 className="dash-title">{company.name}</h1>
          {company.industry && (
            <div className="company-card-industry">{company.industry}</div>
          )}
          <p className="dash-sub">{company.description}</p>
          <div className="company-detail-links">
            {company.website && (
              <a
                href={company.website}
                target="_blank"
                rel="noopener noreferrer"
              >
                {company.website.replace(/^https?:\/\//, "")}
              </a>
            )}
            {company.email && <a href={`mailto:${company.email}`}>{company.email}</a>}
          </div>
        </div>
        <div className="dash-stats">
          <div className="stat-pill">
            <span className="stat-val">{bounties.length}</span>
            <span className="stat-lbl">Bounties</span>
          </div>
          <div className="stat-pill">
            <span className="stat-val">{open}</span>
            <span className="stat-lbl">Open</span>
          </div>
          <div className="stat-pill">
            <span className="stat-val">{funded.toLocaleString()}</span>
            <span className="stat-lbl">Funded</span>
          </div>
          <div className="stat-pill">
            <span className="stat-val">{paid.toLocaleString()}</span>
            <span className="stat-lbl">Paid</span>
          </div>
        </div>
      </section>

      <h2 className="section-label">Bounties from {company.name}</h2>
      {bounties.length === 0 ? (
        <div className="empty">
          <p>No bounties yet from this company.</p>
        </div>
      ) : (
        <div className="bounty-stack">
          {bounties.map((b) => {
            const submitted = user ? hasDevSubmitted(user.id, b.id) : false;
            return (
              <BountyRow
                key={b.id}
                bounty={b}
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
