-- 0020_review_fee.sql
-- GHB-XXX: charge an upfront review fee per bounty, refund the unused portion
-- on cancel.
--
-- The fee is sized at the moment of bounty creation:
--   review_fee_lamports_paid       = max_submissions * cost_per_review * 2
--   review_fee_lamports_per_review = locked-in cost_per_review (lamports), so
--                                    refunds use the same lamport unit even
--                                    if SOL/USD has moved since.
--
-- treasury_refunds is the audit trail. It survives bounty_meta deletion so we
-- can detect repeat-cancel attempts and stay idempotent.

ALTER TABLE bounty_meta
  ADD COLUMN review_fee_lamports_paid BIGINT,
  ADD COLUMN review_fee_lamports_per_review BIGINT;

CREATE TABLE treasury_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Bounty PDA (base58). Not a FK because bounty_meta gets hard-deleted on
  -- cancel; we want the audit row to outlive the bounty.
  bounty_pda TEXT NOT NULL,
  -- 'cancel_refund' for now. Future: 'expiry_refund', etc.
  kind TEXT NOT NULL,
  lamports BIGINT NOT NULL,
  recipient_pubkey TEXT NOT NULL,
  -- Solana tx signature (base58) of the treasury → creator transfer.
  tx_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Idempotency: a second refund attempt for the same (bounty, kind) returns
  -- the existing row instead of double-paying.
  UNIQUE (bounty_pda, kind)
);

CREATE INDEX IF NOT EXISTS idx_treasury_refunds_bounty_pda
  ON treasury_refunds(bounty_pda);
