"use client";

import { FormEvent, useEffect, useState } from "react";
import { addSubmission, hasDevSubmitted, uid } from "@/lib/store";
import { parsePrUrl } from "@/lib/github";
import type { Bounty } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";
import { ProcessingSteps } from "./ProcessingSteps";
import { UsdcIcon } from "./UsdcIcon";

type Props = {
  bounty: Bounty;
  devId: string;
  onClose: () => void;
  onSubmitted: () => void;
};

type Step = "form" | "processing" | "success";

type SubmissionData = { prUrl: string; prRepo: string; prNumber: number; note?: string };

export function SubmitPRModal({ bounty, devId, onClose, onSubmitted }: Props) {
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState<string | null>(null);
  const [submission, setSubmission] = useState<SubmissionData | null>(null);

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

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = e.currentTarget;
    const prUrl = (f.elements.namedItem("prUrl") as HTMLInputElement).value.trim();
    const note = (f.elements.namedItem("note") as HTMLTextAreaElement).value.trim();

    const parsed = parsePrUrl(prUrl);
    if (!parsed) {
      setError("Paste a valid GitHub PR URL — https://github.com/owner/repo/pull/99");
      return;
    }
    if (parsed.repo !== bounty.repo) {
      setError(`PR must target ${bounty.repo} (got ${parsed.repo}).`);
      return;
    }
    if (hasDevSubmitted(devId, bounty.id)) {
      setError("You already submitted a PR for this bounty.");
      return;
    }

    setSubmission({
      prUrl,
      prRepo: parsed.repo,
      prNumber: parsed.prNumber,
      note: note || undefined,
    });
    setStep("processing");
  }

  function handleProcessingDone() {
    if (!submission) return;
    addSubmission({
      id: uid("s"),
      bountyId: bounty.id,
      devId,
      prUrl: submission.prUrl,
      prRepo: submission.prRepo,
      prNumber: submission.prNumber,
      note: submission.note,
      status: "pending",
      createdAt: Date.now(),
    });
    setStep("success");
  }

  function handleDone() {
    onSubmitted();
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

        <div className="modal-head">
          <div className="eyebrow">
            {step === "form"
              ? "Submit pull request"
              : step === "processing"
              ? "Validating"
              : "Submitted"}
          </div>
          <h2 className="modal-title">
            {step === "form"
              ? "Link your PR to this bounty"
              : step === "processing"
              ? "Queueing submission…"
              : "PR submitted!"}
          </h2>
        </div>

        <div className="modal-bounty">
          <div className="modal-bounty-row">
            <span className="bounty-repo">
              {bounty.repo} <span className="bounty-hash">#{bounty.issueNumber}</span>
            </span>
            <StatusBadge status={bounty.status} />
          </div>
          {bounty.title && <div className="modal-bounty-title">{bounty.title}</div>}
          <div className="modal-bounty-foot">
            <span className="bounty-amount-val">
              {bounty.amountUsdc.toLocaleString()}
            </span>
            <span className="musdc-pill">
              <UsdcIcon size={16} />mUSDC
            </span>
          </div>
        </div>

        {step === "form" && (
          <form onSubmit={onSubmit} className="auth-form">
            <label className="field">
              <span className="field-label">Pull request URL *</span>
              <div className="field-with-icon">
                <span className="field-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="6" cy="6" r="3" />
                    <circle cx="18" cy="18" r="3" />
                    <path d="M6 9v6a6 6 0 006 6h3" />
                  </svg>
                </span>
                <input
                  name="prUrl"
                  type="url"
                  placeholder={`https://github.com/${bounty.repo}/pull/…`}
                  required
                  autoFocus
                />
              </div>
            </label>
            <label className="field">
              <span className="field-label">Note to reviewers (optional)</span>
              <textarea
                name="note"
                rows={3}
                placeholder="Anything the validators should know about your approach."
              />
            </label>

            {error && <div className="form-error">{error}</div>}

            <div className="modal-foot">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Submit PR
              </button>
            </div>
          </form>
        )}

        {step === "processing" && (
          <>
            <ProcessingSteps
              steps={[
                { id: "p", label: "Parsing pull request", duration: 500 },
                { id: "s", label: "Uploading diff to sandbox", duration: 900 },
                { id: "r", label: "Running test suite", duration: 1200 },
                { id: "v", label: "Dispatching to AI validators", duration: 800 },
              ]}
              onComplete={handleProcessingDone}
            />
            <p className="modal-note">
              Keep this window open — validators are scoring your PR.
            </p>
          </>
        )}

        {step === "success" && submission && (
          <>
            <div className="modal-success">
              <div className="modal-success-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <div>
                <strong>Your PR is queued for consensus.</strong>
                <p>
                  The bounty moved to <span className="accent">reviewing</span>.
                  You&apos;ll be paid automatically the moment validators reach
                  Optimistic Democracy consensus.
                </p>
              </div>
            </div>

            <div className="modal-foot">
              <a
                href={submission.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-sm"
              >
                View PR
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
