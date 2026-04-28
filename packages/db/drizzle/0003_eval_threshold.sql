-- GHB-95: auto-reject submissions whose Opus score falls below the
-- per-issue reject threshold.
--
-- `bounty_meta.reject_threshold` SMALLINT
--   Per-issue threshold in [1, 10]. Null = no auto-rejection (default).
--   Companies set this from the UI when creating / editing a bounty.
--
-- `submission_state` enum gains `auto_rejected`
--   Submissions with score < threshold are flagged off-chain. Onchain
--   `set_score` still runs for transparency; the off-chain state diverges
--   so the company UI can hide rejected submissions from the main view.
--
-- Apply manually until drizzle's journal is consolidated under
-- @ghbounty/db (GHB-158).

ALTER TYPE "submission_state" ADD VALUE IF NOT EXISTS 'auto_rejected';

ALTER TABLE "bounty_meta"
  ADD COLUMN IF NOT EXISTS "reject_threshold" smallint;
