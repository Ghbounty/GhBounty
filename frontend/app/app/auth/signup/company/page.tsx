"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth, usePrivyBackend } from "@/lib/auth-context";
import { AvatarUploader } from "@/components/AvatarUploader";

/**
 * Company signup form. In Privy mode the submit stashes the form data in
 * a ref inside auth-privy and triggers the Privy modal; the post-auth
 * hydration effect persists the rows once Privy returns. In legacy mode,
 * we go straight through Supabase Auth (email + password).
 */
export default function SignupCompanyPage() {
  const { user, ready, registerCompany, pendingError, clearPendingError } = useAuth();
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

  // Once Privy auth + persist completes, the user object hydrates and we
  // bounce out to the dashboard. The form is hidden by the redirect.
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
    const name = get("name");
    const email = get("email");
    const password = get("password");
    const description = get("description");

    if (!name || !description) {
      setError("Name and description are required.");
      return;
    }
    if (!privyMode && (!email || !password)) {
      setError("Email and password are required.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await registerCompany(
        {
          name,
          email,
          website: get("website") || undefined,
          industry: get("industry") || undefined,
          description,
          avatarUrl: avatar,
        },
        password,
      );
      if (privyMode) {
        // Privy modal is open; the user effect above redirects when the
        // post-auth persist + hydrate finishes. Keep the button disabled
        // so they don't double-submit while the modal is up.
        return;
      }
      if (!result) {
        setError("Account created — check your email to confirm before signing in.");
        return;
      }
      router.replace("/app/company");
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
          <div className="eyebrow">Sign up — Enterprise</div>
          <h1 className="auth-title">
            Set up your <span className="accent">company</span>
          </h1>
          <p className="auth-subtitle">
            We&apos;ll save this and{" "}
            {privyMode ? "open Privy to connect your treasury wallet." : "log you in."}
          </p>
        </div>

        {(error || pendingError) && (
          <div className="form-error">{error ?? pendingError}</div>
        )}

        <form onSubmit={onSubmit} className="auth-form">
          <AvatarUploader
            value={avatar}
            onChange={setAvatar}
            label="Company logo"
            hint="PNG, JPG or SVG · up to 2MB"
          />
          <div className="field-row">
            <label className="field">
              <span className="field-label">Company name *</span>
              <input
                name="name"
                placeholder="Your company name"
                required
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
                placeholder="builders@company.com"
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
              <span className="field-label">Website</span>
              <input
                name="website"
                type="url"
                placeholder="https://…"
                disabled={submitting}
              />
            </label>
            <label className="field">
              <span className="field-label">Industry</span>
              <input
                name="industry"
                placeholder="L1 / Infra, AI…"
                disabled={submitting}
              />
            </label>
          </div>
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
                ? "Connect wallet & create company"
                : "Create company account"}
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
