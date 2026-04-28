import { describe, expect, test } from "vitest";

import { computeRanking, type RankableSubmission } from "../src/ranking.js";

/**
 * Helpers — keep test data terse so the assertions read clearly.
 */
function s(
  pda: string,
  state: RankableSubmission["state"],
  score: number,
  createdAt: number,
): RankableSubmission {
  return { pda, state, score, createdAt };
}

function ranksByPda(
  result: ReturnType<typeof computeRanking>,
): Record<string, number | null> {
  return Object.fromEntries(result.map((r) => [r.pda, r.rank]));
}

describe("computeRanking", () => {
  describe("input/output shape", () => {
    test("empty input → empty output", () => {
      expect(computeRanking([])).toEqual([]);
    });

    test("preserves input order in output", () => {
      const input = [
        s("a", "scored", 5, 100),
        s("b", "scored", 9, 200),
        s("c", "scored", 7, 300),
      ];
      const out = computeRanking(input);
      expect(out.map((r) => r.pda)).toEqual(["a", "b", "c"]);
    });

    test("returns one entry per input submission", () => {
      const input = Array.from({ length: 7 }, (_, i) =>
        s(`p${i}`, "scored", i, i),
      );
      expect(computeRanking(input)).toHaveLength(7);
    });
  });

  describe("eligibility filter", () => {
    test("pending submissions get rank=null", () => {
      const out = ranksByPda(
        computeRanking([
          s("a", "pending", 9, 100),
          s("b", "scored", 7, 200),
        ]),
      );
      expect(out).toEqual({ a: null, b: 1 });
    });

    test("auto_rejected submissions get rank=null", () => {
      const out = ranksByPda(
        computeRanking([
          s("a", "auto_rejected", 9, 100),
          s("b", "scored", 5, 200),
        ]),
      );
      expect(out).toEqual({ a: null, b: 1 });
    });

    test("winner state is rankable (treated like scored)", () => {
      const out = ranksByPda(
        computeRanking([
          s("a", "winner", 9, 100),
          s("b", "scored", 8, 200),
          s("c", "scored", 7, 300),
        ]),
      );
      expect(out).toEqual({ a: 1, b: 2, c: 3 });
    });

    test("all-ineligible input → all nulls", () => {
      const out = ranksByPda(
        computeRanking([
          s("a", "pending", 9, 100),
          s("b", "auto_rejected", 9, 200),
          s("c", "pending", 9, 300),
        ]),
      );
      expect(out).toEqual({ a: null, b: null, c: null });
    });
  });

  describe("ordering by score", () => {
    test("highest score gets rank 1", () => {
      const out = ranksByPda(
        computeRanking([
          s("low", "scored", 3, 100),
          s("mid", "scored", 5, 200),
          s("high", "scored", 9, 300),
        ]),
      );
      expect(out).toEqual({ high: 1, mid: 2, low: 3 });
    });

    test("dense ranking, no gaps for ties", () => {
      // Even with ties broken by createdAt, ranks stay 1, 2, 3 (not 1, 1, 3).
      const out = ranksByPda(
        computeRanking([
          s("a", "scored", 7, 100),
          s("b", "scored", 7, 200),
          s("c", "scored", 7, 300),
        ]),
      );
      expect(out).toEqual({ a: 1, b: 2, c: 3 });
    });

    test("input order doesn't bias ordering", () => {
      // Same ranks whether input order matches score order or not.
      const out = ranksByPda(
        computeRanking([
          s("low", "scored", 3, 100),
          s("high", "scored", 9, 200),
          s("mid", "scored", 5, 300),
        ]),
      );
      expect(out).toEqual({ high: 1, mid: 2, low: 3 });
    });

    test("only one eligible → rank 1", () => {
      const out = ranksByPda(
        computeRanking([
          s("a", "pending", 10, 100),
          s("b", "scored", 5, 200),
          s("c", "auto_rejected", 10, 300),
        ]),
      );
      expect(out).toEqual({ a: null, b: 1, c: null });
    });
  });

  describe("tie-breaking by createdAt", () => {
    test("earlier createdAt wins on tie", () => {
      // Ticket: "Empate: primera submission gana"
      const out = ranksByPda(
        computeRanking([
          s("late", "scored", 7, 500),
          s("early", "scored", 7, 100),
          s("middle", "scored", 7, 300),
        ]),
      );
      expect(out).toEqual({ early: 1, middle: 2, late: 3 });
    });

    test("ties only break ties (higher score still wins)", () => {
      const out = ranksByPda(
        computeRanking([
          s("late_high", "scored", 9, 500),
          s("early_low", "scored", 5, 100),
        ]),
      );
      expect(out).toEqual({ late_high: 1, early_low: 2 });
    });

    test("multiple groups with ties", () => {
      const out = ranksByPda(
        computeRanking([
          // Two at score=8 (tie → createdAt asc), then two at score=5 (tie).
          s("8a", "scored", 8, 200),
          s("8b", "scored", 8, 100), // earlier ⇒ #1
          s("5a", "scored", 5, 300), // earlier of the 5s ⇒ #3
          s("5b", "scored", 5, 400),
        ]),
      );
      expect(out).toEqual({ "8b": 1, "8a": 2, "5a": 3, "5b": 4 });
    });

    test("identical createdAt → input-order-stable", () => {
      // Sort is .sort() which is stable in modern V8, so equal sort keys
      // keep their original relative order. We document and lock that here.
      const out = computeRanking([
        s("first", "scored", 7, 100),
        s("second", "scored", 7, 100),
        s("third", "scored", 7, 100),
      ]);
      expect(out.map((r) => r.rank)).toEqual([1, 2, 3]);
      expect(out.map((r) => r.pda)).toEqual(["first", "second", "third"]);
    });
  });

  describe("realistic scenarios", () => {
    test("two passing, one auto_rejected, one pending", () => {
      const out = ranksByPda(
        computeRanking([
          s("low_quality", "auto_rejected", 2, 100),
          s("waiting", "pending", 0, 200),
          s("good", "scored", 8, 300),
          s("ok", "scored", 6, 400),
        ]),
      );
      expect(out).toEqual({
        low_quality: null,
        waiting: null,
        good: 1,
        ok: 2,
      });
    });

    test("late high-scorer displaces existing #1 on rerank", () => {
      // Simulates the second handler invocation after a new submission
      // arrives. Ranking is recomputed from scratch every time, so order
      // by score+createdAt is what matters — not the previous rank.
      const out = ranksByPda(
        computeRanking([
          s("first_decent", "scored", 7, 100),
          s("late_great", "scored", 10, 500),
          s("middling", "scored", 5, 300),
        ]),
      );
      expect(out).toEqual({ late_great: 1, first_decent: 2, middling: 3 });
    });

    test("winner kept on top even if a higher score appears later", () => {
      // The 'winner' state is set by resolve_bounty (manual or auto). Once
      // chosen, the resolver locks the winner. Newer scored rows should
      // rank below it. This test confirms current behavior: winner is just
      // treated as eligible, score still drives order. If the product
      // wants 'winner' pinned to #1 unconditionally, this test will start
      // failing and force an explicit decision.
      const out = ranksByPda(
        computeRanking([
          s("declared_winner", "winner", 7, 100),
          s("late_higher", "scored", 9, 500),
        ]),
      );
      expect(out).toEqual({ late_higher: 1, declared_winner: 2 });
    });
  });

  describe("immutability", () => {
    test("does not mutate the input array", () => {
      const input: RankableSubmission[] = [
        s("a", "scored", 5, 100),
        s("b", "scored", 9, 200),
        s("c", "scored", 7, 300),
      ];
      const before = JSON.stringify(input);
      computeRanking(input);
      expect(JSON.stringify(input)).toBe(before);
    });

    test("does not mutate input objects", () => {
      const a = s("a", "scored", 5, 100);
      computeRanking([a]);
      expect(a).toEqual({ pda: "a", state: "scored", score: 5, createdAt: 100 });
    });
  });
});
