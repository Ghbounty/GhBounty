import { describe, expect, test } from "vitest";

import { analyzeSubmission } from "../src/analyzer.js";

describe("analyzer (stub)", () => {
  test("returns the stub score unchanged", async () => {
    const result = await analyzeSubmission(
      {
        submissionPda: "FakePDA",
        prUrl: "https://github.com/x/y/pull/1",
        opusReportHash: new Uint8Array(32).fill(1),
      },
      7,
    );
    expect(result.score).toBe(7);
  });

  test("accepts any valid score value", async () => {
    for (const s of [1, 5, 10]) {
      const r = await analyzeSubmission(
        {
          submissionPda: "P",
          prUrl: "",
          opusReportHash: new Uint8Array(32),
        },
        s,
      );
      expect(r.score).toBe(s);
    }
  });
});
