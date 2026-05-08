# Decision — Vercel team for ghbounty-mcp project

**Date:** 2026-05-06
**Status:** Accepted
**Resolves:** OQ #4 in `docs/superpowers/specs/2026-05-05-ghbounty-mcp-server-design.md`

## Decision
Deploy the `ghbounty-mcp` Vercel project under the same team as the frontend: `weareghbounty-6269`.

## Why same team
- Single billing surface
- Same DNS root (`ghbounty.com`) — DNS records live with the team
- Less context-switching for ops

## Why NOT a separate team
The "isolated team for security" argument is theoretical for v1. The threat model: if the frontend's deploy access is compromised, an attacker would already have access to the customer-facing domain. Putting the MCP server on a separate team doesn't materially reduce blast radius if the same humans have access to both.

## Mitigation
The MCP server uses a separate Supabase service-role key from the frontend's. Rotate independently. Vercel env vars are scoped per-project, so leaking the frontend's vars does NOT leak the MCP's.
