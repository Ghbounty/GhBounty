"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { AvatarUploader } from "@/components/AvatarUploader";
import type { Role } from "@/lib/types";

type Mode = "login" | "register";

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>("register");
  const [role, setRole] = useState<Role>("company");
  const [error, setError] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | undefined>(undefined);
  const { loginByEmail, registerCompany, registerDev } = useAuth();
  const router = useRouter();

  function redirectAfter(role: Role) {
    router.replace(role === "company" ? "/app/company" : "/app/dev");
  }

  function onLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const email = (e.currentTarget.elements.namedItem("email") as HTMLInputElement)
      .value.trim();
    if (!email) {
      setError("Enter your email.");
      return;
    }
    const u = loginByEmail(email);
    if (!u) {
      setError("No account for that email. Try registering.");
      return;
    }
    redirectAfter(u.role);
  }

  function onRegisterCompany(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = e.currentTarget;
    const get = (n: string) =>
      (f.elements.namedItem(n) as HTMLInputElement | HTMLTextAreaElement).value.trim();
    const name = get("name");
    const email = get("email");
    const description = get("description");
    if (!name || !email || !description) {
      setError("Name, email and description are required.");
      return;
    }
    registerCompany({
      name,
      email,
      website: get("website") || undefined,
      industry: get("industry") || undefined,
      description,
      avatarUrl: avatar,
    });
    redirectAfter("company");
  }

  function onRegisterDev(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = e.currentTarget;
    const get = (n: string) =>
      (f.elements.namedItem(n) as HTMLInputElement | HTMLTextAreaElement).value.trim();
    const username = get("username");
    const email = get("email");
    if (!username || !email) {
      setError("Username and email are required.");
      return;
    }
    const skills = get("skills")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    registerDev({
      username,
      email,
      bio: get("bio") || undefined,
      github: get("github") || undefined,
      skills,
      avatarUrl: avatar,
    });
    redirectAfter("dev");
  }

  return (
    <div className="auth-page">
      <Link href="/" className="auth-home">
        ← Back home
      </Link>

      <div className="auth-card">
        <div className="auth-head">
          <div className="eyebrow">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </div>
          <h1 className="auth-title">
            {mode === "login" ? (
              <>
                Log in to <span className="accent">GH Bounty</span>
              </>
            ) : (
              <>
                Join <span className="accent">GH Bounty</span>
              </>
            )}
          </h1>
        </div>

        <div className="auth-toggle">
          <button
            className={`auth-toggle-btn ${mode === "register" ? "active" : ""}`}
            onClick={() => {
              setMode("register");
              setError(null);
            }}
            type="button"
          >
            Register
          </button>
          <button
            className={`auth-toggle-btn ${mode === "login" ? "active" : ""}`}
            onClick={() => {
              setMode("login");
              setError(null);
            }}
            type="button"
          >
            Log in
          </button>
        </div>

        {mode === "register" && (
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
              <div className="role-body">
                <div className="role-title">Company</div>
                <div className="role-desc">Post bounties and fund work.</div>
              </div>
              <span className="role-check" />
            </button>
            <button
              type="button"
              className={`role-card ${role === "dev" ? "selected" : ""}`}
              onClick={() => setRole("dev")}
            >
              <div className="role-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 18l6-6-6-6 M8 6l-6 6 6 6" />
                </svg>
              </div>
              <div className="role-body">
                <div className="role-title">Developer</div>
                <div className="role-desc">Solve bounties, get paid onchain.</div>
              </div>
              <span className="role-check" />
            </button>
          </div>
        )}

        {error && <div className="form-error">{error}</div>}

        {mode === "login" ? (
          <form onSubmit={onLogin} className="auth-form">
            <label className="field">
              <span className="field-label">Email</span>
              <input
                name="email"
                type="email"
                placeholder="you@company.com"
                autoComplete="email"
                required
              />
            </label>
            <p className="auth-hint">
              Demo: try <code>dev@ghbounty.xyz</code> or{" "}
              <code>builders@avalabs.org</code>.
            </p>
            <button className="btn btn-primary auth-submit" type="submit">
              Log in
            </button>
          </form>
        ) : role === "company" ? (
          <form onSubmit={onRegisterCompany} className="auth-form">
            <AvatarUploader
              value={avatar}
              onChange={setAvatar}
              label="Company logo"
              hint="PNG, JPG or SVG · up to 2MB"
            />
            <div className="field-row">
              <label className="field">
                <span className="field-label">Company name *</span>
                <input name="name" placeholder="Ava Labs" required />
              </label>
              <label className="field">
                <span className="field-label">Email *</span>
                <input
                  name="email"
                  type="email"
                  placeholder="builders@company.com"
                  required
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span className="field-label">Website</span>
                <input name="website" type="url" placeholder="https://…" />
              </label>
              <label className="field">
                <span className="field-label">Industry</span>
                <input name="industry" placeholder="L1 / Infra, AI…" />
              </label>
            </div>
            <label className="field">
              <span className="field-label">Description *</span>
              <textarea
                name="description"
                rows={3}
                placeholder="One-paragraph pitch of what you fund and why."
                required
              />
            </label>
            <p className="auth-hint">
              You&apos;ll connect your treasury wallet right after signup.
            </p>
            <button className="btn btn-primary auth-submit" type="submit">
              Create company account
            </button>
          </form>
        ) : (
          <form onSubmit={onRegisterDev} className="auth-form">
            <AvatarUploader
              value={avatar}
              onChange={setAvatar}
              label="Profile picture"
              hint="PNG or JPG · up to 2MB"
              rounded
            />
            <div className="field-row">
              <label className="field">
                <span className="field-label">Username *</span>
                <input name="username" placeholder="opus-builder" required />
              </label>
              <label className="field">
                <span className="field-label">Email *</span>
                <input
                  name="email"
                  type="email"
                  placeholder="you@mail.com"
                  required
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span className="field-label">GitHub handle</span>
                <input name="github" placeholder="opus-builder" />
              </label>
              <label className="field">
                <span className="field-label">Skills (comma-separated)</span>
                <input name="skills" placeholder="rust, typescript, solana" />
              </label>
            </div>
            <label className="field">
              <span className="field-label">Bio</span>
              <textarea name="bio" rows={3} placeholder="What you build." />
            </label>
            <p className="auth-hint">
              You&apos;ll connect your payout wallet right after signup.
            </p>
            <button className="btn btn-primary auth-submit" type="submit">
              Create developer account
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
