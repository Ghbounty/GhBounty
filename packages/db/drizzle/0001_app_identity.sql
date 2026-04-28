-- ============================================================================
-- 0001_app_identity.sql
--
-- Adds the off-chain identity / UI-metadata layer on top of the existing
-- onchain-mirror tables (chain_registry, issues, submissions, evaluations).
--
-- New objects:
--   * Enums:   user_role, release_mode
--   * Tables:  profiles, companies, developers, wallets,
--              bounty_meta, submission_meta
--   * RLS:     enabled on every new table with sane defaults
--
-- This migration is idempotent — safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('company', 'dev');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE release_mode AS ENUM ('auto', 'assisted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- profiles  (1:1 with auth.users)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS profiles (
  user_id              uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role                 user_role   NOT NULL,
  email                text        NOT NULL UNIQUE,
  onboarding_completed boolean     NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profiles_role_idx ON profiles(role);

-- ---------------------------------------------------------------------------
-- companies  (populated when profiles.role = 'company')
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS companies (
  user_id      uuid        PRIMARY KEY REFERENCES profiles(user_id) ON DELETE CASCADE,
  name         text        NOT NULL,
  slug         text        NOT NULL UNIQUE,
  description  text        NOT NULL,
  website      text,
  industry     text,
  logo_url     text,
  github_org   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT companies_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$')
);

CREATE INDEX IF NOT EXISTS companies_slug_idx ON companies(slug);

-- ---------------------------------------------------------------------------
-- developers  (populated when profiles.role = 'dev')
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS developers (
  user_id        uuid        PRIMARY KEY REFERENCES profiles(user_id) ON DELETE CASCADE,
  username       text        NOT NULL UNIQUE,
  github_handle  text,
  bio            text,
  skills         text[]      NOT NULL DEFAULT ARRAY[]::text[],
  avatar_url     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT developers_username_format CHECK (username ~ '^[a-z0-9][a-z0-9_-]{1,38}$')
);

CREATE INDEX IF NOT EXISTS developers_username_idx ON developers(username);

-- ---------------------------------------------------------------------------
-- wallets  (N:1 with profiles, multi-chain)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wallets (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  chain_id     text        NOT NULL REFERENCES chain_registry(chain_id),
  address      text        NOT NULL,
  is_treasury  boolean     NOT NULL DEFAULT false,
  is_payout    boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallets_unique_per_user UNIQUE (user_id, chain_id, address),
  CONSTRAINT wallets_unique_per_chain UNIQUE (chain_id, address)
);

CREATE INDEX IF NOT EXISTS wallets_user_idx ON wallets(user_id);
CREATE INDEX IF NOT EXISTS wallets_chain_addr_idx ON wallets(chain_id, address);

-- ---------------------------------------------------------------------------
-- bounty_meta  (1:1 with issues)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bounty_meta (
  issue_id            uuid          PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
  title               text,
  description         text,
  release_mode        release_mode  NOT NULL DEFAULT 'auto',
  closed_by_user      boolean       NOT NULL DEFAULT false,
  created_by_user_id  uuid          REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bounty_meta_creator_idx ON bounty_meta(created_by_user_id);
CREATE INDEX IF NOT EXISTS bounty_meta_release_mode_idx ON bounty_meta(release_mode);

-- ---------------------------------------------------------------------------
-- submission_meta  (1:1 with submissions)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS submission_meta (
  submission_id         uuid        PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
  note                  text,
  submitted_by_user_id  uuid        REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS submission_meta_submitter_idx ON submission_meta(submitted_by_user_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$ BEGIN
  CREATE TRIGGER profiles_updated_at      BEFORE UPDATE ON profiles      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  CREATE TRIGGER companies_updated_at     BEFORE UPDATE ON companies     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  CREATE TRIGGER developers_updated_at    BEFORE UPDATE ON developers    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  CREATE TRIGGER bounty_meta_updated_at   BEFORE UPDATE ON bounty_meta   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- Row Level Security
--
-- Public reads on identity + bounty metadata (anyone browsing the marketplace
-- can see who posted what). Mutations are restricted to the owning user.
-- Wallets are private to the owner.
-- ===========================================================================

ALTER TABLE profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE developers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE bounty_meta      ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_meta  ENABLE ROW LEVEL SECURITY;

-- profiles --------------------------------------------------------------
DROP POLICY IF EXISTS profiles_select_public ON profiles;
CREATE POLICY profiles_select_public ON profiles
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS profiles_insert_self ON profiles;
CREATE POLICY profiles_insert_self ON profiles
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS profiles_update_self ON profiles;
CREATE POLICY profiles_update_self ON profiles
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- companies -------------------------------------------------------------
DROP POLICY IF EXISTS companies_select_public ON companies;
CREATE POLICY companies_select_public ON companies
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS companies_modify_self ON companies;
CREATE POLICY companies_modify_self ON companies
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- developers ------------------------------------------------------------
DROP POLICY IF EXISTS developers_select_public ON developers;
CREATE POLICY developers_select_public ON developers
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS developers_modify_self ON developers;
CREATE POLICY developers_modify_self ON developers
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- wallets (private) -----------------------------------------------------
DROP POLICY IF EXISTS wallets_select_self ON wallets;
CREATE POLICY wallets_select_self ON wallets
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS wallets_modify_self ON wallets;
CREATE POLICY wallets_modify_self ON wallets
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- bounty_meta -----------------------------------------------------------
DROP POLICY IF EXISTS bounty_meta_select_public ON bounty_meta;
CREATE POLICY bounty_meta_select_public ON bounty_meta
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS bounty_meta_modify_creator ON bounty_meta;
CREATE POLICY bounty_meta_modify_creator ON bounty_meta
  FOR ALL TO authenticated
  USING (created_by_user_id = auth.uid())
  WITH CHECK (created_by_user_id = auth.uid());

-- submission_meta -------------------------------------------------------
DROP POLICY IF EXISTS submission_meta_select_public ON submission_meta;
CREATE POLICY submission_meta_select_public ON submission_meta
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS submission_meta_modify_self ON submission_meta;
CREATE POLICY submission_meta_modify_self ON submission_meta
  FOR ALL TO authenticated
  USING (submitted_by_user_id = auth.uid())
  WITH CHECK (submitted_by_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Existing onchain tables: enable RLS read-only for the marketplace
-- (relayer uses the service_role key and bypasses RLS)
-- ---------------------------------------------------------------------------

ALTER TABLE issues          ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE chain_registry  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS issues_select_public ON issues;
CREATE POLICY issues_select_public ON issues
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS submissions_select_public ON submissions;
CREATE POLICY submissions_select_public ON submissions
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS evaluations_select_public ON evaluations;
CREATE POLICY evaluations_select_public ON evaluations
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS chain_registry_select_public ON chain_registry;
CREATE POLICY chain_registry_select_public ON chain_registry
  FOR SELECT TO anon, authenticated USING (true);
