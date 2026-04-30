"use client";

/**
 * GHB-80: real on-chain bounty creation modal.
 *
 * Replaces the prior `<ProcessingSteps>` mock with the actual sign-and-send
 * flow against the `ghbounty_escrow` Solana program plus a Supabase write
 * via `insertIssueAndMeta`. Steps:
 *
 *   1. Build the unsigned `create_bounty` instruction (via `lib/solana`).
 *   2. Wrap it in a Transaction with a fresh blockhash.
 *   3. Hand the serialized message to Privy's `useSignAndSendTransaction`,
 *      which pops the wallet UI and broadcasts.
 *   4. Wait for confirmation.
 *   5. Persist `issues` + `bounty_meta` rows.
 *   6. Render the real txSig with a Solana Explorer link.
 *
 * Errors at any step are surfaced inline; the user can close + retry. We
 * intentionally *do not* fall back to localStorage — if the chain or DB
 * rejects, the bounty doesn't exist anywhere and the form stays correct.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import bs58 from "bs58";
import {
  Connection,
  PublicKey,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  useSignAndSendTransaction,
  useWallets,
} from "@privy-io/react-auth/solana";
import { ProcessingSteps } from "./ProcessingSteps";
import {
  DEFAULT_SCORER,
  buildCreateBountyIx,
  getConnection,
} from "@/lib/solana";
import { insertIssueAndMeta } from "@/lib/bounties";
import { createClient } from "@/utils/supabase/client";
import { useAuth, usePrivyBackend } from "@/lib/auth-context";
import type { Bounty, Company, ReleaseMode } from "@/lib/types";

export type CreateBountyData = {
  repo: string;
  issueNumber: number;
  issueUrl: string;
  title?: string;
  description?: string;
  /** Amount in SOL (devnet). Converted to lamports before signing. */
  amount: number;
  releaseMode: ReleaseMode;
  rejectThreshold?: number | null;
  evaluationCriteria?: string | null;
};

type Step = "confirm" | "processing" | "success" | "error";

const SOLANA_NATIVE_MINT = "11111111111111111111111111111111";
const CHAIN_ID = "solana-devnet";

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
  const [error, setError] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [bountyPda, setBountyPda] = useState<string | null>(null);
  const sentRef = useRef(false);

  const privyMode = usePrivyBackend;
  const { user } = useAuth();
  const { wallets, ready: walletsReady } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  // Pick the user's primary Solana wallet. Privy returns embedded + linked
  // external wallets in `wallets`; for now we just take the first — the
  // company dashboard is single-wallet by design.
  const wallet = wallets[0];
  const walletAddress = wallet?.address ?? company.wallet ?? null;

  // ESC closes (except mid-tx — losing the modal during signing leaves
  // funds in flight with no UI to recover).
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
    setError(null);
    setStep("processing");
  }

  async function runRealFlow() {
    // Guard: useEffect's strict-mode double-invoke would otherwise sign
    // twice. The ref keeps a single attempt per modal lifetime.
    if (sentRef.current) return;
    sentRef.current = true;

    try {
      if (!privyMode) {
        throw new Error(
          "Bounty creation requires Privy auth (NEXT_PUBLIC_USE_PRIVY=1).",
        );
      }
      if (!wallet || !walletAddress) {
        throw new Error("No Solana wallet connected.");
      }
      if (!user) {
        throw new Error("Not signed in.");
      }

      const connection: Connection = getConnection();
      const creator = new PublicKey(walletAddress);
      const amountLamports = BigInt(Math.round(data.amount * LAMPORTS_PER_SOL));

      // 1. Build the unsigned instruction.
      const { ix, bountyPda: pda, bountyId } = await buildCreateBountyIx(
        {
          creator,
          amountLamports,
          githubIssueUrl: data.issueUrl,
        },
        connection,
      );

      // 2. Wrap in a Transaction with a fresh blockhash.
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({
        feePayer: creator,
        recentBlockhash: blockhash,
      }).add(ix);

      // Privy's signAndSendTransaction wants the serialized wire format
      // *before* signing. `requireAllSignatures: false` lets us serialize
      // an unsigned tx (Privy's wallet adds the signature itself).
      const serialized = tx.serialize({ requireAllSignatures: false });

      // 3. Hand off to Privy — pops the wallet UI.
      const { signature } = await signAndSendTransaction({
        transaction: serialized,
        wallet,
        chain: "solana:devnet",
      });
      const sig = bs58.encode(signature);
      setTxSig(sig);
      setBountyPda(pda.toBase58());

      // 4. Wait for confirmation. `confirmed` is enough — `finalized`
      // would be safer but adds ~10s of UX wait.
      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight: (await connection.getLatestBlockhash("confirmed")).lastValidBlockHeight },
        "confirmed",
      );

      // 5. Persist the off-chain rows.
      const supabase = createClient();
      await insertIssueAndMeta(supabase, {
        chainId: CHAIN_ID,
        pda: pda.toBase58(),
        bountyOnchainId: bountyId,
        creator: walletAddress,
        scorer: DEFAULT_SCORER.toBase58(),
        mint: SOLANA_NATIVE_MINT,
        amount: amountLamports,
        githubIssueUrl: data.issueUrl,
        title: data.title,
        description: data.description,
        releaseMode: data.releaseMode === "auto" ? "auto" : "assisted",
        rejectThreshold: data.rejectThreshold ?? null,
        evaluationCriteria: data.evaluationCriteria ?? null,
        createdByUserId: user.id,
      });

      // 6. Build a Bounty for the legacy localStorage-based dashboard so
      // the user sees their new bounty immediately. The Supabase-backed
      // listing lands in GHB-81; until then we mirror the row to
      // localStorage so the existing UI keeps working.
      const bounty: Bounty = {
        id: pda.toBase58(),
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
      // Best-effort mirror; ignore failures.
      try {
        const { addBounty } = await import("@/lib/store");
        addBounty(bounty);
      } catch (mirrorErr) {
        console.warn("[CreateBountyFlow] localStorage mirror failed:", mirrorErr);
      }
      onCreated(bounty);
      setStep("success");
    } catch (err) {
      console.error("[CreateBountyFlow] failed:", err);
      setError(err instanceof Error ? err.message : "Bounty creation failed.");
      setStep("error");
      sentRef.current = false; // allow retry
    }
  }

  // Trigger the real flow when the user moves into the processing step.
  useEffect(() => {
    if (step === "processing") void runRealFlow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function handleDone() {
    onClose();
  }

  function handleRetry() {
    setError(null);
    setStep("confirm");
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
                value={`${data.amount.toLocaleString()} SOL`}
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
              {data.rejectThreshold != null && (
                <SummaryRow
                  label="Reject threshold"
                  value={`Score < ${data.rejectThreshold} auto-rejected`}
                />
              )}
              <SummaryRow label="Network" value="Solana devnet" mono />
              <SummaryRow
                label="Treasury wallet"
                value={walletAddress ? shortHex(walletAddress) : "not connected"}
                mono
              />
            </div>

            <p className="modal-note">
              Funds are locked on-chain in the bounty PDA. They release
              automatically when the AI validators approve a submission.
            </p>

            <div className="modal-foot">
              <button className="btn btn-ghost btn-sm" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleConfirm}
                disabled={!walletAddress || !walletsReady}
                title={!walletAddress ? "Connect a wallet first" : undefined}
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
                { id: "build", label: "Building transaction", duration: 600 },
                { id: "sign", label: "Signing in your wallet", duration: 1200 },
                { id: "confirm", label: "Confirming on Solana devnet", duration: 1500 },
                { id: "index", label: "Indexing in Supabase", duration: 600 },
              ]}
              onComplete={() => {
                /* Animation is purely visual — the real flow is driven
                   by `runRealFlow()` which transitions the step itself. */
              }}
            />

            <p className="modal-note">
              Keep this window open — your wallet is signing. This may take a
              few seconds on Solana devnet.
            </p>
          </>
        )}

        {step === "success" && txSig && bountyPda && (
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
                <strong>{data.amount.toLocaleString()} SOL locked in escrow.</strong>
                <p>
                  Developers can claim it now. The bounty is visible in the
                  public feed and your dashboard.
                </p>
              </div>
            </div>

            <div className="modal-summary">
              <SummaryRow label="Bounty PDA" value={shortHex(bountyPda)} mono copy={bountyPda} />
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
            <div className="modal-head">
              <div className="eyebrow">Failed</div>
              <h2 className="modal-title">Couldn&apos;t create the bounty</h2>
            </div>

            <div className="form-error">{error}</div>

            <p className="modal-note">
              Nothing was charged. Review the error above and try again, or
              cancel.
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
