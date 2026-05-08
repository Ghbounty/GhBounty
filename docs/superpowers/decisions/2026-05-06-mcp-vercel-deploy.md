# Decision — Vercel deploy config for ghbounty-mcp

**Date:** 2026-05-06
**Status:** Accepted (manual provisioning pending user action)

## Project
- Slug: `ghbounty-mcp`
- Team: `weareghbounty-6269s-projects` (same as frontend, per OQ #4 decision in `2026-05-06-mcp-vercel-team.md`)
- Framework: Next.js 16
- Root directory: `apps/mcp`
- Region: `iad1`
- `app/api/mcp/[transport]/route.ts` `maxDuration`: 60s
- `vercel.json` config inside `apps/mcp/` already wired

## Provisioning steps (USER, one-time)

### 1. Create the Vercel project
- Open https://vercel.com/new
- Import `Ghbounty/GhBounty` repo (already connected)
- Project name: `ghbounty-mcp`
- Team: `weareghbounty-6269s-projects`
- Root Directory: `apps/mcp`
- Framework Preset: Next.js (auto-detected)
- Build & Output: leave defaults (the repo's `apps/mcp/vercel.json` overrides them)
- DO NOT deploy yet — set env vars first.

### 2. Set env vars (production + preview, in dashboard)

Required in BOTH `production` and `preview`:

| Var | Value |
|---|---|
| `GITHUB_OAUTH_CLIENT_ID` | `Iv23liabu10KaQEjpH9w` (public, from Phase 0 GitHub App) |
| `GITHUB_OAUTH_CLIENT_SECRET` | from `~/.ghbounty/github-app-credentials.json` (or 1Password) |
| `SUPABASE_URL` | same value as the frontend's |
| `SUPABASE_SERVICE_ROLE_KEY` | NEW key — generate in Supabase dashboard, distinct from frontend's. Rotate independently. |
| `SOLANA_RPC_URL` | Helius mainnet for `production`, devnet for `preview` |
| `GAS_STATION_SPONSOR_URL` | `https://www.ghbounty.com/api/gas-station/sponsor` (prod) or preview URL |
| `GAS_STATION_SERVICE_TOKEN` | Generate a random 64-char hex (`openssl rand -hex 32`). Add SAME value to the frontend's env too. |
| `NEXT_PUBLIC_GAS_STATION_PUBKEY` | same as frontend's `GAS_STATION_PUBKEY` |
| `MCP_TOKEN_ENCRYPTION_KEY` | random 32-byte hex (`openssl rand -hex 32`). Used for AES-256-GCM at-rest encryption of GitHub tokens. |
| `GHBOUNTY_PROGRAM_ADDRESS` | `CPZx26QXs3HjwGobr8cVAZEtF1qGzqnNbBdt7h1EwbBg` (Anchor.toml default — replace if program is redeployed) |
| `NEXT_PUBLIC_MCP_BASE_URL` | `https://mcp.ghbounty.com` |

### 3. Provision Upstash Redis via Vercel Marketplace
- Vercel dashboard → `ghbounty-mcp` project → **Storage** tab
- Click **Browse Marketplace** → search **Upstash** → **Redis** → **Connect**
- Plan: Free
- Attach to: Production environment
- Vercel auto-injects `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (no manual entry)
- Repeat for Preview environment (separate instance recommended; ok to share with prod for v1)

### 4. Configure DNS for `mcp.ghbounty.com`
- Vercel dashboard → `ghbounty-mcp` project → **Settings → Domains**
- Add `mcp.ghbounty.com`
- Vercel issues an SSL cert automatically once DNS resolves
- DNS provider (Vercel-managed if the root `ghbounty.com` is also on Vercel): add `CNAME mcp → cname.vercel-dns.com`

### 5. First deploy
- Push the `feat/mcp-phase-1-onboarding` branch (already done by Phase 1 Task 34 below)
- Vercel auto-deploys preview from the PR
- Once PR merges to main, production deploy goes out
- Smoke test:
  ```bash
  curl https://mcp.ghbounty.com/api/health
  ```
  Expected: `{ "ok": true, "service": "ghbounty-mcp", ... }`

## Frontend follow-up needed (separate PR)

The MCP server's `gas-station-client.ts` POSTs to the frontend's `/api/gas-station/sponsor` with a new `x-mcp-service-token` header. The frontend's `gas-station-route-core.ts` needs to accept this auth path (in addition to existing Privy bearer auth).

Tasks for that PR:
- Add `GAS_STATION_SERVICE_TOKEN` to the frontend's prod + preview Vercel env (same value as MCP project)
- Update `frontend/lib/gas-station-route-core.ts` to accept requests with a matching `x-mcp-service-token` header
- Test that requests from the MCP project are accepted; requests with wrong/missing token are rejected (401)

Until that lands, the MCP's `create_account.complete` will fail at the gas-station call with 401. The MCP server itself works in dev (mocked) but cannot complete on-chain submissions in production until the frontend update merges.
