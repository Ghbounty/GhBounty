"use client";

import {
  FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  closeBounty,
  deleteBounty,
  updateBounty,
} from "@/lib/store";
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
  const wrapRef = useRef<HTMLDivElement | null>(null);

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
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            onChanged();
          }}
        />
      )}

      {modal === "close" && (
        <ConfirmModal
          title="Close this bounty?"
          body={
            <>
              The bounty will stop accepting new PRs. Any pending submissions
              won&apos;t be paid out. Escrowed funds return to your treasury.
            </>
          }
          confirmLabel="Close bounty"
          danger={false}
          onCancel={() => setModal(null)}
          onConfirm={() => {
            closeBounty(bounty.id);
            setModal(null);
            onChanged();
          }}
        />
      )}

      {modal === "delete" && (
        <ConfirmModal
          title="Delete this bounty?"
          body={
            <>
              This permanently removes <code>{bounty.repo} #{bounty.issueNumber}</code>{" "}
              and any linked submissions from your dashboard. You can&apos;t undo this.
            </>
          }
          confirmLabel="Delete"
          danger
          onCancel={() => setModal(null)}
          onConfirm={() => {
            deleteBounty(bounty.id);
            setModal(null);
            onChanged();
          }}
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

  return (
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
    </div>
  );
}

function ConfirmModal({
  title,
  body,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={onCancel}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
        </div>
        <p className="modal-note">{body}</p>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
