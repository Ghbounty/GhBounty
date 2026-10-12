"use client";

/**
 * GHB-187 — Agent wallet delegation consent UI.
 *
 * Shows the current delegation state (active / not authorized) and lets the
 * user authorize or revoke server-side Solana signing via Privy's headless
 * delegation API.
 *
 * Hook notes (v3.22.x):
 *   - `useSigners().addSigners(...)` — the TEE-compatible API. Both
 *     `useDelegatedActions` and `useHeadlessDelegatedActions` are
 *     on-device-only and throw / hang on TEE apps. `addSigners` attaches
 *     a server-side key quorum (registered in the Privy dashboard) so the
 *     backend can sign with the user's wallet without further prompts.
 *   - We get the Solana wallet from `useWallets()` in
 *     `@privy-io/react-auth/solana`, NOT from `user.linkedAccounts`. The
 *     latter has the address but no initialized wallet proxy, so passing
 *     that address to `addSigners` throws "Wallet proxy not initialized".
 */

import { useCallback, useEffect, useState } from "react";
import { usePrivy, useSigners } from "@privy-io/react-auth";
import { useWallets as useSolanaWallets } from "@privy-io/react-auth/solana";

const SIGNER_ID = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID;

import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DelegationRecord {
  wallet_pubkey: string;
  chain_type: string;
  delegated_at: string;
  revoked_at: string | null;
}

interface GetDelegationResponse {
  delegation: DelegationRecord | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** "May 17, 2026, 14:32" — locale-aware, no external library. */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Truncate a pubkey to `AAAA…ZZZZ` for compact display. */
function shortPubkey(pubkey: string): string {
  if (pubkey.length <= 12) return pubkey;
  return `${pubkey.slice(0, 6)}…${pubkey.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgentDelegationCard() {
  const { user, getAccessToken } = usePrivy();
  const { addSigners, removeSigners } = useSigners();
  const { wallets: solanaWallets, ready: walletsReady } = useSolanaWallets();

  const [delegation, setDelegation] = useState<DelegationRecord | null>(null);
  const [loadingState, setLoadingState] = useState<"idle" | "fetching" | "mutating">("fetching");
  const [error, setError] = useState<string | null>(null);

  const solanaWallet = walletsReady && solanaWallets.length > 0 ? solanaWallets[0] : null;

  // ---------------------------------------------------------------------------
  // Fetch current delegation from DB
  // ---------------------------------------------------------------------------

  const load = useCallback(async () => {
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) return;
      const r = await fetch("/api/agent-delegation", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const j = (await r.json()) as GetDelegationResponse;
        setDelegation(j.delegation);
      } else {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${r.status}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "network_error");
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (!user) return;
    setLoadingState("fetching");
    void load().finally(() => setLoadingState("idle"));
  }, [user, load]);

  // ---------------------------------------------------------------------------
  // Authorize
  // ---------------------------------------------------------------------------

  async function onAuthorize() {
    if (!solanaWallet) return;
    if (!SIGNER_ID) {
      setError(
        "Missing NEXT_PUBLIC_PRIVY_SIGNER_ID env var. Set it (Privy Dashboard > Signers) and rebuild the frontend — NEXT_PUBLIC_* vars are inlined at build time.",
      );
      return;
    }
    setError(null);
    setLoadingState("mutating");
    try {
      try {
        await addSigners({
          address: solanaWallet.address,
          signers: [{ signerId: SIGNER_ID, policyIds: [] }],
        });
      } catch (signerErr) {
        // Idempotency: if the signer is already attached in Privy (e.g. a
        // previous attempt added it but the backend POST below failed and
        // left the DB row missing), treat it as success and proceed.
        const msg = signerErr instanceof Error ? signerErr.message : "";
        if (!/duplicate signer/i.test(msg)) throw signerErr;
      }
      const token = await getAccessToken();
      if (!token) throw new Error("No access token");
      const r = await fetch("/api/agent-delegation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "delegate",
          wallet_pubkey: solanaWallet.address,
          chain_type: "solana",
        }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown_error");
    } finally {
      setLoadingState("idle");
    }
  }

  // ---------------------------------------------------------------------------
  // Revoke
  // ---------------------------------------------------------------------------

  async function onRevoke() {
    if (!solanaWallet) return;
    setError(null);
    setLoadingState("mutating");
    try {
      await removeSigners({ address: solanaWallet.address });
      const token = await getAccessToken();
      if (!token) throw new Error("No access token");
      const r = await fetch("/api/agent-delegation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: "revoke" }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown_error");
    } finally {
      setLoadingState("idle");
    }
  }

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const isActive = delegation !== null && delegation.revoked_at === null;
  const isBusy = loadingState !== "idle";
  const pubkey = isActive
    ? delegation!.wallet_pubkey
    : solanaWallet?.address ?? "";

  // ---------------------------------------------------------------------------
  // Render — loading skeleton
  // ---------------------------------------------------------------------------

  if (loadingState === "fetching") {
    return (
      <section className="flex flex-col gap-[18px] rounded-2xl border border-border-brand bg-gradient-to-b from-surface to-surface-2 p-7!">
        <div className="pick-summary-row" style={{ gap: 12 }}>
          <span className="loading-dot" aria-hidden />
          <span>Cargando estado de delegación…</span>
        </div>
      </section>
    );
  }

  // ---------------------------------------------------------------------------
  // Render — authorized state
  // ---------------------------------------------------------------------------

  if (isActive) {
    return (
      <section className="flex flex-col gap-[18px] rounded-2xl border border-border-brand bg-gradient-to-b from-surface to-surface-2 p-7!">
        {/* Header */}
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight">
            Agent authorization
          </h2>
        </div>

        {/* Status badge */}
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "14px 16px",
            background: "rgba(0,0,0,0.3)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <p
            style={{
              fontSize: 14,
              color: "var(--text)",
              fontWeight: 500,
              margin: 0,
            }}
          >
            ✓ <strong>Authorized</strong> — your agent can submit PRs on your
            behalf
          </p>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              fontSize: 13,
              color: "var(--text-muted)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <li>
              Wallet:{" "}
              <code
                className="mono-inline"
                title={delegation!.wallet_pubkey}
              >
                {shortPubkey(delegation!.wallet_pubkey)}
              </code>
            </li>
            <li>
              Delegated since:{" "}
              <span>{formatTimestamp(delegation!.delegated_at)}</span>
            </li>
          </ul>
        </div>

        {/* Error */}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}

        {/* Revoke */}
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isBusy}
            onClick={() => void onRevoke()}
          >
            {isBusy ? "Revoking…" : "Revoke authorization"}
          </Button>
        </div>
      </section>
    );
  }

  // ---------------------------------------------------------------------------
  // Render — not authorized state
  // ---------------------------------------------------------------------------

  return (
    <section className="flex flex-col gap-[18px] rounded-2xl border border-border-brand bg-gradient-to-b from-surface to-surface-2 p-7!">
      {/* Heading */}
      <div>
        <h2 className="font-display text-xl font-semibold tracking-tight">
          Authorize agent to act on-chain
        </h2>
        <p
          className="text-[12.5px] leading-[1.55] text-text-muted"
          style={{ marginTop: 6 }}
        >
          Your AI agent needs permission to sign Solana transactions on your
          behalf to submit PRs to bounties. Without this, every action would
          require you to open a browser and confirm — which defeats the point
          of having an agent.
        </p>
      </div>

      {/* What you're authorizing */}
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "14px 16px",
          background: "rgba(0,0,0,0.3)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div>
          <p
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text)",
              margin: "0 0 6px",
            }}
          >
            What you&apos;re authorizing:
          </p>
          <ul
            style={{
              listStyle: "disc",
              paddingLeft: 18,
              margin: 0,
              fontSize: 13,
              color: "var(--text-muted)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <li>
              GhBounty server can sign{" "}
              <code className="mono-inline">submit_solution</code> transactions
              using your wallet (
              <code className="mono-inline">
                {pubkey ? shortPubkey(pubkey) : "—"}
              </code>
              )
            </li>
            <li>
              This is scoped to the GhBounty escrow program only — we validate
              every transaction server-side before signing
            </li>
          </ul>
        </div>

        <div>
          <p
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text)",
              margin: "0 0 6px",
            }}
          >
            What we cannot do:
          </p>
          <ul
            style={{
              listStyle: "disc",
              paddingLeft: 18,
              margin: 0,
              fontSize: 13,
              color: "var(--text-muted)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <li>Transfer your SOL or tokens</li>
            <li>Withdraw funds from any escrow</li>
            <li>
              Sign any transaction outside the{" "}
              <code className="mono-inline">ghbounty_escrow</code> program
            </li>
          </ul>
        </div>
      </div>

      {/* Revoke notice */}
      <p className="text-[12.5px] leading-[1.55] text-text-muted">
        <strong>Revoke any time:</strong> clicking the button below will revoke
        all server-side signing permissions. Your agent will stop being able to
        submit PRs until you re-authorize.
      </p>

      {/* Error */}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}

      {/* CTA */}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={isBusy || !solanaWallet}
          onClick={() => void onAuthorize()}
        >
          {isBusy ? "Authorizing…" : "Authorize"}
        </Button>
        <span
          style={{ fontSize: 12, color: "var(--text-muted)" }}
        >
          State: Not authorized
        </span>
      </div>

      {!solanaWallet && (
        <p className="modal-note" style={{ marginBottom: 0 }}>
          No Solana wallet found. Connect a Solana wallet first.
        </p>
      )}

      {!SIGNER_ID && (
        <p className="modal-note" style={{ marginBottom: 0 }}>
          Deployment config missing: NEXT_PUBLIC_PRIVY_SIGNER_ID is not set,
          so authorization will fail. Set it from Privy Dashboard &gt; Signers
          and rebuild — NEXT_PUBLIC_* env vars are inlined at build time.
        </p>
      )}
    </section>
  );
}
