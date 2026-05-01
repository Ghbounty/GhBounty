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
import type { Bounty, Company, Dev, Submission, SubmissionStatus } from "@/lib/types";

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

  const totalEarned = submissions
    .filter((s) => s.status === "accepted")
    .reduce((sum, s) => {
      const b = bountiesById.get(s.bountyId);
      return b ? sum + b.amountUsdc : sum;
    }, 0);

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
          <span className="stat-val">
            {submissions.filter((s) => s.status === "accepted").length}
          </span>
          <span className="stat-lbl">Accepted</span>
        </div>
        <div className="stat-pill">
          <span className="stat-val">{totalEarned.toLocaleString()}</span>
          <span className="stat-lbl">Earned SOL</span>
        </div>
      </div>

      <section className="profile-submissions">
        <h2 className="section-label">My submissions</h2>
        {submissions.length === 0 ? (
          <div className="empty">
            <p>You haven&apos;t submitted any PRs yet.</p>
            <Link href="/app/dev" className="btn btn-ghost btn-sm">
              Browse bounties →
            </Link>
          </div>
        ) : (
          <div className="bounty-stack">
            {submissions.map((s) => (
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
    </div>
  );
}

function SubmissionRow({
  submission,
  bounty,
  company,
}: {
  submission: Submission;
  bounty?: Bounty;
  company?: Company;
}) {
  const statusLabels: Record<SubmissionStatus, string> = {
    pending: "Pending",
    accepted: "Accepted",
    rejected: "Rejected",
  };
  return (
    <div className="bounty-card">
      <div className="bounty-card-head">
        {company && (
          <Link
            href={`/app/companies/${encodeURIComponent(company.id)}`}
            className="bounty-company"
          >
            <Avatar src={company.avatarUrl} name={company.name} size={24} rounded={false} />
            <span className="bounty-company-name">{company.name}</span>
          </Link>
        )}
        <span className={`status-badge submission-${submission.status}`}>
          ● {statusLabels[submission.status]}
        </span>
      </div>
      <a
        href={submission.prUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="bounty-card-title"
      >
        <span className="bounty-repo">
          {submission.prRepo}{" "}
          <span className="bounty-hash">PR #{submission.prNumber}</span>
        </span>
        {bounty?.title && <span className="bounty-issue-title">{bounty.title}</span>}
      </a>
      <div className="bounty-card-foot">
        {bounty && (
          <div className="bounty-amount">
            <span className="bounty-amount-val">
              {bounty.amountUsdc.toLocaleString()}
            </span>
            <span className="musdc-pill">
              SOL
            </span>
          </div>
        )}
        {submission.note && (
          <span className="submission-note">“{submission.note}”</span>
        )}
      </div>
      {submission.status === "rejected" && (
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
      {submission.status === "accepted" && (
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
    </div>
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
