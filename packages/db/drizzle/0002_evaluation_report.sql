-- GHB-65: persist Opus structured report on each evaluation row.
--
-- `report`       JSONB  — full 4-section report from Opus (code_quality,
--                          test_coverage, requirements_match, security, summary).
--                          Null for stub evaluations and for genlayer source
--                          (until the GenLayer judge unblocks; then it'll
--                          mirror the Opus report it consumed).
-- `report_hash`  TEXT   — hex sha256 of canonical-JSON report. Matches the
--                          `opus_report_hash` stored onchain at submission time.
--
-- Apply manually until drizzle's journal is consolidated under
-- @ghbounty/db (GHB-158). Both columns are nullable so existing rows are fine.

ALTER TABLE "evaluations"
  ADD COLUMN IF NOT EXISTS "report"      jsonb,
  ADD COLUMN IF NOT EXISTS "report_hash" text;
