-- 0017_max_submissions_cap.sql
-- GHB-184: optional submission cap (off-chain only).
--
-- Key decision: the cap does NOT touch issues.state (which mirrors on-chain).
-- Instead, bounty_meta.closed_by_cap_at is stamped when the cap is hit, so
-- the off-chain rule never collides with on-chain reality. Two new counters
-- live in their own columns to keep submission_count's semantics intact
-- (it counts everything; review_eligible_count counts only scored+winner).

-- 1. Cap de submissions (nullable = sin cap)
ALTER TABLE bounty_meta ADD COLUMN max_submissions INTEGER;

-- 2. Flag para evitar emitir la notif "80%" más de una vez por bounty
ALTER TABLE bounty_meta ADD COLUMN cap_warning_sent_at TIMESTAMPTZ;

-- 3. Timestamp de cierre por cap (off-chain). null = bounty acepta más PRs.
ALTER TABLE bounty_meta ADD COLUMN closed_by_cap_at TIMESTAMPTZ;

-- 4. Counter de submissions review-eligible (state IN ('scored','winner'))
ALTER TABLE issues ADD COLUMN review_eligible_count INTEGER NOT NULL DEFAULT 0;

-- 5. Backfill: contar submissions ya scored/winner para bounties existentes
UPDATE issues i
SET review_eligible_count = (
  SELECT COUNT(*) FROM submissions s
  WHERE s.issue_pda = i.pda
    AND s.state IN ('scored', 'winner')
);

-- 6. Cleanup release_mode: migrar 1 fila auto -> assisted (única bounty con auto)
UPDATE bounty_meta SET release_mode = 'assisted' WHERE release_mode = 'auto';

-- 7. Cambiar default
ALTER TABLE bounty_meta ALTER COLUMN release_mode SET DEFAULT 'assisted';

-- 8. Index parcial para acelerar el conditional UPDATE atomic en submit-handler
CREATE INDEX IF NOT EXISTS idx_issues_state_open ON issues(state) WHERE state = 'open';
