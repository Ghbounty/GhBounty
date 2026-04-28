import { type Db } from "@ghbounty/db";

import { analyzeSubmission, type AnalyzeResult } from "./analyzer.js";
import {
  getEvaluationCriteria,
  getRejectThreshold,
  insertEvaluation,
  markAutoRejected,
  markScored,
  recomputeRanking,
  upsertSubmission,
} from "./db/ops.js";
import { log } from "./logger.js";
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
  /** For tests: inject the analyzer so we don't hit real APIs. */
  analyze?: typeof analyzeSubmission;
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
  }

  // GHB-98: pull company-defined evaluation criteria before analyzing so the
  // Opus prompt incorporates it. Falls back to the default rubric inside the
  // analyzer when null/empty.
  const criteria = deps.db
    ? await getEvaluationCriteria(deps.db, sub.bounty.toBase58())
    : null;

  const analyze = deps.analyze ?? analyzeSubmission;
  const { score, source, reasoning, report, reportHash } = await analyze(
    {
      submissionPda: sub.pda.toBase58(),
      prUrl: sub.prUrl,
      opusReportHash: sub.opusReportHash,
      evaluationCriteria: criteria,
    },
    {
      stubScore: deps.stubScore,
      anthropicApiKey: deps.anthropicApiKey,
      anthropicModel: deps.anthropicModel,
    },
  );

  const txHash = await deps.scorer.setScore(sub.bounty, sub.pda, score);

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
      await markScored(deps.db, sub.pda.toBase58());
    }
    await insertEvaluation(deps.db, {
      submissionPda: sub.pda.toBase58(),
      source,
      score,
      reasoning,
      report,
      reportHash,
      txHash,
    });
    // GHB-96: rerank the issue's submissions. A newly-scored entry can
    // displace an existing #1, and an auto_rejected one needs its old rank
    // cleared (computeRanking returns null for non-eligible rows).
    await recomputeRanking(deps.db, sub.bounty.toBase58());
  }

  return { score, outcome, threshold, source, txHash };
}
