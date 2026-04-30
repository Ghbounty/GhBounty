"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useWallets } from "@privy-io/react-auth/solana";
import { parseIssueUrl } from "@/lib/github";
import { CreateBountyFlow, type CreateBountyData } from "./CreateBountyFlow";
import { ReleaseModePicker } from "./ReleaseModePicker";
import { getConnection } from "@/lib/solana";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { usePrivyBackend } from "@/lib/auth-context";
import type { Company, ReleaseMode } from "@/lib/types";

export function CreateBountyForm({
  company,
  onCreated,
}: {
  company: Company;
  onCreated?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [flowData, setFlowData] = useState<CreateBountyData | null>(null);
  const [releaseMode, setReleaseMode] = useState<ReleaseMode>("auto");
  const [balanceSol, setBalanceSol] = useState<number | null>(null);
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
  }, [walletAddress]);

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

    // Also block the submit if the user is trying to lock more than they
    // have. Tx would fail in the wallet anyway, but a client-side guard
    // saves a popup + a failed network round-trip.
    if (balanceSol !== null && amount > balanceSol) {
      setError(
        `Insufficient SOL — wallet has ${balanceSol.toFixed(4)}, requested ${amount}.`,
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
      releaseMode,
      rejectThreshold,
      evaluationCriteria: criteria || null,
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
          <span className="wallet-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7h18v13H3z" />
              <path d="M3 7l2-3h14l2 3" />
              <circle cx="17" cy="13.5" r="1.5" />
            </svg>
          </span>
          <code>{company.wallet ? shortWallet(company.wallet) : "wallet not set"}</code>
          <span className="wallet-status">
            {company.wallet ? "Connected" : "—"}
          </span>
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

        <div className="field-row">
          <label className="field">
            <span className="field-label">Title (optional)</span>
            <input name="title" placeholder="Short summary of the issue" />
          </label>

          <label className="field">
            <span className="field-label">
              Bounty amount <span className="musdc-inline">SOL</span>
              {balanceSol !== null && (
                <span className="field-hint">
                  {" "}· balance {balanceSol.toFixed(4)} SOL
                </span>
              )}
            </span>
            <input
              name="amount"
              type="number"
              min={0.001}
              step={0.001}
              placeholder="0.5"
              required
            />
          </label>
        </div>

        <label className="field">
          <span className="field-label">Description (optional)</span>
          <textarea
            name="description"
            rows={5}
            placeholder="What needs to be done, expected behavior, edge cases…"
          />
        </label>

        <div className="field">
          <span className="field-label">Release mode</span>
          <ReleaseModePicker value={releaseMode} onChange={setReleaseMode} compact />
        </div>

        <div className="field-row">
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
        </div>

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
    </>
  );
}

function shortWallet(w: string) {
  if (w.length < 12) return w;
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}
