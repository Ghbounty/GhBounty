"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth, usePrivyBackend } from "@/lib/auth-context";
import { AvatarUploader } from "@/components/AvatarUploader";

/**
 * Developer signup form. Same pattern as the company form: stash + open
 * Privy in Privy mode, or full Supabase-Auth path in legacy mode.
 */
export default function SignupDevPage() {
  const { user, ready, registerDev } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | undefined>(undefined);
  const privyMode = usePrivyBackend;

  useEffect(() => {
    if (!ready) return;
    if (user) {
      router.replace(user.role === "company" ? "/app/company" : "/app/dev");
    }
  }, [ready, user, router]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = e.currentTarget;
    const get = (n: string) =>
      (f.elements.namedItem(n) as HTMLInputElement | HTMLTextAreaElement)?.value.trim() ?? "";
    const username = get("username");
    const email = get("email");
    const password = get("password");

    if (!username) {
      setError("Username is required.");
      return;
    }
    if (!privyMode && (!email || !password)) {
      setError("Email and password are required.");
      return;
    }

    const skills = get("skills")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    setSubmitting(true);
    try {
      const result = await registerDev(
        {
          username,
          email,
          bio: get("bio") || undefined,
          github: get("github") || undefined,
          skills,
          avatarUrl: avatar,
        },
        password,
      );
      if (privyMode) return;
      if (!result) {
        setError("Account created — check your email to confirm before signing in.");
        return;
      }
      router.replace("/app/dev");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed.");
    } finally {
      if (!privyMode) setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <Link href="/app/auth/signup" className="auth-home">
        ← Back
      </Link>

      <div className="auth-card">
        <div className="auth-head">
          <div className="eyebrow">Sign up — Developer</div>
          <h1 className="auth-title">
            Set up your <span className="accent">dev profile</span>
          </h1>
          <p className="auth-subtitle">
            We&apos;ll save this and{" "}
            {privyMode ? "open Privy to connect your payout wallet." : "log you in."}
          </p>
        </div>

        {error && <div className="form-error">{error}</div>}

        <form onSubmit={onSubmit} className="auth-form">
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
              <input
                name="username"
                placeholder="opus-builder"
                required
                pattern="^[a-z0-9][a-z0-9_-]{1,38}$"
                disabled={submitting}
              />
            </label>
            <label className="field">
              <span className="field-label">
                Email {privyMode ? "(optional)" : "*"}
              </span>
              <input
                name="email"
                type="email"
                placeholder="you@mail.com"
                required={!privyMode}
                disabled={submitting}
              />
            </label>
          </div>
          {!privyMode && (
            <label className="field">
              <span className="field-label">Password *</span>
              <input
                name="password"
                type="password"
                placeholder="At least 6 characters"
                autoComplete="new-password"
                minLength={6}
                required
                disabled={submitting}
              />
            </label>
          )}
          <div className="field-row">
            <label className="field">
              <span className="field-label">GitHub handle</span>
              <input
                name="github"
                placeholder="opus-builder"
                disabled={submitting}
              />
            </label>
            <label className="field">
              <span className="field-label">Skills (comma-separated)</span>
              <input
                name="skills"
                placeholder="rust, typescript, solana"
                disabled={submitting}
              />
            </label>
          </div>
          <label className="field">
            <span className="field-label">Bio</span>
            <textarea
              name="bio"
              rows={3}
              placeholder="What you build."
              disabled={submitting}
            />
          </label>

          <button
            type="submit"
            className="btn btn-primary auth-submit"
            disabled={submitting}
          >
            {submitting
              ? privyMode
                ? "Waiting for wallet…"
                : "Creating…"
              : privyMode
                ? "Connect wallet & create developer"
                : "Create developer account"}
          </button>

          <p className="auth-hint" style={{ textAlign: "center" }}>
            Already have an account?{" "}
            <Link href="/app/auth/login" className="accent-link">
              Log in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
