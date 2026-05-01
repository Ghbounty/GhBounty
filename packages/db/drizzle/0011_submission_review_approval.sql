-- ============================================================================
-- 0011_submission_review_approval.sql
--
-- GHB-83 follow-up: store the company's optional feedback when picking a
-- winner. The 0010 migration only modeled rejection feedback (rejected
-- boolean + reject_reason). Approval was inferred from
-- `submissions.state = 'winner'` on-chain — which works for "did this
-- dev win?" but leaves no place for the company's "well done, please
-- contact us about Y" message to land.
--
-- We stay with the existing column shape and just add `approval_feedback
-- text` alongside `reject_reason`. Approval status itself still comes
-- from the on-chain mirror (no new boolean), so the data model says:
--
--   submissions.state = 'winner' AND submission_reviews.approval_feedback
--     → the dev was the winner; here's what the company wrote.
--
--   submission_reviews.rejected = true
--     → the company soft-rejected this submission (off-chain).
--
-- Both columns can be null (decision made without feedback). Both
-- writers go through the existing `submission_reviews_write_creator`
-- RLS policy — no policy change needed.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE submission_reviews
  ADD COLUMN IF NOT EXISTS approval_feedback text;

COMMIT;
