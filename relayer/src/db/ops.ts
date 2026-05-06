import { sql } from "drizzle-orm";
import {
  bountyMeta,
  chainRegistry,
  evaluations,
  issues,
  submissions,
  type Db,
} from "@ghbounty/db";

import { computeRanking, type RankableSubmission } from "../ranking.js";

export interface ChainSeed {
  chainId: string;
  name: string;
  rpcUrl: string;
  escrowAddress: string;
  explorerUrl: string;
  tokenSymbol: string;
  x402Supported?: boolean;
}

export async function seedChain(db: Db, chain: ChainSeed): Promise<void> {
  await db
    .insert(chainRegistry)
    .values({
      chainId: chain.chainId,
      name: chain.name,
      rpcUrl: chain.rpcUrl,
      escrowAddress: chain.escrowAddress,
      explorerUrl: chain.explorerUrl,
      tokenSymbol: chain.tokenSymbol,
      x402Supported: chain.x402Supported ?? false,
    })
    .onConflictDoUpdate({
      target: chainRegistry.chainId,
      set: {
        name: chain.name,
        rpcUrl: chain.rpcUrl,
        escrowAddress: chain.escrowAddress,
        explorerUrl: chain.explorerUrl,
        tokenSymbol: chain.tokenSymbol,
        x402Supported: chain.x402Supported ?? false,
      },
    });
}

export interface UpsertSubmissionInput {
  chainId: string;
  issuePda: string;
  submissionPda: string;
  solver: string;
  submissionIndex: number;
  prUrl: string;
  opusReportHashHex: string;
  txHash?: string;
}

export async function upsertSubmission(
  db: Db,
  input: UpsertSubmissionInput,
): Promise<void> {
  await db
    .insert(submissions)
    .values({
      chainId: input.chainId,
      issuePda: input.issuePda,
      pda: input.submissionPda,
      solver: input.solver,
      submissionIndex: input.submissionIndex,
      prUrl: input.prUrl,
      opusReportHash: input.opusReportHashHex,
      txHash: input.txHash,
      state: "pending",
    })
    .onConflictDoNothing({ target: submissions.pda });
}

export async function markScored(
  db: Db,
  submissionPda: string,
): Promise<void> {
  await db
    .update(submissions)
    .set({
      state: "scored",
      scoredAt: sql`now()`,
    })
    .where(sql`${submissions.pda} = ${submissionPda}`);
}

/**
 * GHB-184: claim a "review-eligible" slot atomically.
 *
 * Increments `issues.review_eligible_count` and (if the new count reaches
 * `bounty_meta.max_submissions`) sets `bounty_meta.closed_by_cap_at` in the
 * SAME statement. The WHERE clause guarantees that two concurrent submissions
 * landing at `count = max - 1` can't both succeed: the loser sees `applied:
 * false` and the caller falls back to `markAutoRejected`.
 *
 * `issues.state` is intentionally untouched — it mirrors on-chain reality.
 * The "closed by cap" signal lives entirely in `bounty_meta.closed_by_cap_at`.
 *
 * Caller still needs to mark the submission as `scored` after a successful
 * claim; this helper only enforces the cap rule.
 */
export interface CapCheckResult {
  /** True when the slot was claimed. False = bounty already closed/full. */
  applied: boolean;
  /** UUID of `issues.id` (for `notifications.issue_id`, which is uuid). */
  issueId?: string;
  /** New `review_eligible_count` after the increment. */
  reviewEligibleCount?: number;
  /** Cap value at the moment of the UPDATE; null = unlimited. */
  maxSubmissions?: number | null;
  /** Previous `cap_warning_sent_at`; null means we haven't sent the 80% notif yet. */
  capWarningSentAt?: Date | null;
  /** True when this UPDATE is the one that crossed `count >= max`. */
  justClosed?: boolean;
  /** Privy DID of the company that owns the bounty (notif recipient). */
  bountyOwnerUserId?: string | null;
  /** Bounty title for notif payloads. */
  bountyTitle?: string | null;
}

export async function markScoredAndCheckCap(
  db: Db,
  submissionPda: string,
  issuePda: string,
): Promise<CapCheckResult> {
  // CTE pattern (Option B):
  //   1. `bumped` increments review_eligible_count when the bounty is open
  //      to more PRs. Failure (closed_by_cap_at IS NOT NULL or count == max)
  //      yields no row.
  //   2. `closed` sets bounty_meta.closed_by_cap_at when the new count meets
  //      or exceeds max — runs only if `bumped` produced a row.
  //   3. Final SELECT returns the bumped row plus a `just_closed` flag.
  const result = await db.execute(sql`
    WITH bumped AS (
      UPDATE issues i
      SET review_eligible_count = i.review_eligible_count + 1
      FROM bounty_meta bm
      WHERE i.pda = ${issuePda}
        AND bm.issue_id = i.id
        AND i.state = 'open'
        AND bm.closed_by_cap_at IS NULL
        AND (bm.max_submissions IS NULL
             OR i.review_eligible_count < bm.max_submissions)
      RETURNING
        i.id AS issue_id,
        i.review_eligible_count AS review_eligible_count,
        bm.max_submissions AS max_submissions,
        bm.cap_warning_sent_at AS cap_warning_sent_at,
        bm.created_by_user_id AS bounty_owner_user_id,
        bm.title AS bounty_title
    ),
    closed AS (
      UPDATE bounty_meta bm
      SET closed_by_cap_at = now()
      FROM bumped b
      WHERE bm.issue_id = b.issue_id
        AND b.max_submissions IS NOT NULL
        AND b.review_eligible_count >= b.max_submissions
      RETURNING bm.issue_id
    )
    SELECT
      b.issue_id,
      b.review_eligible_count,
      b.max_submissions,
      b.cap_warning_sent_at,
      b.bounty_owner_user_id,
      b.bounty_title,
      EXISTS(SELECT 1 FROM closed c WHERE c.issue_id = b.issue_id) AS just_closed
    FROM bumped b
  `);

  type Row = {
    issue_id: string;
    review_eligible_count: number;
    max_submissions: number | null;
    cap_warning_sent_at: string | null;
    bounty_owner_user_id: string | null;
    bounty_title: string | null;
    just_closed: boolean;
  };
  const list = (result as unknown as { rows?: Row[] }).rows;
  const flat = Array.isArray(result) ? (result as unknown as Row[]) : list ?? [];
  const first = flat[0];

  if (!first) {
    return { applied: false };
  }

  // Slot claimed — flip the submission to 'scored'. Done as a separate
  // UPDATE because submissions has no FK relationship that we can leverage
  // inside the CTE atomically.
  await db
    .update(submissions)
    .set({ state: "scored", scoredAt: sql`now()` })
    .where(sql`${submissions.pda} = ${submissionPda}`);

  return {
    applied: true,
    issueId: first.issue_id,
    reviewEligibleCount: first.review_eligible_count,
    maxSubmissions: first.max_submissions,
    capWarningSentAt: first.cap_warning_sent_at
      ? new Date(first.cap_warning_sent_at)
      : null,
    bountyOwnerUserId: first.bounty_owner_user_id,
    bountyTitle: first.bounty_title,
    justClosed: first.just_closed,
  };
}

/**
 * GHB-184: pre-check before scoring. The bounty accepts new submissions only
 * when on-chain state is 'open' AND the off-chain cap hasn't been hit. False
 * means the caller should mark the submission auto_rejected and skip Opus.
 */
export async function isBountyOpenForSubmissions(
  db: Db,
  issuePda: string,
): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT i.state AS state, bm.closed_by_cap_at AS closed_by_cap_at
      FROM issues i
      JOIN bounty_meta bm ON bm.issue_id = i.id
     WHERE i.pda = ${issuePda}
     LIMIT 1
  `);
  type Row = { state: string; closed_by_cap_at: string | null };
  const list = (rows as unknown as { rows?: Row[] }).rows;
  const flat = Array.isArray(rows) ? (rows as unknown as Row[]) : list ?? [];
  const first = flat[0];
  if (!first) return true; // no row yet (mock/legacy) — let it through
  return first.state === "open" && first.closed_by_cap_at === null;
}

/**
 * GHB-184: stamp `cap_warning_sent_at` so the relayer never emits the 80%
 * notif twice for the same bounty.
 */
export async function markCapWarningSent(
  db: Db,
  issueId: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE bounty_meta
    SET cap_warning_sent_at = now()
    WHERE issue_id = ${issueId}
  `);
}

/**
 * GHB-95: mark a submission as auto-rejected off-chain (score below the
 * issue's reject threshold). Onchain `set_score` is still expected to have
 * run for transparency; this only affects the off-chain UI state.
 */
export async function markAutoRejected(
  db: Db,
  submissionPda: string,
): Promise<void> {
  await db
    .update(submissions)
    .set({
      state: "auto_rejected",
      scoredAt: sql`now()`,
    })
    .where(sql`${submissions.pda} = ${submissionPda}`);
}

/**
 * GHB-95: look up the per-issue reject threshold by the bounty's onchain PDA.
 *
 * Joins `issues` (onchain mirror) → `bounty_meta` (off-chain UI config) using
 * `issues.pda` as the bridge. Returns `null` if either the issue isn't in the
 * relayer DB yet or the company hasn't configured a threshold for it. In both
 * cases the caller treats the submission as a pass (no auto-rejection).
 */
export async function getRejectThreshold(
  db: Db,
  issuePda: string,
): Promise<number | null> {
  const rows = await db
    .select({ threshold: bountyMeta.rejectThreshold })
    .from(bountyMeta)
    .innerJoin(issues, sql`${issues.id} = ${bountyMeta.issueId}`)
    .where(sql`${issues.pda} = ${issuePda}`)
    .limit(1);
  const first = rows[0];
  if (!first) return null;
  return first.threshold ?? null;
}

/**
 * GHB-98: look up the per-issue evaluation criteria.
 *
 * Same join shape as `getRejectThreshold`. Null/empty result lets the
 * caller fall back to the default rubric in `sanitizeCriteria`.
 */
export async function getEvaluationCriteria(
  db: Db,
  issuePda: string,
): Promise<string | null> {
  const rows = await db
    .select({ criteria: bountyMeta.evaluationCriteria })
    .from(bountyMeta)
    .innerJoin(issues, sql`${issues.id} = ${bountyMeta.issueId}`)
    .where(sql`${issues.pda} = ${issuePda}`)
    .limit(1);
  const first = rows[0];
  if (!first) return null;
  return first.criteria ?? null;
}

/* ---------------------------------------------------------------- */
/* GHB-96: ranking                                                    */
/* ---------------------------------------------------------------- */

/**
 * Fetch all submissions for the given issue, in a shape ready for the
 * ranking module. Includes auto_rejected/pending rows so the ranking can
 * also clear stale ranks (state transitions are not tracked separately).
 */
export async function fetchSubmissionsForRanking(
  db: Db,
  issuePda: string,
): Promise<RankableSubmission[]> {
  const rows = await db
    .select({
      pda: submissions.pda,
      state: submissions.state,
      score: evaluations.score,
      createdAt: submissions.createdAt,
    })
    .from(submissions)
    .leftJoin(
      evaluations,
      sql`${evaluations.submissionPda} = ${submissions.pda}`,
    )
    .where(sql`${submissions.issuePda} = ${issuePda}`);
  return rows.map((r) => ({
    pda: r.pda,
    state: r.state as RankableSubmission["state"],
    score: r.score ?? 0,
    createdAt: r.createdAt instanceof Date ? r.createdAt.getTime() : 0,
  }));
}

/**
 * Persist new rank values. Each row gets `rank` = the value from the
 * assignment (null for ineligible rows).
 *
 * One UPDATE per submission. Row counts are tiny in practice (≤ a few
 * dozen per issue), so we don't bother batching with a CASE expression.
 */
export async function applyRanking(
  db: Db,
  assignments: ReadonlyArray<{ pda: string; rank: number | null }>,
): Promise<void> {
  for (const a of assignments) {
    await db
      .update(submissions)
      .set({ rank: a.rank })
      .where(sql`${submissions.pda} = ${a.pda}`);
  }
}

/**
 * Convenience wrapper: fetch + compute + persist ranks for one issue.
 * The handler calls this after every newly-scored submission.
 */
export async function recomputeRanking(
  db: Db,
  issuePda: string,
): Promise<void> {
  const subs = await fetchSubmissionsForRanking(db, issuePda);
  const ranks = computeRanking(subs);
  await applyRanking(db, ranks);
}

export interface InsertEvaluationInput {
  submissionPda: string;
  source: "stub" | "opus" | "genlayer";
  score: number;
  reasoning?: string;
  /** Full structured Opus report (4 dims + summary). Pass `null` for stub. */
  report?: unknown;
  /** sha256 hex of canonical-JSON report. Empty/null for stub. */
  reportHash?: string;
  retryCount?: number;
  txHash?: string;
  /**
   * GHB-58: optional GenLayer BountyJudge "second-opinion" verdict.
   * Omit (or pass null) when the relayer didn't call GenLayer (feature
   * disabled, contract unreachable, consensus timed out). When set, all
   * four fields land together — partial fills aren't supported by the
   * contract response shape so we don't model that case here.
   */
  genlayer?: {
    score: number;
    status: "passed" | "rejected_by_genlayer";
    dimensions: {
      code_quality: number;
      test_coverage: number;
      requirements_match: number;
      security: number;
    };
    txHash: string;
  } | null;
}

export async function insertEvaluation(
  db: Db,
  input: InsertEvaluationInput,
): Promise<void> {
  await db.insert(evaluations).values({
    submissionPda: input.submissionPda,
    source: input.source,
    score: input.score,
    reasoning: input.reasoning,
    report: input.report ?? null,
    reportHash: input.reportHash || null,
    retryCount: input.retryCount ?? 0,
    txHash: input.txHash,
    genlayerScore: input.genlayer?.score ?? null,
    genlayerStatus: input.genlayer?.status ?? null,
    genlayerDimensions: input.genlayer?.dimensions ?? null,
    genlayerTxHash: input.genlayer?.txHash ?? null,
  });
}

export async function issueExists(db: Db, pda: string): Promise<boolean> {
  const rows = await db
    .select({ pda: issues.pda })
    .from(issues)
    .where(sql`${issues.pda} = ${pda}`)
    .limit(1);
  return rows.length > 0;
}

/* ---------------------------------------------------------------- */
/* GHB-92: notifications written by the relayer                       */
/* ---------------------------------------------------------------- */

/**
 * Resolve the dev's Privy DID (`profiles.user_id`) by submission PDA.
 *
 * Two-hop join via `submission_meta`:
 *   submissions.pda = ? → submissions.id = submission_meta.submission_id
 *                       → submission_meta.submitted_by_user_id
 *
 * Returns null when the dev never logged in (legacy on-chain submissions
 * created before the meta row was wired up) — caller skips the notif.
 */
export async function getSubmittedByUserId(
  db: Db,
  submissionPda: string,
): Promise<string | null> {
  const rows = await db.execute(
    sql`
      SELECT sm.submitted_by_user_id AS user_id
        FROM submissions s
        JOIN submission_meta sm ON sm.submission_id = s.id
       WHERE s.pda = ${submissionPda}
       LIMIT 1
    `,
  );
  // drizzle's `execute` returns a Result; rows accessor varies by driver.
  const list = (rows as unknown as { rows?: Array<{ user_id: string | null }> })
    .rows;
  const flat = Array.isArray(rows) ? rows : list ?? [];
  const first = flat[0] as { user_id?: string | null } | undefined;
  return first?.user_id ?? null;
}

/**
 * Pull title + amount for the notification payload so the dropdown can
 * render "Evaluation ready for 'X' · 250 SOL" without an extra fetch.
 *
 * `amount` is the on-chain raw lamports; the frontend divides by 1e9
 * (SOL_DECIMALS) before display, but we store the raw value for
 * forward-compatibility with future SPL/USDC bounties.
 */
export interface BountyDisplayInfo {
  title: string | null;
  amount: number | string;
  /**
   * GHB-127: company branding snapshot, joined from
   * `bounty_meta.created_by_user_id → companies.user_id`. Persisted on
   * notif payloads so the dev's bell can render the company logo + name
   * without an extra fetch.
   *
   * All three are nullable: legacy bounties created before
   * `bounty_meta` existed, or companies that never filled out their
   * profile (no logo). The bell falls back to initials in that case.
   */
  companyId: string | null;
  companyName: string | null;
  companyAvatarUrl: string | null;
}

export async function getBountyDisplayInfo(
  db: Db,
  issuePda: string,
): Promise<BountyDisplayInfo | null> {
  const rows = await db.execute(
    sql`
      SELECT bm.title       AS title,
             i.amount        AS amount,
             c.user_id       AS company_id,
             c.name          AS company_name,
             c.logo_url      AS company_avatar_url
        FROM issues i
        LEFT JOIN bounty_meta bm ON bm.issue_id = i.id
        LEFT JOIN companies   c  ON c.user_id   = bm.created_by_user_id
       WHERE i.pda = ${issuePda}
       LIMIT 1
    `,
  );
  type Row = {
    title?: string | null;
    amount?: number | string;
    company_id?: string | null;
    company_name?: string | null;
    company_avatar_url?: string | null;
  };
  const list = (rows as unknown as { rows?: Row[] }).rows;
  const flat = Array.isArray(rows) ? (rows as Row[]) : list ?? [];
  const first = flat[0];
  if (!first) return null;
  return {
    title: first.title ?? null,
    amount: first.amount ?? 0,
    companyId: first.company_id ?? null,
    companyName: first.company_name ?? null,
    companyAvatarUrl: first.company_avatar_url ?? null,
  };
}

export type RelayerNotificationKind =
  | "submission_evaluated"
  | "submission_auto_rejected"
  // GHB-184: cap notif kinds — issue-targeted (no submission_id).
  | "bounty_cap_approaching"
  | "bounty_cap_reached";

export interface InsertNotificationInput {
  /** Privy DID of the recipient dev. */
  userId: string;
  kind: RelayerNotificationKind;
  /** Frontend `submissions.id` (uuid). NOT the on-chain PDA. */
  submissionId: string;
  /** Free-form payload — bountyTitle, bountyAmount, score, threshold. */
  payload?: Record<string, unknown>;
}

/**
 * Insert a single row into `notifications`. Bypasses RLS because the
 * relayer connects with the service-role JDBC URL (DATABASE_URL points
 * at the privileged credential). Failures are logged upstream — the
 * caller must not let a missing notif undo the score it just wrote.
 */
export async function insertNotification(
  db: Db,
  input: InsertNotificationInput,
): Promise<void> {
  const payload = JSON.stringify(input.payload ?? {});
  await db.execute(
    sql`
      INSERT INTO notifications
        (user_id, kind, submission_id, issue_id, payload)
      VALUES
        (${input.userId},
         ${input.kind},
         ${input.submissionId},
         NULL,
         ${payload}::jsonb)
    `,
  );
}

/**
 * GHB-184: heads-up at 80% of cap. Targets the company (issue-scoped).
 */
export async function sendCapApproachingNotif(
  db: Db,
  params: {
    bountyOwnerUserId: string;
    issueId: string;
    bountyTitle: string | null;
    reviewEligibleCount: number;
    maxSubmissions: number;
  },
): Promise<void> {
  const payload = JSON.stringify({
    bountyTitle: params.bountyTitle ?? undefined,
    reviewEligibleCount: params.reviewEligibleCount,
    maxSubmissions: params.maxSubmissions,
  });
  await db.execute(sql`
    INSERT INTO notifications (user_id, kind, submission_id, issue_id, payload)
    VALUES (
      ${params.bountyOwnerUserId},
      'bounty_cap_approaching',
      NULL,
      ${params.issueId},
      ${payload}::jsonb
    )
  `);
}

/**
 * GHB-184: cap hit, bounty auto-closed. Targets the company.
 */
export async function sendCapReachedNotif(
  db: Db,
  params: {
    bountyOwnerUserId: string;
    issueId: string;
    bountyTitle: string | null;
    maxSubmissions: number;
  },
): Promise<void> {
  const payload = JSON.stringify({
    bountyTitle: params.bountyTitle ?? undefined,
    maxSubmissions: params.maxSubmissions,
  });
  await db.execute(sql`
    INSERT INTO notifications (user_id, kind, submission_id, issue_id, payload)
    VALUES (
      ${params.bountyOwnerUserId},
      'bounty_cap_reached',
      NULL,
      ${params.issueId},
      ${payload}::jsonb
    )
  `);
}

/**
 * Resolve the frontend submission UUID by on-chain PDA. The relayer only
 * carries the PDA; `notifications.submission_id` references the uuid.
 */
export async function getSubmissionIdByPda(
  db: Db,
  submissionPda: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(sql`${submissions.pda} = ${submissionPda}`)
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * GHB-85 mirror: the off-chain `submission_reviews` row that the
 * frontend reads to render "Auto-rejected". The relayer is the only
 * writer for the `auto_rejected = true` case.
 *
 * Idempotent — uses ON CONFLICT to overwrite. The XOR check from
 * migration 0012 (`NOT (rejected AND approved)`) holds because we only
 * set `rejected=true, approved=false`.
 */
export async function upsertAutoRejectReview(
  db: Db,
  submissionId: string,
  reason: string,
): Promise<void> {
  await db.execute(
    sql`
      INSERT INTO submission_reviews
        (submission_id, rejected, auto_rejected, reject_reason, decided_at)
      VALUES
        (${submissionId}, true, true, ${reason}, now())
      ON CONFLICT (submission_id) DO UPDATE SET
        rejected      = excluded.rejected,
        auto_rejected = excluded.auto_rejected,
        reject_reason = excluded.reject_reason,
        approved      = false,
        decided_at    = excluded.decided_at
    `,
  );
}
