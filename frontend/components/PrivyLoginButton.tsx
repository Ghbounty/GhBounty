"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { usePrivyBackend } from "@/lib/auth-context";

/**
 * "Connect Wallet" button shown on /app/auth when NEXT_PUBLIC_USE_PRIVY=1.
 *
 * Stores the role hint in localStorage so the Privy auth provider knows
 * whether to render a Company or Dev shape after the wallet signs the
 * SIWS message.
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
      router.replace(role === "company" ? "/app/company" : "/app/dev");
    }
  }, [ready, authenticated, role, router]);

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
