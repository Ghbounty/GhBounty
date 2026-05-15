"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth, usePrivyBackend } from "@/lib/auth-context";

/**
 * Login flow. Privy mode: one Connect button — Privy modal handles wallet
 * + email itself. The bridge mints the JWT, the index page detects the
 * existing profile's role and redirects to /app/company or /app/dev. We
 * never ask the user for their role here.
 *
 * Legacy mode (NEXT_PUBLIC_USE_PRIVY=0): old email + password form.
 */
export default function LoginPage() {
  const { user, ready, pendingOnboarding, loginByEmail } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const privyMode = usePrivyBackend;

  useEffect(() => {
    if (!ready) return;
    // Privy authed but no Supabase profile row yet — first-time login via
    // the wallet button on this page. Without this branch the button
    // sticks on "Connecting…" forever because the user state never
    // populates (loadUser returns null with no profile). Mirrors the
    // `/app/page.tsx` route guard. Route to the role-picker signup so
    // they land on the right dedicated form (dev or company).
    if (pendingOnboarding) {
      router.replace("/app/auth/signup");
      return;
    }
    if (user) {
      router.replace(user.role === "company" ? "/app/company" : "/app/dev");
    }
  }, [ready, user, pendingOnboarding, router]);

  function onPrivyLogin() {
    setSubmitting(true);
    // In Privy mode, loginByEmail with empty args triggers privy.login().
    // The user-redirect effect above takes over once authenticated.
    void loginByEmail("", "");
  }

  async function onLegacyLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = e.currentTarget;
    const email = (f.elements.namedItem("email") as HTMLInputElement).value.trim();
    const password = (f.elements.namedItem("password") as HTMLInputElement)?.value ?? "";
    if (!email) {
      setError("Enter your email.");
      return;
    }
    setSubmitting(true);
    try {
      const u = await loginByEmail(email, password);
      if (!u) {
        setError("Invalid credentials. Try signing up.");
        return;
      }
      router.replace(u.role === "company" ? "/app/company" : "/app/dev");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <Link href="/app/auth" className="auth-home">
        ← Back
      </Link>

      <div className="auth-card">
        <div className="auth-head">
          <div className="eyebrow">Welcome back</div>
          <h1 className="auth-title">
            Log in to <span className="accent">GH Bounty</span>
          </h1>
          <p className="auth-subtitle">
            {privyMode
              ? "Use the wallet or email you signed up with."
              : "Use your email and password."}
          </p>
        </div>

        {error && <div className="form-error">{error}</div>}

        {privyMode ? (
          <div className="auth-form">
            <button
              type="button"
              className="btn btn-primary auth-submit"
              onClick={onPrivyLogin}
              disabled={submitting || !ready}
            >
              {submitting ? "Connecting…" : "Connect with Privy"}
            </button>
            <p className="auth-hint" style={{ textAlign: "center" }}>
              Don&apos;t have an account?{" "}
              <Link href="/app/auth/signup" className="accent-link">
                Sign up
              </Link>
            </p>
          </div>
        ) : (
          <form onSubmit={onLegacyLogin} className="auth-form">
            <label className="field">
              <span className="field-label">Email</span>
              <input
                name="email"
                type="email"
                placeholder="you@company.com"
                autoComplete="email"
                required
                disabled={submitting}
              />
            </label>
            <label className="field">
              <span className="field-label">Password</span>
              <input
                name="password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                minLength={6}
                disabled={submitting}
              />
            </label>
            <button className="btn btn-primary auth-submit" type="submit" disabled={submitting}>
              {submitting ? "Logging in…" : "Log in"}
            </button>
            <p className="auth-hint" style={{ textAlign: "center" }}>
              Don&apos;t have an account?{" "}
              <Link href="/app/auth/signup" className="accent-link">
                Sign up
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
