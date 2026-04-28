-- ============================================================================
-- 0006_privy_text_user_id.sql
--
-- GHB-165: switch the off-chain identity layer from Supabase auth UUIDs to
-- Privy DIDs (e.g. "did:privy:cm0abc..."). Privy users do not exist in
-- auth.users, so the FK to auth.users is dropped. RLS policies are rewritten
-- in 0007 to read the JWT's `sub` claim directly (`auth.jwt() ->> 'sub'`).
--
-- This migration is idempotent — safe to re-run.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Drop policies that reference the soon-to-change column types.
--    Recreated against the new text columns in 0007.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS profiles_insert_self          ON profiles;
DROP POLICY IF EXISTS profiles_update_self          ON profiles;
DROP POLICY IF EXISTS companies_modify_self         ON companies;
DROP POLICY IF EXISTS developers_modify_self        ON developers;
DROP POLICY IF EXISTS wallets_select_self           ON wallets;
DROP POLICY IF EXISTS wallets_modify_self           ON wallets;
DROP POLICY IF EXISTS bounty_meta_modify_creator    ON bounty_meta;
DROP POLICY IF EXISTS submission_meta_modify_self   ON submission_meta;

-- ---------------------------------------------------------------------------
-- 2. Drop FKs that pin column types. We recreate the profile-linkage FKs
--    after the type change; the auth.users FK on profiles is dropped for
--    good (Privy users aren't in auth.users).
-- ---------------------------------------------------------------------------

ALTER TABLE profiles         DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;
ALTER TABLE companies        DROP CONSTRAINT IF EXISTS companies_user_id_fkey;
ALTER TABLE developers       DROP CONSTRAINT IF EXISTS developers_user_id_fkey;
ALTER TABLE wallets          DROP CONSTRAINT IF EXISTS wallets_user_id_fkey;
ALTER TABLE bounty_meta      DROP CONSTRAINT IF EXISTS bounty_meta_created_by_user_id_fkey;
ALTER TABLE submission_meta  DROP CONSTRAINT IF EXISTS submission_meta_submitted_by_user_id_fkey;

-- ---------------------------------------------------------------------------
-- 3. Convert uuid columns to text. Any existing rows keep working — their
--    UUIDs serialize to the canonical hex form and remain unique.
-- ---------------------------------------------------------------------------

ALTER TABLE profiles         ALTER COLUMN user_id              TYPE text USING user_id::text;
ALTER TABLE companies        ALTER COLUMN user_id              TYPE text USING user_id::text;
ALTER TABLE developers       ALTER COLUMN user_id              TYPE text USING user_id::text;
ALTER TABLE wallets          ALTER COLUMN user_id              TYPE text USING user_id::text;
ALTER TABLE bounty_meta      ALTER COLUMN created_by_user_id   TYPE text USING created_by_user_id::text;
ALTER TABLE submission_meta  ALTER COLUMN submitted_by_user_id TYPE text USING submitted_by_user_id::text;

-- ---------------------------------------------------------------------------
-- 4. Recreate profile-linkage FKs against the new text columns.
--    profiles.user_id stays the PK; the auth.users FK is intentionally
--    NOT recreated (Privy users live outside Supabase Auth).
-- ---------------------------------------------------------------------------

ALTER TABLE companies
  ADD CONSTRAINT companies_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE;

ALTER TABLE developers
  ADD CONSTRAINT developers_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE;

ALTER TABLE wallets
  ADD CONSTRAINT wallets_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE;

ALTER TABLE bounty_meta
  ADD CONSTRAINT bounty_meta_created_by_user_id_fkey
  FOREIGN KEY (created_by_user_id) REFERENCES profiles(user_id) ON DELETE SET NULL;

ALTER TABLE submission_meta
  ADD CONSTRAINT submission_meta_submitted_by_user_id_fkey
  FOREIGN KEY (submitted_by_user_id) REFERENCES profiles(user_id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 5. Email becomes optional. Privy wallet-only logins start with no email;
--    the user can fill it in during onboarding (or never).
--    The unique index stays — empty values must be NULL, not "".
-- ---------------------------------------------------------------------------

ALTER TABLE profiles ALTER COLUMN email DROP NOT NULL;

COMMIT;
