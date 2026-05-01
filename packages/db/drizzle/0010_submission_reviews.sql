-- ============================================================================
-- 0010_submission_reviews.sql
--
-- GHB-83 + GHB-84: company-side review actions on individual submissions.
--
-- Adds a new `submission_reviews` table that stores the company's decision
-- (rejected + optional feedback) on each submission. We deliberately do
-- NOT extend `submission_meta` because:
--
--   1. submission_meta is owned by the dev (RLS on submitted_by_user_id) —
--      mixing the company's reject decision into the same row would force
--      the dev's RLS policy to allow updates from a different writer, and
--      Postgres RLS doesn't scope by column.
--
--   2. The on-chain `submissions.state` enum is { pending, scored, winner } —
--      no `rejected` value. Rejection is a soft, off-chain decision that
--      doesn't change escrow custody (the bounty still pays out to the
--      eventual winner via resolve_bounty). Keeping it in its own table
--      keeps the on-chain mirror clean.
--
-- The "winner" path uses the existing `submissions.state = 'winner'` mirror
-- (set by the relayer that observes resolve_bounty), so we don't store
-- winner state here — only rejections.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS submission_reviews (
  submission_id  uuid        PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
  rejected       boolean     NOT NULL DEFAULT false,
  -- Free-form feedback the company writes when rejecting. Capped via UI
  -- (we render a textarea with maxLength); the column is unconstrained
  -- here so we don't bake a length limit into the schema before we know
  -- the right number.
  reject_reason  text,
  decided_by     text        REFERENCES profiles(user_id) ON DELETE SET NULL,
  decided_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS submission_reviews_rejected_idx
  ON submission_reviews(rejected) WHERE rejected = true;

ALTER TABLE submission_reviews ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- RLS: public SELECT, write only by the bounty creator.
--
-- The `submission_reviews_write_creator` policy walks
--   submissions.id  → submissions.issue_pda
--                  → issues.pda    → issues.id
--                  → bounty_meta.issue_id → bounty_meta.created_by_user_id
-- to verify the writing user owns the bounty this submission targets.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS submission_reviews_select_public ON submission_reviews;
CREATE POLICY submission_reviews_select_public ON submission_reviews
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS submission_reviews_write_creator ON submission_reviews;
CREATE POLICY submission_reviews_write_creator ON submission_reviews
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM submissions  s
        JOIN issues       i  ON i.pda      = s.issue_pda
        JOIN bounty_meta  bm ON bm.issue_id = i.id
       WHERE s.id = submission_reviews.submission_id
         AND bm.created_by_user_id = (auth.jwt() ->> 'sub')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM submissions  s
        JOIN issues       i  ON i.pda      = s.issue_pda
        JOIN bounty_meta  bm ON bm.issue_id = i.id
       WHERE s.id = submission_reviews.submission_id
         AND bm.created_by_user_id = (auth.jwt() ->> 'sub')
    )
  );

COMMIT;
