"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import bs58 from "bs58";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  useSignAndSendTransaction,
  type ConnectedStandardSolanaWallet,
} from "@privy-io/react-auth/solana";
import { getConnection } from "@/lib/solana";

/**
 * Withdraw SOL from the user's Privy embedded wallet to an external
 * Solana address (typically a Phantom / Solflare wallet, but the form
 * accepts any valid base58 pubkey).
 *
 * No on-chain program is involved — it's a vanilla `SystemProgram.transfer`.
 * The Privy embedded wallet signs and sends through `useSignAndSendTransaction`.
 *
 * After confirmation we call `onWithdrawn` so the parent dashboard can
 * refresh the balance display (via the `tick`/`refreshKey` plumbing
 * shared with the delete-bounty refund flow).
 *
 * Fee headroom: we keep `FEE_RESERVE_LAMPORTS` lamports back from "Max"
 * because Solana charges ~5000 lamports per signature plus the transaction
 * cost; sending the full balance produces an "insufficient funds for fee"
 * error mid-flow, which is a confusing UX for a single-click action.
 */

const FEE_RESERVE_LAMPORTS = 5_000_000; // 0.005 SOL — generous

type Phase = "idle" | "building" | "signing" | "confirming";

export function WithdrawModal({
  wallet,
  balanceSol,
  onClose,
  onWithdrawn,
}: {
  wallet: ConnectedStandardSolanaWallet;
  balanceSol: number | null;
  onClose: () => void;
  onWithdrawn: () => void;
}) {
  const [recipient, setRecipient] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);

  const { signAndSendTransaction } = useSignAndSendTransaction();
  const busy = phase !== "idle";

  // Lock body scroll + ESC handler. Mid-tx the close is disabled — losing
  // the modal between sign and confirm leaves the user without a way to
  // see the result.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, busy]);

  const handleMax = useCallback(() => {
    if (balanceSol === null) return;
    const reserve = FEE_RESERVE_LAMPORTS / LAMPORTS_PER_SOL;
    const max = Math.max(0, balanceSol - reserve);
    setAmountStr(max.toFixed(6));
  }, [balanceSol]);

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);
      setTxSig(null);

      // Validate recipient — PublicKey throws on bad base58, which we
      // surface with a clear message instead of letting the wallet
      // popup fail mysteriously.
      let to: PublicKey;
      try {
        to = new PublicKey(recipient.trim());
      } catch {
        setError("Recipient must be a valid Solana address (base58).");
        return;
      }
      const fromAddress = wallet.address;
      if (to.toBase58() === fromAddress) {
        setError("Sending to the same wallet does nothing — pick a different address.");
        return;
      }

      const amount = Number(amountStr);
      if (!Number.isFinite(amount) || amount <= 0) {
        setError("Amount must be a positive number.");
        return;
      }
      if (balanceSol !== null && amount > balanceSol) {
        setError(
          `Amount exceeds wallet balance (${balanceSol.toFixed(4)} SOL).`,
        );
        return;
      }
      const lamports = Math.round(amount * LAMPORTS_PER_SOL);
      if (lamports <= 0) {
        setError("Amount is too small (rounded to 0 lamports).");
        return;
      }

      try {
        setPhase("building");
        const connection = getConnection();
        const from = new PublicKey(fromAddress);

        const ix = SystemProgram.transfer({
          fromPubkey: from,
          toPubkey: to,
          lamports,
        });
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");
        const tx = new Transaction({
          feePayer: from,
          recentBlockhash: blockhash,
        }).add(ix);
        const serialized = tx.serialize({ requireAllSignatures: false });

        setPhase("signing");
        const { signature } = await signAndSendTransaction({
          transaction: serialized,
          wallet,
          chain: "solana:devnet",
        });
        const sig = bs58.encode(signature);
        setTxSig(sig);

        setPhase("confirming");
        // `confirmTransaction` resolves on revert too — `value.err` carries
        // the program error. We treat any err as a failed withdraw and
        // surface it.
        const conf = await connection.confirmTransaction(
          { signature: sig, blockhash, lastValidBlockHeight },
          "confirmed",
        );
        if (conf.value.err) {
          throw new Error(
            `Transfer reverted: ${JSON.stringify(conf.value.err)}`,
          );
        }

        onWithdrawn();
        onClose();
      } catch (err) {
        console.error("[WithdrawModal] withdraw failed:", err);
        setError(err instanceof Error ? err.message : "Withdraw failed.");
      } finally {
        setPhase("idle");
      }
    },
    [
      amountStr,
      balanceSol,
      onClose,
      onWithdrawn,
      recipient,
      signAndSendTransaction,
      wallet,
    ],
  );

  const submitLabel =
    phase === "building"
      ? "Building transaction…"
      : phase === "signing"
        ? "Awaiting signature…"
        : phase === "confirming"
          ? "Confirming…"
          : "Withdraw";

  // Render at document.body so the modal isn't trapped by any ancestor
  // that creates a containing block (`.bounty-card:hover` adds a
  // `transform`, which would re-anchor `position: fixed` to the card and
  // produce the flickering modal we hit on the edit menu).
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div
        className="modal modal-narrow"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="modal-close"
          aria-label="Close"
          onClick={onClose}
          disabled={busy}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="modal-head">
          <div className="eyebrow">Withdraw</div>
          <h2 className="modal-title">Send SOL from your Privy wallet</h2>
        </div>

        <p className="modal-note">
          Move SOL from your in-app Privy wallet to any external Solana
          address (Phantom, Solflare, exchange deposit, etc.). Network
          fee (~0.000005 SOL) is paid by your Privy wallet.
        </p>

        <form className="auth-form" onSubmit={onSubmit}>
          <label className="field">
            <span className="field-label">Recipient address</span>
            <input
              name="recipient"
              type="text"
              placeholder="Solana address (base58)"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
              disabled={busy}
            />
          </label>

          <label className="field">
            <span className="field-label">Amount (SOL)</span>
            <div className="field-with-icon">
              <input
                name="amount"
                type="number"
                inputMode="decimal"
                step="0.0001"
                min={0}
                placeholder="0.10"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                required
                disabled={busy}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm field-trailing"
                onClick={handleMax}
                disabled={busy || balanceSol === null}
              >
                Max
              </button>
            </div>
            <span className="field-hint">
              Wallet balance:{" "}
              {balanceSol !== null ? `${balanceSol.toFixed(4)} SOL` : "—"}
              {balanceSol !== null && (
                <>
                  {" "}· keeps {(FEE_RESERVE_LAMPORTS / LAMPORTS_PER_SOL).toFixed(4)} SOL
                  back for network fees
                </>
              )}
            </span>
          </label>

          {error && <div className="form-error">{error}</div>}
          {txSig && !error && (
            <div className="form-hint">
              Sent — sig <code>{txSig.slice(0, 12)}…{txSig.slice(-6)}</code>
            </div>
          )}

          <div className="modal-foot">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy}
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
