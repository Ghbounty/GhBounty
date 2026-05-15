"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { usePrivyBackend } from "@/lib/auth-context";

/**
 * "Connect Wallet" button shown on /app/auth when NEXT_PUBLIC_USE_PRIVY=1.
 *
 * GHB-165: stores the role hint in localStorage as a UX nudge for the
 * signup form, then redirects to `/app` after Privy authenticates.
 * The index page reads `pendingOnboarding` from the auth context and
 * sends the user to /app/auth/signup (no profile yet) or to their dashboard
 * (returning user with profile already in Supabase).
 */
export function PrivyLoginButton({
  role,
  label,
}: {
  role: "company" | "dev";
  label?: string;
}) {
  const router = useRouter();
  const { login, ready, authenticated } = usePrivy();

  useEffect(() => {
    if (ready && authenticated) {
      router.replace("/app");
    }
  }, [ready, authenticated, router]);

  function onClick() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("privyRole", role);
    }
    login();
  }

  return (
    <button
      type="button"
      className="btn btn-primary auth-submit"
      onClick={onClick}
      disabled={!ready}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7h18v13H3z" />
        <path d="M3 7l2-3h14l2 3" />
        <circle cx="17" cy="13.5" r="1.5" />
      </svg>
      {label ?? "Connect wallet"}
    </button>
  );
}

export function PrivyAvailable({ children }: { children: React.ReactNode }) {
  if (!usePrivyBackend) return null;
  return <>{children}</>;
}
