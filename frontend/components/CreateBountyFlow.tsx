"use client";

import { useEffect, useMemo, useState } from "react";
import { ProcessingSteps } from "./ProcessingSteps";
import { addBounty, uid } from "@/lib/store";
import type { Bounty, Company, ReleaseMode } from "@/lib/types";

export type CreateBountyData = {
  repo: string;
  issueNumber: number;
  issueUrl: string;
  title?: string;
  amount: number;
  releaseMode: ReleaseMode;
};

type Step = "confirm" | "processing" | "success";

export function CreateBountyFlow({
  company,
  data,
  onClose,
  onCreated,
}: {
  company: Company;
  data: CreateBountyData;
  onClose: () => void;
  onCreated: (b: Bounty) => void;
}) {
  const [step, setStep] = useState<Step>("confirm");
  const [bounty, setBounty] = useState<Bounty | null>(null);

  const txHash = useMemo(() => {
    const hex = "0123456789abcdef";
    let s = "0x";
    for (let i = 0; i < 64; i++) s += hex[Math.floor(Math.random() * 16)];
    return s;
  }, []);

  // ESC closes (except during processing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && step !== "processing") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, step]);

  function handleConfirm() {
    setStep("processing");
  }

  function handleProcessingDone() {
    const b: Bounty = {
      id: uid("b"),
      companyId: company.id,
      repo: data.repo,
      issueNumber: data.issueNumber,
      issueUrl: data.issueUrl,
      title: data.title,
      amountUsdc: data.amount,
      status: "open",
      releaseMode: data.releaseMode,
      createdAt: Date.now(),
    };
    addBounty(b);
    setBounty(b);
    setStep("success");
  }

  function handleDone() {
    if (bounty) onCreated(bounty);
    onClose();
  }

  return (
    <div
      className="modal-backdrop"
      onClick={step === "processing" ? undefined : onClose}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {step !== "processing" && (
          <button className="modal-close" aria-label="Close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}

        {step === "confirm" && (
          <>
            <div className="modal-head">
              <div className="eyebrow">Review bounty</div>
              <h2 className="modal-title">Confirm &amp; fund escrow</h2>
            </div>

            <div className="modal-summary">
              <SummaryRow label="Issue" value={`${data.repo} #${data.issueNumber}`} mono />
              {data.title && <SummaryRow label="Title" value={data.title} />}
              <SummaryRow
                label="Bounty"
                value={`${data.amount.toLocaleString()} mUSDC`}
                highlight
              />
              <SummaryRow
                label="Release mode"
                value={
                  data.releaseMode === "auto"
                    ? "Auto-release on AI approval"
                    : "AI-assisted — you pick winner"
                }
              />
              <SummaryRow
                label="Treasury wallet"
                value={company.wallet ? shortHex(company.wallet) : "not connected"}
                mono
              />
            </div>

            <p className="modal-note">
              Funds are locked in escrow. They release automatically to the
              contributor whose PR the AI validators approve.
            </p>

            <div className="modal-foot">
              <button className="btn btn-ghost btn-sm" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleConfirm}
                disabled={!company.wallet}
                title={!company.wallet ? "Connect a wallet first" : undefined}
              >
                Confirm &amp; fund
              </button>
            </div>
          </>
        )}

        {step === "processing" && (
          <>
            <div className="modal-head">
              <div className="eyebrow">Processing</div>
              <h2 className="modal-title">Creating bounty…</h2>
            </div>

            <ProcessingSteps
              steps={[
                { id: "w", label: "Connecting treasury wallet", duration: 550 },
                { id: "s", label: "Signing transaction", duration: 900 },
                { id: "d", label: "Deploying escrow contract", duration: 1200 },
                { id: "i", label: "Indexing on GH Bounty", duration: 500 },
              ]}
              onComplete={handleProcessingDone}
            />

            <p className="modal-note">Keep this window open — your wallet is signing.</p>
          </>
        )}

        {step === "success" && bounty && (
          <>
            <div className="modal-head">
              <div className="eyebrow">Success</div>
              <h2 className="modal-title">Bounty funded!</h2>
            </div>

            <div className="modal-success">
              <div className="modal-success-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <div>
                <strong>
                  {bounty.amountUsdc.toLocaleString()} mUSDC locked in escrow.
                </strong>
                <p>
                  Developers can claim it now. The bounty is visible in the
                  public feed and your dashboard.
                </p>
              </div>
            </div>

            <div className="modal-summary">
              <SummaryRow label="Bounty" value={`${bounty.repo} #${bounty.issueNumber}`} mono />
              <SummaryRow
                label="Transaction"
                value={`${txHash.slice(0, 8)}…${txHash.slice(-6)}`}
                mono
                copy={txHash}
              />
            </div>

            <div className="modal-foot">
              <a
                href={bounty.issueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-sm"
              >
                View issue on GitHub
              </a>
              <button className="btn btn-primary" onClick={handleDone}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  mono,
  highlight,
  copy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
  copy?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="summary-row">
      <span className="summary-label">{label}</span>
      <span
        className={`summary-value ${mono ? "mono" : ""} ${highlight ? "highlight" : ""}`}
      >
        {value}
        {copy && (
          <button
            className="summary-copy"
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(copy);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* no-op */
              }
            }}
            aria-label="Copy"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </span>
    </div>
  );
}

function shortHex(w: string) {
  if (w.length < 12) return w;
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}
