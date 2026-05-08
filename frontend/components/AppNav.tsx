/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
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

  // Two header dropdowns: wallet (address/balance/Deposit/Withdraw) and
  // account (Profile/Log out). Both mirror the click-outside + Escape
  // pattern from BountyEditMenu so the affordance is consistent.
  const [walletOpen, setWalletOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const walletWrapRef = useRef<HTMLDivElement | null>(null);
  const accountWrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!walletOpen && !accountOpen) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (walletOpen && !walletWrapRef.current?.contains(target)) {
        setWalletOpen(false);
      }
      if (accountOpen && !accountWrapRef.current?.contains(target)) {
        setAccountOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setWalletOpen(false);
        setAccountOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [walletOpen, accountOpen]);

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
            <div className="menu-wrap" ref={walletWrapRef}>
              <button
                type="button"
                className="wallet-btn connected"
                aria-haspopup="menu"
                aria-expanded={walletOpen}
                onClick={() => setWalletOpen((o) => !o)}
              >
                <span className="wallet-btn-dot" />
                <code>{shortWallet(walletAddress)}</code>
                {balanceSol !== null && (
                  <span className="wallet-btn-balance">
                    {balanceSol.toFixed(3)} SOL
                  </span>
                )}
                <svg
                  className="wallet-btn-chevron"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {walletOpen && (
                <div className="menu-dropdown wallet-menu" role="menu">
                  <div className="wallet-menu-info">
                    <div className="wallet-menu-row">
                      <code className="wallet-menu-address" title={walletAddress}>
                        {shortWallet(walletAddress)}
                      </code>
                      <button
                        type="button"
                        className="wallet-menu-copy"
                        onClick={handleCopy}
                        title="Copy full address"
                      >
                        {copied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <div className="wallet-menu-row">
                      <span className="wallet-menu-label">Balance</span>
                      <span className="wallet-menu-balance">
                        {balanceSol !== null
                          ? `${balanceSol.toFixed(3)} SOL`
                          : "—"}
                      </span>
                    </div>
                  </div>
                  <div className="menu-sep" />
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      setWalletOpen(false);
                      setDepositOpen(true);
                    }}
                    disabled={!privyMode}
                    title="Receive SOL into your Privy wallet"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <polyline points="19 12 12 19 5 12" />
                    </svg>
                    Deposit
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      setWalletOpen(false);
                      setWithdrawOpen(true);
                    }}
                    disabled={!canWithdraw}
                    title="Send SOL from your Privy wallet to an external address"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="19" x2="12" y2="5" />
                      <polyline points="5 12 12 5 19 12" />
                    </svg>
                    Withdraw
                  </button>
                </div>
              )}
            </div>
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
          <div className="menu-wrap appnav-user-wrap" ref={accountWrapRef}>
            <button
              type="button"
              className={`appnav-user ${accountOpen || pathname === "/app/profile" ? "active" : ""}`}
              aria-label="Account menu"
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((o) => !o)}
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
              <svg
                className="appnav-user-chevron"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {accountOpen && (
              <div className="menu-dropdown" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    setAccountOpen(false);
                    router.push("/app/profile");
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  Profile
                </button>
                <div className="menu-sep" />
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item danger"
                  onClick={async () => {
                    setAccountOpen(false);
                    await logout();
                    router.push("/app/auth");
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Log out
                </button>
              </div>
            )}
          </div>
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
