import { Keypair } from "@solana/web3.js";
import { describe, expect, test, vi } from "vitest";

import { type AnalyzeResult } from "../src/analyzer.js";
import { handleSubmission } from "../src/submission-handler.js";

/**
 * Integration-style tests for the per-submission pipeline. We build a fake
 * `Db` that records every call, a fake scorer client, and a fake analyzer.
 * The real `analyzeSubmission` is bypassed via `deps.analyze`, and the real
 * `db/ops` functions are exercised against a Drizzle-shaped fake.
 *
 * Drizzle calls supported by the proxy:
 *   threshold lookup  : select({threshold:...}).from(bountyMeta).innerJoin(...).where(...).limit(1)
 *   criteria lookup   : select({criteria:...}).from(bountyMeta).innerJoin(...).where(...).limit(1)
 *   ranking fetch     : select(...).from(submissions).leftJoin(...).where(...)
 *   submission upsert : insert(submissions).values(...).onConflictDoNothing()
 *   evaluation insert : insert(evaluations).values(...) (awaited directly)
 *   state mark        : update(submissions).set(...).where(...)
 *   rank apply        : update(submissions).set({rank}).where(...)
 *
 * Threshold and criteria lookups share the same chain shape; we dispatch on
 * the select-arg key (`threshold` vs `criteria`).
 */

type Recorded = { kind: string; payload: unknown };

interface RankingRow {
  pda: string;
  state: string;
  score: number;
  createdAt: Date;
}

interface FakeDb {
  calls: Recorded[];
  thresholdToReturn: number | null;
  criteriaToReturn: string | null;
  rankingRowsToReturn: RankingRow[];
  /**
   * GHB-184: queue of fake `execute` results, consumed in order. Each entry
   * is the rows array the next `db.execute(sql...)` call should resolve to.
   * If the queue is empty when execute fires, it resolves to []. The fake
   * routes by SQL snippet so tests don't need to enumerate the order
   * across the whole pipeline (pre-check, cap UPDATE, mark warning, etc.).
   */
  executeRoutes: Array<{ match: RegExp; rows: unknown[] }>;
}

function fakeDb(opts: {
  threshold?: number | null;
  criteria?: string | null;
  rankingRows?: RankingRow[];
  /** Override default routes. Custom routes take precedence over defaults. */
  executeRoutes?: Array<{ match: RegExp; rows: unknown[] }>;
} = {}): FakeDb {
  // GHB-184: defaults for the new execute-based helpers so the pre-existing
  // threshold tests still pass without each one configuring cap fixtures.
  // Pre-check defaults to "bounty is open"; cap UPDATE defaults to "applied,
  // no cap" so markScoredAndCheckCap acts like the old markScored.
  const defaults: Array<{ match: RegExp; rows: unknown[] }> = [
    {
      match: /SELECT i\.state[\s\S]+FROM issues/i,
      rows: [{ state: "open", closed_by_cap_at: null }],
    },
    {
      match: /WITH bumped AS/i,
      rows: [
        {
          issue_id: "00000000-0000-0000-0000-000000000000",
          review_eligible_count: 1,
          max_submissions: null,
          cap_warning_sent_at: null,
          bounty_owner_user_id: null,
          bounty_title: null,
          just_closed: false,
        },
      ],
    },
  ];
  return {
    calls: [],
    thresholdToReturn: opts.threshold ?? null,
    criteriaToReturn: opts.criteria ?? null,
    rankingRowsToReturn: opts.rankingRows ?? [],
    executeRoutes: [...(opts.executeRoutes ?? []), ...defaults],
  };
}

function buildDrizzleProxy(state: FakeDb): unknown {
  const insertChain = (table: unknown) => ({
    values: (payload: unknown) => {
      const next = {
        onConflictDoNothing: () => {
          state.calls.push({ kind: "insert", payload: { table, payload } });
          return Promise.resolve();
        },
        onConflictDoUpdate: () => {
          state.calls.push({ kind: "insert", payload: { table, payload } });
          return Promise.resolve();
        },
        // Direct await without .onConflict* (used by insertEvaluation)
        then: (
          resolve: (v: unknown) => void,
          reject?: (e: unknown) => void,
        ) => {
          state.calls.push({ kind: "insert", payload: { table, payload } });
          return Promise.resolve().then(resolve, reject);
        },
      };
      return next;
    },
  });

  const updateChain = (table: unknown) => ({
    set: (patch: unknown) => ({
      where: () => {
        state.calls.push({ kind: "update", payload: { table, patch } });
        return Promise.resolve();
      },
    }),
  });

  // Threshold and criteria selects share the same chain shape, distinguished
  // by which key the caller put in the `select({ ... })` map. Ranking is the
  // only leftJoin-shaped query.
  const selectChain = (selectArg: Record<string, unknown>) => ({
    from: () => ({
      innerJoin: () => ({
        where: () => ({
          limit: () => {
            if ("threshold" in selectArg) {
              state.calls.push({ kind: "select", payload: "threshold-lookup" });
              return Promise.resolve(
                state.thresholdToReturn == null
                  ? []
                  : [{ threshold: state.thresholdToReturn }],
              );
            }
            if ("criteria" in selectArg) {
              state.calls.push({ kind: "select", payload: "criteria-lookup" });
              return Promise.resolve(
                state.criteriaToReturn == null
                  ? []
                  : [{ criteria: state.criteriaToReturn }],
              );
            }
            state.calls.push({ kind: "select", payload: "unknown-lookup" });
            return Promise.resolve([]);
          },
        }),
      }),
      leftJoin: () => ({
        where: () => {
          state.calls.push({ kind: "select", payload: "ranking-fetch" });
          return Promise.resolve(state.rankingRowsToReturn);
        },
      }),
    }),
  });

  // GHB-184: drizzle's `sql` template returns an SQL object; `db.execute`
  // accepts it. We stringify the queryChunks (a mix of strings + parameter
  // markers) and route to the first matching test route. Recording the call
  // also lets tests assert which path executed.
  const execute = async (sqlObj: unknown) => {
    const text = sqlToString(sqlObj);
    state.calls.push({ kind: "execute", payload: text });
    const route = state.executeRoutes.find((r) => r.match.test(text));
    const rows = route?.rows ?? [];
    // Drizzle drivers vary: postgres-js exposes `.rows`; others spread an
    // array. Return both shapes so the helpers' fallback logic finds rows
    // either way.
    return Object.assign([...rows], { rows });
  };

  return {
    insert: insertChain,
    update: updateChain,
    select: selectChain,
    execute,
  };
}

/** Best-effort SQL stringifier for the test proxy. Drizzle's SQL template
 * exposes `queryChunks` (mix of strings + Param objects). We just join the
 * string parts so we can pattern-match on stable SQL keywords. */
function sqlToString(sqlObj: unknown): string {
  const chunks = (sqlObj as { queryChunks?: unknown[] })?.queryChunks;
  if (!Array.isArray(chunks)) return String(sqlObj);
  return chunks
    .map((c) => (typeof c === "object" && c && "value" in c ? String((c as { value: unknown }).value) : String(c)))
    .join(" ");
}

// Build a fake DecodedSubmission. We use freshly generated keypairs because
// `new PublicKey(string)` requires a valid base58 32-byte encoding and most
// hand-crafted strings (e.g. "22222...") fall outside the valid set.
function buildSub(prUrl = "https://github.com/o/r/pull/1") {
  return {
    pda: Keypair.generate().publicKey,
    bounty: Keypair.generate().publicKey,
    solver: Keypair.generate().publicKey,
    submissionIndex: 0,
    prUrl,
    opusReportHash: new Uint8Array(32).fill(0xab),
    score: null as number | null,
  };
}

const opusResult: AnalyzeResult = {
  score: 7,
  source: "opus",
  reasoning: "Decent change, no concerns.",
  report: {
    code_quality: { score: 7, reasoning: "" },
    test_coverage: { score: 6, reasoning: "" },
    requirements_match: { score: 8, reasoning: "" },
    security: { score: 5, reasoning: "" },
    summary: "Decent change, no concerns.",
  },
  reportHash: "f".repeat(64),
};

const lowOpusResult: AnalyzeResult = {
  ...opusResult,
  score: 3,
  reasoning: "Weak.",
  report: {
    code_quality: { score: 3, reasoning: "" },
    test_coverage: { score: 2, reasoning: "" },
    requirements_match: { score: 4, reasoning: "" },
    security: { score: 3, reasoning: "" },
    summary: "Weak.",
  },
};

function buildScorer(txHash = "TX_OK") {
  const setScore = vi.fn(async () => txHash);
  return { client: { setScore }, setScore };
}

const baseDeps = {
  chainId: "solana-devnet",
  stubScore: 5,
  anthropicApiKey: null,
  anthropicModel: "claude-sonnet-4-5-20250929",
};

describe("handleSubmission", () => {
  test("no DB: still calls setScore with the analyzer's score", async () => {
    const { client, setScore } = buildScorer("ABC");
    const analyze = vi.fn(async () => opusResult);
    const sub = buildSub();

    const r = await handleSubmission(sub, {
      ...baseDeps,
      db: null,
      scorer: client,
      analyze,
    });

    expect(setScore).toHaveBeenCalledOnce();
    const args = setScore.mock.calls[0];
    expect(args[0].equals(sub.bounty)).toBe(true);
    expect(args[1].equals(sub.pda)).toBe(true);
    expect(args[2]).toBe(7);
    expect(r.score).toBe(7);
    expect(r.outcome).toBe("pass");
    expect(r.threshold).toBeNull();
    expect(r.txHash).toBe("ABC");
  });

  test("with DB and no threshold: marks scored, never auto_rejected", async () => {
    const state = fakeDb({}); // no threshold configured for the issue
    const db = buildDrizzleProxy(state);
    const { client } = buildScorer();
    const analyze = vi.fn(async () => opusResult);

    const r = await handleSubmission(buildSub(), {
      ...baseDeps,
      db: db as never,
      scorer: client,
      analyze,
    });

    expect(r.outcome).toBe("pass");
    expect(r.threshold).toBeNull();

    const updateCalls = state.calls.filter((c) => c.kind === "update");
    expect(updateCalls).toHaveLength(1);
    const patch = (updateCalls[0].payload as { patch: { state: string } }).patch;
    expect(patch.state).toBe("scored");
  });

  test("score below threshold → marks auto_rejected", async () => {
    const state = fakeDb({ threshold: 5 }); // threshold=5, score=3 → reject
    const db = buildDrizzleProxy(state);
    const { client } = buildScorer();
    const analyze = vi.fn(async () => lowOpusResult);

    const r = await handleSubmission(buildSub(), {
      ...baseDeps,
      db: db as never,
      scorer: client,
      analyze,
    });

    expect(r.outcome).toBe("auto_rejected");
    expect(r.threshold).toBe(5);
    expect(r.score).toBe(3);

    const updateCalls = state.calls.filter((c) => c.kind === "update");
    expect(updateCalls).toHaveLength(1);
    const patch = (updateCalls[0].payload as { patch: { state: string } }).patch;
    expect(patch.state).toBe("auto_rejected");
  });

  test("score equal to threshold passes (strict <)", async () => {
    const state = fakeDb({ threshold: 7 }); // threshold=7, score=7 → pass
    const db = buildDrizzleProxy(state);
    const { client } = buildScorer();
    const analyze = vi.fn(async () => opusResult);

    const r = await handleSubmission(buildSub(), {
      ...baseDeps,
      db: db as never,
      scorer: client,
      analyze,
    });

    expect(r.outcome).toBe("pass");
    expect(r.score).toBe(7);

    const updateCalls = state.calls.filter((c) => c.kind === "update");
    const patch = (updateCalls[0].payload as { patch: { state: string } }).patch;
    expect(patch.state).toBe("scored");
  });

  test("setScore is called regardless of threshold outcome (onchain truth)", async () => {
    const state = fakeDb({ threshold: 10 }); // threshold=10, score=3 → reject
    const db = buildDrizzleProxy(state);
    const { client, setScore } = buildScorer("TX_REJECTED");
    const analyze = vi.fn(async () => lowOpusResult);

    const r = await handleSubmission(buildSub(), {
      ...baseDeps,
      db: db as never,
      scorer: client,
      analyze,
    });

    // Even though the submission auto-rejects off-chain, set_score still runs
    // so onchain has the truth and resolve_bounty can compare scores later.
    expect(setScore).toHaveBeenCalledOnce();
    expect(r.txHash).toBe("TX_REJECTED");
    expect(r.outcome).toBe("auto_rejected");
  });

  test("evaluation row is inserted in both pass and reject paths", async () => {
    const passState = fakeDb({});
    await handleSubmission(buildSub(), {
      ...baseDeps,
      db: buildDrizzleProxy(passState) as never,
      scorer: buildScorer().client,
      analyze: vi.fn(async () => opusResult),
    });
    expect(passState.calls.filter((c) => c.kind === "insert").length).toBe(2);
    // First insert = upsertSubmission, second = insertEvaluation.

    const rejectState = fakeDb({ threshold: 8 });
    await handleSubmission(buildSub(), {
      ...baseDeps,
      db: buildDrizzleProxy(rejectState) as never,
      scorer: buildScorer().client,
      analyze: vi.fn(async () => lowOpusResult),
    });
    expect(rejectState.calls.filter((c) => c.kind === "insert").length).toBe(2);
  });

  test("falls back to stub when no API key (still threshold-checked)", async () => {
    const state = fakeDb({ threshold: 6 }); // stubScore=5 < threshold=6 → reject
    const db = buildDrizzleProxy(state);
    const { client } = buildScorer();

    const r = await handleSubmission(buildSub(), {
      ...baseDeps,
      stubScore: 5,
      db: db as never,
      scorer: client,
      // Use the real analyzer (no analyze override) → stub path
    });

    expect(r.source).toBe("stub");
    expect(r.score).toBe(5);
    expect(r.outcome).toBe("auto_rejected");
    expect(r.threshold).toBe(6);
  });

  test("propagates analyzer errors (does not silently swallow)", async () => {
    const { client } = buildScorer();
    const analyze = vi.fn(async () => {
      throw new Error("analyzer exploded");
    });

    await expect(
      handleSubmission(buildSub(), {
        ...baseDeps,
        db: null,
        scorer: client,
        analyze,
      }),
    ).rejects.toThrow(/analyzer exploded/);
  });

  test("propagates setScore errors (does not silently swallow)", async () => {
    const setScore = vi.fn(async () => {
      throw new Error("rpc down");
    });
    const analyze = vi.fn(async () => opusResult);

    await expect(
      handleSubmission(buildSub(), {
        ...baseDeps,
        db: null,
        scorer: { setScore },
        analyze,
      }),
    ).rejects.toThrow(/rpc down/);
  });

  test("upserts the submission before analyzing (so DB has the row even on analyze failure)", async () => {
    const state = fakeDb({});
    const db = buildDrizzleProxy(state);
    const { client } = buildScorer();
    const analyze = vi.fn(async () => {
      throw new Error("opus boom");
    });

    await expect(
      handleSubmission(buildSub(), {
        ...baseDeps,
        db: db as never,
        scorer: client,
        analyze,
      }),
    ).rejects.toThrow();

    // The upsert ran before the analyzer threw.
    expect(state.calls.filter((c) => c.kind === "insert").length).toBe(1);
    // No update yet because we never made it past setScore.
    expect(state.calls.filter((c) => c.kind === "update").length).toBe(0);
  });

  /* GHB-96: ranking integration ---------------------------------- */

  test("recomputes rank for the issue after scoring", async () => {
    // Stage three existing submissions for the same issue. After the new
    // submission is scored, the handler runs recomputeRanking, which fetches
    // these rows and writes back rank values for each.
    const t0 = new Date("2026-04-28T10:00:00Z");
    const state = fakeDb({
      rankingRows: [
        { pda: "old_lower", state: "scored", score: 5, createdAt: t0 },
        { pda: "new_higher", state: "scored", score: 9, createdAt: new Date(t0.getTime() + 60_000) },
        { pda: "rejected", state: "auto_rejected", score: 2, createdAt: new Date(t0.getTime() + 30_000) },
      ],
    });
    const db = buildDrizzleProxy(state);
    const { client } = buildScorer();
    const analyze = vi.fn(async () => opusResult);

    await handleSubmission(buildSub(), {
      ...baseDeps,
      db: db as never,
      scorer: client,
      analyze,
    });

    // Update calls in order: 1 markScored + 3 rank applications.
    const updateCalls = state.calls.filter((c) => c.kind === "update");
    expect(updateCalls).toHaveLength(4);

    const rankPatches = updateCalls
      .slice(1)
      .map((c) => (c.payload as { patch: { rank: number | null } }).patch);
    // computeRanking output (input-order preserved):
    //   old_lower (score=5)    → rank 2 (later than new_higher)
    //   new_higher (score=9)   → rank 1
    //   rejected (auto_rejected) → null
    expect(rankPatches).toEqual([{ rank: 2 }, { rank: 1 }, { rank: null }]);
  });

  test("recomputeRanking runs on auto_rejected path too (clears stale rank)", async () => {
    // Even when the new submission is auto-rejected, we still recompute
    // ranks: an admin might have changed the threshold and the row's old
    // rank needs to clear.
    const t0 = new Date("2026-04-28T10:00:00Z");
    const state = fakeDb({
      threshold: 8,
      rankingRows: [
        { pda: "stale", state: "auto_rejected", score: 4, createdAt: t0 },
      ],
    });
    const db = buildDrizzleProxy(state);
    const { client } = buildScorer();
    const analyze = vi.fn(async () => lowOpusResult); // score=3 < 8

    await handleSubmission(buildSub(), {
      ...baseDeps,
      db: db as never,
      scorer: client,
      analyze,
    });

    const updateCalls = state.calls.filter((c) => c.kind === "update");
    // 1 markAutoRejected + 1 rank-clear = 2
    expect(updateCalls).toHaveLength(2);
    const rankPatch = (updateCalls[1].payload as { patch: { rank: number | null } }).patch;
    expect(rankPatch).toEqual({ rank: null });
  });

  test("SELECT order: criteria → threshold → ranking-fetch", async () => {
    const state = fakeDb({});
    const db = buildDrizzleProxy(state);
    const { client } = buildScorer();
    const analyze = vi.fn(async () => opusResult);

    await handleSubmission(buildSub(), {
      ...baseDeps,
      db: db as never,
      scorer: client,
      analyze,
    });

    // criteria-lookup runs before analyze, threshold-lookup after setScore,
    // ranking-fetch after the evaluation insert.
    const selects = state.calls.filter((c) => c.kind === "select");
    expect(selects.map((s) => s.payload)).toEqual([
      "criteria-lookup",
      "threshold-lookup",
      "ranking-fetch",
    ]);
  });

  test("no DB: ranking is not attempted", async () => {
    const { client } = buildScorer();
    const analyze = vi.fn(async () => opusResult);
    // Just verify it doesn't crash without a DB; nothing to assert beyond
    // a successful resolution since there's no fake to record into.
    const r = await handleSubmission(buildSub(), {
      ...baseDeps,
      db: null,
      scorer: client,
      analyze,
    });
    expect(r.outcome).toBe("pass");
  });

  /* GHB-98: criteria integration --------------------------------- */

  test("fetches evaluation_criteria from DB and passes it to the analyzer", async () => {
    const state = fakeDb({ criteria: "must include integration tests" });
    const db = buildDrizzleProxy(state);
    const { client } = buildScorer();
    const analyze = vi.fn(async () => opusResult);

    await handleSubmission(buildSub(), {
      ...baseDeps,
      db: db as never,
      scorer: client,
      analyze,
    });

    expect(analyze).toHaveBeenCalledOnce();
    const analyzeArgs = analyze.mock.calls[0]![0];
    expect(analyzeArgs.evaluationCriteria).toBe(
      "must include integration tests",
    );
  });

  test("passes null criteria when none configured (analyzer falls back to default)", async () => {
    const state = fakeDb({}); // criteria left at null
    const db = buildDrizzleProxy(state);
    const { client } = buildScorer();
    const analyze = vi.fn(async () => opusResult);

    await handleSubmission(buildSub(), {
      ...baseDeps,
      db: db as never,
      scorer: client,
      analyze,
    });

    const analyzeArgs = analyze.mock.calls[0]![0];
    expect(analyzeArgs.evaluationCriteria).toBeNull();
  });

  test("no DB: criteria stays null (default rubric used by analyzer)", async () => {
    const { client } = buildScorer();
    const analyze = vi.fn(async () => opusResult);

    await handleSubmission(buildSub(), {
      ...baseDeps,
      db: null,
      scorer: client,
      analyze,
    });

    const analyzeArgs = analyze.mock.calls[0]![0];
    expect(analyzeArgs.evaluationCriteria).toBeNull();
  });

  /* ============================================================== */
  /* GHB-58: GenLayer second-opinion integration                     */
  /* ============================================================== */

  /**
   * Default config used in the GenLayer tests below — feature ENABLED
   * (contract + key set) but the actual call is mocked via
   * `deps.callGenLayer`, so the real RPC is never touched.
   */
  const enabledGenLayerCfg = {
    rpcUrl: "https://studio.genlayer.com/api",
    bountyJudgeContract: "0x" + "1".repeat(40),
    privateKey: ("0x" + "2".repeat(64)) as `0x${string}`,
    pollTimeoutS: 30,
  };

  test("genlayer disabled (null contract): no call, eval row has nulls", async () => {
    const state = fakeDb({});
    const db = buildDrizzleProxy(state);
    const callGenLayer = vi.fn();
    const analyze = vi.fn(async () => opusResult);

    await handleSubmission(buildSub(), {
      ...baseDeps,
      db: db as never,
      scorer: buildScorer().client,
      analyze,
      genlayer: { ...enabledGenLayerCfg, bountyJudgeContract: null },
      callGenLayer,
    });

    expect(callGenLayer).not.toHaveBeenCalled();
    const evalCall = state.calls.find(
      (c) =>
        c.kind === "insert" &&
        (c.payload as { payload: { source?: string } }).payload?.source ===
          "opus",
    );
    const payload = (evalCall!.payload as { payload: Record<string, unknown> })
      .payload;
    expect(payload.genlayerScore).toBeNull();
    expect(payload.genlayerStatus).toBeNull();
    expect(payload.genlayerDimensions).toBeNull();
    expect(payload.genlayerTxHash).toBeNull();
  });

  test("genlayer success: verdict persisted alongside Sonnet score", async () => {
    const state = fakeDb({});
    const db = buildDrizzleProxy(state);
    const callGenLayer = vi.fn(async () => ({
      outcome: "success" as const,
      txHash: "0xdeadbeef",
      status: "passed" as const,
      score: 8,
      dimensions: {
        code_quality: 8,
        test_coverage: 7,
        requirements_match: 9,
        security: 6,
      },
    }));
    const analyze = vi.fn(async () => opusResult);

    await handleSubmission(buildSub(), {
      ...baseDeps,
      db: db as never,
      scorer: buildScorer().client,
      analyze,
      genlayer: enabledGenLayerCfg,
      callGenLayer,
    });

    expect(callGenLayer).toHaveBeenCalledOnce();
    // Second arg = submission PDA, third arg = narrative report (the
    // scrubbed text built from opus.report). It must NOT contain the
    // numeric scores from the Opus report.
    const callArgs = callGenLayer.mock.calls[0]!;
    expect(typeof callArgs[1]).toBe("string"); // submission_id
    const narrative = callArgs[2] as string;
    expect(narrative).toContain("## Summary");
    expect(narrative).not.toMatch(/\b[0-9]+\b/); // numbers were scrubbed

    // Evaluation row should carry the GenLayer verdict.
    const evalCall = state.calls.find(
      (c) =>
        c.kind === "insert" &&
        (c.payload as { payload: { source?: string } }).payload?.source ===
          "opus",
    );
    const payload = (evalCall!.payload as { payload: Record<string, unknown> })
      .payload;
    expect(payload.genlayerScore).toBe(8);
    expect(payload.genlayerStatus).toBe("passed");
    expect(payload.genlayerTxHash).toBe("0xdeadbeef");
    expect(payload.genlayerDimensions).toEqual({
      code_quality: 8,
      test_coverage: 7,
      requirements_match: 9,
      security: 6,
    });
  });

  test("genlayer timeout: handler doesn't throw, eval row has nulls", async () => {
    const state = fakeDb({});
    const db = buildDrizzleProxy(state);
    const callGenLayer = vi.fn(async () => ({
      outcome: "timeout" as const,
      txHash: "0xabc",
      message: "polling exceeded 30s",
    }));
    const analyze = vi.fn(async () => opusResult);

    const r = await handleSubmission(buildSub(), {
      ...baseDeps,
      db: db as never,
      scorer: buildScorer().client,
      analyze,
      genlayer: enabledGenLayerCfg,
      callGenLayer,
    });

    // Sonnet's score still wins on the main path — GenLayer timeout is
    // best-effort and shouldn't break the relayer.
    expect(r.score).toBe(7);
    expect(r.outcome).toBe("pass");
    const evalCall = state.calls.find(
      (c) =>
        c.kind === "insert" &&
        (c.payload as { payload: { source?: string } }).payload?.source ===
          "opus",
    );
    const payload = (evalCall!.payload as { payload: Record<string, unknown> })
      .payload;
    expect(payload.genlayerScore).toBeNull();
    expect(payload.genlayerStatus).toBeNull();
    expect(payload.genlayerTxHash).toBeNull();
  });

  test("genlayer skipped on stub path (no report to forward)", async () => {
    const state = fakeDb({});
    const db = buildDrizzleProxy(state);
    const callGenLayer = vi.fn();

    // No `analyze` override → falls back to stub since anthropicApiKey
    // is null in baseDeps. Stub path returns report=null.
    await handleSubmission(buildSub(), {
      ...baseDeps,
      db: db as never,
      scorer: buildScorer().client,
      genlayer: enabledGenLayerCfg,
      callGenLayer,
    });

    expect(callGenLayer).not.toHaveBeenCalled();
  });

  /* ============================================================== */
  /* GHB-73: sandbox executor integration                            */
  /* ============================================================== */

  /**
   * Sandbox enabled in config (token + app set) but real Fly never
   * reached because we inject `runSandbox` for every test below.
   */
  const enabledSandboxCfg = {
    apiToken: "fly_test_token",
    appName: "ghbounty-sandbox-test",
    image: "registry.fly.io/ghbounty-sandbox:test",
    region: "iad",
    timeoutS: 300,
    cpus: 2,
    memoryMb: 2048,
  };

  test("sandbox disabled (no apiToken): runSandbox NOT invoked, analyze sees testResult=null", async () => {
    const runSandbox = vi.fn();
    const analyze = vi.fn(async () => opusResult);
    await handleSubmission(buildSub(), {
      ...baseDeps,
      db: null,
      scorer: buildScorer().client,
      sandbox: { ...enabledSandboxCfg, apiToken: null },
      runSandbox,
      analyze,
    });
    expect(runSandbox).not.toHaveBeenCalled();
    expect(analyze).toHaveBeenCalledOnce();
    expect(analyze.mock.calls[0]![0].testResult).toBeNull();
  });

  test("sandbox disabled (no appName): same — skipped, testResult=null", async () => {
    const runSandbox = vi.fn();
    const analyze = vi.fn(async () => opusResult);
    await handleSubmission(buildSub(), {
      ...baseDeps,
      db: null,
      scorer: buildScorer().client,
      sandbox: { ...enabledSandboxCfg, appName: null },
      runSandbox,
      analyze,
    });
    expect(runSandbox).not.toHaveBeenCalled();
    expect(analyze.mock.calls[0]![0].testResult).toBeNull();
  });

  test("sandbox not in deps (legacy): no spawn, analyze gets null", async () => {
    const analyze = vi.fn(async () => opusResult);
    await handleSubmission(buildSub(), {
      ...baseDeps,
      db: null,
      scorer: buildScorer().client,
      analyze,
    });
    expect(analyze.mock.calls[0]![0].testResult).toBeNull();
  });

  test("sandbox: kind=exited exitCode=0 → testResult.status='passed' with runner kind", async () => {
    const runSandbox = vi.fn(async () => ({
      kind: "exited" as const,
      runner: { kind: "pytest" as const, command: ["pytest"], markers: ["pyproject.toml"] },
      exitCode: 0,
      durationMs: 12345,
      stdoutTail: "PASS test_foo",
      stderrTail: "",
    }));
    const analyze = vi.fn(async () => opusResult);
    await handleSubmission(buildSub(), {
      ...baseDeps,
      db: null,
      scorer: buildScorer().client,
      sandbox: enabledSandboxCfg,
      runSandbox,
      analyze,
    });
    expect(runSandbox).toHaveBeenCalledOnce();
    // The spec passed to runSandbox was built from the PR URL.
    const [, opts] = runSandbox.mock.calls[0]!;
    expect(opts.repoUrl).toBe("https://github.com/o/r.git");
    expect(opts.prNumber).toBe(1);
    expect(opts.baseRef).toBe("main");
    // Sonnet-bound testResult shape.
    const tr = analyze.mock.calls[0]![0].testResult;
    expect(tr).toMatchObject({
      status: "passed",
      runner: "pytest",
      durationMs: 12345,
    });
    expect(tr.outputTail).toContain("PASS test_foo");
  });

  test("sandbox: kind=exited non-zero exit → testResult.status='failed'", async () => {
    const runSandbox = vi.fn(async () => ({
      kind: "exited" as const,
      runner: { kind: "cargo" as const, command: ["cargo", "test"], markers: ["Cargo.toml"] },
      exitCode: 101,
      durationMs: 9999,
      stdoutTail: "",
      stderrTail: "test failed: assertion `left == right`",
    }));
    const analyze = vi.fn(async () => opusResult);
    await handleSubmission(buildSub(), {
      ...baseDeps,
      db: null,
      scorer: buildScorer().client,
      sandbox: enabledSandboxCfg,
      runSandbox,
      analyze,
    });
    const tr = analyze.mock.calls[0]![0].testResult;
    expect(tr.status).toBe("failed");
    expect(tr.runner).toBe("cargo");
    expect(tr.outputTail).toContain("assertion");
  });

  test.each([
    {
      label: "kind=timeout",
      result: {
        kind: "timeout" as const,
        phase: "test" as const,
        runner: { kind: "anchor" as const, command: ["anchor", "test"], markers: ["Anchor.toml"] },
        durationMs: 240_000,
        stdoutTail: "",
        stderrTail: "",
      },
    },
    {
      label: "kind=install_error",
      result: {
        kind: "install_error" as const,
        runner: { kind: "npm" as const, command: ["npm", "test"], markers: ["package.json"] },
        exitCode: 127,
        durationMs: 4321,
        stdoutTail: "",
        stderrTail: "command not found",
      },
    },
    {
      label: "kind=git_error",
      result: {
        kind: "git_error" as const,
        reason: "Repository not found",
        durationMs: 3000,
      },
    },
    {
      label: "kind=no_runner",
      result: { kind: "no_runner" as const, reason: "no markers", durationMs: 2000 },
    },
    {
      label: "kind=infra",
      result: {
        kind: "infra" as const,
        reason: "Fly create failed",
        durationMs: 1500,
      },
    },
  ])("sandbox: $label → testResult=null (Sonnet sees the no-results prompt)", async ({ result }) => {
    const runSandbox = vi.fn(async () => result);
    const analyze = vi.fn(async () => opusResult);
    await handleSubmission(buildSub(), {
      ...baseDeps,
      db: null,
      scorer: buildScorer().client,
      sandbox: enabledSandboxCfg,
      runSandbox,
      analyze,
    });
    expect(runSandbox).toHaveBeenCalledOnce();
    expect(analyze.mock.calls[0]![0].testResult).toBeNull();
  });

  test("sandbox: thrown exception → testResult=null (handler doesn't crash)", async () => {
    const runSandbox = vi.fn(async () => {
      throw new Error("network unreachable");
    });
    const analyze = vi.fn(async () => opusResult);
    const r = await handleSubmission(buildSub(), {
      ...baseDeps,
      db: null,
      scorer: buildScorer().client,
      sandbox: enabledSandboxCfg,
      runSandbox,
      analyze,
    });
    expect(analyze.mock.calls[0]![0].testResult).toBeNull();
    // The submission still completes end-to-end with the analyzer's score.
    expect(r.score).toBe(7);
  });

  test("sandbox: unparseable PR URL → skipped, testResult=null", async () => {
    const runSandbox = vi.fn();
    const analyze = vi.fn(async () => opusResult);
    await handleSubmission(buildSub("not-a-github-url"), {
      ...baseDeps,
      db: null,
      scorer: buildScorer().client,
      sandbox: enabledSandboxCfg,
      runSandbox,
      analyze,
    });
    expect(runSandbox).not.toHaveBeenCalled();
    expect(analyze.mock.calls[0]![0].testResult).toBeNull();
  });
});

/* ──────────────────────────────────────────────────────────────────────
 * GHB-184: cap de submissions (off-chain).
 *
 * The atomic UPDATE pattern lives in `markScoredAndCheckCap`. We exercise
 * it through `handleSubmission` so we also assert that the surrounding
 * orchestration (skip-on-closed pre-check, fallback to auto_rejected on
 * race-loss, cap_reached / cap_approaching notif emission) all fire on
 * the right edges. The fakeDb's executeRoutes mechanism lets each test
 * configure exactly the SQL responses the handler will see.
 * ────────────────────────────────────────────────────────────────────── */
describe("GHB-184: cap de submissions", () => {
  const ISSUE_UUID = "11111111-1111-1111-1111-111111111111";
  const OWNER_DID = "did:privy:owner";

  // Helper: a cap UPDATE response shaped like the production CTE returns.
  function capRow(p: {
    reviewEligibleCount: number;
    maxSubmissions: number | null;
    capWarningSentAt?: string | null;
    justClosed?: boolean;
  }) {
    return {
      issue_id: ISSUE_UUID,
      review_eligible_count: p.reviewEligibleCount,
      max_submissions: p.maxSubmissions,
      cap_warning_sent_at: p.capWarningSentAt ?? null,
      bounty_owner_user_id: OWNER_DID,
      bounty_title: "My bounty",
      just_closed: p.justClosed ?? false,
    };
  }

  test("pre-check: bounty already closed by cap → skip Opus + auto_reject", async () => {
    const state = fakeDb({
      executeRoutes: [
        {
          // Pre-check sees the bounty as closed-by-cap.
          match: /SELECT i\.state[\s\S]+FROM issues/i,
          rows: [{ state: "open", closed_by_cap_at: "2026-05-06T00:00:00Z" }],
        },
      ],
    });
    const db = buildDrizzleProxy(state);
    const { client, setScore } = buildScorer();
    const analyze = vi.fn(async () => opusResult);

    const r = await handleSubmission(buildSub(), {
      ...baseDeps,
      db: db as never,
      scorer: client,
      analyze,
    });

    expect(analyze).not.toHaveBeenCalled();
    expect(setScore).not.toHaveBeenCalled();
    expect(r.outcome).toBe("auto_rejected");
    expect(r.txHash).toBe("bounty_closed");

    // Submission was marked auto_rejected via the existing markAutoRejected
    // path (drizzle update, recorded as kind="update").
    const updates = state.calls.filter((c) => c.kind === "update");
    expect(updates.some((u) => {
      const patch = (u.payload as { patch: { state?: string } }).patch;
      return patch?.state === "auto_rejected";
    })).toBe(true);
  });

  test("scored bumps review_eligible_count when bounty stays open", async () => {
    const state = fakeDb({
      executeRoutes: [
        {
          match: /WITH bumped AS/i,
          rows: [capRow({ reviewEligibleCount: 3, maxSubmissions: 5 })],
        },
      ],
    });
    const db = buildDrizzleProxy(state);
    const { client } = buildScorer();
    const analyze = vi.fn(async () => opusResult);

    const r = await handleSubmission(buildSub(), {
      ...baseDeps,
      db: db as never,
      scorer: client,
      analyze,
    });

    expect(r.outcome).toBe("pass");
    // Atomic UPDATE was issued.
    const executes = state.calls.filter((c) => c.kind === "execute");
    expect(executes.some((e) => /WITH bumped AS/i.test(String(e.payload)))).toBe(true);
    // No cap_reached notif (just_closed=false): the UPDATE that sends it is
    // an INSERT INTO notifications statement we'd see in the calls list.
    expect(executes.some((e) => /'bounty_cap_reached'/i.test(String(e.payload)))).toBe(false);
  });

  test("hitting the cap closes the bounty and emits cap_reached notif", async () => {
    const state = fakeDb({
      executeRoutes: [
        {
          match: /WITH bumped AS/i,
          rows: [
            capRow({
              reviewEligibleCount: 3,
              maxSubmissions: 3,
              justClosed: true,
            }),
          ],
        },
      ],
    });
    const db = buildDrizzleProxy(state);
    const { client } = buildScorer();
    const analyze = vi.fn(async () => opusResult);

    await handleSubmission(buildSub(), {
      ...baseDeps,
      db: db as never,
      scorer: client,
      analyze,
    });

    const executes = state.calls.filter((c) => c.kind === "execute");
    // cap_reached notif emitted.
    expect(executes.some((e) => /'bounty_cap_reached'/i.test(String(e.payload)))).toBe(true);
    // No cap_approaching (we jumped straight to close).
    expect(executes.some((e) => /'bounty_cap_approaching'/i.test(String(e.payload)))).toBe(false);
  });

  test("race-lost (applied=false) → auto_reject + no notif", async () => {
    const state = fakeDb({
      executeRoutes: [
        {
          // Empty rows = the WHERE didn't match (cap already filled by a
          // concurrent submission).
          match: /WITH bumped AS/i,
          rows: [],
        },
      ],
    });
    const db = buildDrizzleProxy(state);
    const { client } = buildScorer();
    const analyze = vi.fn(async () => opusResult);

    const r = await handleSubmission(buildSub(), {
      ...baseDeps,
      db: db as never,
      scorer: client,
      analyze,
    });

    // Outcome flips to auto_rejected because the slot couldn't be claimed.
    expect(r.outcome).toBe("auto_rejected");
    const updates = state.calls.filter((c) => c.kind === "update");
    expect(updates.some((u) => {
      const patch = (u.payload as { patch: { state?: string } }).patch;
      return patch?.state === "auto_rejected";
    })).toBe(true);
    // No cap notifs.
    const executes = state.calls.filter((c) => c.kind === "execute");
    expect(executes.some((e) => /'bounty_cap_reached'/i.test(String(e.payload)))).toBe(false);
    expect(executes.some((e) => /'bounty_cap_approaching'/i.test(String(e.payload)))).toBe(false);
  });

  test("first crossing of 80% → emits cap_approaching + stamps cap_warning_sent_at", async () => {
    const state = fakeDb({
      executeRoutes: [
        {
          match: /WITH bumped AS/i,
          // 4/5 = 80% on the dot, capWarningSentAt still null.
          rows: [capRow({ reviewEligibleCount: 4, maxSubmissions: 5 })],
        },
      ],
    });
    const db = buildDrizzleProxy(state);
    const { client } = buildScorer();
    const analyze = vi.fn(async () => opusResult);

    await handleSubmission(buildSub(), {
      ...baseDeps,
      db: db as never,
      scorer: client,
      analyze,
    });

    const executes = state.calls.filter((c) => c.kind === "execute");
    expect(executes.some((e) => /'bounty_cap_approaching'/i.test(String(e.payload)))).toBe(true);
    // The flag UPDATE fires right after the notif so the next submission
    // doesn't double-notify.
    expect(executes.some((e) => /SET cap_warning_sent_at = now\(\)/i.test(String(e.payload)))).toBe(true);
  });

  test("auto_rejected by threshold → no cap UPDATE (counter untouched)", async () => {
    const state = fakeDb({
      threshold: 8,
      executeRoutes: [
        {
          // The pre-check still runs; the cap UPDATE must NOT.
          match: /WITH bumped AS/i,
          rows: [capRow({ reviewEligibleCount: 99, maxSubmissions: 5 })],
        },
      ],
    });
    const db = buildDrizzleProxy(state);
    const { client } = buildScorer();
    const analyze = vi.fn(async () => lowOpusResult); // score=3 < threshold=8

    const r = await handleSubmission(buildSub(), {
      ...baseDeps,
      db: db as never,
      scorer: client,
      analyze,
    });

    expect(r.outcome).toBe("auto_rejected");
    const executes = state.calls.filter((c) => c.kind === "execute");
    // Cap UPDATE never ran — threshold rejection short-circuits before it.
    expect(executes.some((e) => /WITH bumped AS/i.test(String(e.payload)))).toBe(false);
  });
});
