"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useWallets } from "@privy-io/react-auth/solana";
import { parseIssueUrl } from "@/lib/github";
import { CreateBountyFlow, type CreateBountyData } from "./CreateBountyFlow";
import { DepositModal } from "./DepositModal";
import { WithdrawModal } from "./WithdrawModal";
import { getConnection } from "@/lib/solana";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { usePrivyBackend } from "@/lib/auth-context";
import { fetchSolUsdPrice } from "@/lib/pyth";
import {
  computeReviewFee,
  MAX_SUBMISSIONS_DEFAULT,
  MAX_SUBMISSIONS_MAX,
  MAX_SUBMISSIONS_MIN,
  REVIEW_COST_USD_PER_REVIEW,
  REVIEW_FEE_MARKUP,
} from "@/lib/review-fee";
import { REVIEW_FEE_ENABLED } from "@/lib/gas-station-client";
import type { Company } from "@/lib/types";

export function CreateBountyForm({
  company,
  onCreated,
  refreshKey = 0,
}: {
  company: Company;
  onCreated?: () => void;
  /** Bumped by the parent dashboard whenever something happens that may
   * have changed the wallet's SOL balance off-band — e.g. a `cancel_bounty`
   * refund triggered by the `⋯` menu Delete action. Forces the balance
   * useEffect to re-run without needing a full unmount. */
  refreshKey?: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [flowData, setFlowData] = useState<CreateBountyData | null>(null);
  const [balanceSol, setBalanceSol] = useState<number | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  // Controlled "Max PRs" input so we can render a live fee breakdown.
  // Stored as a string so the input never coerces "" to NaN.
  const [maxSubsInput, setMaxSubsInput] = useState<string>(
    String(MAX_SUBMISSIONS_DEFAULT),
  );
  // SOL/USD locked at form mount. Re-fetched on mount only — flickering it
  // mid-typing would change the displayed total under the user's hands.
  // null while loading, number on success, false on hard failure.
  const [solUsdPrice, setSolUsdPrice] = useState<number | null | false>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  // Wallet (Privy in real mode, fall back to mock store wallet otherwise)
  const privyMode = usePrivyBackend;
  const { wallets } = useWallets();
  const walletAddress = privyMode
    ? wallets[0]?.address ?? null
    : company.wallet ?? null;

  // Fetch SOL balance on mount + whenever the wallet changes. We hit the
  // RPC directly (no cache) because the value matters at click-time and
  // the form is rarely visible long enough for staleness to matter.
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
        console.warn("[CreateBountyForm] balance fetch failed:", err);
        if (!cancelled) setBalanceSol(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, refreshKey]);

  // Pyth Hermes SOL/USD lookup. Only fired when the review-fee feature
  // is wired on (no point hitting Pyth for legacy/local-dev builds with
  // the env unset). Mount-only — see `solUsdPrice` doc comment.
  useEffect(() => {
    if (!REVIEW_FEE_ENABLED) {
      setSolUsdPrice(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const price = await fetchSolUsdPrice();
        if (!cancelled) setSolUsdPrice(price);
      } catch (err) {
        console.error("[CreateBountyForm] Pyth fetch failed:", err);
        if (!cancelled) setSolUsdPrice(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live fee breakdown. Recomputed on every keystroke in the cap input.
  // Returns null when input is invalid or price hasn't loaded yet — the
  // UI swaps in a placeholder string in that case.
  const feeBreakdown = useMemo(() => {
    if (!REVIEW_FEE_ENABLED) return null;
    if (typeof solUsdPrice !== "number") return null;
    const cap = Number(maxSubsInput);
    if (
      !Number.isInteger(cap) ||
      cap < MAX_SUBMISSIONS_MIN ||
      cap > MAX_SUBMISSIONS_MAX
    ) {
      return null;
    }
    try {
      return computeReviewFee({
        maxSubmissions: cap,
        solPriceUsd: solUsdPrice,
      });
    } catch {
      return null;
    }
  }, [solUsdPrice, maxSubsInput]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = e.currentTarget;
    const url = (f.elements.namedItem("issueUrl") as HTMLInputElement).value.trim();
    const amountRaw = (f.elements.namedItem("amount") as HTMLInputElement).value;
    const title = (f.elements.namedItem("title") as HTMLInputElement).value.trim();
    const description = (
      f.elements.namedItem("description") as HTMLTextAreaElement
    )?.value.trim();
    const rejectRaw = (
      f.elements.namedItem("rejectThreshold") as HTMLInputElement
    )?.value;
    const criteria = (
      f.elements.namedItem("evaluationCriteria") as HTMLTextAreaElement
    )?.value.trim();
    const maxSubsRaw = (
      f.elements.namedItem("maxSubmissions") as HTMLInputElement
    )?.value;

    const parsed = parseIssueUrl(url);
    if (!parsed) {
      setError("Paste a valid GitHub issue URL — https://github.com/owner/repo/issues/123");
      return;
    }
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Amount must be a positive number.");
      return;
    }

    // Threshold is optional — empty means "no auto-rejection". When set,
    // it must be 1-10 to match the on-chain score range.
    let rejectThreshold: number | null = null;
    if (rejectRaw && rejectRaw.length > 0) {
      const n = Number(rejectRaw);
      if (!Number.isInteger(n) || n < 1 || n > 10) {
        setError("Reject threshold must be an integer between 1 and 10.");
        return;
      }
      rejectThreshold = n;
    }

    // Cap is now REQUIRED (the upfront review fee is sized off it).
    // Range: [MAX_SUBMISSIONS_MIN, MAX_SUBMISSIONS_MAX].
    if (!maxSubsRaw || maxSubsRaw.length === 0) {
      setError("Max PRs is required (1-50).");
      return;
    }
    const maxSubmissions = Number(maxSubsRaw);
    if (
      !Number.isInteger(maxSubmissions) ||
      maxSubmissions < MAX_SUBMISSIONS_MIN ||
      maxSubmissions > MAX_SUBMISSIONS_MAX
    ) {
      setError(
        `Max PRs must be an integer in [${MAX_SUBMISSIONS_MIN}, ${MAX_SUBMISSIONS_MAX}].`,
      );
      return;
    }

    // Block submit if Pyth price didn't load — sponsoring a bounty
    // without a fee size is a net loss for us.
    if (REVIEW_FEE_ENABLED && typeof solUsdPrice !== "number") {
      setError(
        "Couldn't load the live SOL price. Retry in a moment or refresh the page.",
      );
      return;
    }

    // Block submit if the user is trying to lock more than the balance
    // covers — bounty + review fee. The tx would fail in the wallet
    // anyway, but a client-side guard saves a popup + a failed network
    // round-trip. Skip the check when the gas station tops up automatically
    // (GAS_STATION_ENABLED + we'll fund the user from gas station).
    const reviewFeeSol =
      feeBreakdown !== null
        ? feeBreakdown.totalLamports / LAMPORTS_PER_SOL
        : 0;
    if (balanceSol !== null && amount + reviewFeeSol > balanceSol) {
      setError(
        `Insufficient SOL — wallet has ${balanceSol.toFixed(4)}, ` +
          `requested ${amount.toFixed(4)} bounty + ${reviewFeeSol.toFixed(4)} review fee.`,
      );
      return;
    }

    setFlowData({
      repo: parsed.repo,
      issueNumber: parsed.issueNumber,
      issueUrl: url,
      title: title || undefined,
      description: description || undefined,
      amount,
      // GHB-184: Release Mode picker is hidden in the UI but the column
      // stays in the schema. Hardcoding 'assisted' here matches the new
      // default and lets us re-enable user choice later without a migration.
      releaseMode: "assisted",
      rejectThreshold,
      evaluationCriteria: criteria || null,
      maxSubmissions,
      // Lock the SOL/USD rate at the moment the user committed. The
      // flow uses this to size the bundled fee transfer in lamports.
      solUsdPrice: typeof solUsdPrice === "number" ? solUsdPrice : null,
    });
  }

  function handleFlowClose() {
    setFlowData(null);
  }

  function handleFlowCreated() {
    formRef.current?.reset();
    onCreated?.();
  }

  return (
    <>
      <form ref={formRef} className="create-bounty" onSubmit={onSubmit}>
        <div className="create-bounty-head">
          <div className="create-bounty-head-left">
            <span className="plus-icon">+</span>
            <div>
              <h3>Create Bounty</h3>
              <p>Fund a GitHub issue for the community to solve.</p>
            </div>
          </div>
        </div>

        <div className="wallet-pill">
          {/* Row 1: identity + balance. Address truncated for legibility,
              full string lives in the Deposit modal so users can copy it. */}
          <div className="wallet-pill-row">
            <span className="wallet-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7h18v13H3z" />
                <path d="M3 7l2-3h14l2 3" />
                <circle cx="17" cy="13.5" r="1.5" />
              </svg>
            </span>
            <code>
              {walletAddress ? shortWallet(walletAddress) : "wallet not set"}
            </code>
            <span className="wallet-status">
              {balanceSol !== null
                ? `${balanceSol.toFixed(4)} SOL`
                : walletAddress
                  ? "—"
                  : "not connected"}
            </span>
          </div>
          {/* Row 2: actions. Deposit is the safer/zero-friction action
              (just shows your address) so it gets the ghost variant;
              Withdraw is the filled accent because it actually moves
              funds out of the in-app wallet. Both stay disabled
              (instead of hidden) so the layout doesn't reflow as
              wallet/balance state hydrates. */}
          <div className="wallet-pill-actions">
            <button
              type="button"
              className="wallet-action wallet-deposit"
              onClick={() => setDepositOpen(true)}
              disabled={!privyMode || !walletAddress}
              title="Receive SOL from an external wallet"
            >
              Deposit
            </button>
            <button
              type="button"
              className="wallet-action wallet-withdraw"
              onClick={() => setWithdrawOpen(true)}
              disabled={
                !privyMode ||
                !wallets[0] ||
                balanceSol === null ||
                balanceSol <= 0
              }
              title="Send SOL from your Privy wallet to an external address"
            >
              Withdraw
            </button>
          </div>
        </div>

        <label className="field">
          <span className="field-label">GitHub Issue URL</span>
          <div className="field-with-icon">
            <span className="field-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.08c-3.2.7-3.87-1.37-3.87-1.37-.52-1.32-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.69 1.25 3.34.95.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.18a10.95 10.95 0 015.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.58.23 2.75.11 3.04.73.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.25 5.67.41.36.77 1.07.77 2.16v3.2c0 .31.21.68.8.56C20.21 21.38 23.5 17.07 23.5 12 23.5 5.65 18.35.5 12 .5z" />
              </svg>
            </span>
            <input
              name="issueUrl"
              type="url"
              placeholder="https://github.com/owner/repo/issues/123"
              required
            />
          </div>
        </label>

        <label className="field">
          <span className="field-label">Title (optional)</span>
          <input name="title" placeholder="Short summary of the issue" />
        </label>

        <label className="field">
          <span className="field-label">
            Bounty amount <span className="token-inline">SOL</span>
          </span>
          <input
            name="amount"
            type="number"
            min={0.001}
            step={0.001}
            placeholder="0.5"
            required
            onKeyDown={(e) => {
              // GHB-184: hard-block letters/symbols. type="number" alone lets
              // through 'e', '+', '-' (Chrome) and full pasted strings.
              if (
                e.key.length > 1 ||
                e.ctrlKey ||
                e.metaKey
              ) {
                return;
              }
              if (/^[0-9]$/.test(e.key)) return;
              if (e.key === "." && !(e.currentTarget.value ?? "").includes(".")) return;
              e.preventDefault();
            }}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData("text").trim();
              if (!/^\d+(\.\d+)?$/.test(pasted)) {
                e.preventDefault();
                setError("Numbers only (e.g. 0.5)");
              }
            }}
          />
        </label>

        <label className="field">
          <span className="field-label">Description (optional)</span>
          <textarea
            name="description"
            rows={5}
            placeholder="What needs to be done, expected behavior, edge cases…"
          />
        </label>

        {/* GHB-184: read-only display of the active release mode. We keep
            the picker component reserved for the future when auto-release
            is mature enough to re-enable. For now there's only one mode,
            but we still surface it so companies see how reviews work. */}
        <div className="field">
          <span className="field-label">Release mode</span>
          <div className="release-picker compact">
            <div className="release-opt static">
              <span className="release-opt-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </span>
              <span className="release-opt-body">
                <span className="release-opt-title">AI-assisted review</span>
                <span className="release-opt-desc">
                  Receive many PRs with AI scoring. You pick the winner and
                  trigger the payout.
                </span>
              </span>
            </div>
          </div>
        </div>

        <label className="field">
          <span className="field-label">Reject threshold (1-10, optional)</span>
          <input
            name="rejectThreshold"
            type="number"
            min={1}
            max={10}
            step={1}
            placeholder="8"
          />
        </label>

        <label className="field">
          <span className="field-label">
            Max PRs to review <span className="token-inline">required</span>
          </span>
          <input
            name="maxSubmissions"
            type="number"
            min={MAX_SUBMISSIONS_MIN}
            max={MAX_SUBMISSIONS_MAX}
            step={1}
            required
            value={maxSubsInput}
            placeholder={String(MAX_SUBMISSIONS_DEFAULT)}
            onChange={(e) => setMaxSubsInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (
                e.key.length > 1 ||
                e.ctrlKey ||
                e.metaKey
              ) {
                return;
              }
              if (/^[0-9]$/.test(e.key)) return;
              e.preventDefault();
            }}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData("text").trim();
              if (!/^\d+$/.test(pasted)) {
                e.preventDefault();
                setError(
                  `Max PRs accepts integers only (${MAX_SUBMISSIONS_MIN}-${MAX_SUBMISSIONS_MAX}).`,
                );
              }
            }}
          />
          <span className="field-hint">
            Each PR is reviewed with Sonnet 4.5 (~${REVIEW_COST_USD_PER_REVIEW.toFixed(2)} per
            review). The bounty closes automatically when this number is
            reached. You'll get a refund for any unused review slots if you
            cancel before the cap fills.
          </span>
        </label>

        {/* Live review-fee breakdown. Stays in DOM even when invalid so
            the layout doesn't jump as the user types — placeholder copy
            tells them why the numbers aren't shown. */}
        {REVIEW_FEE_ENABLED && (
          <div className="field fee-breakdown">
            <span className="field-label">Review fee</span>
            {solUsdPrice === null && (
              <span className="field-hint">Loading live SOL price…</span>
            )}
            {solUsdPrice === false && (
              <span className="field-hint">
                Couldn't load SOL/USD from Pyth. Refresh to retry.
              </span>
            )}
            {feeBreakdown && typeof solUsdPrice === "number" && (
              <div className="fee-breakdown-rows">
                <div className="fee-row">
                  <span>{maxSubsInput} reviews × ${REVIEW_COST_USD_PER_REVIEW.toFixed(2)} × {REVIEW_FEE_MARKUP}× markup</span>
                  <span>${feeBreakdown.totalUsd.toFixed(2)}</span>
                </div>
                <div className="fee-row total">
                  <span>Charged in SOL @ ${solUsdPrice.toFixed(2)}/SOL</span>
                  <span>
                    {(feeBreakdown.totalLamports / LAMPORTS_PER_SOL).toFixed(4)}{" "}
                    SOL
                  </span>
                </div>
              </div>
            )}
            {!feeBreakdown && typeof solUsdPrice === "number" && (
              <span className="field-hint">
                Enter a valid Max PRs ({MAX_SUBMISSIONS_MIN}-
                {MAX_SUBMISSIONS_MAX}) to see the fee.
              </span>
            )}
          </div>
        )}

        <label className="field">
          <span className="field-label">Evaluation criteria (optional)</span>
          <textarea
            name="evaluationCriteria"
            rows={4}
            placeholder="Must include tests for the new behavior."
          />
        </label>

        {error && <div className="form-error">{error}</div>}

        <button type="submit" className="btn btn-primary btn-wide">
          <span className="plus-icon inline">+</span> Create Bounty
        </button>
      </form>

      {flowData && (
        <CreateBountyFlow
          company={company}
          data={flowData}
          onClose={handleFlowClose}
          onCreated={handleFlowCreated}
        />
      )}

      {withdrawOpen && wallets[0] && (
        <WithdrawModal
          wallet={wallets[0]}
          balanceSol={balanceSol}
          onClose={() => setWithdrawOpen(false)}
          // Reuse the parent's `onCreated` signal to bump `tick` — the
          // dashboard's `tick` flows back into our `refreshKey`, which
          // refetches the balance. Same plumbing the delete flow uses.
          onWithdrawn={() => onCreated?.()}
        />
      )}

      {depositOpen && walletAddress && (
        <DepositModal
          walletAddress={walletAddress}
          // Hardcoded for MVP — we're locked to devnet via the Privy
          // `solana:devnet` chain registration in `auth-privy.tsx`.
          // When mainnet ships, lift this from the Solana RPC env var.
          network="Solana Devnet"
          onClose={() => setDepositOpen(false)}
          onRefresh={() => onCreated?.()}
        />
      )}
    </>
  );
}

function shortWallet(w: string) {
  if (w.length < 12) return w;
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}
