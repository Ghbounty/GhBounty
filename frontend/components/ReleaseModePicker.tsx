"use client";

import type { ReleaseMode } from "@/lib/types";

export function ReleaseModePicker({
  value,
  onChange,
  compact = false,
}: {
  value: ReleaseMode;
  onChange: (v: ReleaseMode) => void;
  compact?: boolean;
}) {
  return (
    <div className={`release-picker ${compact ? "compact" : ""}`}>
      <button
        type="button"
        className={`release-opt ${value === "auto" ? "selected" : ""}`}
        onClick={() => onChange("auto")}
      >
        <span className="release-opt-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
          </svg>
        </span>
        <span className="release-opt-body">
          <span className="release-opt-title">
            Auto-release
            <span className="release-opt-check" />
          </span>
          <span className="release-opt-desc">
            Pay out instantly when AI validators approve the winning PR. Zero
            human intervention.
          </span>
        </span>
      </button>

      <button
        type="button"
        className={`release-opt ${value === "assisted" ? "selected" : ""}`}
        onClick={() => onChange("assisted")}
      >
        <span className="release-opt-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </span>
        <span className="release-opt-body">
          <span className="release-opt-title">
            AI-assisted review
            <span className="release-opt-check" />
          </span>
          <span className="release-opt-desc">
            Receive many PRs with AI scoring. You pick the winner and trigger
            the payout.
          </span>
        </span>
      </button>
    </div>
  );
}

export function ReleaseModeBadge({ mode }: { mode: ReleaseMode }) {
  return (
    <span className={`release-badge release-badge-${mode}`}>
      {mode === "auto" ? (
        <>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
          </svg>
          Auto-release
        </>
      ) : (
        <>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          AI-assisted
        </>
      )}
    </span>
  );
}
