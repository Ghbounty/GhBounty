-- GHB-98: customizable evaluation criteria per bounty.
--
-- `bounty_meta.evaluation_criteria` TEXT
--   Free-form rubric the company writes when creating / editing a bounty.
--   Injected into the Opus prompt as additional context when scoring
--   `requirements_match`. Null or empty → relayer falls back to a default
--   ("PR must address all requirements, code clean and functional.").
--
--   The string is treated as untrusted content: the relayer caps length,
--   escapes container-tag closures, and wraps it in a tagged delimiter so
--   the LLM treats it as data, not instructions.
--
-- Apply manually until drizzle's journal is consolidated under
-- @ghbounty/db (GHB-158).

ALTER TABLE "bounty_meta"
  ADD COLUMN IF NOT EXISTS "evaluation_criteria" text;
