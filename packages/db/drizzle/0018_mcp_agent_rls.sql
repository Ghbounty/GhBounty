-- Migration: 0018_mcp_agent_rls.sql
--
-- RLS for the MCP agent tables (Phase 0). All five tables are accessible
-- ONLY via the service-role key. The MCP server enforces equivalent
-- per-agent policies in code (e.g., agent X can only read its own api_keys).

ALTER TABLE agent_accounts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys         ENABLE ROW LEVEL SECURITY;
ALTER TABLE stake_deposits   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_txs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE slashing_events  ENABLE ROW LEVEL SECURITY;

-- Block all access for anon and authenticated roles. Service role bypasses
-- RLS by default (postgres superuser semantics in Supabase).
CREATE POLICY "agent_accounts_block_anon"  ON agent_accounts  FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "agent_accounts_block_auth"  ON agent_accounts  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY "api_keys_block_anon"        ON api_keys        FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "api_keys_block_auth"        ON api_keys        FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY "stake_deposits_block_anon"  ON stake_deposits  FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "stake_deposits_block_auth"  ON stake_deposits  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY "pending_txs_block_anon"     ON pending_txs     FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "pending_txs_block_auth"     ON pending_txs     FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY "slashing_events_block_anon" ON slashing_events FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY "slashing_events_block_auth" ON slashing_events FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- Indices for hot lookups.
CREATE INDEX api_keys_prefix_idx
  ON api_keys (key_prefix)
  WHERE revoked_at IS NULL;

CREATE INDEX pending_txs_unconsumed_idx
  ON pending_txs (agent_account_id, expires_at)
  WHERE consumed_at IS NULL;
