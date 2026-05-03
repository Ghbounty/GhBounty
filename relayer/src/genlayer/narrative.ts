/**
 * GHB-58 second-opinion integration — narrative-report builder.
 *
 * Converts a structured `OpusReport` (with numeric scores per dimension)
 * into a flat narrative text suitable for the GenLayer BountyJudge
 * contract.
 *
 * Why strip numbers?
 *   - Anti-anchoring. If the contract sees "Opus scored security 6/10",
 *     the validators' own LLM calls anchor on that number and the
 *     democratic verdict collapses to a single-LLM echo. We confirmed
 *     this empirically in studionet (v0.4.0 → exact match on all 4
 *     axes; v0.5.0 with stripped numbers → independent divergence).
 *
 * Format we emit (mirrors the JUDGE_PROMPT_TEMPLATE in
 * `bounty_judge/contracts/bounty_judge.py`):
 *
 *     ## Summary
 *     <summary text>
 *
 *     ## Code Quality
 *     <reasoning text>
 *
 *     ## Test Coverage
 *     <reasoning text>
 *
 *     ## Requirements Match
 *     <reasoning text>
 *
 *     ## Security
 *     <reasoning text>
 *
 * No numbers, no model names ("Opus" / "Sonnet" / etc.), no meta
 * commentary. The contract's prompt does the rest of the framing.
 *
 * The output is deterministic given the same input, which keeps the
 * report hash chain stable (canonical-JSON hash on the structured side,
 * SHA-256 on the narrative side — see `narrativeHash` below).
 */

import { createHash } from "node:crypto";
import type { OpusReport } from "../opus.js";

/**
 * Strip all numeric tokens from a piece of free-form reasoning text.
 *
 * Defensive against an LLM that smuggles a score back into prose
 * (e.g. "I would rate this 7/10 because..."). We replace digit runs
 * with `<n>` so the structure of the sentence stays readable but the
 * actual number is gone.
 *
 * Tradeoff: this also strips legit numeric content like "Node 24+" or
 * "200 lines of code". For the bounty-judge use case that's fine —
 * the validator's job is to score the *quality*, not to verify counts.
 * If we ever need to preserve specific numbers, switch to a regex that
 * targets only "/10", "score", "rating" patterns.
 */
function scrubNumbers(text: string): string {
  return text
    // Replace any digit run with a placeholder. Aggressive but safe for
    // the bounty-judge prompt where numeric anchoring is the enemy.
    .replace(/\b\d+(\.\d+)?\b/g, "<n>")
    // Collapse repeated `<n>` introduced by ranges ("8-10" → "<n>-<n>",
    // "v0.5.0" → "v<n>.<n>.<n>") into one for readability.
    .replace(/<n>([\s/.\-]+<n>)+/g, "<n>")
    // Trim trailing whitespace introduced by replacements.
    .replace(/[ \t]+$/gm, "");
}

/**
 * Build the narrative report passed to the GenLayer contract.
 *
 * Headers are intentionally neutral — no "Opus analysis", no "the
 * upstream evaluator", nothing that hints at a prior verdict the
 * validator should defer to.
 */
export function buildNarrativeReport(report: OpusReport): string {
  const sections: string[] = [];
  sections.push("## Summary");
  sections.push(scrubNumbers(report.summary).trim());
  sections.push("");
  sections.push("## Code Quality");
  sections.push(scrubNumbers(report.code_quality.reasoning).trim());
  sections.push("");
  sections.push("## Test Coverage");
  sections.push(scrubNumbers(report.test_coverage.reasoning).trim());
  sections.push("");
  sections.push("## Requirements Match");
  sections.push(scrubNumbers(report.requirements_match.reasoning).trim());
  sections.push("");
  sections.push("## Security");
  sections.push(scrubNumbers(report.security.reasoning).trim());
  return sections.join("\n");
}

/**
 * SHA-256 of the narrative report. Used to:
 *   - Confirm the same narrative we sent to GenLayer is what we
 *     persisted in the DB (audit trail integrity).
 *   - Future-proof: a follow-up ticket may want to commit this hash
 *     onchain (Solana side) so the dev/company can verify the GenLayer
 *     contract saw the same text the relayer did.
 */
export function narrativeHash(narrative: string): string {
  return createHash("sha256").update(narrative, "utf8").digest("hex");
}
