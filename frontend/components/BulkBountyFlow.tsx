"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ProcessingSteps } from "./ProcessingSteps";
import { ReleaseModePicker } from "./ReleaseModePicker";
import { UsdcIcon } from "./UsdcIcon";
import { addBounty, uid } from "@/lib/store";
import { parseRepoUrl } from "@/lib/github";
import { analyzeRepo, type AnalyzedIssue, type Complexity } from "@/lib/aiMock";
import type { Bounty, Company, ReleaseMode } from "@/lib/types";

type Step = "input" | "analyzing" | "review" | "posting" | "success";

const COMPLEXITIES: Complexity[] = ["easy", "medium", "hard"];
const COMPLEXITY_LABEL: Record<Complexity, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

export function BulkBountyFlow({
  company,
  onClose,
  onCreated,
}: {
  company: Company;
  onClose: () => void;
  onCreated: (count: number) => void;
}) {
  const [step, setStep] = useState<Step>("input");
  const [repoInput, setRepoInput] = useState("");
  const [repo, setRepo] = useState<{ full: string; owner: string; repo: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<AnalyzedIssue[]>([]);
  const [releaseMode, setReleaseMode] = useState<ReleaseMode>("auto");
  const [posted, setPosted] = useState<{ count: number; total: number }>({
    count: 0,
    total: 0,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && step !== "analyzing" && step !== "posting") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, step]);

  const selected = useMemo(
    () => issues.filter((i) => i.included),
    [issues]
  );
  const total = useMemo(
    () => selected.reduce((s, i) => s + i.amount, 0),
    [selected]
  );

  function onAnalyze(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const parsed = parseRepoUrl(repoInput);
    if (!parsed) {
      setError("Paste a valid GitHub repo URL — https://github.com/owner/repo");
      return;
    }
    setRepo(parsed);
    setStep("analyzing");
  }

  function onAnalysisDone() {
    setIssues(analyzeRepo());
    setStep("review");
  }

  function toggle(id: string, included: boolean) {
    setIssues((items) =>
      items.map((i) => (i.id === id ? { ...i, included } : i))
    );
  }
  function changeComplexity(id: string, complexity: Complexity) {
    setIssues((items) =>
      items.map((i) => (i.id === id ? { ...i, complexity } : i))
    );
  }
  function changeAmount(id: string, amount: number) {
    setIssues((items) =>
      items.map((i) => (i.id === id ? { ...i, amount } : i))
    );
  }

  function onPostAll() {
    if (selected.length === 0) return;
    setStep("posting");
  }

  function onPostingDone() {
    if (!repo) return;
    const toPost = issues.filter((i) => i.included);
    for (const i of toPost) {
      const b: Bounty = {
        id: uid("b"),
        companyId: company.id,
        repo: repo.full,
        issueNumber: i.issueNumber,
        issueUrl: `https://github.com/${repo.full}/issues/${i.issueNumber}`,
        title: i.title,
        amountUsdc: Math.max(1, Math.round(i.amount)),
        status: "open",
        releaseMode,
        createdAt: Date.now() - Math.floor(Math.random() * 1000),
      };
      addBounty(b);
    }
    const countTotal = toPost.reduce((s, i) => s + Math.max(1, Math.round(i.amount)), 0);
    setPosted({ count: toPost.length, total: countTotal });
    setStep("success");
  }

  function handleDone() {
    onCreated(posted.count);
    onClose();
  }

  const locked = step === "analyzing" || step === "posting";

  return (
    <div className="modal-backdrop" onClick={locked ? undefined : onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        {!locked && (
          <button className="modal-close" aria-label="Close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}

        {step === "input" && (
          <>
            <div className="modal-head">
              <div className="eyebrow">
                <SparkIcon /> AI-assisted
              </div>
              <h2 className="modal-title">Bulk import from a public repo</h2>
            </div>
            <p className="modal-note">
              Paste any public GitHub repo. Our AI reads the issues, scores
              them by complexity and proposes a bounty amount for each — you
              review, tweak and post them all in one click.
            </p>
            <form onSubmit={onAnalyze} className="auth-form">
              <label className="field">
                <span className="field-label">Repository URL *</span>
                <div className="field-with-icon">
                  <span className="field-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.08c-3.2.7-3.87-1.37-3.87-1.37-.52-1.32-1.27-1.68-1.27-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.69 1.25 3.34.95.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.18a10.95 10.95 0 015.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.58.23 2.75.11 3.04.73.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.25 5.67.41.36.77 1.07.77 2.16v3.2c0 .31.21.68.8.56C20.21 21.38 23.5 17.07 23.5 12 23.5 5.65 18.35.5 12 .5z" />
                    </svg>
                  </span>
                  <input
                    type="url"
                    placeholder="https://github.com/owner/repo"
                    required
                    autoFocus
                    value={repoInput}
                    onChange={(e) => setRepoInput(e.target.value)}
                  />
                </div>
              </label>

              <div className="field">
                <span className="field-label">Release mode for this batch</span>
                <ReleaseModePicker value={releaseMode} onChange={setReleaseMode} />
              </div>

              {error && <div className="form-error">{error}</div>}

              <div className="modal-foot">
                <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!company.wallet}
                  title={!company.wallet ? "Connect a wallet first" : undefined}
                >
                  <SparkIcon /> Analyze repo
                </button>
              </div>
            </form>
          </>
        )}

        {step === "analyzing" && (
          <>
            <div className="modal-head">
              <div className="eyebrow">Analyzing</div>
              <h2 className="modal-title">
                Reading <span className="mono-inline">{repo?.full}</span>…
              </h2>
            </div>
            <ProcessingSteps
              steps={[
                { id: "c", label: "Cloning repository", duration: 700 },
                { id: "i", label: "Fetching open issues", duration: 900 },
                { id: "x", label: "Building codebase context", duration: 1100 },
                { id: "s", label: "Scoring complexity with Claude", duration: 1300 },
                { id: "p", label: "Proposing bounty amounts", duration: 700 },
              ]}
              onComplete={onAnalysisDone}
            />
            <p className="modal-note">This usually takes a few seconds.</p>
          </>
        )}

        {step === "review" && (
          <>
            <div className="modal-head">
              <div className="eyebrow">Review proposals</div>
              <h2 className="modal-title">
                {issues.length} issues found in{" "}
                <span className="mono-inline">{repo?.full}</span>
              </h2>
            </div>
            <p className="modal-note">
              Toggle issues you don&apos;t want to fund. Tweak the complexity
              and amount per issue — all numbers are editable.
            </p>

            <div className="bulk-table">
              <div className="bulk-table-head">
                <span className="bulk-col-chk" />
                <span className="bulk-col-issue">Issue</span>
                <span className="bulk-col-complex">Complexity</span>
                <span className="bulk-col-amount">SOL</span>
              </div>
              <div className="bulk-table-body">
                {issues.map((i) => (
                  <div
                    className={`bulk-row ${i.included ? "" : "excluded"}`}
                    key={i.id}
                  >
                    <label className="bulk-col-chk">
                      <input
                        type="checkbox"
                        checked={i.included}
                        onChange={(e) => toggle(i.id, e.target.checked)}
                      />
                      <span className="bulk-check" />
                    </label>
                    <div className="bulk-col-issue">
                      <span className="bulk-issue-num">#{i.issueNumber}</span>
                      <span className="bulk-issue-title">{i.title}</span>
                    </div>
                    <div className="bulk-col-complex">
                      <select
                        className={`complexity-select complexity-${i.complexity}`}
                        value={i.complexity}
                        onChange={(e) =>
                          changeComplexity(i.id, e.target.value as Complexity)
                        }
                        disabled={!i.included}
                      >
                        {COMPLEXITIES.map((c) => (
                          <option key={c} value={c}>
                            {COMPLEXITY_LABEL[c]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="bulk-col-amount">
                      <input
                        type="number"
                        min={1}
                        step={10}
                        value={i.amount}
                        onChange={(e) =>
                          changeAmount(i.id, Number(e.target.value) || 0)
                        }
                        disabled={!i.included}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bulk-total">
              <div className="bulk-total-left">
                <strong>{selected.length}</strong> selected ·{" "}
                {issues.length - selected.length} skipped
              </div>
              <div className="bulk-total-right">
                <span className="bulk-total-val">
                  {total.toLocaleString()}
                </span>
                <span className="musdc-pill">
                  SOL total
                </span>
              </div>
            </div>

            <div className="modal-foot">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={onPostAll}
                disabled={selected.length === 0}
              >
                Post {selected.length} bount{selected.length === 1 ? "y" : "ies"}
              </button>
            </div>
          </>
        )}

        {step === "posting" && (
          <>
            <div className="modal-head">
              <div className="eyebrow">Processing</div>
              <h2 className="modal-title">
                Posting {selected.length} bounties…
              </h2>
            </div>
            <ProcessingSteps
              steps={[
                { id: "w", label: "Connecting treasury wallet", duration: 500 },
                { id: "s", label: "Signing batch transaction", duration: 900 },
                {
                  id: "d",
                  label: `Deploying ${selected.length} escrow contracts`,
                  duration: 1400,
                },
                { id: "i", label: "Indexing on GH Bounty", duration: 500 },
              ]}
              onComplete={onPostingDone}
            />
            <p className="modal-note">Do not close this window.</p>
          </>
        )}

        {step === "success" && (
          <>
            <div className="modal-head">
              <div className="eyebrow">Success</div>
              <h2 className="modal-title">
                {posted.count} bounties posted!
              </h2>
            </div>
            <div className="modal-success">
              <div className="modal-success-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
              <div>
                <strong>
                  {posted.total.toLocaleString()} SOL locked in escrow across{" "}
                  {posted.count} issues.
                </strong>
                <p>
                  All bounties are now live on <span className="accent">{repo?.full}</span>.
                  Developers can start submitting PRs immediately.
                </p>
              </div>
            </div>
            <div className="modal-foot">
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

function SparkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, verticalAlign: "-2px" }}>
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
      <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z" />
    </svg>
  );
}
