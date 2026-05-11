# Ghbounty

> Automated GitHub bounty marketplace with AI-verified PRs. Opus analyzes, GenLayer juries on-chain, humans pick the winner. Solana-first, agent-native via x402 + MCP.

## Quick Start

Prerequisites:

- Node 24+
- pnpm 10+
- Solana CLI

```bash
pnpm install
cp frontend/.env.example frontend/.env.local
cd frontend && pnpm dev
```

Fill in the values in `frontend/.env.local` before starting the frontend.

## What it is

Ghbounty is a bounty platform for GitHub issues where **companies post bounties, developers (human or AI) submit PRs, and an automated evaluation pipeline decides the ranking**. Final winner selection is always human.

The core loop:

1. **Developer** submits a PR against a bounty.
2. **Pre-processor** filters the diff (lockfiles, binaries, generated configs).
3. **Sandbox** (Fly.io) clones the repo, applies the PR, runs the test suite.
4. **Claude Opus** analyzes everything with 200K context, generates a structured report (Code Quality, Test Coverage, Requirements, Security).
5. **GenLayer** scores each dimension on-chain: 5 validators × 5 exec_prompts = 25 independent evaluations under `strict_eq` consensus.
6. **Company** reads only the top-scored PRs (reject threshold filters noise automatically), picks **one** winner, escrow releases the payment.

## Why hybrid (Opus + GenLayer)

GenLayer has a practical ~256-token output ceiling per `exec_prompt`. Asking it to read a full 10K-token PR and emit a verdict is not feasible. So:

- **Opus (off-chain)** does the deep reasoning with long context and produces a compact report.
- **GenLayer (on-chain)** judges each section of the report on a single dimension with a short structured output — exactly what `strict_eq` consensus needs.

Result: descentralized AI jury + reproducible scores + full auditability.

## Status

MVP in progress. Current focus: Phase 1 (Core MVP on Solana).

- [ ] GenLayer multi-call rewrite (INFRA-1, unblocks everything)
- [ ] Solana Anchor escrow program
- [ ] Relayer (Node.js, Railway)
- [ ] Postgres schema + chain registry
- [ ] Dashboards (Next.js + Vercel)
- [ ] Sandbox (Fly.io ephemeral machines)
- [ ] Agents: x402 + MCP server + agent wallets
- [ ] Base as second chain (Phase 2)

## Stack

- **Frontend:** Next.js + Vercel, RainbowKit (EVM) + wallet-adapter (Solana)
- **Backend:** Express + x402 middleware on Railway, MCP server (TypeScript SDK)
- **Data:** Postgres (Neon), R2 (Cloudflare), Claude Opus API
- **On-chain:** Anchor program (Solana MVP), `BountyEscrow.sol` (Base, Phase 2), GenLayer for the jury
- **Sandbox:** Fly.io ephemeral machines (5 min timeout, destroyed after each run)

## Architecture at a glance

Chain-agnostic by design. A `chain_registry` table in Postgres lists every supported chain; adding a chain = inserting a row + deploying the contract. Zero code changes.

The relayer is the only component aware of multiple chains. For EVM it uses `viem` WebSockets; for Solana `@solana/web3.js` with `onAccountChange`. When it detects a `SubmissionCreated`, it runs the pipeline (sandbox → Opus → GenLayer) and calls the escrow on the originating chain to release funds once the company approves a winner.

## Repository layout

```
ghbounty/
├── contracts/
│   ├── genlayer/       # BountyJudge.py (multi-call, strict_eq consensus)
│   └── solana/         # Anchor program (escrow)
├── tests/
│   └── genlayer/       # Local simulator tests
├── relayer/            # Node.js event listener (Railway)
├── backend/            # Express + x402 + MCP server
└── frontend/           # Next.js app
```

Directories are added as each phase lands.

### Stake authority keypair (MCP Phase 0)

Each developer must generate their own dev keypair for the stake authority:

```bash
mkdir -p contracts/solana/keys
solana-keygen new --no-bip39-passphrase --silent \
  --outfile contracts/solana/keys/stake-authority-dev.json
solana-keygen pubkey contracts/solana/keys/stake-authority-dev.json
```

The pubkey is hardcoded in `contracts/solana/programs/ghbounty_escrow/src/constants.rs` as `STAKE_AUTHORITY_PUBKEY`. The keypair is loaded by the relayer via `STAKE_AUTHORITY_KEYPAIR_JSON` env var (see `relayer/.env.example`).

For mainnet rotation, see [GHB-179](https://linear.app/ghbounty/issue/GHB-179).

## License

MIT — see [LICENSE](LICENSE).
