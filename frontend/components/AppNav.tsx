/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { useAuth, usePrivyBackend } from "@/lib/auth-context";
import { useWallets } from "@privy-io/react-auth/solana";
import { mockWallet, setWallet } from "@/lib/store";
import { getConnection } from "@/lib/solana";
import { Avatar } from "./Avatar";
import { DepositModal } from "./DepositModal";
import { WithdrawModal } from "./WithdrawModal";
import { NotificationsBell } from "./NotificationsBell";
import { useSupabaseBackend } from "@/lib/auth-context";

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

  // Copying the address from the header — used to be a disconnect button
  // (`handleDisconnect`) which conflicted with the dedicated "Log out"
  // button on the right. Now the pill is a clipboard chip: clicking it
  // copies the full address. Logging out goes through the Log out button.
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    if (!walletAddress) return;
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked in iframes / insecure contexts — silent
       * fail is fine here, the address is also visible on /app/profile. */
    }
  }

  // Live balance + Deposit/Withdraw chips. The header is the single
  // global home for wallet actions: every screen shows the same chip
  // row, so devs and companies use the same affordances regardless of
  // which dashboard they're on. Re-fetch on `tick` so a deposit/withdraw
  // result reflects without a full page refresh.
  const [balanceSol, setBalanceSol] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  useEffect(() => {
    if (!walletAddress) {
      setBalanceSol(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const conn = getConnection();
        const lamports = await conn.getBalance(new PublicKey(walletAddress));
        if (!cancelled) setBalanceSol(lamports / LAMPORTS_PER_SOL);
      } catch (err) {
        console.warn("[AppNav] balance fetch failed:", err);
        if (!cancelled) setBalanceSol(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, tick]);

  const refreshBalance = useCallback(() => setTick((t) => t + 1), []);
  const canWithdraw =
    privyMode &&
    !!wallets[0] &&
    balanceSol !== null &&
    balanceSol > 0;

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
            <>
              <button
                type="button"
                className="wallet-btn connected"
                onClick={handleCopy}
                title="Click to copy address"
              >
                <span className="wallet-btn-dot" />
                <code>{copied ? "Copied!" : shortWallet(walletAddress)}</code>
                {balanceSol !== null && (
                  <span className="wallet-btn-balance">
                    {balanceSol.toFixed(3)} SOL
                  </span>
                )}
              </button>
              <button
                type="button"
                className="wallet-chip wallet-chip-deposit"
                onClick={() => setDepositOpen(true)}
                disabled={!privyMode}
                title="Receive SOL into your Privy wallet"
              >
                Deposit
              </button>
              <button
                type="button"
                className="wallet-chip wallet-chip-withdraw"
                onClick={() => setWithdrawOpen(true)}
                disabled={!canWithdraw}
                title="Send SOL from your Privy wallet to an external address"
              >
                Withdraw
              </button>
            </>
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
          {/* GHB-92: bell only renders on real backends (Privy/Supabase).
              The localStorage mock has no `notifications` table so we'd
              just be making 404'ing fetches. */}
          {(privyMode || useSupabaseBackend) && (
            <NotificationsBell userId={user.id} />
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

      {withdrawOpen && wallets[0] && (
        <WithdrawModal
          wallet={wallets[0]}
          balanceSol={balanceSol}
          onClose={() => setWithdrawOpen(false)}
          onWithdrawn={refreshBalance}
        />
      )}

      {depositOpen && walletAddress && (
        <DepositModal
          walletAddress={walletAddress}
          network="Solana Devnet"
          onClose={() => setDepositOpen(false)}
          onRefresh={() => {
            setDepositOpen(false);
            refreshBalance();
          }}
        />
      )}
    </header>
  );
}
