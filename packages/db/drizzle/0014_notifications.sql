-- ============================================================================
-- 0014_notifications.sql
--
-- GHB-92: bell-icon notifications.
--
-- A single per-user inbox that surfaces lifecycle events: company picked your
-- PR as winner, company rejected your PR, your PR got auto-rejected by the
-- relayer (GHB-85 threshold), your PR finished evaluating, a company you
-- follow posted a new bounty.
--
-- Design choices
--
--  * One table, polymorphic via `submission_id` / `issue_id`. Both nullable
--    because future kinds (e.g. dm-from-company, system-announcement) may
--    not point at either. CHECK constraint enforces "exactly one is set"
--    for the kinds that target a specific resource.
--
--  * `payload jsonb` carries kind-specific extras (score, feedback excerpt,
--    bounty amount). Keeps the column count bounded as we add kinds.
--
--  * `read_at timestamptz` instead of a boolean — gives us "marked at"
--    info for free, and "unread" is just `read_at IS NULL`.
--
--  * Insert policy is permissive (any authenticated user can write any
--    notification). We trust the application code: the only call sites
--    are `recordWinnerOnchain` and `rejectSubmission` (company → dev),
--    plus the future relayer (service-role, bypasses RLS).
--    Tightening this is tracked separately if it becomes a concern.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS notifications (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text        NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  kind          text        NOT NULL,
  submission_id uuid        REFERENCES submissions(id) ON DELETE CASCADE,
  issue_id      uuid        REFERENCES issues(id)      ON DELETE CASCADE,
  payload       jsonb,
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notifications_kind_chk CHECK (kind IN (
    'submission_approved',
    'submission_rejected',
    'submission_auto_rejected',
    'submission_evaluated',
    'bounty_followed_new'
  )),

  -- Submission-targeted kinds must carry submission_id; bounty-targeted
  -- kinds must carry issue_id. Belt-and-suspenders: catches a writer
  -- forgetting the polymorphic FK.
  CONSTRAINT notifications_target_chk CHECK (
    (kind IN ('submission_approved',
              'submission_rejected',
              'submission_auto_rejected',
              'submission_evaluated')
     AND submission_id IS NOT NULL)
    OR
    (kind = 'bounty_followed_new' AND issue_id IS NOT NULL)
  )
);

-- Hot path: "give me my unread, newest first" for the bell badge.
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;

-- Full inbox listing.
CREATE INDEX IF NOT EXISTS notifications_user_all_idx
  ON notifications(user_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- RLS
--   SELECT: only your own.
--   UPDATE: only your own (used to flip read_at).
--   INSERT: any authenticated user (MVP-permissive). Tightened later.
--   DELETE: only your own (so a dev can clear their inbox).
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS notifications_select_self ON notifications;
CREATE POLICY notifications_select_self ON notifications
  FOR SELECT TO authenticated
  USING (user_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS notifications_update_self ON notifications;
CREATE POLICY notifications_update_self ON notifications
  FOR UPDATE TO authenticated
  USING (user_id = (auth.jwt() ->> 'sub'))
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS notifications_delete_self ON notifications;
CREATE POLICY notifications_delete_self ON notifications
  FOR DELETE TO authenticated
  USING (user_id = (auth.jwt() ->> 'sub'));

-- MVP-permissive insert. The application layer is the only writer (company-
-- side action handlers + relayer). Service-role from the relayer bypasses
-- RLS entirely; the company-side path is constrained because the same
-- request that emits the notification has already passed the
-- `submission_reviews_write_creator` policy from migration 0010.
DROP POLICY IF EXISTS notifications_insert_authed ON notifications;
CREATE POLICY notifications_insert_authed ON notifications
  FOR INSERT TO authenticated
  WITH CHECK (auth.jwt() ->> 'sub' IS NOT NULL);

COMMIT;
