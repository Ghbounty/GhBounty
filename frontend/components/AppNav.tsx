/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth, usePrivyBackend } from "@/lib/auth-context";
import { useWallets } from "@privy-io/react-auth/solana";
import { mockWallet, setWallet } from "@/lib/store";
import { Avatar } from "./Avatar";

function shortWallet(w: string) {
  if (w.length < 12) return w;
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

export function AppNav() {
  const { user, logout, refresh } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  // In Privy mode the wallet lives on the Solana wallet hook, not on the
  // mock `user.wallet` field (which is localStorage from the old store).
  // We surface whichever is real so the header always reflects what
  // CreateBountyFlow will actually sign with.
  const privyMode = usePrivyBackend;
  const { wallets } = useWallets();
  const privyWallet = wallets[0]?.address ?? null;

  if (!user) return null;

  const isCompany = user.role === "company";
  const displayName = isCompany ? user.name : user.username;
  const walletAddress = privyMode ? privyWallet : user.wallet ?? null;

  const tabs = isCompany
    ? [{ href: "/app/company", label: "Bounties" }]
    : [
        { href: "/app/dev", label: "Bounties" },
        { href: "/app/companies", label: "Companies" },
      ];

  function handleConnect() {
    // Legacy-only: the mock store fakes a wallet for the localStorage flow.
    // In Privy mode wallets are minted by `embeddedWallets.solana.createOnLogin`,
    // so this button is hidden via `walletAddress` being non-null.
    const addr = mockWallet();
    setWallet(user!.id, addr);
    refresh();
  }

  function handleDisconnect() {
    if (privyMode) {
      // Disconnecting in Privy mode means logging out — the embedded wallet
      // is tied to the session.
      void logout();
      router.replace("/app/auth");
      return;
    }
    setWallet(user!.id, undefined);
    refresh();
  }

  return (
    <header className="appnav">
      <div className="appnav-inner">
        <Link href="/app" className="appnav-logo" aria-label="GH Bounty">
          <img src="/assets/ghbounty-logo.svg" alt="GH Bounty" />
        </Link>
        <nav className="appnav-tabs">
          {tabs.map((t) => {
            const active =
              pathname === t.href || pathname.startsWith(t.href + "/");
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`appnav-tab ${active ? "active" : ""}`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
        <div className="appnav-right">
          {walletAddress ? (
            <button
              className="wallet-btn connected"
              onClick={handleDisconnect}
              title={privyMode ? "Click to log out" : "Click to disconnect"}
            >
              <span className="wallet-btn-dot" />
              <code>{shortWallet(walletAddress)}</code>
            </button>
          ) : (
            <button className="wallet-btn" onClick={handleConnect}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7h18v13H3z" />
                <path d="M3 7l2-3h14l2 3" />
                <circle cx="17" cy="13.5" r="1.5" />
              </svg>
              Connect wallet
            </button>
          )}
          <Link
            href="/app/profile"
            className={`appnav-user ${pathname === "/app/profile" ? "active" : ""}`}
            aria-label="Open profile"
          >
            <Avatar
              src={user.avatarUrl}
              name={displayName}
              size={32}
              rounded={!isCompany}
            />
            <div className="appnav-user-meta">
              <span className="appnav-user-name">{displayName}</span>
              <span className="appnav-user-role">
                {isCompany ? "Company" : "Developer"}
              </span>
            </div>
          </Link>
          <button
            className="appnav-logout"
            onClick={async () => {
              await logout();
              router.push("/app/auth");
            }}
          >
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}
