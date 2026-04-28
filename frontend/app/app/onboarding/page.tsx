"use client";

/**
 * GHB-165: onboarding form for first-time Privy users.
 *
 * Lands here when a wallet has signed in via Privy but no `profiles` row
 * exists yet. The user picks a role (company / dev) and fills the minimum
 * fields the role-specific table requires. Email is optional — Privy
 * wallet-only logins don't carry one by default.
 *
 * If the user is not authenticated through Privy, we send them back to
 * `/app/auth` to start the wallet flow. If they already have a profile,
 * we send them to their dashboard.
 */

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import type { Role } from "@/lib/types";

function readRoleHint(): Role | null {
  if (typeof window === "undefined") return null;
  const r = window.localStorage.getItem("privyRole");
  if (r === "dev") return "dev";
  if (r === "company") return "company";
  return null;
}

export default function OnboardingPage() {
  const { user, ready, registerCompany, registerDev } = useAuth();
  // No default. The user must pick a role before any form is rendered.
  // The hint from PrivyLoginButton (when present) auto-selects on mount;
  // otherwise the picker is shown until the user clicks one of the cards.
  const [role, setRole] = useState<Role | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Auto-pick the role when the user came in via PrivyLoginButton (which
  // wrote the hint to localStorage). Returning sessions that hit
  // /app/onboarding via the auto-redirect have no hint and see the picker.
  useEffect(() => {
    const hinted = readRoleHint();
    if (hinted) setRole(hinted);
  }, []);

  // Returning user with a profile — bounce out.
  useEffect(() => {
    if (!ready) return;
    if (user) {
      router.replace(user.role === "company" ? "/app/company" : "/app/dev");
    }
  }, [ready, user, router]);

  function redirectAfter(r: Role) {
    router.replace(r === "company" ? "/app/company" : "/app/dev");
  }

  async function onSubmitCompany(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const f = e.currentTarget;
      const get = (n: string) =>
        (f.elements.namedItem(n) as HTMLInputElement | HTMLTextAreaElement)?.value.trim() ?? "";
      const name = get("name");
      const description = get("description");
      if (!name || !description) {
        setError("Name and description are required.");
        return;
      }
      const result = await registerCompany({
        name,
        email: get("email"),
        website: get("website") || undefined,
        industry: get("industry") || undefined,
        description,
        avatarUrl: undefined,
      });
      if (!result) {
        setError("Could not create profile. Are you signed in with Privy?");
        return;
      }
      redirectAfter("company");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Onboarding failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitDev(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const f = e.currentTarget;
      const get = (n: string) =>
        (f.elements.namedItem(n) as HTMLInputElement | HTMLTextAreaElement)?.value.trim() ?? "";
      const username = get("username");
      if (!username) {
        setError("Username is required.");
        return;
      }
      const skills = get("skills")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const result = await registerDev({
        username,
        email: get("email"),
        bio: get("bio") || undefined,
        github: get("github") || undefined,
        skills,
        avatarUrl: undefined,
      });
      if (!result) {
        setError("Could not create profile. Are you signed in with Privy?");
        return;
      }
      redirectAfter("dev");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Onboarding failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) {
    return (
      <div className="app-loading">
        <span className="loading-dot" />
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">
          {role === null ? "Choose your role" : "Complete your profile"}
        </h1>
        <p className="auth-subtitle">
          {role === null
            ? "How do you want to use Ghbounty? You can change this later."
            : "Fill in a few details — you can update them anytime."}
        </p>

        <div className="role-picker">
          <button
            type="button"
            className={`role-card ${role === "company" ? "selected" : ""}`}
            onClick={() => setRole("company")}
          >
            <div className="role-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 21V7l6-4v18M9 21h12V11l-6-4" />
                <path d="M13 11h2M13 15h2M13 19h2M5 11h2M5 15h2M5 19h2" />
              </svg>
            </div>
            <div>
              <div className="role-title">Company</div>
              <div className="role-desc">Post bounties for your team</div>
            </div>
            <span className="role-check" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`role-card ${role === "dev" ? "selected" : ""}`}
            onClick={() => setRole("dev")}
          >
            <div className="role-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </div>
            <div>
              <div className="role-title">Developer</div>
              <div className="role-desc">Solve issues, earn bounties</div>
            </div>
            <span className="role-check" aria-hidden="true" />
          </button>
        </div>

        {role === null ? null : role === "company" ? (
          <form onSubmit={onSubmitCompany} className="auth-form">
            <label className="field">
              <span className="field-label">Company name *</span>
              <input
                name="name"
                type="text"
                placeholder="Acme Labs"
                required
                disabled={submitting}
              />
            </label>
            <label className="field">
              <span className="field-label">Description *</span>
              <textarea
                name="description"
                rows={3}
                placeholder="One-paragraph pitch of what you fund and why."
                required
                disabled={submitting}
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span className="field-label">Email (optional)</span>
                <input
                  name="email"
                  type="email"
                  placeholder="team@acme.com"
                  disabled={submitting}
                />
              </label>
              <label className="field">
                <span className="field-label">Website</span>
                <input
                  name="website"
                  type="url"
                  placeholder="https://…"
                  disabled={submitting}
                />
              </label>
            </div>
            <label className="field">
              <span className="field-label">Industry</span>
              <input
                name="industry"
                type="text"
                placeholder="L1 / Infra, AI…"
                disabled={submitting}
              />
            </label>
            {error && <div className="auth-error">{error}</div>}
            <button
              type="submit"
              className="btn btn-primary auth-submit"
              disabled={submitting}
            >
              {submitting ? "Saving…" : "Create company profile"}
            </button>
          </form>
        ) : (
          <form onSubmit={onSubmitDev} className="auth-form">
            <div className="field-row">
              <label className="field">
                <span className="field-label">Username *</span>
                <input
                  name="username"
                  type="text"
                  placeholder="opus-builder"
                  required
                  pattern="^[a-z0-9][a-z0-9_-]{1,38}$"
                  disabled={submitting}
                />
              </label>
              <label className="field">
                <span className="field-label">Email (optional)</span>
                <input
                  name="email"
                  type="email"
                  placeholder="you@mail.com"
                  disabled={submitting}
                />
              </label>
            </div>
            <label className="field">
              <span className="field-label">Bio</span>
              <textarea
                name="bio"
                rows={3}
                placeholder="What do you build? What are you looking for?"
                disabled={submitting}
              />
            </label>
            <label className="field">
              <span className="field-label">GitHub handle</span>
              <input
                name="github"
                type="text"
                placeholder="opusbuilder"
                disabled={submitting}
              />
            </label>
            <label className="field">
              <span className="field-label">Skills (comma-separated)</span>
              <input
                name="skills"
                type="text"
                placeholder="rust, solana, react"
                disabled={submitting}
              />
            </label>
            {error && <div className="auth-error">{error}</div>}
            <button
              type="submit"
              className="btn btn-primary auth-submit"
              disabled={submitting}
            >
              {submitting ? "Saving…" : "Create developer profile"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
