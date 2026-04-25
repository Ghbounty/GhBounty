"use client";

import { useEffect, useRef, useState } from "react";

export type ProcessingStep = { id: string; label: string; duration?: number };

type Props = {
  steps: ProcessingStep[];
  onComplete: () => void;
};

export function ProcessingSteps({ steps, onComplete }: Props) {
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
    if (idx >= stepsRef.current.length) {
      const t = setTimeout(() => onCompleteRef.current(), 240);
      return () => clearTimeout(t);
    }
    const d = stepsRef.current[idx].duration ?? 700;
    const t = setTimeout(() => setIdx((i) => i + 1), d);
    return () => clearTimeout(t);
  }, [idx]);

  return (
    <ul className="processing-steps">
      {steps.map((s, i) => {
        const state = i < idx ? "done" : i === idx ? "active" : "pending";
        return (
          <li key={s.id} className={`processing-step ${state}`}>
            <span className="processing-step-mark">
              {state === "done" ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              ) : state === "active" ? (
                <span className="processing-spinner" aria-hidden />
              ) : (
                <span className="processing-dot" aria-hidden />
              )}
            </span>
            <span className="processing-step-label">{s.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
