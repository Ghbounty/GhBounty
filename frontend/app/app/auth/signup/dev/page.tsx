"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth, usePrivyBackend } from "@/lib/auth-context";
import { AvatarUploader } from "@/components/AvatarUploader";

// Mirror of the DB CHECK constraint `developers_username_format`.
// Kept as a plain string instead of an HTML5 `pattern` attribute because
// some browsers parse `pattern` with the unicodeSets (`/v`) flag, which
// rejects `[a-z0-9_-]` for the way the dash sits between two ranges.
// Validating in JS sidesteps the parser quirk and keeps DB + UI in sync.
const USERNAME_REGEX = /^[a-z0-9][a-z0-9_-]{1,38}$/;

/**
 * Developer signup form. Same pattern as the company form: stash + open
 * Privy in Privy mode, or full Supabase-Auth path in legacy mode.
 */
export default function SignupDevPage() {
  const { user, ready, registerDev, pendingError, clearPendingError } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | undefined>(undefined);
  const privyMode = usePrivyBackend;

  // If the post-auth persist failed (constraint, RLS, etc.) we'd otherwise
  // be stuck on "Waiting for wallet…". Drop the submitting state so the
  // user can fix the input and retry.
  useEffect(() => {
    if (pendingError) setSubmitting(false);
  }, [pendingError]);

  useEffect(() => {
    if (!ready) return;
    if (user) {
      router.replace(user.role === "company" ? "/app/company" : "/app/dev");
    }
  }, [ready, user, router]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    clearPendingError?.();
    const f = e.currentTarget;
    const get = (n: string) =>
      (f.elements.namedItem(n) as HTMLInputElement | HTMLTextAreaElement)?.value.trim() ?? "";
    // Username must be lowercase to satisfy the DB check; the input also
    // forces lowercase via `style.textTransform`, but a paste can sneak
    // mixed case in — normalize before we validate.
    const username = get("username").toLowerCase();
    const email = get("email");
    const password = get("password");

    if (!username) {
      setError("Username is required.");
      return;
    }
    if (!USERNAME_REGEX.test(username)) {
      setError(
        "Username must be 2–39 characters, lowercase letters/digits, with optional - or _.",
      );
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

        {(error || pendingError) && (
          <div className="form-error">{error ?? pendingError}</div>
        )}

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
                minLength={2}
                maxLength={39}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                style={{ textTransform: "lowercase" }}
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
