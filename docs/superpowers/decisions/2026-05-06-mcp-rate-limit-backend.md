# Decision — Rate-limit backend (Upstash via Vercel Marketplace)

**Date:** 2026-05-06
**Status:** Accepted
**Resolves:** OQ #5 in `docs/superpowers/specs/2026-05-05-ghbounty-mcp-server-design.md`

## Decision
Use Upstash Redis (`@upstash/redis` + `@upstash/ratelimit`), **provisioned via Vercel Marketplace** (Project → Storage → Browse Marketplace → Upstash → Connect). NO separate Upstash account needed; Vercel manages the integration end-to-end.

## Why Upstash (provisioned via Vercel)
- `@upstash/ratelimit` is purpose-built for serverless: sliding window, fixed window, token bucket — all atomic, all REST-based (no connection pooling issues).
- Mature: years in production at thousands of Vercel deployments.
- Free tier covers our v1 traffic (10K requests/day).
- REST API works from any JS runtime (Edge, Node, browser); no socket setup.
- **Vercel Marketplace provisioning means zero new accounts, single billing through Vercel.**

## Why NOT pure Postgres (Supabase) rate limiting
Considered. Pros: zero new services. Cons: needs an atomic Postgres function (sliding window with row-level locking) — non-trivial SQL, slower (30-50ms p95 vs ~5ms for Redis), risks DB connection saturation under load. Not worth the complexity for v1.

## Setup
- Production Vercel env: connect Upstash Redis instance via Marketplace (sized "Free" or "Pay-as-you-go").
- Preview Vercel env: connect a separate Upstash instance (or share with prod for v1 — only adds noise to metrics, doesn't break anything).
- Vercel auto-injects `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` into the deployment env. No copy-paste of secrets.
- Configured in Task 13 (code) + Task 32 (provisioning during deploy).
