-- GHB-96: rank submissions that pass the reject threshold by Opus score.
--
-- `submissions.rank` SMALLINT
--   1-based rank within an issue, ordered by `score` desc with ties broken
--   by `created_at` asc (first submission wins). Null for:
--     - submissions still pending evaluation
--     - submissions in state 'auto_rejected' (filtered out of the ranking)
--
-- The relayer recomputes the rank for an issue every time a new submission
-- is scored, so an existing #1 can be displaced by a higher-scoring
-- newcomer.
--
-- Apply manually until drizzle's journal is consolidated under
-- @ghbounty/db (GHB-158).

ALTER TABLE "submissions"
  ADD COLUMN IF NOT EXISTS "rank" smallint;
