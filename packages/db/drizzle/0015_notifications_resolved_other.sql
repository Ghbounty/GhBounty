-- ============================================================================
-- 0015_notifications_resolved_other.sql
--
-- Adds a new notification kind so participants in a bounty get pinged when
-- a *different* submission wins. Today only the winner gets a bell ring;
-- the other devs who submitted PRs against the same issue are left in the
-- dark until they manually re-check their profile.
--
-- New kind:
--   bounty_resolved_other — "the bounty you submitted a PR to was awarded
--                          to another submission". Targets submission_id
--                          (the loser's own submission, so clicking the
--                          notif still routes to /app/profile and lands
--                          on their entry).
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_chk;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_chk CHECK (kind IN (
  'submission_approved',
  'submission_rejected',
  'submission_auto_rejected',
  'submission_evaluated',
  'bounty_followed_new',
  'bounty_resolved_other'
));

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_target_chk;
ALTER TABLE notifications ADD CONSTRAINT notifications_target_chk CHECK (
  (kind IN ('submission_approved',
            'submission_rejected',
            'submission_auto_rejected',
            'submission_evaluated',
            'bounty_resolved_other')
   AND submission_id IS NOT NULL)
  OR
  (kind = 'bounty_followed_new' AND issue_id IS NOT NULL)
);

COMMIT;
