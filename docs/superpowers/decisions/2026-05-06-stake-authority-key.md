# Decision — stake/refund authority key

**Date:** 2026-05-06
**Status:** Accepted
**Resolves:** OQ #1 in `docs/superpowers/specs/2026-05-05-ghbounty-mcp-server-design.md`

## Context
The MCP design adds three privileged instructions: `slash_stake_deposit`, `refund_stake_deposit`, and (transitively) the cron paths that automate stake lifecycle. They must execute without the agent's signature — slash should never require the slashed party's consent, and refund runs from a cron when the lock period expires.

The existing escrow program has no global authority. Per-action authority is enforced by signer constraints (`creator` signs `cancel_bounty`, `scorer` signs `set_score`). That model does not extend to slashing.

## Decision
Introduce a new hardcoded `STAKE_AUTHORITY_PUBKEY` in `constants.rs`, matching the pattern Tomi used for the gas station (`GAS_STATION_PUBKEY`). The relayer holds the matching keypair as `STAKE_AUTHORITY_KEYPAIR_JSON` env var.

For dev: generate a fresh keypair (`contracts/solana/keys/stake-authority-dev.json`, gitignored). For mainnet: separate keypair generated on a clean machine, paired with the gas-station mainnet rotation in GHB-179.

## Consequences
- Simple to reason about, matches existing pattern.
- Rotating the authority requires a program redeploy (acceptable; rotation is rare).
- The relayer becomes a trusted-but-bounded actor: it can only execute instructions whose `authority` constraint matches `STAKE_AUTHORITY_PUBKEY`.
- A leaked keypair lets an attacker slash any stake, but cannot drain bounty escrows (those still require the bounty creator's signature). Mitigation: store as a non-extractable Vercel env var, rotate on incident.

## Rejected alternatives
- **Per-action signers (status quo)**: doesn't work for slashing.
- **Multisig PDA**: too complex for v1; revisit if Squads integration ever lands.
- **Program upgrade authority**: conflates upgradability with operational authority. Bad practice.
