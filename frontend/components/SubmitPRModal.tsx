"use client";

/**
 * GHB-89: real on-chain submission modal.
 *
 * Replaces the prior `<ProcessingSteps>` mock with the actual sign-and-send
 * flow against the `ghbounty_escrow.submit_solution` Solana program plus a
 * Supabase write via `insertSubmissionAndMeta`. Steps:
 *
 *   1. Validate the PR URL (form + repo match + no double submit).
 *   2. Build the unsigned `submit_solution` instruction (via `lib/solana`).
 *      This reads the bounty's `submission_count` to derive the next PDA.
 *   3. Wrap it in a Transaction with a fresh blockhash.
 *   4. Hand the serialized message to Privy's `useSignAndSendTransaction`.
 *   5. Wait for confirmation.
 *   6. Persist `submissions` + `submission_meta` rows.
 *   7. Render the real txSig with a Solana Explorer link.
 *
 * Errors at any step are surfaced inline; the user can close + retry.
 *
 * `opus_report_hash` is sent as `[0; 32]` — the relayer fills in the real
 * hash off-chain when scoring runs (see `evaluations.report_hash`).
 */

import { FormEvent, useEffect, useRef, useState } from "react";
import bs58 from "bs58";
import {
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  useSignAndSendTransaction,
  useWallets,
} from "@privy-io/react-auth/solana";
import { ProcessingSteps } from "./ProcessingSteps";
import { StatusBadge } from "./StatusBadge";
import { parsePrUrl } from "@/lib/github";
import { buildSubmitSolutionIx, getConnection } from "@/lib/solana";
import { insertSubmissionAndMeta } from "@/lib/submissions";
import { hasDevSubmitted } from "@/lib/data";
import { createClient } from "@/utils/supabase/client";
import { useAuth, usePrivyBackend } from "@/lib/auth-context";
import type { Bounty } from "@/lib/types";

type Props = {
  bounty: Bounty;
  devId: string;
  onClose: () => void;
  onSubmitted: () => void;
};

type Step = "form" | "processing" | "success" | "error";
type FormData = { prUrl: string; note?: string };

const CHAIN_ID = "solana-devnet";

/**
 * Indices into the controlled-mode `<ProcessingSteps>` list. Mirror the
 * order of the steps array below so the cursor stays in sync with the
 * label the user sees.
 */
const PHASE_BUILD = 0;
const PHASE_SIGN = 1;
const PHASE_CONFIRM = 2;
const PHASE_INDEX = 3;

const PROCESSING_STEPS = [
  { id: "build", label: "Building transaction" },
  { id: "sign", label: "Signing in your wallet" },
  { id: "confirm", label: "Confirming on Solana devnet" },
  { id: "index", label: "Indexing in Supabase" },
];

export function SubmitPRModal({ bounty, devId, onClose, onSubmitted }: Props) {
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [submissionPda, setSubmissionPda] = useState<string | null>(null);
  // GHB-169: drive `<ProcessingSteps>` from the real flow so each phase
  // only marks done when its await actually resolves. `phase` is an index
  // into PROCESSING_STEPS; `phaseError` flips the active step to its red
  // failure state when something throws.
  const [phase, setPhase] = useState<number>(PHASE_BUILD);
  const [phaseError, setPhaseError] = useState(false);
  const sentRef = useRef(false);

  const privyMode = usePrivyBackend;
  const { user } = useAuth();
  const { wallets, ready: walletsReady } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  // Single-wallet UX matches the company side. If the dev linked an external
  // wallet on top of the embedded one, we just take the first.
  const wallet = wallets[0];
  const walletAddress = wallet?.address ?? null;

  // ESC closes (except mid-tx — losing the modal during signing leaves a
  // pending tx with no UI to recover).
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

  async function onSubmitForm(e: FormEvent<HTMLFormElement>) {
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

    // Cheap pre-flight against the DB before we sign anything. The on-chain
    // `init` will also reject duplicates per submission index, but failing
    // before signing saves a wasted wallet pop.
    try {
      const already = await hasDevSubmitted(devId, bounty.id);
      if (already) {
        setError("You already submitted a PR for this bounty.");
        return;
      }
    } catch (err) {
      console.warn("[SubmitPRModal] hasDevSubmitted check failed:", err);
      // Don't block on a pre-flight read failure — let the chain enforce.
    }

    setFormData({ prUrl, note: note || undefined });
    setStep("processing");
  }

  async function runRealFlow(data: FormData) {
    if (sentRef.current) return;
    sentRef.current = true;

    setPhase(PHASE_BUILD);
    setPhaseError(false);

    try {
      if (!privyMode) {
        throw new Error(
          "PR submission requires Privy auth (NEXT_PUBLIC_USE_PRIVY=1).",
        );
      }
      if (!wallet || !walletAddress) {
        throw new Error("No Solana wallet connected.");
      }
      if (!user) {
        throw new Error("Not signed in.");
      }

      const connection: Connection = getConnection();
      const solver = new PublicKey(walletAddress);
      // `bounty.pda` is the on-chain address; `bounty.id` is a Postgres UUID
      // in the Supabase-backed flow. Always reach for `pda` first; fall back
      // to `id` only for legacy localStorage rows where the mock overloaded
      // `id` with the PDA.
      const bountyPdaStr = bounty.pda ?? bounty.id;
      if (!bountyPdaStr) {
        throw new Error("Bounty has no on-chain address.");
      }
      const bountyPda = new PublicKey(bountyPdaStr);

      // PHASE_BUILD: build the unsigned instruction. Reads
      // `submission_count` on-chain to derive the next submission PDA.
      // Manual submits send a zero hash — the off-chain Opus pipeline
      // records the real hash in `evaluations.report_hash` afterwards.
      const { ix, submissionPda: pda, submissionIndex } = await buildSubmitSolutionIx(
        {
          solver,
          bountyPda,
          prUrl: data.prUrl,
        },
        connection,
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(
        "confirmed",
      );
      const tx = new Transaction({
        feePayer: solver,
        recentBlockhash: blockhash,
      }).add(ix);
      const serialized = tx.serialize({ requireAllSignatures: false });

      // PHASE_SIGN: hand off to Privy — pops the wallet UI. This is the
      // step that takes the longest in practice (waiting on the user).
      setPhase(PHASE_SIGN);
      const { signature } = await signAndSendTransaction({
        transaction: serialized,
        wallet,
        chain: "solana:devnet",
      });
      const sig = bs58.encode(signature);
      setTxSig(sig);
      setSubmissionPda(pda.toBase58());

      // PHASE_CONFIRM: wait for confirmation. `confirmed` is enough —
      // `finalized` would add ~10s of UX wait for a marginal safety win
      // on devnet. CRITICAL: `confirmTransaction` resolves even when the
      // on-chain tx reverted (program error / constraint violation). The
      // failure shows up in `value.err`, not as a thrown error — so we
      // must check it explicitly. Without this guard, the modal pretends
      // the tx succeeded and we surface a confusing DB error two steps
      // later (typically the `submissions_pda_unique` 409 you'd hit on
      // a duplicate submit_solution).
      setPhase(PHASE_CONFIRM);
      const confirmation = await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed",
      );
      if (confirmation.value.err) {
        throw new Error(
          `Submit reverted on-chain: ${JSON.stringify(confirmation.value.err)}. ` +
            `The submission PDA likely already exists for this bounty (replay).`,
        );
      }

      // PHASE_INDEX: persist the off-chain rows.
      setPhase(PHASE_INDEX);
      const supabase = createClient();
      await insertSubmissionAndMeta(supabase, {
        chainId: CHAIN_ID,
        issuePda: bountyPdaStr,
        pda: pda.toBase58(),
        solver: walletAddress,
        submissionIndex,
        prUrl: data.prUrl,
        // Empty hash — Opus didn't run yet. The eval pipeline writes the
        // canonical hash into `evaluations.report_hash` later.
        opusReportHash: "",
        txHash: sig,
        note: data.note,
        submittedByUserId: user.id,
      });

      // Bump the cursor past the last step so every entry renders as
      // "done" while the modal swaps to the success view.
      setPhase(PROCESSING_STEPS.length);
      setStep("success");
    } catch (err) {
      console.error("[SubmitPRModal] failed:", err);
      // Mark the currently-active step in red before flipping to the
      // error view so the user sees *which* phase failed.
      setPhaseError(true);
      setError(err instanceof Error ? err.message : "Submission failed.");
      setStep("error");
      sentRef.current = false; // allow retry
    }
  }

  // Trigger the real flow when the user moves into the processing step.
  // The first setState inside `runRealFlow` is gated behind an `await` and
  // a `try/catch`, so the cascade-render concern of `set-state-in-effect`
  // doesn't apply — but the rule can't see across the async boundary.
  /* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */
  useEffect(() => {
    if (step === "processing" && formData) void runRealFlow(formData);
  }, [step]);
  /* eslint-enable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */

  function handleDone() {
    onSubmitted();
  }

  function handleRetry() {
    setError(null);
    setPhase(PHASE_BUILD);
    setPhaseError(false);
    setStep("form");
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
                ? "Submitting on-chain"
                : step === "success"
                  ? "Submitted"
                  : "Failed"}
          </div>
          <h2 className="modal-title">
            {step === "form"
              ? "Link your PR to this bounty"
              : step === "processing"
                ? "Sign + broadcast…"
                : step === "success"
                  ? "PR submitted!"
                  : "Couldn't submit the PR"}
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
            <span className="token-pill">SOL</span>
          </div>
        </div>

        {step === "form" && (
          <form onSubmit={onSubmitForm} className="auth-form">
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

            <p className="modal-note">
              You&apos;ll sign a <code>submit_solution</code> transaction on
              Solana devnet. Network fees only — no escrow lock.
            </p>

            <div className="modal-foot">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!walletAddress || !walletsReady}
                title={!walletAddress ? "Connect a wallet first" : undefined}
              >
                Submit PR
              </button>
            </div>
          </form>
        )}

        {step === "processing" && (
          <>
            <ProcessingSteps
              steps={PROCESSING_STEPS}
              currentStep={phase}
              error={phaseError}
            />
            <p className="modal-note">
              Keep this window open — your wallet is signing. This may take a
              few seconds on Solana devnet.
            </p>
          </>
        )}

        {step === "success" && txSig && submissionPda && (
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
                  Validators will score it shortly. You&apos;ll be paid
                  automatically the moment they reach Optimistic Democracy
                  consensus.
                </p>
              </div>
            </div>

            <div className="modal-summary">
              <SummaryRow label="Submission PDA" value={shortHex(submissionPda)} mono copy={submissionPda} />
              <SummaryRow
                label="Transaction"
                value={`${txSig.slice(0, 8)}…${txSig.slice(-6)}`}
                mono
                copy={txSig}
              />
            </div>

            <div className="modal-foot">
              <a
                href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-sm"
              >
                View on Solana Explorer
              </a>
              <button className="btn btn-primary" onClick={handleDone}>
                Done
              </button>
            </div>
          </>
        )}

        {step === "error" && (
          <>
            {/* Re-render the steps list with the failing phase marked in
                red so the user sees *which* step blew up before reading
                the message. */}
            <ProcessingSteps
              steps={PROCESSING_STEPS}
              currentStep={phase}
              error
            />
            <div className="form-error">{error}</div>

            <p className="modal-note">
              Nothing was charged besides the network fee (if the wallet
              broadcast at all). Review the error and try again, or cancel.
            </p>

            <div className="modal-foot">
              <button className="btn btn-ghost btn-sm" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleRetry}>
                Try again
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
  copy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copy?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="summary-row">
      <span className="summary-label">{label}</span>
      <span className={`summary-value ${mono ? "mono" : ""}`}>
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
