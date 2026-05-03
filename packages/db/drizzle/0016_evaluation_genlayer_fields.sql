-- GHB-58: persist GenLayer BountyJudge "second-opinion" verdict alongside the
--         primary Sonnet/Opus evaluation.
--
-- Each evaluation row already carries the Sonnet score (`score`), the
-- structured report (`report`), and the on-chain Solana payout signature
-- (`tx_hash`). This migration adds parallel columns so the frontend can render
-- "Sonnet 6 / GenLayer 7" side-by-side without joining a separate table.
--
-- Why columns and not a sibling `evaluations_genlayer` table:
--   - 1:1 cardinality (one GenLayer verdict per Sonnet eval).
--   - All four columns are nullable so submissions that never reached
--     GenLayer (relayer disabled / studionet down / future stub mode)
--     stay legal.
--   - Avoids a JOIN on every read; the existing public SELECT policy on
--     `evaluations` covers the new columns automatically.
--
-- Columns added:
--   genlayer_score      smallint  — consensed integer 1-10 from BountyJudge
--   genlayer_status     text      — "passed" | "rejected_by_genlayer"
--   genlayer_dimensions jsonb     — { code_quality, test_coverage,
--                                     requirements_match, security }
--   genlayer_tx_hash    text      — GenLayer tx hash (0x...) for audit /
--                                   linking the dev to the on-chain verdict
--
-- All four are nullable; missing means "GenLayer wasn't called" or
-- "GenLayer call failed/timed out". The relayer logs the reason elsewhere.

ALTER TABLE "evaluations"
  ADD COLUMN IF NOT EXISTS "genlayer_score"      smallint,
  ADD COLUMN IF NOT EXISTS "genlayer_status"     text,
  ADD COLUMN IF NOT EXISTS "genlayer_dimensions" jsonb,
  ADD COLUMN IF NOT EXISTS "genlayer_tx_hash"    text;

-- Constrain the score to the same 1-10 range we use everywhere. Use a
-- DO block so a re-run doesn't fail when the constraint already exists.
DO $$ BEGIN
  ALTER TABLE "evaluations"
    ADD CONSTRAINT evaluations_genlayer_score_range
    CHECK (genlayer_score IS NULL OR (genlayer_score >= 1 AND genlayer_score <= 10));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "evaluations"
    ADD CONSTRAINT evaluations_genlayer_status_values
    CHECK (genlayer_status IS NULL OR genlayer_status IN ('passed', 'rejected_by_genlayer'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
