-- ============================================================================
-- 0012_submission_review_approved_flag.sql
--
-- GHB-83 follow-up #2: add `approved boolean` to submission_reviews so the
-- dev/company UI can mirror "this submission won" off-chain, without
-- waiting for the relayer to catch up to `submissions.state = 'winner'`.
--
-- Why this exists: in dev/devnet runs without the relayer, picking a
-- winner pays out via `resolve_bounty` correctly, but the
-- `submissions.state` mirror in Supabase stays "pending" — RLS forbids
-- non-relayer UPDATEs on the on-chain mirror table. So the dev had no
-- in-app signal of their win until the relayer eventually backfilled.
--
-- The 0011 migration only added an optional `approval_feedback` text
-- column. We didn't add a status flag because we hoped the on-chain
-- mirror would be timely. It isn't — so this migration adds:
--
--   `approved` boolean NOT NULL DEFAULT false
--
-- Source of truth precedence (read-side):
--   submissions.state = 'winner'   (relayer mirror — strongest)
--     OR
--   submission_reviews.approved    (off-chain shortcut — fallback)
--
-- Either signal flips the dev/company UI into the "won" state.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE submission_reviews
  ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT false;

-- Defensive: prevent a row that's both rejected AND approved. The UI
-- never tries to set both, but the constraint catches concurrent
-- writes from a future where two reviewers race on the same submission.
DO $$ BEGIN
  ALTER TABLE submission_reviews
    ADD CONSTRAINT submission_reviews_decision_xor
    CHECK (NOT (rejected AND approved));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
