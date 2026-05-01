"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { useWallets } from "@privy-io/react-auth/solana";
import { Guard } from "@/components/Guard";
import { BountyRow } from "@/components/BountyRow";
import { DepositModal } from "@/components/DepositModal";
import { SubmitPRModal } from "@/components/SubmitPRModal";
import { WithdrawModal } from "@/components/WithdrawModal";
import { useAuth, usePrivyBackend } from "@/lib/auth-context";
import { fetchMarketplace, fetchSubmissionsByDev } from "@/lib/data";
import { getConnection } from "@/lib/solana";
import type { Bounty, Company } from "@/lib/types";

type StatusFilter = "all" | "open" | "reviewing" | "approved";
const STATUS_FILTERS: StatusFilter[] = ["all", "open", "reviewing", "approved"];

/**
 * Decide whether a bounty matches a given UI filter for THIS dev.
 *
 * The filters are dev-perspective, not bounty-perspective: a bounty
 * the dev already submitted a PR to is "reviewing" for them and no
 * longer "open", regardless of whether the on-chain bounty itself is
 * still accepting new PRs from other devs. (The company-side analogue
 * uses different rules — see `app/app/company/page.tsx`.)
 *
 *   - "open"      → on-chain Open (or has-submissions Reviewing) AND
 *                   THIS dev has NOT submitted yet. The bounty is
 *                   actionable for them.
 *   - "reviewing" → this dev submitted, decision still pending. Stays
 *                   here regardless of how many other PRs landed.
 *   - "approved"  → bounty resolved on-chain (any winner picked,
 *                   payout cleared). Includes losses; the dev's own
 *                   personal "won/lost" view lives in the profile
 *                   submissions list (GHB-90 / 91).
 */
function matchesStatusFilter(
  b: Bounty,
  filter: StatusFilter,
  hasSubmitted: boolean,
): boolean {
  switch (filter) {
    case "open":
      return (
        (b.status === "open" || b.status === "reviewing") && !hasSubmitted
      );
    case "reviewing":
      return (
        hasSubmitted &&
        (b.status === "open" || b.status === "reviewing")
      );
    case "approved":
      return b.status === "approved" || b.status === "paid";
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
  const privyMode = usePrivyBackend;
  const { wallets } = useWallets();
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
  // Live SOL balance for the dev's Privy wallet — surfaced in the
  // wallet pill so the dev can SEE the bounty payout land after a
  // company picks them as winner. Re-fetched on `tick` bumps so the
  // user can refresh by triggering a state change anywhere (modal
  // close, deposit, etc.).
  const [balanceSol, setBalanceSol] = useState<number | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);

  // The dev's wallet — Privy embedded in real mode, mock store wallet
  // for the legacy localStorage flow.
  const walletAddress = privyMode
    ? wallets[0]?.address ?? null
    : user?.wallet ?? null;

  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }, []);

  // Balance fetch — separate effect from the marketplace fetch because
  // the wallet address can change without the dev's submissions
  // changing (and vice-versa). Hits the RPC directly; the value
  // matters at click-time.
  useEffect(() => {
    if (!walletAddress) {
      setBalanceSol(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const conn = getConnection();
        const lamports = await conn.getBalance(new PublicKey(walletAddress));
        if (!cancelled) setBalanceSol(lamports / LAMPORTS_PER_SOL);
      } catch (err) {
        console.warn("[DevDashboard] balance fetch failed:", err);
        if (!cancelled) setBalanceSol(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, tick]);

  const refreshAll = useCallback(() => setTick((t) => t + 1), []);

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
    if (companyId !== "all" && b.companyId !== companyId) return false;
    if (status !== "all" && !matchesStatusFilter(b, status, submitted)) {
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

      {/* Dev wallet pill — mirrors the company-side `CreateBountyForm`
        * pill so the dev sees their live SOL balance + can move funds in
        * and out without leaving the dashboard. The balance only shows
        * here (the dev's own view); we do NOT expose it to companies in
        * the submissions review modal. */}
      {walletAddress && (
        <section className="wallet-pill dev-wallet-pill">
          <div className="wallet-pill-row">
            <span className="wallet-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7h18v13H3z" />
                <path d="M3 7l2-3h14l2 3" />
                <circle cx="17" cy="13.5" r="1.5" />
              </svg>
            </span>
            <code>{shortWallet(walletAddress)}</code>
            <span className="wallet-status">
              {balanceSol !== null ? `${balanceSol.toFixed(4)} SOL` : "—"}
            </span>
          </div>
          <div className="wallet-pill-actions">
            <button
              type="button"
              className="wallet-action wallet-deposit"
              onClick={() => setDepositOpen(true)}
              disabled={!privyMode}
              title="Receive SOL into your Privy wallet"
            >
              Deposit
            </button>
            <button
              type="button"
              className="wallet-action wallet-withdraw"
              onClick={() => setWithdrawOpen(true)}
              disabled={
                !privyMode ||
                !wallets[0] ||
                balanceSol === null ||
                balanceSol <= 0
              }
              title="Send SOL from your Privy wallet to an external address"
            >
              Withdraw
            </button>
          </div>
        </section>
      )}

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

      {withdrawOpen && wallets[0] && (
        <WithdrawModal
          wallet={wallets[0]}
          balanceSol={balanceSol}
          onClose={() => setWithdrawOpen(false)}
          onWithdrawn={refreshAll}
        />
      )}

      {depositOpen && walletAddress && (
        <DepositModal
          walletAddress={walletAddress}
          // Hardcoded for MVP — we're locked to devnet via the Privy
          // chain config; surface the explicit cluster so the user
          // doesn't dust mainnet SOL into the wrong wallet.
          network="Solana Devnet"
          onClose={() => setDepositOpen(false)}
          onRefresh={() => {
            setDepositOpen(false);
            refreshAll();
          }}
        />
      )}
    </div>
  );
}

function shortWallet(w: string): string {
  if (w.length < 12) return w;
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}
