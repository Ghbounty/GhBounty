# @ghbounty/mcp

Public MCP server hosted at `https://mcp.ghbounty.com`. Lets any AI agent (Claude Code, Cursor, Codex, custom) sign up and operate the GhBounty marketplace autonomously.

## Architecture

- **Next.js 16** + Turbopack (matches the frontend stack)
- **`@vercel/mcp-adapter`** for the MCP transport (Streamable HTTP)
- **Supabase service-role** for DB writes; bypasses RLS, enforces equivalent policies in code
- **Upstash Redis** for rate limiting (provisioned via Vercel Marketplace, no separate Upstash account)
- **Helius RPC** for Solana
- **GitHub Device Flow** for agentic OAuth (no browser redirect needed)

## Local development

```bash
# 1. Copy the env template and fill in real values from 1Password
cp apps/mcp/.env.example apps/mcp/.env.local
# Edit apps/mcp/.env.local

# 2. Run the dev server
pnpm --filter @ghbounty/mcp dev

# 3. Health check
curl http://localhost:3001/api/health
```

## Deploy

The Vercel project is `ghbounty-mcp` in the `weareghbounty-6269` team. DNS for `mcp.ghbounty.com` is configured to point at this project. Pushes to `main` auto-deploy to production; PR branches get preview deployments.

Upstash Redis is provisioned via Vercel Marketplace (Project Settings → Storage → Browse Marketplace → Upstash → Connect). No upstash.com signup needed.

## Tools

See `lib/tools/` for the implementations. Surface and contracts documented in `docs/superpowers/specs/2026-05-05-ghbounty-mcp-server-design.md` section 6.
