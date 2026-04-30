-- ============================================================================
-- 0009_marketplace_select_policies.sql
--
-- GHB-88: open public SELECT on the marketplace tables so devs (and
-- eventually anonymous visitors) can browse companies + bounties they
-- don't own.
--
-- The 0007 migration only added per-owner ALL policies, which means
-- SELECT is implicitly restricted to the row owner. That's correct for
-- `profiles` and `wallets` (private), but wrong for the marketplace —
-- a dev clicking on a company card can't load the row, and the page
-- shows "Company not found".
--
-- Open SELECT (anon + authenticated) on:
--   - companies (logo + name + description on every bounty card)
--   - developers (winner attribution on resolved bounties)
--   - issues (the marketplace itself)
--   - bounty_meta (UI fields paired 1:1 with issues)
--   - submissions / submission_meta (proposal feed on bounty detail)
--   - evaluations (scores on the ranking page)
--
-- Stays private:
--   - profiles (email lives here — keep it owner-scoped)
--   - wallets (treasury / payout addresses — owner-scoped)
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS companies_select_public ON companies;
CREATE POLICY companies_select_public ON companies
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS developers_select_public ON developers;
CREATE POLICY developers_select_public ON developers
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS issues_select_public ON issues;
CREATE POLICY issues_select_public ON issues
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS bounty_meta_select_public ON bounty_meta;
CREATE POLICY bounty_meta_select_public ON bounty_meta
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS submissions_select_public ON submissions;
CREATE POLICY submissions_select_public ON submissions
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS submission_meta_select_public ON submission_meta;
CREATE POLICY submission_meta_select_public ON submission_meta
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS evaluations_select_public ON evaluations;
CREATE POLICY evaluations_select_public ON evaluations
  FOR SELECT TO anon, authenticated
  USING (true);

COMMIT;
