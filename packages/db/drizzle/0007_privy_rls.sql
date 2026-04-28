-- ============================================================================
-- 0007_privy_rls.sql
--
-- GHB-165: rewrite the per-user RLS policies to compare against the JWT's
-- `sub` claim instead of `auth.uid()`. The bridge route at
-- `/api/auth/privy-bridge` mints HS256 JWTs with the user's Privy DID as
-- `sub`, so `(auth.jwt() ->> 'sub')` resolves to the same value stored in
-- `profiles.user_id`.
--
-- Public SELECT policies stay untouched — anonymous browsing is unchanged.
--
-- This migration is idempotent — safe to re-run.
-- ============================================================================

-- profiles --------------------------------------------------------------
DROP POLICY IF EXISTS profiles_insert_self ON profiles;
CREATE POLICY profiles_insert_self ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS profiles_update_self ON profiles;
CREATE POLICY profiles_update_self ON profiles
  FOR UPDATE TO authenticated
  USING      (user_id = (auth.jwt() ->> 'sub'))
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

-- companies -------------------------------------------------------------
DROP POLICY IF EXISTS companies_modify_self ON companies;
CREATE POLICY companies_modify_self ON companies
  FOR ALL TO authenticated
  USING      (user_id = (auth.jwt() ->> 'sub'))
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

-- developers ------------------------------------------------------------
DROP POLICY IF EXISTS developers_modify_self ON developers;
CREATE POLICY developers_modify_self ON developers
  FOR ALL TO authenticated
  USING      (user_id = (auth.jwt() ->> 'sub'))
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

-- wallets (private to owner) -------------------------------------------
DROP POLICY IF EXISTS wallets_select_self ON wallets;
CREATE POLICY wallets_select_self ON wallets
  FOR SELECT TO authenticated
  USING (user_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS wallets_modify_self ON wallets;
CREATE POLICY wallets_modify_self ON wallets
  FOR ALL TO authenticated
  USING      (user_id = (auth.jwt() ->> 'sub'))
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

-- bounty_meta -----------------------------------------------------------
DROP POLICY IF EXISTS bounty_meta_modify_creator ON bounty_meta;
CREATE POLICY bounty_meta_modify_creator ON bounty_meta
  FOR ALL TO authenticated
  USING      (created_by_user_id = (auth.jwt() ->> 'sub'))
  WITH CHECK (created_by_user_id = (auth.jwt() ->> 'sub'));

-- submission_meta -------------------------------------------------------
DROP POLICY IF EXISTS submission_meta_modify_self ON submission_meta;
CREATE POLICY submission_meta_modify_self ON submission_meta
  FOR ALL TO authenticated
  USING      (submitted_by_user_id = (auth.jwt() ->> 'sub'))
  WITH CHECK (submitted_by_user_id = (auth.jwt() ->> 'sub'));
