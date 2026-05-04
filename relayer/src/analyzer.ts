import { log } from "./logger.js";
import {
  scorePR,
  type OpusReport,
  type PromptTestResult,
  type ScorePRDeps,
} from "./opus.js";

export type EvaluationSource = "stub" | "opus";

export interface AnalyzeInput {
  submissionPda: string;
  prUrl: string;
  opusReportHash: Uint8Array;
  /**
   * GHB-98: company-defined evaluation criteria from `bounty_meta.evaluation_criteria`.
   * Null/empty = relayer falls back to the default rubric.
   */
  evaluationCriteria?: string | null;
  /**
   * GHB-73: pre-flattened test execution result from the sandbox. The
   * submission handler maps the executor's discriminated union into this
   * stable shape; null means no useful data (sandbox disabled, infra
   * failure, no_runner, etc.) and Sonnet's prompt instructs it to
   * penalize `test_coverage` accordingly.
   */
  testResult?: PromptTestResult | null;
}

export interface AnalyzeResult {
  /** Score in [1,10] sent to set_score onchain. */
  score: number;
  source: EvaluationSource;
  /** Human-readable summary string for the evaluations.reasoning column. */
  reasoning: string;
  /** Full structured report for opus runs; null for stub. */
  report: OpusReport | null;
  /** sha256 of canonical-JSON report. Empty for stub. */
  reportHash: string;
}

export interface AnalyzerOptions {
  stubScore: number;
  anthropicApiKey: string | null;
  anthropicModel: string;
  /** For tests: inject mocks instead of hitting real APIs. */
  scorePRDeps?: Partial<Pick<ScorePRDeps, "fetchDiff" | "callLLM" | "maxDiffBytes">>;
}

function summarizeForLog(report: OpusReport, overall: number): string {
  return `overall=${overall} (cq=${report.code_quality.score} tc=${report.test_coverage.score} req=${report.requirements_match.score} sec=${report.security.score})`;
}

/**
 * Evaluate a submission. If `anthropicApiKey` is set, we ask Claude (Sonnet by
 * default, Opus once Founder Inc credits arrive) to produce a 4-dimension
 * structured report. Otherwise we fall back to the fixed stub score so the
 * loop still works in CI / local dev without burning API credits.
 *
 * The 4-section report is also the input GenLayer's BountyJudge will consume
 * (single exec_prompt; 215K-token window). Until BountyJudge unblocks, the
 * relayer uses the locally-computed `overall` as the onchain score.
 */
export async function analyzeSubmission(
  input: AnalyzeInput,
  opts: AnalyzerOptions,
): Promise<AnalyzeResult> {
  if (!opts.anthropicApiKey) {
    log.debug("analyze (stub: no ANTHROPIC_API_KEY)", {
      submission: input.submissionPda,
      prUrl: input.prUrl,
    });
    return {
      score: opts.stubScore,
      source: "stub",
      reasoning: "stub evaluator (no ANTHROPIC_API_KEY configured)",
      report: null,
      reportHash: "",
    };
  }

  try {
    const result = await scorePR(
      {
        prUrl: input.prUrl,
        evaluationCriteria: input.evaluationCriteria ?? null,
        testResult: input.testResult ?? null,
      },
      {
        apiKey: opts.anthropicApiKey,
        model: opts.anthropicModel,
        ...(opts.scorePRDeps ?? {}),
      },
    );
    log.info("analyze: opus result", {
      submission: input.submissionPda,
      summary: summarizeForLog(result.report, result.overall),
    });
    return {
      score: result.overall,
      source: "opus",
      reasoning: result.report.summary,
      report: result.report,
      reportHash: result.reportHash,
    };
  } catch (err) {
    log.error("opus scoring failed, falling back to stub", {
      submission: input.submissionPda,
      prUrl: input.prUrl,
      err: String(err),
    });
    return {
      score: opts.stubScore,
      source: "stub",
      reasoning: `opus scoring failed: ${String(err)}`,
      report: null,
      reportHash: "",
    };
  }
}
