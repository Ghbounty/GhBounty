-- ============================================================================
-- 0013_submission_review_auto_rejected.sql
--
-- GHB-85: distinguish a submission rejected by the company from one
-- auto-rejected because its Opus score landed below the bounty's
-- `reject_threshold`.
--
-- The 0010 migration only had `rejected boolean + reject_reason text`.
-- Both kinds of rejection share that pair (the rejection itself + the
-- reason / score-below-threshold message), but the frontend wants to
-- treat them differently:
--
--   * Auto-rejected: hidden by default in the company review modal so
--     the queue only shows submissions that need a real decision. A
--     toggle reveals them.
--   * Manual rejected: stays visible (the company already triaged it).
--
--   * Dev-side (GHB-90 / GHB-91): the dev's "My submissions" page surfaces
--     "AutoRejected" as a distinct status so the dev knows the company
--     never even looked at the PR — the score is the message.
--
-- Source of truth: when the relayer scores a submission and the score
-- lands below the effective threshold, it writes
-- `rejected=true, auto_rejected=true` and fills `reject_reason` with
-- the score / threshold pair. Until that path lands (blocked on the
-- Opus pipeline), the column stays false everywhere — the existing
-- manual-reject path keeps working unchanged.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE submission_reviews
  ADD COLUMN IF NOT EXISTS auto_rejected boolean NOT NULL DEFAULT false;

-- Sanity: an auto-rejected row must also be `rejected = true`. The two
-- bits are independent in shape (auto_rejected is a refinement of
-- rejected), so it's possible to mistakenly set auto_rejected without
-- the parent flag. Catch that early.
DO $$ BEGIN
  ALTER TABLE submission_reviews
    ADD CONSTRAINT submission_reviews_auto_implies_rejected
    CHECK (NOT auto_rejected OR rejected);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
