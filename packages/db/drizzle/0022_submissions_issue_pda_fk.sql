-- GHB-191: declare the FK between submissions.issue_pda and issues.pda.
--
-- Without this FK, Supabase Postgrest can't resolve the embed syntax
-- `bounty:issue_pda(creator)` used by tools/submissions/get.ts, returning
-- "Could not find a relationship between 'submissions' and 'issue_pda' in
-- the schema cache".
--
-- The relationship existed semantically (every submission belongs to an
-- issue) but was never declared in schema.ts. issues.pda is UNIQUE, so it
-- qualifies as a FK target.
--
-- Added as NOT VALID because prod has 16 orphan submissions from early
-- devnet testing (all auto_rejected, May 4-8 2026, bounties that no
-- longer exist after program redeploys). The constraint applies to new
-- writes; existing rows are exempt. Postgrest still recognizes NOT VALID
-- FKs for embed resolution. Future cleanup: investigate/delete orphans,
-- then `ALTER TABLE submissions VALIDATE CONSTRAINT
-- submissions_issue_pda_issues_pda_fk;` to promote to fully enforced.

ALTER TABLE "submissions"
  ADD CONSTRAINT "submissions_issue_pda_issues_pda_fk"
  FOREIGN KEY ("issue_pda") REFERENCES "public"."issues"("pda")
  ON DELETE no action ON UPDATE no action
  NOT VALID;
