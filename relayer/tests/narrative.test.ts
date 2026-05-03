import { describe, expect, it } from "vitest";
import { buildNarrativeReport, narrativeHash } from "../src/genlayer/narrative.js";
import type { OpusReport } from "../src/opus.js";

const sampleReport: OpusReport = {
  code_quality: {
    score: 7,
    reasoning:
      "The diff modifies 4 files cohesively. Cyclomatic complexity is 3 and naming follows the existing snake_case convention.",
  },
  test_coverage: {
    score: 5,
    reasoning:
      "No new tests were added. The PR is documentation-only so traditional coverage doesn't apply, but the absence is notable for a bounty submission.",
  },
  requirements_match: {
    score: 6,
    reasoning:
      "The PR adds the requested Quick Start section. Without seeing the linked issue we cannot fully verify the acceptance criteria, but the contribution appears aligned.",
  },
  security: {
    score: 6,
    reasoning:
      "No security impact. The change touches only documentation; no dependencies, code paths, or secrets are affected.",
  },
  summary:
    "Quick Start documentation addition. Useful but limited in scope — no code, no tests, no functional behavior changes. Score 6/10 reflects the small but positive contribution.",
};

describe("buildNarrativeReport", () => {
  it("includes all four dimension sections plus summary", () => {
    const out = buildNarrativeReport(sampleReport);
    expect(out).toContain("## Summary");
    expect(out).toContain("## Code Quality");
    expect(out).toContain("## Test Coverage");
    expect(out).toContain("## Requirements Match");
    expect(out).toContain("## Security");
  });

  it("strips ALL digit runs from reasoning + summary", () => {
    const out = buildNarrativeReport(sampleReport);
    // Source had "4 files", "3", "Score 6/10" — all numbers must be gone.
    expect(out).not.toMatch(/\b\d+\b/);
    expect(out).toContain("<n>"); // placeholder used at least once
  });

  it("does NOT mention the upstream evaluator (no anchoring)", () => {
    const out = buildNarrativeReport(sampleReport);
    expect(out.toLowerCase()).not.toContain("opus");
    expect(out.toLowerCase()).not.toContain("sonnet");
    expect(out.toLowerCase()).not.toContain("claude");
  });

  it("preserves the textual reasoning content", () => {
    const out = buildNarrativeReport(sampleReport);
    // Distinctive phrases from each section should survive.
    expect(out).toContain("snake_case convention");
    expect(out).toContain("documentation-only");
    expect(out).toContain("Quick Start section");
    expect(out).toContain("No security impact");
  });

  it("is deterministic — same input → same output", () => {
    const a = buildNarrativeReport(sampleReport);
    const b = buildNarrativeReport(sampleReport);
    expect(a).toBe(b);
  });

  it("collapses adjacent <n> tokens (ranges like 8-10 → <n>)", () => {
    const r: OpusReport = {
      ...sampleReport,
      code_quality: {
        score: 9,
        reasoning: "Score range 8-10 across all touched modules.",
      },
    };
    const out = buildNarrativeReport(r);
    expect(out).toContain("Score range <n> across");
    expect(out).not.toContain("<n>-<n>");
  });
});

describe("narrativeHash", () => {
  it("returns a 64-char hex sha256", () => {
    const h = narrativeHash("hello");
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is stable for the same string", () => {
    const a = narrativeHash("the quick brown fox");
    const b = narrativeHash("the quick brown fox");
    expect(a).toBe(b);
  });

  it("differs for any change", () => {
    const a = narrativeHash("a");
    const b = narrativeHash("b");
    expect(a).not.toBe(b);
  });
});
