"use client";

/**
 * ProcessingSteps — multi-step animation widget.
 *
 * Two modes:
 *
 * 1) **Mock / timer-driven** (default, no `currentStep` prop). Each step
 *    auto-advances after its `duration` (default 700ms). When the last step
 *    finishes, `onComplete` fires. Used by purely cosmetic flows where the
 *    real work hasn't been wired yet (e.g. `BulkBountyFlow`'s repo scan).
 *
 * 2) **Controlled** (pass `currentStep`). The caller drives which step is
 *    active by updating the prop as real work completes. No timers. Set
 *    `error` to mark the active step as failed (red X instead of spinner).
 *    Used by real chain flows (`CreateBountyFlow`, `SubmitPRModal`).
 *
 * Pre-GHB-169 the component was timer-only, which made real flows look
 * fake — the animation finished in ~4s regardless of how long signing or
 * confirmation actually took.
 */

import { useEffect, useRef, useState } from "react";

export type ProcessingStep = { id: string; label: string; duration?: number };

type Props = {
  steps: ProcessingStep[];
  /**
   * Controlled mode: zero-indexed current step. Steps before this index
   * render as "done", this step renders as "active" (or "error" if `error`
   * is true), steps after render as "pending". When undefined, the
   * component falls back to its timer-driven mock behavior.
   */
  currentStep?: number;
  /**
   * Mark the active step as failed (red X). Only meaningful in controlled
   * mode — ignored when the timer is driving transitions.
   */
  error?: boolean;
  /**
   * Fired only in mock mode when the last step finishes. Optional in
   * controlled mode (the caller already knows the flow is done).
   */
  onComplete?: () => void;
};

type StepState = "pending" | "active" | "done" | "error";

export function ProcessingSteps({ steps, currentStep, error, onComplete }: Props) {
  const controlled = currentStep !== undefined;

  /* ---- mock / timer mode ---------------------------------------- */
  const [idx, setIdx] = useState(0);
  const stepsRef = useRef(steps);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (controlled) return; // timers off in controlled mode
    if (idx >= stepsRef.current.length) {
      const t = setTimeout(() => onCompleteRef.current?.(), 240);
      return () => clearTimeout(t);
    }
    const d = stepsRef.current[idx].duration ?? 700;
    const t = setTimeout(() => setIdx((i) => i + 1), d);
    return () => clearTimeout(t);
  }, [idx, controlled]);

  /* ---- render --------------------------------------------------- */
  const cursor = controlled ? (currentStep as number) : idx;

  function stateFor(i: number): StepState {
    if (i < cursor) return "done";
    if (i === cursor) return controlled && error ? "error" : "active";
    return "pending";
  }

  return (
    <ul className="processing-steps">
      {steps.map((s, i) => {
        const state = stateFor(i);
        return (
          <li key={s.id} className={`processing-step ${state}`}>
            <span className="processing-step-mark">{renderMark(state)}</span>
            <span className="processing-step-label">{s.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

function renderMark(state: StepState) {
  if (state === "done") {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    );
  }
  if (state === "active") {
    return <span className="processing-spinner" aria-hidden />;
  }
  if (state === "error") {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    );
  }
  return <span className="processing-dot" aria-hidden />;
}
