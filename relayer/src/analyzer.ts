import { log } from "./logger.js";

export interface AnalyzeInput {
  submissionPda: string;
  prUrl: string;
  opusReportHash: Uint8Array;
}

export interface AnalyzeResult {
  score: number;
}

/**
 * Stub analyzer. The real implementation (GHB-65) will:
 *   1. Fetch the PR diff from GitHub
 *   2. Send it through a Claude Opus prompt → structured report
 *   3. Pass that report to BountyJudge on GenLayer (GHB-58)
 *   4. Read the consensed verdict as the score
 *
 * Until then this returns a fixed score so the relayer loop can be
 * exercised end-to-end.
 */
export async function analyzeSubmission(
  input: AnalyzeInput,
  stubScore: number,
): Promise<AnalyzeResult> {
  log.debug("analyze (stub)", { submission: input.submissionPda, prUrl: input.prUrl });
  return { score: stubScore };
}
