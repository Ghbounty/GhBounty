/**
 * One-shot backfill: marks `submission_reviews.auto_rejected = true` for any
 * evaluation whose score is strictly below the bounty's `reject_threshold`
 * AND has no existing review row (or has one without `auto_rejected=true`).
 *
 * Why this exists: the relayer used to call `set_score` on-chain BEFORE
 * writing the off-chain auto_rejected flag. When `set_score` failed
 * (UnauthorizedScorer on legacy bounties, devnet RPC blip, etc.), the
 * handler crashed and the off-chain flag was never written — so the
 * company's review modal kept showing low-score PRs that should have been
 * filtered out.
 *
 * The relayer's order is now reversed (off-chain mark first), so going
 * forward this is a non-issue. This script cleans up the historical data.
 *
 * Run with:
 *   pnpm --filter @ghbounty/relayer exec tsx src/scripts/backfill-auto-rejected.mts
 *
 * Idempotent: safe to re-run, only inserts/updates rows that need it.
 */

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ override: true, quiet: true });

import { createDb } from "@ghbounty/db";
import { sql } from "drizzle-orm";

const DEFAULT_THRESHOLD = 7; // matches frontend's effectiveRejectThreshold

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL not set");
  const db = createDb({ url });

  // 1. Pull every (evaluation, bounty_threshold) pair via raw SQL —
  //    drizzle's typed builder doesn't model the LEFT JOIN to
  //    submission_reviews easily, and we only want a quick read here.
  const rows = await db.execute(sql`
    SELECT
      e.id              AS eval_id,
      e.submission_pda  AS submission_pda,
      e.score           AS score,
      s.id              AS submission_id,
      COALESCE(bm.reject_threshold, ${DEFAULT_THRESHOLD}) AS effective_threshold,
      sr.auto_rejected  AS already_marked
    FROM evaluations e
    JOIN submissions s         ON s.pda      = e.submission_pda
    JOIN issues      i         ON i.pda      = s.issue_pda
    LEFT JOIN bounty_meta bm   ON bm.issue_id = i.id
    LEFT JOIN submission_reviews sr ON sr.submission_id = s.id
  `);

  type Row = {
    eval_id: string;
    submission_pda: string;
    score: number;
    submission_id: string;
    effective_threshold: number;
    already_marked: boolean | null;
  };
  // postgres-js returns the rows directly as an array on `.execute()`.
  const all = (Array.isArray(rows) ? rows : (rows as { rows?: Row[] }).rows ?? []) as Row[];

  let candidates = 0;
  let alreadyOk = 0;
  let updated = 0;

  for (const r of all) {
    if (r.score >= r.effective_threshold) continue; // not a reject candidate
    candidates += 1;
    if (r.already_marked === true) {
      alreadyOk += 1;
      continue;
    }

    const reason = `Score ${r.score}/10 below threshold ${r.effective_threshold} (backfilled)`;
    await db.execute(sql`
      INSERT INTO submission_reviews (
        submission_id, rejected, auto_rejected, reject_reason,
        decided_by, decided_at
      ) VALUES (
        ${r.submission_id}, true, true, ${reason},
        'backfill-script', now()
      )
      ON CONFLICT (submission_id) DO UPDATE SET
        rejected      = true,
        auto_rejected = true,
        reject_reason = COALESCE(submission_reviews.reject_reason, EXCLUDED.reject_reason),
        decided_at    = COALESCE(submission_reviews.decided_at, now())
    `);
    updated += 1;
  }

  console.log(JSON.stringify({
    totalEvaluations: all.length,
    rejectCandidates: candidates,
    alreadyMarked: alreadyOk,
    backfilled: updated,
  }, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("backfill failed:", err);
  process.exit(1);
});
