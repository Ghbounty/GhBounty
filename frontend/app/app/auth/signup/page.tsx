"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

/**
 * Signup picker. Two stacked CTAs — Enterprise / Developer — each leading
 * to its own dedicated form route. We avoid the side-by-side role cards on
 * purpose: Tom flagged that as confusing UX, and the two flows have
 * meaningfully different copy and field sets.
 */
export default function SignupPickerPage() {
  const { user, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    if (user) {
      router.replace(user.role === "company" ? "/app/company" : "/app/dev");
    }
  }, [ready, user, router]);

  return (
    <div className="auth-page">
      <Link href="/app/auth" className="auth-home">
        ← Back
      </Link>

      <div className="auth-card">
        <div className="auth-head">
          <div className="eyebrow">Create your account</div>
          <h1 className="auth-title">
            Sign up for <span className="accent">GH Bounty</span>
          </h1>
          <p className="auth-subtitle">
            Pick the flow that fits — you can&apos;t change roles later.
          </p>
        </div>

        <div className="auth-stack">
          <Link href="/app/auth/signup/company" className="auth-stack-item">
            <div className="auth-stack-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 21V7l6-4v18M9 21h12V11l-6-4" />
                <path d="M13 11h2M13 15h2M13 19h2M5 11h2M5 15h2M5 19h2" />
              </svg>
            </div>
            <div className="auth-stack-body">
              <div className="auth-stack-title">Sign up as Enterprise</div>
              <div className="auth-stack-desc">
                Post bounties, fund work, and let AI rank submissions.
              </div>
            </div>
            <span className="auth-stack-chevron" aria-hidden="true">→</span>
          </Link>

          <Link href="/app/auth/signup/dev" className="auth-stack-item">
            <div className="auth-stack-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            </div>
            <div className="auth-stack-body">
              <div className="auth-stack-title">Sign up as Developer</div>
              <div className="auth-stack-desc">
                Solve open bounties and get paid onchain when you ship.
              </div>
            </div>
            <span className="auth-stack-chevron" aria-hidden="true">→</span>
          </Link>
        </div>

        <p className="auth-hint" style={{ textAlign: "center", marginTop: 12 }}>
          Already have an account?{" "}
          <Link href="/app/auth/login" className="accent-link">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
