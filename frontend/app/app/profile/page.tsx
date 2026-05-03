"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Guard } from "@/components/Guard";
import { Avatar } from "@/components/Avatar";
import { AvatarUploader } from "@/components/AvatarUploader";
import { StatusBadge } from "@/components/StatusBadge";
import { UsdcIcon } from "@/components/UsdcIcon";
import { useAuth } from "@/lib/auth";
import {
  fetchBounties,
  fetchBountiesByCompany,
  fetchCompanies,
  fetchSubmissionsByDev,
} from "@/lib/data";
import type {
  Bounty,
  Company,
  Dev,
  Submission,
  SubmissionGranularStatus,
} from "@/lib/types";

export default function ProfilePage() {
  return (
    <Guard>
      <Inner />
    </Guard>
  );
}

function Inner() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role === "company") return <CompanyProfile />;
  return <DevProfile />;
}

/* --------------- Company profile --------------- */
function CompanyProfile() {
  const { user, updateUser } = useAuth();
  const c = user as Company;
  const [editing, setEditing] = useState(false);
  const [avatar, setAvatar] = useState<string | undefined>(c.avatarUrl);
  const [saved, setSaved] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => setAvatar(c.avatarUrl), [c.avatarUrl]);

  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }, []);

  const [bounties, setBounties] = useState<Bounty[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchBountiesByCompany(c.id).then((bs) => {
      if (!cancelled) setBounties(bs);
    });
    return () => {
      cancelled = true;
    };
  }, [c.id, tick]);
  const funded = bounties.reduce((s, b) => s + b.amountUsdc, 0);
  const paid = bounties
    .filter((b) => b.status === "paid")
    .reduce((s, b) => s + b.amountUsdc, 0);

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget;
    const get = (n: string) =>
      (f.elements.namedItem(n) as HTMLInputElement | HTMLTextAreaElement).value.trim();
    await updateUser({
      name: get("name") || c.name,
      email: get("email") || c.email,
      website: get("website") || undefined,
      industry: get("industry") || undefined,
      description: get("description") || c.description,
      avatarUrl: avatar,
    });
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function cancel() {
    setAvatar(c.avatarUrl);
    setEditing(false);
  }

  return (
    <div className="dash">
      <section className="profile-hero">
        <div className="profile-hero-main">
          {!editing && (
            <Avatar
              src={c.avatarUrl}
              name={c.name}
              size={72}
              rounded={false}
            />
          )}
          <div className="profile-hero-text">
            <div className="eyebrow">Company profile</div>
            <h1 className="dash-title">{c.name}</h1>
            {c.industry && (
              <div className="profile-hero-handle">{c.industry}</div>
            )}
          </div>
        </div>
        <div className="profile-actions">
          {saved && <span className="saved-pill">✓ Saved</span>}
          {!editing && (
            <button className="btn btn-primary btn-sm" onClick={() => setEditing(true)}>
              Edit profile
            </button>
          )}
        </div>
      </section>

      {editing ? (
        <form className="profile-card" onSubmit={onSave}>
          <AvatarUploader
            value={avatar}
            onChange={setAvatar}
            label="Company logo"
          />
          <div className="field-row">
            <label className="field">
              <span className="field-label">Company name</span>
              <input name="name" defaultValue={c.name} required />
            </label>
            <label className="field">
              <span className="field-label">Email</span>
              <input name="email" type="email" defaultValue={c.email} required />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span className="field-label">Website</span>
              <input name="website" type="url" defaultValue={c.website ?? ""} />
            </label>
            <label className="field">
              <span className="field-label">Industry</span>
              <input name="industry" defaultValue={c.industry ?? ""} />
            </label>
          </div>
          <label className="field">
            <span className="field-label">Description</span>
            <textarea name="description" rows={4} defaultValue={c.description} />
          </label>
          <div className="profile-card-foot">
            <button type="button" className="btn btn-ghost btn-sm" onClick={cancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save changes
            </button>
          </div>
        </form>
      ) : (
        <div className="profile-card">
          <ReadRow label="Description" value={c.description} />
          <div className="profile-grid">
            <ReadRow label="Email" value={c.email} />
            <ReadRow label="Website" value={c.website ?? "—"} />
            <ReadRow label="Industry" value={c.industry ?? "—"} />
            <ReadRow
              label="Wallet"
              value={c.wallet ? shortHex(c.wallet) : "not connected"}
              mono
              copy={c.wallet}
            />
          </div>
        </div>
      )}

      <div className="dash-stats profile-stats">
        <div className="stat-pill">
          <span className="stat-val">{bounties.length}</span>
          <span className="stat-lbl">Bounties</span>
        </div>
        <div className="stat-pill">
          <span className="stat-val">{funded.toLocaleString()}</span>
          <span className="stat-lbl">Funded SOL</span>
        </div>
        <div className="stat-pill">
          <span className="stat-val">{paid.toLocaleString()}</span>
          <span className="stat-lbl">Released SOL</span>
        </div>
      </div>
    </div>
  );
}

/* --------------- Dev profile --------------- */
function DevProfile() {
  const { user, updateUser } = useAuth();
  const d = user as Dev;
  const [editing, setEditing] = useState(false);
  const [avatar, setAvatar] = useState<string | undefined>(d.avatarUrl);
  const [saved, setSaved] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => setAvatar(d.avatarUrl), [d.avatarUrl]);

  useEffect(() => {
    const h = () => setTick((t) => t + 1);
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }, []);

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [bountiesAll, setBountiesAll] = useState<Bounty[]>([]);
  const [companiesAll, setCompaniesAll] = useState<Company[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchSubmissionsByDev(d.id),
      fetchBounties(),
      fetchCompanies(),
    ]).then(([subs, bs, cs]) => {
      if (cancelled) return;
      setSubmissions(subs);
      setBountiesAll(bs);
      setCompaniesAll(cs);
    });
    return () => {
      cancelled = true;
    };
  }, [d.id, tick]);

  const bountiesById = useMemo(() => {
    const m = new Map<string, Bounty>();
    for (const b of bountiesAll) m.set(b.id, b);
    return m;
  }, [bountiesAll]);
  const companiesById = useMemo(() => {
    const m = new Map<string, Company>();
    for (const c of companiesAll) m.set(c.id, c);
    return m;
  }, [companiesAll]);

  /**
   * GHB-93: derive earnings stats up here so the EarningsPanel and the
   * submission counters stay in sync. We split:
   *   - paid:    accepted + tx_hash present  → counted as real income
   *   - pending: accepted, tx_hash still null → "in flight" (relayer
   *              hasn't confirmed the payout, or `assisted` mode hasn't
   *              executed `resolve_bounty` yet)
   *
   * Bounties without a matching `Bounty` row in `bountiesById` are
   * skipped — the marketplace fetch may have lagged behind the
   * submission fetch (rare race), and double-counting an unknown amount
   * is worse than under-counting briefly.
   */
  const earnings = useMemo(() => {
    const accepted = submissions.filter((s) => s.status === "accepted");
    const paidRows: Array<{ submission: Submission; bounty: Bounty; company?: Company }> = [];
    const pendingRows: Array<{ submission: Submission; bounty: Bounty }> = [];
    for (const s of accepted) {
      const b = bountiesById.get(s.bountyId);
      if (!b) continue;
      if (s.payoutTxHash) {
        paidRows.push({
          submission: s,
          bounty: b,
          company: companiesById.get(b.companyId),
        });
      } else {
        pendingRows.push({ submission: s, bounty: b });
      }
    }
    const paidTotal = paidRows.reduce((sum, r) => sum + r.bounty.amountUsdc, 0);
    const pendingTotal = pendingRows.reduce(
      (sum, r) => sum + r.bounty.amountUsdc,
      0,
    );
    const best = paidRows.reduce(
      (max, r) => (r.bounty.amountUsdc > max ? r.bounty.amountUsdc : max),
      0,
    );
    const avg = paidRows.length > 0 ? paidTotal / paidRows.length : 0;
    const winRate =
      submissions.length > 0
        ? Math.round((accepted.length / submissions.length) * 100)
        : 0;
    const totalSubmissions = submissions.length;
    // Top 3 companies by lifetime payout. Tiny dataset (tens of rows) so
    // a Map + sort is plenty.
    const byCompany = new Map<string, { name: string; avatarUrl?: string; total: number; wins: number }>();
    for (const r of paidRows) {
      const key = r.bounty.companyId;
      const cur =
        byCompany.get(key) ?? {
          name: r.company?.name ?? "Unknown company",
          avatarUrl: r.company?.avatarUrl,
          total: 0,
          wins: 0,
        };
      cur.total += r.bounty.amountUsdc;
      cur.wins += 1;
      byCompany.set(key, cur);
    }
    const topCompanies = Array.from(byCompany.entries())
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);
    return {
      paidRows: paidRows.sort(
        (a, b) => b.submission.createdAt - a.submission.createdAt,
      ),
      pendingRows,
      paidTotal,
      pendingTotal,
      best,
      avg,
      winRate,
      acceptedCount: accepted.length,
      totalSubmissions,
      topCompanies,
    };
  }, [submissions, bountiesById, companiesById]);
  // Kept for the "Earned SOL" pill copy; same number as earnings.paidTotal.
  const totalEarned = earnings.paidTotal;

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget;
    const get = (n: string) =>
      (f.elements.namedItem(n) as HTMLInputElement | HTMLTextAreaElement).value.trim();
    const skills = get("skills")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    await updateUser({
      username: get("username") || d.username,
      email: get("email") || d.email,
      github: get("github") || undefined,
      bio: get("bio") || undefined,
      skills,
      avatarUrl: avatar,
    });
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function cancel() {
    setAvatar(d.avatarUrl);
    setEditing(false);
  }

  return (
    <div className="dash">
      <section className="profile-hero">
        <div className="profile-hero-main">
          {!editing && (
            <Avatar src={d.avatarUrl} name={d.username} size={72} rounded />
          )}
          <div className="profile-hero-text">
            <div className="eyebrow">My profile</div>
            <h1 className="dash-title">{d.username}</h1>
            {d.github && (
              <a
                className="profile-hero-handle accent"
                href={`https://github.com/${d.github}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                @{d.github}
              </a>
            )}
          </div>
        </div>
        <div className="profile-actions">
          {saved && <span className="saved-pill">✓ Saved</span>}
          {!editing && (
            <button className="btn btn-primary btn-sm" onClick={() => setEditing(true)}>
              Edit profile
            </button>
          )}
        </div>
      </section>

      {editing ? (
        <form className="profile-card" onSubmit={onSave}>
          <AvatarUploader
            value={avatar}
            onChange={setAvatar}
            label="Profile picture"
            rounded
          />
          <div className="field-row">
            <label className="field">
              <span className="field-label">Username</span>
              <input name="username" defaultValue={d.username} required />
            </label>
            <label className="field">
              <span className="field-label">Email</span>
              <input name="email" type="email" defaultValue={d.email} required />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span className="field-label">GitHub handle</span>
              <input name="github" defaultValue={d.github ?? ""} />
            </label>
            <label className="field">
              <span className="field-label">Skills (comma-separated)</span>
              <input name="skills" defaultValue={d.skills.join(", ")} />
            </label>
          </div>
          <label className="field">
            <span className="field-label">Bio</span>
            <textarea name="bio" rows={4} defaultValue={d.bio ?? ""} />
          </label>
          <div className="profile-card-foot">
            <button type="button" className="btn btn-ghost btn-sm" onClick={cancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save changes
            </button>
          </div>
        </form>
      ) : (
        <div className="profile-card">
          {d.bio && <ReadRow label="Bio" value={d.bio} />}
          <div className="profile-grid">
            <ReadRow label="Email" value={d.email} />
            <ReadRow label="GitHub" value={d.github ? `@${d.github}` : "—"} />
            <ReadRow
              label="Wallet"
              value={d.wallet ? shortHex(d.wallet) : "not connected"}
              mono
              copy={d.wallet}
            />
          </div>
          {d.skills.length > 0 && (
            <div className="profile-skills">
              {d.skills.map((s) => (
                <span key={s} className="skill-tag">{s}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="dash-stats profile-stats">
        <div className="stat-pill">
          <span className="stat-val">{submissions.length}</span>
          <span className="stat-lbl">Submissions</span>
        </div>
        <div className="stat-pill">
          <span className="stat-val">{earnings.acceptedCount}</span>
          <span className="stat-lbl">Accepted</span>
        </div>
        <div className="stat-pill">
          <span className="stat-val">{totalEarned.toLocaleString()}</span>
          <span className="stat-lbl">Earned SOL</span>
        </div>
      </div>

      <EarningsPanel earnings={earnings} />

      <DevSubmissionsList
        submissions={submissions}
        bountiesById={bountiesById}
        companiesById={companiesById}
      />
    </div>
  );
}

/**
 * GHB-93: earnings dashboard for the dev profile.
 *
 * Splits accepted submissions into "paid" (tx_hash present, real
 * income) and "pending payout" (accepted, relayer hasn't executed
 * `resolve_bounty` yet — only relevant on `assisted` mode bounties or
 * during the brief window between the company's pick and the on-chain
 * confirm).
 *
 * Three sub-sections:
 *   1. KPI grid — paid total, pending, win rate, avg, best
 *   2. Recent payments — last 5 payouts with explorer links
 *   3. Top companies — who has paid you most
 *
 * Empty state (no accepted submissions yet) collapses to a single
 * encouraging line — we don't want to render a wall of zeros.
 */
type EarningsData = {
  paidRows: Array<{ submission: Submission; bounty: Bounty; company?: Company }>;
  pendingRows: Array<{ submission: Submission; bounty: Bounty }>;
  paidTotal: number;
  pendingTotal: number;
  best: number;
  avg: number;
  winRate: number;
  acceptedCount: number;
  totalSubmissions: number;
  topCompanies: Array<{
    id: string;
    name: string;
    avatarUrl?: string;
    total: number;
    wins: number;
  }>;
};

function EarningsPanel({ earnings }: { earnings: EarningsData }) {
  const hasAnyAccepted = earnings.acceptedCount > 0;
  if (!hasAnyAccepted) {
    return (
      <section className="profile-card earnings-card">
        <h2 className="section-label">Earnings</h2>
        <p className="modal-note">
          You haven&apos;t earned any payouts yet. Win a bounty and your
          payments will appear here with on-chain explorer links.
        </p>
      </section>
    );
  }

  const recent = earnings.paidRows.slice(0, 5);
  return (
    <section className="profile-card earnings-card">
      <div className="earnings-head">
        <h2 className="section-label">Earnings</h2>
        <span className="earnings-head-aux">
          {earnings.paidRows.length} payout
          {earnings.paidRows.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="earnings-grid">
        <EarningsKpi
          label="Paid"
          value={`${earnings.paidTotal.toLocaleString()} SOL`}
          aux="lifetime"
        />
        <EarningsKpi
          label="Pending payout"
          value={
            earnings.pendingTotal > 0
              ? `${earnings.pendingTotal.toLocaleString()} SOL`
              : "—"
          }
          aux={
            earnings.pendingRows.length > 0
              ? `${earnings.pendingRows.length} bounty${
                  earnings.pendingRows.length === 1 ? "" : "ies"
                }`
              : "all settled"
          }
        />
        <EarningsKpi
          label="Win rate"
          value={`${earnings.winRate}%`}
          aux={`${earnings.acceptedCount} of ${earnings.totalSubmissions} submission${earnings.totalSubmissions === 1 ? "" : "s"}`}
        />
        <EarningsKpi
          label="Avg payout"
          value={
            earnings.avg > 0
              ? `${earnings.avg.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })} SOL`
              : "—"
          }
          aux="per win"
        />
        <EarningsKpi
          label="Best win"
          value={earnings.best > 0 ? `${earnings.best.toLocaleString()} SOL` : "—"}
          aux="single payout"
        />
      </div>

      {recent.length > 0 && (
        <div className="earnings-sub">
          <div className="earnings-sub-head">
            <h3 className="earnings-sub-title">Recent payments</h3>
          </div>
          <ul className="earnings-payments">
            {recent.map((r) => (
              <li key={r.submission.id} className="earnings-payment">
                <div className="earnings-payment-left">
                  {r.company && (
                    <Avatar
                      src={r.company.avatarUrl}
                      name={r.company.name}
                      size={28}
                      rounded={false}
                    />
                  )}
                  <div className="earnings-payment-meta">
                    <Link
                      href={`/app/submissions/${r.submission.id}`}
                      className="earnings-payment-title"
                    >
                      {r.bounty.title ?? `${r.bounty.repo} #${r.bounty.issueNumber}`}
                    </Link>
                    <span className="earnings-payment-sub">
                      {r.company?.name ?? r.bounty.repo} ·{" "}
                      {new Date(r.submission.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className="earnings-payment-right">
                  <span className="earnings-payment-amount">
                    +{r.bounty.amountUsdc.toLocaleString()} SOL
                  </span>
                  {r.submission.payoutTxHash && (
                    <a
                      href={`https://explorer.solana.com/tx/${r.submission.payoutTxHash}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="earnings-payment-tx"
                      title={r.submission.payoutTxHash}
                    >
                      Tx ↗
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {earnings.topCompanies.length > 0 && (
        <div className="earnings-sub">
          <div className="earnings-sub-head">
            <h3 className="earnings-sub-title">Top companies</h3>
          </div>
          <ul className="earnings-top">
            {earnings.topCompanies.map((c) => (
              <li key={c.id} className="earnings-top-row">
                <Link
                  href={`/app/companies/${encodeURIComponent(c.id)}`}
                  className="earnings-top-left"
                >
                  <Avatar
                    src={c.avatarUrl}
                    name={c.name}
                    size={28}
                    rounded={false}
                  />
                  <span className="earnings-top-name">{c.name}</span>
                </Link>
                <span className="earnings-top-meta">
                  {c.wins} win{c.wins === 1 ? "" : "s"} ·{" "}
                  <strong>{c.total.toLocaleString()} SOL</strong>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function EarningsKpi({
  label,
  value,
  aux,
}: {
  label: string;
  value: string;
  aux?: string;
}) {
  return (
    <div className="earnings-kpi">
      <span className="earnings-kpi-label">{label}</span>
      <span className="earnings-kpi-value">{value}</span>
      {aux && <span className="earnings-kpi-aux">{aux}</span>}
    </div>
  );
}

/**
 * GHB-90: list of the dev's submissions with status filters and the
 * granular badge per row. Lifted out of `DevProfile` so the filter
 * state stays scoped (no need to re-render the whole profile when the
 * dev clicks a pill) and so the section reads top-down.
 *
 * Filter buckets are intentionally COARSER than the granular status:
 * "Pending review" collapses submitted/evaluating/scored into one — the
 * dev is waiting on the same human/relayer decision regardless of
 * sub-state. The granular badge inside each row keeps the detail.
 */
type ProfileFilter = "all" | "pending" | "won" | "rejected";
const PROFILE_FILTERS: ProfileFilter[] = ["all", "pending", "won", "rejected"];
const PROFILE_FILTER_LABELS: Record<ProfileFilter, string> = {
  all: "All",
  pending: "In review",
  won: "Won",
  rejected: "Rejected",
};

function matchesProfileFilter(s: Submission, f: ProfileFilter): boolean {
  if (f === "all") return true;
  // Fall back to coarse `status` when granularStatus isn't populated
  // (mock paths). Maps loosely to the same buckets.
  const g = s.granularStatus ?? coarseToGranular(s);
  switch (f) {
    case "pending":
      return g === "submitted" || g === "evaluating" || g === "scored";
    case "won":
      return g === "approved";
    case "rejected":
      return g === "auto_rejected" || g === "rejected" || g === "lost";
  }
}

function coarseToGranular(s: Submission): SubmissionGranularStatus {
  if (s.status === "accepted") return "approved";
  if (s.status === "lost") return "lost";
  if (s.status === "rejected") return s.autoRejected ? "auto_rejected" : "rejected";
  return "submitted";
}

function DevSubmissionsList({
  submissions,
  bountiesById,
  companiesById,
}: {
  submissions: Submission[];
  bountiesById: Map<string, Bounty>;
  companiesById: Map<string, Company>;
}) {
  const [filter, setFilter] = useState<ProfileFilter>("all");

  // Pre-compute counts for each filter chip. Cheap (one pass per
  // re-render of this component, submissions list is tens of items
  // tops).
  const counts = useMemo(() => {
    const out: Record<ProfileFilter, number> = {
      all: submissions.length,
      pending: 0,
      won: 0,
      rejected: 0,
    };
    for (const s of submissions) {
      const g = s.granularStatus ?? coarseToGranular(s);
      if (g === "submitted" || g === "evaluating" || g === "scored") out.pending++;
      else if (g === "approved") out.won++;
      else if (g === "auto_rejected" || g === "rejected" || g === "lost") out.rejected++;
    }
    return out;
  }, [submissions]);

  const filtered = submissions.filter((s) => matchesProfileFilter(s, filter));

  return (
    <section className="profile-submissions">
      <div className="profile-submissions-head">
        <h2 className="section-label">My submissions</h2>
        {submissions.length > 0 && (
          <div className="filter-pills">
            {PROFILE_FILTERS.map((f) => (
              <button
                key={f}
                className={`filter-pill ${filter === f ? "active" : ""}`}
                onClick={() => setFilter(f)}
                type="button"
              >
                {PROFILE_FILTER_LABELS[f]}{" "}
                <span className="filter-pill-count">({counts[f]})</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {submissions.length === 0 ? (
        <div className="empty">
          <p>You haven&apos;t submitted any PRs yet.</p>
          <Link href="/app/dev" className="btn btn-ghost btn-sm">
            Browse bounties →
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <p>No submissions match this filter.</p>
        </div>
      ) : (
        <div className="bounty-stack">
          {filtered.map((s) => (
            <SubmissionRow
              key={s.id}
              submission={s}
              bounty={bountiesById.get(s.bountyId)}
              company={
                bountiesById.get(s.bountyId)?.companyId
                  ? companiesById.get(bountiesById.get(s.bountyId)!.companyId)
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * GHB-90: dev-facing summary of a single submission.
 *
 * The whole row links to `/app/submissions/[id]` (GHB-91) — clicking
 * anywhere except the inner PR/company anchors opens the detail page.
 * We render the granular status badge, the score (when scored), the
 * rank within the bounty, and the kind-specific feedback panel
 * (auto-reject reason, manual reject feedback, win note, lost note).
 */
const GRANULAR_LABELS: Record<SubmissionGranularStatus, string> = {
  submitted: "Submitted",
  evaluating: "Evaluating",
  scored: "Scored",
  auto_rejected: "Auto-rejected",
  rejected: "Rejected",
  approved: "Won",
  lost: "Not selected",
};

function SubmissionRow({
  submission,
  bounty,
  company,
}: {
  submission: Submission;
  bounty?: Bounty;
  company?: Company;
}) {
  const granular = submission.granularStatus ?? coarseToGranular(submission);
  const label = GRANULAR_LABELS[granular];
  const score = submission.score;
  const rank = submission.rank;
  const total = submission.totalForBounty;

  return (
    <Link
      href={`/app/submissions/${submission.id}`}
      className={`bounty-card bounty-card-link granular-${granular.replace("_", "-")}`}
    >
      <div className="bounty-card-head">
        {company && (
          // Inner Link to the company page — wrapped in a span so the
          // outer `<a>` still receives the click everywhere else. We
          // can't nest <a> tags, so use a span + onClick navigation.
          <span
            className="bounty-company"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.location.href = `/app/companies/${encodeURIComponent(company.id)}`;
            }}
          >
            <Avatar src={company.avatarUrl} name={company.name} size={24} rounded={false} />
            <span className="bounty-company-name">{company.name}</span>
          </span>
        )}
        <span className={`status-badge granular-${granular.replace("_", "-")}`}>
          ● {label}
        </span>
      </div>
      <div className="bounty-card-title">
        <span className="bounty-repo">
          {submission.prRepo}{" "}
          <span className="bounty-hash">PR #{submission.prNumber}</span>
        </span>
        {bounty?.title && <span className="bounty-issue-title">{bounty.title}</span>}
      </div>
      <div className="bounty-card-foot">
        {bounty && (
          <div className="bounty-amount">
            <span className="bounty-amount-val">
              {bounty.amountUsdc.toLocaleString()}
            </span>
            <span className="musdc-pill">SOL</span>
          </div>
        )}
        {typeof score === "number" && (
          <span className="submission-score" title="Opus evaluation score">
            {score}/10
          </span>
        )}
        {typeof rank === "number" && (
          <span className="submission-rank" title="Rank within this bounty">
            #{rank}
            {typeof total === "number" && total > 0 && (
              <span className="submission-rank-of"> of {total}</span>
            )}
          </span>
        )}
        {submission.note && (
          <span className="submission-note">“{submission.note}”</span>
        )}
      </div>
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
          <p>
            {submission.rejectReason ??
              "No reason provided."}
          </p>
        </div>
      )}
      {granular === "approved" && (
        <div className="submission-approve-feedback">
          <span className="submission-approve-feedback-label">
            ★ You won this bounty
          </span>
          <p>
            {submission.approvalFeedback
              ? submission.approvalFeedback
              : "No specific note from the company. The bounty payout has been released to your wallet."}
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
            wasn&apos;t selected this time — thanks for participating.
          </p>
        </div>
      )}
    </Link>
  );
}

function ReadRow({
  label,
  value,
  mono,
  copy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  /**
   * When set, render a small "Copy" button next to the value that writes
   * `copy` (the full untruncated string) to the clipboard. We pass the
   * full address here while `value` shows the abbreviated form, so users
   * can see "AbCd…1234" but copy the real bytes.
   */
  copy?: string;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    if (!copy) return;
    try {
      await navigator.clipboard.writeText(copy);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard API may be blocked in iframes / insecure contexts —
       * fall through silently rather than showing a confusing toast. */
    }
  };
  return (
    <div className="read-row">
      <span className="field-label">{label}</span>
      <span className={`read-value ${mono ? "mono" : ""} ${copy ? "has-copy" : ""}`}>
        <span className="read-value-text">{value}</span>
        {copy && (
          <button
            type="button"
            className="summary-copy"
            onClick={onCopy}
            aria-label={`Copy ${label.toLowerCase()}`}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </span>
    </div>
  );
}

function shortHex(w: string) {
  if (w.length < 12) return w;
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}
