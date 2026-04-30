"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import bs58 from "bs58";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  useSignAndSendTransaction,
  useWallets,
} from "@privy-io/react-auth/solana";
import {
  closeBounty as closeBountyMock,
  deleteBounty as deleteBountyMock,
  updateBounty,
} from "@/lib/store";
import { usePrivyBackend } from "@/lib/auth-context";
import { closeIssue, deleteIssueAndMeta } from "@/lib/bounties";
import { buildCancelBountyIx, getConnection } from "@/lib/solana";
import { createClient } from "@/utils/supabase/client";
import type { Bounty, ReleaseMode } from "@/lib/types";
import { ReleaseModePicker } from "./ReleaseModePicker";
import { UsdcIcon } from "./UsdcIcon";

export function BountyEditMenu({
  bounty,
  onChanged,
}: {
  bounty: Bounty;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<"edit" | "close" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  // Surface the on-chain phase so the modal button can swap from
  // "Cancelling on-chain…" → "Removing…" instead of just spinning blankly.
  const [phase, setPhase] = useState<"idle" | "cancelling" | "removing">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const privyMode = usePrivyBackend;
  const { wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isActionable = bounty.status !== "closed" && bounty.status !== "paid";

  // Memoize dismiss + confirm handlers so the modals' useEffect deps don't
  // see a fresh function reference on every render. Without this, opening
  // the modal triggers a tight re-register loop on the keydown listener
  // and toggles `body.style.overflow`, which combined with `.bounty-card:hover`
  // creating a containing block for `position: fixed` was producing the
  // "modal flickers and slides around the screen" bug.
  const dismissModal = useCallback(() => {
    if (busy) return;
    setModal(null);
    setError(null);
  }, [busy]);

  const onSaved = useCallback(() => {
    setModal(null);
    onChanged();
  }, [onChanged]);

  const onConfirmClose = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (privyMode) {
        const supabase = createClient();
        await closeIssue(supabase, bounty.id);
      } else {
        closeBountyMock(bounty.id);
      }
      setModal(null);
      onChanged();
    } catch (err) {
      console.error("[BountyEditMenu] close failed:", err);
      setError(err instanceof Error ? err.message : "Close failed.");
    } finally {
      setBusy(false);
    }
  }, [bounty.id, onChanged, privyMode]);

  // Delete = "cancel & forget":
  //   1. If the bounty is still Open on-chain, call `cancel_bounty` so the
  //      escrow returns to the creator's Privy wallet. This is the only way
  //      to recover the locked SOL — without it, deleting the row leaves the
  //      lamports stuck in the bounty PDA forever.
  //   2. Once the cancel is confirmed (or skipped because the bounty is
  //      already cancelled / resolved / not yet on-chain), remove the
  //      Supabase rows so the dashboard stops showing it.
  //
  // Mock mode (NEXT_PUBLIC_USE_PRIVY off) just hits the localStorage store.
  const onConfirmDelete = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (!privyMode) {
        deleteBountyMock(bounty.id);
        setModal(null);
        onChanged();
        return;
      }

      // 1) On-chain cancel — only meaningful if the bounty PDA exists and
      //    is still Open. Anything else (closed_by_user, resolved on-chain,
      //    cancelled previously, mock data without pda) skips straight to
      //    the off-chain cleanup.
      const canCancelOnChain = !!bounty.pda && bounty.status === "open";
      if (canCancelOnChain) {
        const wallet = wallets[0];
        if (!wallet) {
          throw new Error(
            "No Solana wallet connected. Reconnect Privy and try again.",
          );
        }
        setPhase("cancelling");
        const connection = getConnection();
        const creator = new PublicKey(wallet.address);
        const bountyPda = new PublicKey(bounty.pda as string);

        const ix = await buildCancelBountyIx(
          { creator, bountyPda },
          connection,
        );
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
        const sig = bs58.encode(signature);

        // `confirmTransaction` resolves even when the program reverted —
        // it stuffs the program error into `value.err`. Without this check
        // we'd "succeed" when the chain actually rejected the cancel.
        const conf = await connection.confirmTransaction(
          { signature: sig, blockhash, lastValidBlockHeight },
          "confirmed",
        );
        if (conf.value.err) {
          throw new Error(
            `cancel_bounty reverted on-chain: ${JSON.stringify(conf.value.err)}`,
          );
        }
      }

      // 2) Off-chain cleanup. RLS lets the creator delete their own meta,
      //    then the orphan-issue policy lets them delete the issue row.
      setPhase("removing");
      const supabase = createClient();
      await deleteIssueAndMeta(supabase, bounty.id);

      setModal(null);
      onChanged();
    } catch (err) {
      console.error("[BountyEditMenu] delete failed:", err);
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
      setPhase("idle");
    }
  }, [
    bounty.id,
    bounty.pda,
    bounty.status,
    onChanged,
    privyMode,
    signAndSendTransaction,
    wallets,
  ]);

  return (
    <>
      <div className="menu-wrap" ref={wrapRef}>
        <button
          type="button"
          className="menu-btn"
          aria-label="Bounty actions"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
        {open && (
          <div className="menu-dropdown" role="menu">
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setModal("edit");
                setOpen(false);
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              Edit bounty
            </button>
            {isActionable && (
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  setModal("close");
                  setOpen(false);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                Close bounty
              </button>
            )}
            <div className="menu-sep" />
            <button
              type="button"
              role="menuitem"
              className="menu-item danger"
              onClick={() => {
                setModal("delete");
                setOpen(false);
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
              Delete
            </button>
          </div>
        )}
      </div>

      {modal === "edit" && (
        <BountyEditModal
          bounty={bounty}
          onClose={dismissModal}
          onSaved={onSaved}
        />
      )}

      {modal === "close" && (
        <ConfirmModal
          title="Close this bounty?"
          body={
            <>
              The bounty will stop accepting new PRs. Closed bounties hide
              from the open feed but the on-chain escrow still holds the
              funds — call <code>cancel_bounty</code> to release them.
            </>
          }
          confirmLabel={busy ? "Closing…" : "Close bounty"}
          danger={false}
          busy={busy}
          error={error}
          onCancel={dismissModal}
          onConfirm={onConfirmClose}
        />
      )}

      {modal === "delete" && (
        <ConfirmModal
          title="Delete this bounty?"
          body={
            bounty.status === "open" ? (
              <>
                This will cancel the bounty on-chain and refund{" "}
                <strong>{bounty.amountUsdc} SOL</strong> to your Privy wallet,
                then remove <code>{bounty.repo} #{bounty.issueNumber}</code>{" "}
                from your dashboard. You&apos;ll be asked to sign one
                transaction. You can&apos;t undo this.
              </>
            ) : (
              <>
                This removes <code>{bounty.repo} #{bounty.issueNumber}</code>{" "}
                from your dashboard. The bounty is no longer Open on-chain,
                so no refund is owed. You can&apos;t undo this.
              </>
            )
          }
          confirmLabel={
            phase === "cancelling"
              ? "Cancelling on-chain…"
              : phase === "removing"
                ? "Removing…"
                : bounty.status === "open"
                  ? "Cancel & delete"
                  : "Delete"
          }
          danger
          busy={busy}
          error={error}
          onCancel={dismissModal}
          onConfirm={onConfirmDelete}
        />
      )}
    </>
  );
}

function BountyEditModal({
  bounty,
  onClose,
  onSaved,
}: {
  bounty: Bounty;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [releaseMode, setReleaseMode] = useState<ReleaseMode>(bounty.releaseMode);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = e.currentTarget;
    const title = (f.elements.namedItem("title") as HTMLInputElement).value.trim();
    const amountRaw = (f.elements.namedItem("amount") as HTMLInputElement).value;
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount < 1) {
      setError("Amount must be a positive number.");
      return;
    }
    updateBounty(bounty.id, {
      title: title || undefined,
      amountUsdc: Math.round(amount),
      releaseMode,
    });
    onSaved();
  }

  return modalPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="modal-head">
          <div className="eyebrow">Edit bounty</div>
          <h2 className="modal-title">
            <span className="mono-inline">{bounty.repo}</span>{" "}
            <span className="bounty-hash">#{bounty.issueNumber}</span>
          </h2>
        </div>

        <form className="auth-form" onSubmit={onSubmit}>
          <label className="field">
            <span className="field-label">Title</span>
            <input name="title" defaultValue={bounty.title ?? ""} placeholder="Short summary of the issue" />
          </label>

          <label className="field">
            <span className="field-label">
              Bounty amount <span className="musdc-inline">SOL</span>
            </span>
            <div className="field-with-icon">
              <span className="field-icon"><UsdcIcon size={18} /></span>
              <input
                name="amount"
                type="number"
                min={1}
                step={1}
                defaultValue={bounty.amountUsdc}
                required
              />
            </div>
            <span className="field-hint">
              You can increase the reward to attract stronger PRs. The extra
              amount is locked in escrow.
            </span>
          </label>

          <div className="field">
            <span className="field-label">Release mode</span>
            <ReleaseModePicker value={releaseMode} onChange={setReleaseMode} compact />
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="modal-foot">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save changes
            </button>
          </div>
        </form>
      </div>
    </div>,
  );
}

function ConfirmModal({
  title,
  body,
  confirmLabel,
  danger,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onCancel, busy]);

  // Render via portal to escape any ancestor that creates a containing
  // block for `position: fixed` (notably `.bounty-card:hover` adds a
  // `transform`, which breaks the modal's viewport-relative anchor and
  // causes the modal to flicker around the screen as the cursor moves).
  return modalPortal(
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <button
          className="modal-close"
          aria-label="Close"
          onClick={onCancel}
          disabled={busy}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
        </div>
        <p className="modal-note">{body}</p>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
  );
}

/**
 * Render the given modal tree at `document.body` so it escapes any
 * ancestor containing block (transform, filter, will-change, ...). On
 * the SSR pass `document` is undefined — we just render null until the
 * client mounts. Modals only matter post-mount anyway.
 */
function modalPortal(node: React.ReactElement): React.ReactPortal | null {
  if (typeof document === "undefined") return null;
  return createPortal(node, document.body);
}
