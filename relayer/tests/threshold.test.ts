import { describe, expect, test } from "vitest";

import { classifyByThreshold } from "../src/threshold.js";

describe("classifyByThreshold", () => {
  describe("no threshold configured", () => {
    test("returns 'pass' when threshold is null", () => {
      expect(classifyByThreshold(1, null)).toBe("pass");
      expect(classifyByThreshold(5, null)).toBe("pass");
      expect(classifyByThreshold(10, null)).toBe("pass");
    });

    test("returns 'pass' when threshold is undefined", () => {
      expect(classifyByThreshold(1, undefined)).toBe("pass");
      expect(classifyByThreshold(5, undefined)).toBe("pass");
      expect(classifyByThreshold(10, undefined)).toBe("pass");
    });

    test("treats NaN/Infinity threshold as unset (defensive)", () => {
      expect(classifyByThreshold(1, Number.NaN)).toBe("pass");
      expect(classifyByThreshold(1, Number.POSITIVE_INFINITY)).toBe("pass");
      expect(classifyByThreshold(1, Number.NEGATIVE_INFINITY)).toBe("pass");
    });
  });

  describe("threshold configured", () => {
    test("score below threshold → 'auto_rejected'", () => {
      expect(classifyByThreshold(4, 5)).toBe("auto_rejected");
      expect(classifyByThreshold(1, 6)).toBe("auto_rejected");
      expect(classifyByThreshold(9, 10)).toBe("auto_rejected");
    });

    test("score equal to threshold → 'pass' (strict <)", () => {
      // Ticket: "if score < reject_threshold ... auto_rejected"
      expect(classifyByThreshold(5, 5)).toBe("pass");
      expect(classifyByThreshold(7, 7)).toBe("pass");
      expect(classifyByThreshold(10, 10)).toBe("pass");
    });

    test("score above threshold → 'pass'", () => {
      expect(classifyByThreshold(6, 5)).toBe("pass");
      expect(classifyByThreshold(10, 1)).toBe("pass");
      expect(classifyByThreshold(8, 7)).toBe("pass");
    });
  });

  describe("threshold extremes", () => {
    test("threshold=1: only score 0 or below auto-rejects (in practice never fires for valid scores)", () => {
      // Valid scores are [1, 10]; threshold=1 means "accept everything ≥ 1".
      expect(classifyByThreshold(1, 1)).toBe("pass");
      expect(classifyByThreshold(5, 1)).toBe("pass");
      expect(classifyByThreshold(10, 1)).toBe("pass");
    });

    test("threshold=10: only a perfect 10 passes", () => {
      expect(classifyByThreshold(9, 10)).toBe("auto_rejected");
      expect(classifyByThreshold(10, 10)).toBe("pass");
    });

    test("score=1 (the minimum): rejects against any threshold > 1", () => {
      // Penalty path in analyzer can collapse overall to 1 (security ≤ 2).
      // Any non-trivial threshold should auto-reject these.
      expect(classifyByThreshold(1, 2)).toBe("auto_rejected");
      expect(classifyByThreshold(1, 5)).toBe("auto_rejected");
      expect(classifyByThreshold(1, 10)).toBe("auto_rejected");
      // …but threshold=1 still passes a 1.
      expect(classifyByThreshold(1, 1)).toBe("pass");
    });
  });

  describe("realistic scenarios", () => {
    test("typical company picks threshold=6 (moderate filter)", () => {
      expect(classifyByThreshold(5, 6)).toBe("auto_rejected");
      expect(classifyByThreshold(6, 6)).toBe("pass");
      expect(classifyByThreshold(7, 6)).toBe("pass");
    });

    test("strict company picks threshold=8", () => {
      expect(classifyByThreshold(7, 8)).toBe("auto_rejected");
      expect(classifyByThreshold(8, 8)).toBe("pass");
    });

    test("permissive company picks threshold=3", () => {
      expect(classifyByThreshold(2, 3)).toBe("auto_rejected");
      expect(classifyByThreshold(3, 3)).toBe("pass");
      expect(classifyByThreshold(10, 3)).toBe("pass");
    });
  });

  describe("input typing safety", () => {
    test("non-integer scores still classify correctly (defensive)", () => {
      // Analyzer always returns integers, but the function should be
      // robust to floats in case this is ever called from other code.
      expect(classifyByThreshold(4.9, 5)).toBe("auto_rejected");
      expect(classifyByThreshold(5.0, 5)).toBe("pass");
      expect(classifyByThreshold(5.1, 5)).toBe("pass");
    });

    test("non-integer threshold still works (defensive)", () => {
      expect(classifyByThreshold(5, 5.5)).toBe("auto_rejected");
      expect(classifyByThreshold(6, 5.5)).toBe("pass");
    });
  });
});
