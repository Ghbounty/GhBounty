import { type Db } from "@ghbounty/db";

import { analyzeSubmission, type AnalyzeResult } from "./analyzer.js";
import { type GenLayerConfig, type SandboxConfig } from "./config.js";
import {
  getBountyDisplayInfo,
  getEvaluationCriteria,
  getRejectThreshold,
  getSubmissionIdByPda,
  getSubmittedByUserId,
  insertEvaluation,
  insertNotification,
  isBountyOpenForSubmissions,
  markAutoRejected,
  markCapWarningSent,
  markScoredAndCheckCap,
  recomputeRanking,
  sendCapApproachingNotif,
  sendCapReachedNotif,
  upsertAutoRejectReview,
  upsertSubmission,
} from "./db/ops.js";
import {
  submitToBountyJudge,
  type BountyJudgeResult,
} from "./genlayer/client.js";
import { buildNarrativeReport } from "./genlayer/narrative.js";
import { log } from "./logger.js";
import { type PromptTestResult } from "./opus.js";
import { runSandboxedTests } from "./sandbox/index.js";
import type { ExecutorResult } from "./sandbox/index.js";
import { type ScorerClient } from "./scorer.js";
import { classifyByThreshold, type ThresholdOutcome } from "./threshold.js";
import { type DecodedSubmission } from "./watcher.js";

export interface SubmissionHandlerDeps {
  /** Optional DB; relayer can run without one in dev/CI. */
  db: Db | null;
  /** Onchain scorer that calls `set_score`. */
  scorer: Pick<ScorerClient, "setScore">;
  /** Chain id used when persisting the submission row. */
  chainId: string;
  /** Stub score returned when ANTHROPIC_API_KEY is unset. */
  stubScore: number;
  /** Anthropic key (null disables Opus path; relayer falls back to stub). */
  anthropicApiKey: string | null;
  anthropicModel: string;
  /**
   * GHB-58: GenLayer second-opinion config. Pass `null` to disable.
   * When the contract or key is unset, the handler skips the call
   * entirely and the evaluation row keeps `genlayer_*` null.
   */
  genlayer?: GenLayerConfig | null;
  /**
   * GHB-73: sandbox config (Fly machine spawn for in-PR test execution).
   * When `apiToken` or `appName` is unset the handler skips the spawn
   * and feeds Sonnet the "no test results available" prompt section.
   */
  sandbox?: SandboxConfig | null;
  /** For tests: inject the analyzer so we don't hit real APIs. */
  analyze?: typeof analyzeSubmission;
  /**
   * For tests: inject the GenLayer call so we don't hit a real chain.
   * Must match the shape of the real `submitToBountyJudge`.
   */
  callGenLayer?: typeof submitToBountyJudge;
  /**
   * For tests: inject the sandbox call so we don't spawn real Fly
   * machines. Must match the shape of the real `runSandboxedTests`.
   */
  runSandbox?: typeof runSandboxedTests;
}

export interface HandleSubmissionResult {
  score: number;
  outcome: ThresholdOutcome;
  threshold: number | null;
  source: AnalyzeResult["source"];
  txHash: string;
}

/**
 * Process a single submission end-to-end:
 *
 * 1. Persist the submission row (no-op if DB is absent).
 * 2. Run the analyzer (Opus or stub) to get a score.
 * 3. Send `set_score` onchain — onchain is the source of truth for the score.
 * 4. Decide off-chain whether the score passes the issue's reject threshold
 *    and update the submission state accordingly (`scored` vs `auto_rejected`).
 * 5. Insert the evaluation row with the full report.
 *
 * Steps 1, 4, and 5 are no-ops when `deps.db` is null.
 *
 * Extracted from `index.ts` so the threshold filter (GHB-95) and the
 * upstream pipeline can be exercised together in tests without spinning up
 * a real Solana cluster or hitting Anthropic.
 */
export async function handleSubmission(
  sub: DecodedSubmission,
  deps: SubmissionHandlerDeps,
): Promise<HandleSubmissionResult> {
  log.info("new submission detected", {
    submission: sub.pda.toBase58(),
    bounty: sub.bounty.toBase58(),
    solver: sub.solver.toBase58(),
    prUrl: sub.prUrl,
  });

  if (deps.db) {
    await upsertSubmission(deps.db, {
      chainId: deps.chainId,
      issuePda: sub.bounty.toBase58(),
      submissionPda: sub.pda.toBase58(),
      solver: sub.solver.toBase58(),
      submissionIndex: sub.submissionIndex,
      prUrl: sub.prUrl,
      opusReportHashHex: Buffer.from(sub.opusReportHash).toString("hex"),
    });

    // GHB-184: bail before Opus when the bounty was already closed by cap
    // (or cancelled on-chain). Saves an inference call and matches the
    // user-visible state ("Cap reached" → no scoring).
    const open = await isBountyOpenForSubmissions(deps.db, sub.bounty.toBase58());
    if (!open) {
      log.info("submission arrived after cap or closure; skipping scoring", {
        submission: sub.pda.toBase58(),
        bounty: sub.bounty.toBase58(),
      });
      await markAutoRejected(deps.db, sub.pda.toBase58());
      return {
        score: 0,
        outcome: "auto_rejected",
        threshold: null,
        source: "stub",
        txHash: "skipped-bounty-closed",
      };
    }
  }

  // GHB-98: pull company-defined evaluation criteria before analyzing so the
  // Opus prompt incorporates it. Falls back to the default rubric inside the
  // analyzer when null/empty.
  const criteria = deps.db
    ? await getEvaluationCriteria(deps.db, sub.bounty.toBase58())
    : null;

  // GHB-73: spin up the sandbox + run the PR's tests BEFORE asking Sonnet
  // to score, so Sonnet's prompt includes a real pass/fail signal. The
  // call is best-effort — any failure (disabled, infra, timeout,
  // git_error, install_error, no_runner) leaves `testResult` null and
  // the prompt then tells Sonnet to penalize `test_coverage` from the
  // diff alone.
  const testResult = await runSandboxIfEnabled(sub, deps);

  const analyze = deps.analyze ?? analyzeSubmission;
  const { score, source, reasoning, report, reportHash } = await analyze(
    {
      submissionPda: sub.pda.toBase58(),
      prUrl: sub.prUrl,
      opusReportHash: sub.opusReportHash,
      evaluationCriteria: criteria,
      testResult,
    },
    {
      stubScore: deps.stubScore,
      anthropicApiKey: deps.anthropicApiKey,
      anthropicModel: deps.anthropicModel,
    },
  );

  // ── Threshold + auto-reject mark FIRST ─────────────────────────────────
  //
  // Bug we're fixing: we used to call `setScore` first, then mark the
  // submission auto_rejected. If `setScore` threw (UnauthorizedScorer on
  // bounties created with a stale scorer pubkey, devnet RPC blip, etc.)
  // the handler crashed and NEVER wrote the auto_rejected flag — the
  // company's review modal kept showing low-score PRs forever because
  // `submission_reviews.auto_rejected = false` (default).
  //
  // Now we compute the outcome + write the off-chain mark BEFORE the
  // on-chain call. The off-chain mark is what the company UI reads;
  // the on-chain set_score is for the program's view of the world. The
  // two are independent — failing one doesn't and shouldn't unmark the
  // other.
  let threshold: number | null = null;
  let outcome: ThresholdOutcome = "pass";
  if (deps.db) {
    threshold = await getRejectThreshold(deps.db, sub.bounty.toBase58());
    outcome = classifyByThreshold(score, threshold);
    if (outcome === "auto_rejected") {
      log.info("submission auto-rejected by threshold", {
        submission: sub.pda.toBase58(),
        score,
        threshold,
      });
      await markAutoRejected(deps.db, sub.pda.toBase58());
    } else {
      // GHB-184: atomic claim. The CTE bumps review_eligible_count and (if
      // we just hit the cap) stamps closed_by_cap_at. A race-loser receives
      // applied=false; we then auto_reject so the dev sees a coherent outcome.
      const cap = await markScoredAndCheckCap(
        deps.db,
        sub.pda.toBase58(),
        sub.bounty.toBase58(),
      );
      if (!cap.applied) {
        log.info("cap reached; submission auto_rejected post-scoring", {
          submission: sub.pda.toBase58(),
          bounty: sub.bounty.toBase58(),
        });
        await markAutoRejected(deps.db, sub.pda.toBase58());
        outcome = "auto_rejected";
      } else if (
        cap.justClosed &&
        cap.bountyOwnerUserId &&
        cap.issueId &&
        typeof cap.maxSubmissions === "number"
      ) {
        log.info("bounty closed by cap", {
          bounty: sub.bounty.toBase58(),
          max: cap.maxSubmissions,
        });
        try {
          await sendCapReachedNotif(deps.db, {
            bountyOwnerUserId: cap.bountyOwnerUserId,
            issueId: cap.issueId,
            bountyTitle: cap.bountyTitle ?? null,
            maxSubmissions: cap.maxSubmissions,
          });
        } catch (err) {
          log.warn("cap_reached notif failed", {
            bounty: sub.bounty.toBase58(),
            err: String(err),
          });
        }
      } else if (
        cap.applied &&
        typeof cap.maxSubmissions === "number" &&
        cap.maxSubmissions > 0 &&
        cap.capWarningSentAt === null &&
        typeof cap.reviewEligibleCount === "number" &&
        cap.reviewEligibleCount >= Math.ceil(cap.maxSubmissions * 0.8) &&
        cap.reviewEligibleCount < cap.maxSubmissions &&
        cap.bountyOwnerUserId &&
        cap.issueId
      ) {
        // 80% crossed for the first time. Ping the company once.
        try {
          await sendCapApproachingNotif(deps.db, {
            bountyOwnerUserId: cap.bountyOwnerUserId,
            issueId: cap.issueId,
            bountyTitle: cap.bountyTitle ?? null,
            reviewEligibleCount: cap.reviewEligibleCount,
            maxSubmissions: cap.maxSubmissions,
          });
          await markCapWarningSent(deps.db, cap.issueId);
        } catch (err) {
          log.warn("cap_approaching notif failed", {
            bounty: sub.bounty.toBase58(),
            err: String(err),
          });
        }
      }
    }
  }

  // Race: another relayer instance (typically the deployed one on
  // Railway/Fly while local dev is also running) may have called
  // `set_score` while we were busy with Sonnet. The Anchor program rejects
  // the second writer with `ScoreAlreadySet` (error 6006), but the on-chain
  // score is already there, so we don't actually lose the chain side. The
  // DB writes + GHB-92 notifications still need to happen — without this
  // catch, the handler throws and the notif never fires.
  let txHash: string;
  try {
    txHash = await deps.scorer.setScore(sub.bounty, sub.pda, score);
  } catch (err) {
    const msg = String(err);
    if (msg.includes("ScoreAlreadySet") || msg.includes("Error Number: 6006")) {
      log.info("set_score raced — on-chain already scored, continuing to DB", {
        submission: sub.pda.toBase58(),
        ourScore: score,
      });
      txHash = "raced"; // sentinel; insertEvaluation just persists it as a string
    } else if (msg.includes("UnauthorizedScorer") || msg.includes("Error Number: 6007")) {
      // Bounty was created by a frontend pointing at a different scorer
      // pubkey (legacy config). On-chain we can never write the score —
      // but the off-chain auto-reject mark above DID land, which is
      // what the UI cares about. Log + persist a sentinel tx_hash so
      // the eval row still gets written and downstream notifications
      // fire normally.
      log.warn("set_score blocked by UnauthorizedScorer — on-chain score skipped", {
        submission: sub.pda.toBase58(),
        bounty: sub.bounty.toBase58(),
      });
      txHash = "unauthorized_scorer";
    } else {
      throw err;
    }
  }

  if (deps.db) {
    // GHB-58: ask GenLayer's BountyJudge for a second opinion. Only
    // makes sense when we have a structured report (Opus path) — stub
    // evaluations have nothing to forward. Best-effort: a failure or
    // timeout doesn't undo the Sonnet score, it just leaves the
    // genlayer_* columns null and we surface the reason in the log.
    let genlayerVerdict: BountyJudgeResult | null = null;
    if (
      report &&
      deps.genlayer?.bountyJudgeContract &&
      deps.genlayer.privateKey
    ) {
      const narrative = buildNarrativeReport(report);
      const callGenLayer = deps.callGenLayer ?? submitToBountyJudge;
      try {
        genlayerVerdict = await callGenLayer(
          deps.genlayer,
          sub.pda.toBase58(),
          narrative,
        );
        if (genlayerVerdict.outcome === "success") {
          log.info("genlayer second opinion landed", {
            submission: sub.pda.toBase58(),
            sonnetScore: score,
            genlayerScore: genlayerVerdict.score,
            txHash: genlayerVerdict.txHash,
          });
        } else {
          log.warn("genlayer second opinion did not settle", {
            submission: sub.pda.toBase58(),
            outcome: genlayerVerdict.outcome,
            message: genlayerVerdict.message,
          });
        }
      } catch (err) {
        log.warn("genlayer call threw", {
          submission: sub.pda.toBase58(),
          err: String(err),
        });
      }
    }

    await insertEvaluation(deps.db, {
      submissionPda: sub.pda.toBase58(),
      source,
      score,
      reasoning,
      report,
      reportHash,
      txHash,
      genlayer:
        genlayerVerdict?.outcome === "success"
          ? {
              score: genlayerVerdict.score,
              status: genlayerVerdict.status,
              dimensions: genlayerVerdict.dimensions,
              txHash: genlayerVerdict.txHash,
            }
          : null,
    });
    // GHB-96: rerank the issue's submissions. A newly-scored entry can
    // displace an existing #1, and an auto_rejected one needs its old rank
    // cleared (computeRanking returns null for non-eligible rows).
    await recomputeRanking(deps.db, sub.bounty.toBase58());

    // GHB-92: ring the dev's bell. Two kinds depending on the threshold
    // outcome — auto_rejected gets the gray "below threshold" notif,
    // pass gets the teal "evaluation ready" one. Best-effort: a missing
    // recipient (legacy submission with no submission_meta row) or a
    // failed insert just logs and moves on.
    try {
      await emitEvaluationNotifications(deps.db, sub.pda.toBase58(), {
        score,
        outcome,
        threshold,
        bountyPda: sub.bounty.toBase58(),
      });
    } catch (err) {
      log.warn("notification emit failed", {
        submission: sub.pda.toBase58(),
        err: String(err),
      });
    }
  }

  return { score, outcome, threshold, source, txHash };
}

/**
 * Side-effect: writes the "PR evaluated" / "PR auto-rejected" rows into
 * `notifications` so the dev's bell rings. Also writes the
 * `submission_reviews` row for the auto-rejected case (the off-chain
 * mirror the frontend's GHB-85 toggle reads).
 *
 * Pulled out of `handleSubmission` so the main flow stays linear and
 * the notif logic can be tested in isolation if needed.
 */
async function emitEvaluationNotifications(
  db: NonNullable<SubmissionHandlerDeps["db"]>,
  submissionPda: string,
  ctx: {
    score: number;
    outcome: ThresholdOutcome;
    threshold: number | null;
    bountyPda: string;
  },
): Promise<void> {
  // Need the frontend uuid (notifications.submission_id) and the dev's
  // Privy DID. Both can be missing on legacy rows — bail quietly.
  const [submissionId, recipientUserId, bountyInfo] = await Promise.all([
    getSubmissionIdByPda(db, submissionPda),
    getSubmittedByUserId(db, submissionPda),
    getBountyDisplayInfo(db, ctx.bountyPda),
  ]);
  if (!submissionId) {
    log.debug("notif skipped: no submissions row by pda", { submissionPda });
    return;
  }
  if (!recipientUserId) {
    log.debug("notif skipped: no submitted_by_user_id", { submissionPda });
    return;
  }

  // SOL_DECIMALS=9: convert raw lamports to display SOL for the payload.
  // Mirrors the frontend's parseGithubPrUrl/rowToBounty arithmetic so the
  // bell shows the same "X SOL" the dashboard does.
  const amountRaw =
    typeof bountyInfo?.amount === "string"
      ? Number(bountyInfo.amount)
      : bountyInfo?.amount ?? 0;
  const bountyAmount = amountRaw / 1e9;
  const sharedPayload = {
    bountyTitle: bountyInfo?.title ?? undefined,
    bountyAmount: bountyAmount > 0 ? bountyAmount : undefined,
    // GHB-127: persist a snapshot of the company branding on the notif
    // so the bell renders the right logo + name without joining at read
    // time. Snapshot semantics: if the company later changes their logo
    // the existing notif keeps the old one (acceptable historical record).
    companyId: bountyInfo?.companyId ?? undefined,
    companyName: bountyInfo?.companyName ?? undefined,
    companyAvatarUrl: bountyInfo?.companyAvatarUrl ?? undefined,
  };

  if (ctx.outcome === "auto_rejected") {
    const reason =
      ctx.threshold != null
        ? `Score ${ctx.score}/10 below threshold ${ctx.threshold}`
        : `Score ${ctx.score}/10 below the bounty's threshold`;
    // Mirror the off-chain auto-reject row first so the company-side
    // SubmissionsListModal toggle picks it up the moment the bell rings.
    await upsertAutoRejectReview(db, submissionId, reason);
    await insertNotification(db, {
      userId: recipientUserId,
      kind: "submission_auto_rejected",
      submissionId,
      payload: {
        ...sharedPayload,
        score: ctx.score,
        threshold: ctx.threshold ?? undefined,
      },
    });
    return;
  }

  // Pass: just an "evaluation ready" ping with the score.
  await insertNotification(db, {
    userId: recipientUserId,
    kind: "submission_evaluated",
    submissionId,
    payload: {
      ...sharedPayload,
      score: ctx.score,
    },
  });
}

// ── GHB-73: sandbox orchestration ─────────────────────────────────────

/**
 * Run the PR through the sandbox executor and flatten the result into
 * the shape Sonnet's prompt builder consumes. Returns `null` on any
 * non-success outcome (and on any thrown exception) — the analyzer
 * then renders the "no test results available" prompt section.
 *
 * Why null on failure (rather than a failure-flavored PromptTestResult):
 *   - Keeps the prompt section's two paths cleanly separated: "we ran
 *     and here's what happened" vs "we couldn't run".
 *   - Infra / disabled / timeout aren't the developer's fault and we
 *     don't want Sonnet to confuse "tests failed" with "we couldn't
 *     execute tests". Both pull `test_coverage` down, but for very
 *     different reasons. The handler logs the distinction.
 */
async function runSandboxIfEnabled(
  sub: DecodedSubmission,
  deps: SubmissionHandlerDeps,
): Promise<PromptTestResult | null> {
  if (!deps.sandbox || !deps.sandbox.apiToken || !deps.sandbox.appName) {
    log.debug("sandbox skipped: not configured", {
      submission: sub.pda.toBase58(),
    });
    return null;
  }
  const parsed = parseGithubPrUrl(sub.prUrl);
  if (!parsed) {
    log.warn("sandbox skipped: unparseable PR URL", {
      submission: sub.pda.toBase58(),
      prUrl: sub.prUrl,
    });
    return null;
  }

  const runSandbox = deps.runSandbox ?? runSandboxedTests;
  let result: ExecutorResult;
  try {
    result = await runSandbox(deps.sandbox, {
      // We default to "main" because the runner only consumes baseRef
      // for `git init -b` — the actual fetch is `pull/N/head` which is
      // independent of the base branch. Saves a GitHub API roundtrip.
      repoUrl: `https://github.com/${parsed.owner}/${parsed.repo}.git`,
      baseRef: "main",
      prNumber: parsed.prNumber,
    });
  } catch (err) {
    // Defensive — runSandboxedTests is documented as "never throws for
    // expected failure modes" but if it somehow does, we don't want it
    // to take down the whole submission.
    log.warn("sandbox call threw", {
      submission: sub.pda.toBase58(),
      prUrl: sub.prUrl,
      err: String(err),
    });
    return null;
  }

  return executorResultToPromptShape(result, sub.pda.toBase58());
}

/**
 * Map ExecutorResult discriminated union → PromptTestResult, with full
 * structured logging at this seam so ops can trace any submission's
 * sandbox outcome without re-parsing prompt strings.
 *
 * Only `kind: "exited"` produces a non-null result — everything else
 * returns null so the prompt's "no test results" path fires (see
 * runSandboxIfEnabled doc for why).
 */
function executorResultToPromptShape(
  result: ExecutorResult,
  submissionPda: string,
): PromptTestResult | null {
  switch (result.kind) {
    case "exited": {
      const detail =
        result.exitCode === 0
          ? `tests passed (exit code 0)`
          : `tests failed (exit code ${result.exitCode ?? "unknown"})`;
      log.info("sandbox: exited", {
        submission: submissionPda,
        runner: result.runner.kind,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      });
      return {
        status: result.exitCode === 0 ? "passed" : "failed",
        runner: result.runner.kind,
        durationMs: result.durationMs,
        detail,
        outputTail: combineOutputTails(result.stdoutTail, result.stderrTail),
      };
    }
    case "timeout":
      log.warn("sandbox: timeout", {
        submission: submissionPda,
        phase: result.phase,
        runner: result.runner.kind,
        durationMs: result.durationMs,
      });
      return null;
    case "install_error":
      log.warn("sandbox: install_error", {
        submission: submissionPda,
        runner: result.runner.kind,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      });
      return null;
    case "git_error":
      log.warn("sandbox: git_error", {
        submission: submissionPda,
        reason: result.reason,
        durationMs: result.durationMs,
      });
      return null;
    case "no_runner":
      log.info("sandbox: no_runner — repo has no detectable test markers", {
        submission: submissionPda,
        durationMs: result.durationMs,
      });
      return null;
    case "disabled":
      log.debug("sandbox: disabled", {
        submission: submissionPda,
        reason: result.reason,
      });
      return null;
    case "infra":
      log.warn("sandbox: infra error", {
        submission: submissionPda,
        reason: result.reason,
        durationMs: result.durationMs,
      });
      return null;
  }
}

function combineOutputTails(stdout: string, stderr: string): string | null {
  const out = stdout?.trim() ?? "";
  const err = stderr?.trim() ?? "";
  if (!out && !err) return null;
  if (!err) return out;
  if (!out) return err;
  return `--- stdout (tail) ---\n${out}\n--- stderr (tail) ---\n${err}`;
}

/**
 * Parse a GitHub PR URL into the parts the SandboxSpec needs. Returns
 * null on shapes we don't recognize so the caller can skip the sandbox
 * cleanly (e.g. legacy submissions with non-GitHub URLs).
 */
function parseGithubPrUrl(
  url: string,
): { owner: string; repo: string; prNumber: number } | null {
  const m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (!m) return null;
  const [, owner, repo, num] = m;
  const prNumber = Number(num);
  if (!Number.isInteger(prNumber) || prNumber <= 0) return null;
  return { owner: owner!, repo: repo!.replace(/\.git$/, ""), prNumber };
}
