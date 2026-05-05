"use client";

/**
 * GHB-83 — company-side modal for picking a winner.
 *
 * Mirrors `SubmitPRModal`'s sign-and-send flow but against the
 * `ghbounty_escrow.resolve_bounty` instruction:
 *
 *   1. Build the unsigned `resolve_bounty` ix (lib/solana.ts).
 *   2. Wrap in a Transaction with a fresh blockhash.
 *   3. Sign + send via Privy (`useSignAndSendTransaction`).
 *   4. Wait for confirmation; check `value.err` (the call may revert
 *      silently — same gotcha as `submit_solution`).
 *   5. Best-effort DB mirror update (lib/review-actions.ts).
 *
 * On success the bounty's escrow has paid out to the winning solver.
 * The on-chain state flips to Resolved and the submission state flips
 * to Winner; the relayer's watcher catches up the Supabase mirror
 * shortly after — but we eagerly bump `bounty_meta.closed_by_user` and
 * the submission's `tx_hash` so the company UI feels instant.
 */

import { useEffect, useRef, useState } from "react";
import bs58 from "bs58";
import { createPortal } from "react-dom";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  useSignAndSendTransaction,
  useSignTransaction,
  useWallets,
} from "@privy-io/react-auth/solana";
import { usePrivy } from "@privy-io/react-auth";
import { Avatar } from "./Avatar";
import { ProcessingSteps } from "./ProcessingSteps";
import { buildResolveBountyIx, getConnection } from "@/lib/solana";
import { recordWinnerOnchain } from "@/lib/review-actions";
import { createClient } from "@/utils/supabase/client";
import {
  formatGasStationError,
  GAS_STATION_ENABLED,
  submitSponsored,
} from "@/lib/gas-station-client";
import type { Bounty } from "@/lib/types";
import type { EnrichedSubmission } from "@/lib/data";

const APPROVAL_FEEDBACK_MAX = 600;

type Step = "confirm" | "processing" | "success" | "error";

const PHASE_BUILD = 0;
const PHASE_SIGN = 1;
const PHASE_CONFIRM = 2;
const PHASE_INDEX = 3;
const PROCESSING_STEPS = [
  { id: "build", label: "Building transaction" },
  { id: "sign", label: "Signing in your wallet" },
  { id: "confirm", label: "Confirming on Solana devnet" },
  { id: "index", label: "Updating bounty status" },
];

export function PickWinnerModal({
  bounty,
  submission,
  reviewerUserId,
  companyBranding,
  onClose,
  onResolved,
}: {
  bounty: Bounty;
  submission: EnrichedSubmission;
  /** Privy DID of the company user picking the winner. Threaded through
   * to `recordWinnerOnchain` for `submission_reviews.decided_by` audit
   * symmetry with the reject path. */
  reviewerUserId: string;
  /** GHB-127: snapshot of the company's branding (id + name + logo) so
   * the dev's notification carries it on the payload. The parent is
   * gated on `user.role === "company"`, so this is always set in the
   * happy path; left optional for type-narrowing convenience. */
  companyBranding?: {
    companyId: string;
    companyName: string;
    companyAvatarUrl: string | undefined;
  };
  onClose: () => void;
  /** Called after on-chain confirmation + DB mirror update.
   * Receives the tx signature so the parent can render an explorer link. */
  onResolved: (txSig: string) => void;
}) {
  const [step, setStep] = useState<Step>("confirm");
  const [error, setError] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [phase, setPhase] = useState<number>(PHASE_BUILD);
  const [phaseError, setPhaseError] = useState(false);
  // Optional feedback the company can leave alongside the payout.
  // Persisted to `submission_reviews.approval_feedback` only when
  // non-empty after trim (see `recordWinnerOnchain`).
  const [feedback, setFeedback] = useState("");
  const sentRef = useRef(false);

  const { wallets, ready: walletsReady } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  // GHB-176: gas-station path uses partial-sign. Both hooks always
  // mounted — React forbids conditional hook usage.
  const { signTransaction } = useSignTransaction();
  const privy = usePrivy();
  const wallet = wallets[0];
  const walletAddress = wallet?.address ?? null;

  // ESC closes — but NOT during processing. A signing tx with no UI
  // would leave the user blind to errors and unable to retry.
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

  async function runRealFlow() {
    if (sentRef.current) return;
    sentRef.current = true;
    setPhase(PHASE_BUILD);
    setPhaseError(false);
    setError(null);

    try {
      if (!walletAddress || !wallet) {
        throw new Error("No connected wallet — sign back in.");
      }
      const bountyPdaStr = bounty.pda ?? bounty.id;
      if (!bountyPdaStr) {
        throw new Error("Bounty has no on-chain address.");
      }
      const bountyPda = new PublicKey(bountyPdaStr);
      const winnerWallet = new PublicKey(submission.solver);
      const winningSubmissionPda = new PublicKey(submission.pda);
      const creator = new PublicKey(walletAddress);
      const connection = getConnection();

      // PHASE_BUILD
      const ix = await buildResolveBountyIx(
        {
          creator,
          bountyPda,
          winningSubmissionPda,
          winnerWallet,
        },
        connection,
      );

      // PHASE_SIGN — gas-station vs legacy split (GHB-176).
      setPhase(PHASE_SIGN);
      let sig: string;
      if (GAS_STATION_ENABLED) {
        const result = await submitSponsored({
          ix,
          wallet,
          signTransaction,
          getAccessToken: () => privy.getAccessToken(),
          connection,
        });
        sig = result.txHash;
        setTxSig(sig);
        // Server already confirmed — advance through CONFIRM into INDEX.
        setPhase(PHASE_CONFIRM);
      } else {
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");
        const tx = new Transaction({
          feePayer: creator,
          recentBlockhash: blockhash,
        }).add(ix);
        const serialized = tx.serialize({ requireAllSignatures: false });
        const { signature } = await signAndSendTransaction({
          transaction: serialized,
          wallet,
          chain: "solana:devnet",
        });
        sig = bs58.encode(signature);
        setTxSig(sig);

        // PHASE_CONFIRM — confirmTransaction resolves on revert without
        // throwing, so we MUST inspect `value.err` ourselves.
        setPhase(PHASE_CONFIRM);
        const confirmation = await connection.confirmTransaction(
          { signature: sig, blockhash, lastValidBlockHeight },
          "confirmed",
        );
        if (confirmation.value.err) {
          throw new Error(
            `Resolve reverted on-chain: ${JSON.stringify(confirmation.value.err)}.`,
          );
        }
      }

      // PHASE_INDEX — best-effort DB mirror. Failures are logged, not
      // surfaced: the on-chain payout already succeeded.
      setPhase(PHASE_INDEX);
      const supabase = createClient();
      await recordWinnerOnchain(supabase, {
        bountyId: bounty.id,
        winnerSubmissionId: submission.id,
        txSignature: sig,
        approvalFeedback: feedback,
        reviewerUserId,
        // GHB-92: tell the dev about the win in their bell. The dev id
        // comes off the submission's enriched profile. Payload pre-fills
        // the bounty meta so the dropdown renders without a join.
        recipientUserId: submission.dev.id || undefined,
        notificationPayload: {
          bountyTitle:
            bounty.title ?? `${bounty.repo} #${bounty.issueNumber}`,
          bountyAmount: bounty.amountUsdc,
          // GHB-127: branding snapshot for the bell on the dev side.
          companyId: companyBranding?.companyId,
          companyName: companyBranding?.companyName,
          companyAvatarUrl: companyBranding?.companyAvatarUrl,
        },
      });

      setPhase(PROCESSING_STEPS.length);
      setStep("success");
      onResolved(sig);
    } catch (err) {
      console.error("[PickWinnerModal] failed:", err);
      setPhaseError(true);
      setError(formatGasStationError(err));
      setStep("error");
      sentRef.current = false; // allow retry
    }
  }

  // Trigger the real flow once the user advances past the confirm screen.
  useEffect(() => {
    if (step === "processing") void runRealFlow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const displayName =
    submission.dev.username || submission.dev.email || "Anonymous dev";

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="modal-backdrop"
      onClick={step === "processing" ? undefined : onClose}
    >
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <button
          className="modal-close"
          aria-label="Close"
          onClick={onClose}
          disabled={step === "processing"}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        {step === "confirm" && (
          <>
            <div className="modal-head">
              <div className="eyebrow">Pick winner</div>
              <h2 className="modal-title">Pay this submission</h2>
            </div>

            <div className="reject-target">
              <Avatar
                src={submission.dev.avatarUrl}
                name={displayName}
                size={36}
              />
              <div className="reject-target-meta">
                <span className="reject-target-name">{displayName}</span>
                <a
                  href={submission.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="reject-target-pr"
                >
                  <span className="mono-inline">{submission.prRepo}</span>{" "}
                  <span className="bounty-hash">#{submission.prNumber}</span>
                </a>
              </div>
            </div>

            <div className="pick-winner-summary">
              <div className="pick-summary-row">
                <span className="field-label">Bounty</span>
                <span>
                  <span className="mono-inline">{bounty.repo}</span>{" "}
                  <span className="bounty-hash">#{bounty.issueNumber}</span>
                </span>
              </div>
              <div className="pick-summary-row">
                <span className="field-label">Amount</span>
                <span className="pick-amount">
                  <strong>{bounty.amountUsdc.toLocaleString()}</strong>
                  <span className="token-pill">SOL</span>
                </span>
              </div>
              <div className="pick-summary-row">
                <span className="field-label">Sent to</span>
                <code className="mono-inline pick-solver">
                  {shortAddr(submission.solver)}
                </code>
              </div>
            </div>

            <p className="modal-note">
              This calls <code>resolve_bounty</code> on the escrow program
              and <strong>pays out the bounty immediately</strong>. The
              action is irreversible — once confirmed on Solana, the
              escrow no longer holds the funds. Other submissions will
              stay open until you reject them.
            </p>

            <label className="field">
              <span className="field-label">
                Feedback for the dev{" "}
                <span className="field-label-aux">
                  (optional, {APPROVAL_FEEDBACK_MAX - feedback.length} left)
                </span>
              </span>
              <textarea
                className="reject-textarea"
                rows={4}
                maxLength={APPROVAL_FEEDBACK_MAX}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="e.g. Solid approach to the migration, ping me on Discord if you want to take more bounties on this repo…"
              />
            </label>

            {error && <div className="form-error">{error}</div>}

            <div className="modal-foot">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!walletAddress || !walletsReady}
                onClick={() => setStep("processing")}
              >
                Confirm & pay
              </button>
            </div>
          </>
        )}

        {step === "processing" && (
          <>
            <div className="modal-head">
              <div className="eyebrow">Pick winner</div>
              <h2 className="modal-title">Releasing escrow…</h2>
            </div>
            <ProcessingSteps
              steps={PROCESSING_STEPS}
              currentStep={phase}
              error={phaseError}
            />
          </>
        )}

        {step === "success" && txSig && (
          <>
            <div className="modal-head">
              <div className="eyebrow">Pick winner</div>
              <h2 className="modal-title">Bounty paid</h2>
            </div>
            <p className="modal-note">
              The escrow released to{" "}
              <code className="mono-inline">{shortAddr(submission.solver)}</code>.
              Solana usually surfaces the tx in Explorer within a second.
            </p>
            <div className="pick-winner-summary">
              <div className="pick-summary-row">
                <span className="field-label">Tx</span>
                <a
                  href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mono-inline"
                >
                  {shortAddr(txSig)}
                </a>
              </div>
            </div>
            <div className="modal-foot">
              <button
                type="button"
                className="btn btn-primary"
                onClick={onClose}
              >
                Done
              </button>
            </div>
          </>
        )}

        {step === "error" && (
          <>
            <div className="modal-head">
              <div className="eyebrow">Pick winner</div>
              <h2 className="modal-title">Could not release escrow</h2>
            </div>
            <p className="modal-note">
              {error ?? "Something went wrong while signing or confirming."}
            </p>
            <div className="modal-foot">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onClose}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setStep("processing")}
              >
                Try again
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function shortAddr(s: string): string {
  if (s.length < 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}
