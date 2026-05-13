-- GHB-186: add solana-devnet row to chain_registry so that MCP server
-- deployed against devnet can write rows with chain_id='solana-devnet'
-- without FK violations.
--
-- escrow_address is a placeholder until Sprint B (GHB-187) deploys the
-- Anchor program to devnet. Update this value when that happens.

INSERT INTO chain_registry (
  chain_id,
  name,
  rpc_url,
  escrow_address,
  explorer_url,
  token_symbol,
  x402_supported
)
VALUES (
  'solana-devnet',
  'Solana Devnet',
  'https://api.devnet.solana.com',
  'PENDING_DEVNET_DEPLOY_GHB_187',
  'https://explorer.solana.com/?cluster=devnet',
  'SOL',
  false
)
ON CONFLICT (chain_id) DO NOTHING;
