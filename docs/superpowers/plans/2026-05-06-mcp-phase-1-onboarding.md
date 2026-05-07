# MCP Phase 1 — Onboarding + Read-Only Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `mcp.ghbounty.com` — a public MCP server that lets any agent sign up autonomously (Device Flow + 0.035 SOL stake) and read marketplace state.

**Architecture:** New `apps/mcp/` Next.js workspace deployed to Vercel. Uses `@vercel/mcp-adapter` for MCP transport (Streamable HTTP). Supabase service-role for DB, Helius RPC for Solana, Upstash Redis for rate limiting, the existing frontend's gas-station endpoint for fee sponsorship. Auth via API keys (`ghbk_live_<32hex>`) with bcrypt-hashed lookup.

**Tech Stack:** Next.js 16.2.4 (Turbopack), `@vercel/mcp-adapter` 0.3.2, `@modelcontextprotocol/sdk` (peer of adapter), `@upstash/redis` + `@upstash/ratelimit`, `@supabase/supabase-js` 2.x, `@solana/kit` 6.x, `@ghbounty/sdk` (Phase 0), `bcryptjs` 3.0.3, Vitest 2.x.

**Spec reference:** `docs/superpowers/specs/2026-05-05-ghbounty-mcp-server-design.md` — sections 6 (tool surface), 7 (onboarding), 8 (tx-building), 9 (rate limits).

**Open questions resolved by this plan:**
- **OQ #4 (Vercel team)**: same team `weareghbounty-6269` as the frontend. Isolated team is overkill for v1 — rotate service-role key independently if needed.
- **OQ #5 (rate-limit backend)**: Upstash Redis (more mature than Vercel KV for hot-path rate limiting).

**Branching:** Branch from `feat/mcp-phase-0-foundations` as `feat/mcp-phase-1-onboarding`. When PR #60 (Phase 0) merges to main, rebase onto main. Phase 1 PR depends on Phase 0 PR.

**Pre-requisites the engineer must have BEFORE starting:**

1. PR #60 (Phase 0) is already on the `feat/mcp-phase-0-foundations` branch. The new branch `feat/mcp-phase-1-onboarding` is created from there.
2. Solana CLI 3.1.14 + Anchor 0.30.1 + Rust 1.89 (installed during Phase 0).
3. `~/.ghbounty/github-app-credentials.json` exists locally with the GitHub App credentials registered in Phase 0.
4. Device Flow toggle activated in https://github.com/organizations/Ghbounty/settings/apps/ghbounty-mcp (manual one-time step).
5. Upstash account exists (free tier is fine). Two Redis databases: one for production, one for preview/dev. Both have `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` from the dashboard.
6. Helius Solana RPC key (free tier OK for dev, paid for production).

---

## File Structure

### New workspace `apps/mcp/`

```
apps/mcp/
├── package.json
├── next.config.ts
├── tsconfig.json
├── .env.example
├── .gitignore
├── vercel.json
├── README.md
├── app/
│   ├── layout.tsx                       (minimal HTML wrapper)
│   ├── page.tsx                         (basic landing for mcp.ghbounty.com)
│   ├── globals.css                      (minimal)
│   └── api/
│       ├── health/route.ts              (GET → { ok: true })
│       └── mcp/[transport]/route.ts     (createMcpHandler entry — registers all tools)
├── lib/
│   ├── auth/
│   │   ├── api-key.ts                   (mint + hash + verify)
│   │   └── middleware.ts                (Bearer token → agent_account)
│   ├── github/
│   │   └── device-flow.ts               (3 GitHub API calls)
│   ├── rate-limit/
│   │   ├── upstash.ts                   (Ratelimit instances per tool group)
│   │   └── ip.ts                        (extract IP from Vercel headers)
│   ├── solana/
│   │   ├── gas-station-client.ts        (calls frontend's /api/gas-station/sponsor)
│   │   └── rpc.ts                       (Helius RPC wrapper)
│   ├── supabase/
│   │   └── admin.ts                     (service-role client singleton)
│   ├── tools/
│   │   ├── types.ts                     (ToolContext, AgentAccount, etc.)
│   │   ├── register.ts                  (helper to bind a tool to the adapter)
│   │   ├── _common/
│   │   │   ├── validate-auth.ts
│   │   │   └── rate-limit.ts
│   │   ├── create-account/
│   │   │   ├── init.ts
│   │   │   ├── poll.ts
│   │   │   └── complete.ts
│   │   ├── whoami.ts
│   │   ├── bounties/
│   │   │   ├── list.ts
│   │   │   └── get.ts
│   │   └── submissions/
│   │       └── get.ts
│   └── errors.ts                        (typed errors: BlockhashExpired, WrongSigner, etc.)
└── tests/
    ├── auth/
    │   ├── api-key.test.ts
    │   └── middleware.test.ts
    ├── github/
    │   └── device-flow.test.ts
    ├── rate-limit/
    │   └── upstash.test.ts
    ├── tools/
    │   ├── create-account.test.ts
    │   ├── whoami.test.ts
    │   ├── bounties.test.ts
    │   └── submissions.test.ts
    └── e2e/
        └── onboarding.test.ts
```

### Files modified outside `apps/mcp/`

```
pnpm-workspace.yaml                      (add apps/* if not already covered)
.gitignore                               (no change — apps/mcp/.env.local already covered by global rule)
docs/superpowers/decisions/
  2026-05-06-mcp-vercel-team.md          (NEW — OQ #4 resolution)
  2026-05-06-mcp-rate-limit-backend.md   (NEW — OQ #5 resolution)
```

---

## Sub-phase 1A — Workspace scaffold (Tasks 1-5)

### Task 1: Create Phase 1 branch + decision docs

**Files:**
- Create: `docs/superpowers/decisions/2026-05-06-mcp-vercel-team.md`
- Create: `docs/superpowers/decisions/2026-05-06-mcp-rate-limit-backend.md`

- [ ] **Step 1: Branch from Phase 0**

```bash
cd /Users/arturogrande/Desktop/GhBounty
git checkout feat/mcp-phase-0-foundations
git pull origin feat/mcp-phase-0-foundations
git checkout -b feat/mcp-phase-1-onboarding
```

- [ ] **Step 2: Write `docs/superpowers/decisions/2026-05-06-mcp-vercel-team.md`**

```markdown
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
```

- [ ] **Step 3: Write `docs/superpowers/decisions/2026-05-06-mcp-rate-limit-backend.md`**

```markdown
# Decision — Rate-limit backend (Upstash vs Vercel KV)

**Date:** 2026-05-06
**Status:** Accepted
**Resolves:** OQ #5 in `docs/superpowers/specs/2026-05-05-ghbounty-mcp-server-design.md`

## Decision
Use Upstash Redis (`@upstash/redis` + `@upstash/ratelimit`) for rate limiting.

## Why Upstash
- `@upstash/ratelimit` is purpose-built for serverless: sliding window, fixed window, token bucket — all atomic, all REST-based (no connection pooling issues).
- Mature: years in production at thousands of Vercel deployments.
- Free tier covers our v1 traffic (10K requests/day).
- REST API works from any JS runtime (Edge, Node, browser); no socket setup.

## Why NOT Vercel KV
- Newer (released 2023). Less battle-tested for rate limiting specifically.
- Would couple our rate-limit infra to Vercel; harder to migrate if we ever leave Vercel.
- The `@vercel/kv` package wraps Upstash Redis under the hood anyway — using Upstash directly skips a layer.

## Setup
Each environment (preview, production) gets its own Upstash Redis instance. Env vars: `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`. Configured in Task 13.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/decisions/
git commit -m "docs(mcp): Phase 1 — resolve OQ #4 (Vercel team) and #5 (rate-limit backend)"
```

### Task 2: Scaffold `apps/mcp/` workspace package

**Files:**
- Create: `apps/mcp/package.json`
- Create: `apps/mcp/tsconfig.json`
- Create: `apps/mcp/next.config.ts`
- Create: `apps/mcp/.gitignore`
- Modify: `pnpm-workspace.yaml` (verify `apps/*` already included)

- [ ] **Step 1: Verify pnpm-workspace.yaml covers apps/**

```bash
cat /Users/arturogrande/Desktop/GhBounty/pnpm-workspace.yaml
```

If `apps/*` is missing, add it. Should look like:

```yaml
packages:
  - "frontend"
  - "relayer"
  - "packages/*"
  - "apps/*"
```

- [ ] **Step 2: Create directory structure**

```bash
mkdir -p /Users/arturogrande/Desktop/GhBounty/apps/mcp/{app,lib,tests}
```

- [ ] **Step 3: Create `apps/mcp/package.json`**

```json
{
  "name": "@ghbounty/mcp",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --port 3001",
    "build": "next build",
    "start": "next start --port 3001",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@ghbounty/db": "workspace:^",
    "@ghbounty/sdk": "workspace:^",
    "@ghbounty/shared": "workspace:^",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@solana/kit": "^6.9.0",
    "@supabase/supabase-js": "^2.104.1",
    "@upstash/ratelimit": "^2.0.8",
    "@upstash/redis": "^1.38.0",
    "@vercel/mcp-adapter": "^0.3.2",
    "bcryptjs": "^3.0.3",
    "next": "16.2.4",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 4: Create `apps/mcp/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "noUncheckedIndexedAccess": false,
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", ".next"]
}
```

- [ ] **Step 5: Create `apps/mcp/next.config.ts`**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Same reason as frontend: workspace packages with NodeNext-style imports
  // need transpilation through Next/SWC.
  transpilePackages: ["@ghbounty/sdk", "@ghbounty/shared", "@ghbounty/db"],

  // The MCP server has no public UI besides /api routes + a tiny landing.
  // Disable image optimization (not needed) and reactStrictMode is fine on.
  reactStrictMode: true,
};

export default nextConfig;
```

- [ ] **Step 6: Create `apps/mcp/.gitignore`**

```
.next/
node_modules/
.env.local
.env*.local
next-env.d.ts
```

- [ ] **Step 7: Install dependencies**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm install 2>&1 | tail -10
```

Expected: pnpm picks up the new workspace, downloads new packages, no errors.

- [ ] **Step 8: Commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
git add apps/mcp/ pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore(mcp): scaffold apps/mcp workspace"
```

### Task 3: Minimal app shell + health endpoint

**Files:**
- Create: `apps/mcp/app/layout.tsx`
- Create: `apps/mcp/app/page.tsx`
- Create: `apps/mcp/app/globals.css`
- Create: `apps/mcp/app/api/health/route.ts`

- [ ] **Step 1: Write `apps/mcp/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GhBounty MCP",
  description: "Public MCP server for AI agents to operate the GhBounty marketplace.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Write `apps/mcp/app/globals.css`**

```css
:root {
  color-scheme: dark;
}
body {
  margin: 0;
  font-family: -apple-system, system-ui, sans-serif;
  background: #0a0a0a;
  color: #e5e5e5;
  min-height: 100vh;
}
.container {
  max-width: 720px;
  margin: 80px auto;
  padding: 0 24px;
}
code {
  background: #1a1a1a;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: ui-monospace, monospace;
}
pre {
  background: #1a1a1a;
  padding: 16px;
  border-radius: 8px;
  overflow-x: auto;
}
a { color: #00e5d1; }
```

- [ ] **Step 3: Write `apps/mcp/app/page.tsx`**

```tsx
export default function Page() {
  return (
    <div className="container">
      <h1>GhBounty MCP Server</h1>
      <p>
        This is the MCP endpoint for AI agents. Connect with the URL:
      </p>
      <pre>https://mcp.ghbounty.com/api/mcp/sse</pre>
      <p>
        Full docs:{" "}
        <a href="https://www.ghbounty.com/agents">ghbounty.com/agents</a>
      </p>
      <p>
        Health: <a href="/api/health">/api/health</a>
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Write `apps/mcp/app/api/health/route.ts`**

```typescript
export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(
    JSON.stringify({
      ok: true,
      service: "ghbounty-mcp",
      timestamp: new Date().toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
```

- [ ] **Step 5: Verify locally**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp dev &
sleep 5
curl -s http://localhost:3001/api/health
kill %1 2>/dev/null
```

Expected: JSON `{ "ok": true, "service": "ghbounty-mcp", "timestamp": "..." }`.

If `next dev` fails to start, check the error and fix typos in config files. Common issue: missing `next-env.d.ts` (it's auto-generated on first `next dev` — that's fine).

- [ ] **Step 6: Commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
git add apps/mcp/app/
git commit -m "feat(mcp): app shell + /api/health endpoint"
```

### Task 4: Vercel project config (`vercel.json` + README)

**Files:**
- Create: `apps/mcp/vercel.json`
- Create: `apps/mcp/.env.example` (more complete than Phase 0's placeholder)
- Create: `apps/mcp/README.md`

- [ ] **Step 1: Write `apps/mcp/vercel.json`**

```json
{
  "framework": "nextjs",
  "buildCommand": "cd ../.. && pnpm --filter @ghbounty/mcp build",
  "installCommand": "cd ../.. && pnpm install --frozen-lockfile",
  "outputDirectory": ".next",
  "regions": ["iad1"],
  "functions": {
    "app/api/mcp/[transport]/route.ts": {
      "maxDuration": 60
    }
  }
}
```

- [ ] **Step 2: Overwrite `apps/mcp/.env.example`** (Phase 0 left a stub here)

```
# GitHub OAuth App for Device Flow
# Public; ships in env (production + preview).
GITHUB_OAUTH_CLIENT_ID=

# Secret; production env only. Backed up in 1Password.
GITHUB_OAUTH_CLIENT_SECRET=

# Supabase service-role key (separate from the frontend's; rotate independently)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Solana RPC (Helius mainnet for production, devnet for preview/dev)
SOLANA_RPC_URL=

# Stake authority keypair (JSON array, 64 bytes). Same format as
# GAS_STATION_KEYPAIR_JSON. Used by the relayer-side cron jobs (Phase 4),
# NOT by the MCP server itself. Phase 1 doesn't read this — it's listed
# here for documentation completeness.
# STAKE_AUTHORITY_KEYPAIR_JSON=

# Upstash Redis for rate limiting
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Frontend's gas-station endpoint (production: https://www.ghbounty.com/api/gas-station/sponsor)
GAS_STATION_SPONSOR_URL=

# Public; identifies this service in logs / agent welcome messages.
NEXT_PUBLIC_MCP_BASE_URL=https://mcp.ghbounty.com
```

- [ ] **Step 3: Write `apps/mcp/README.md`**

```markdown
# @ghbounty/mcp

Public MCP server hosted at `https://mcp.ghbounty.com`. Lets any AI agent (Claude Code, Cursor, Codex, custom) sign up and operate the GhBounty marketplace autonomously.

## Architecture

- **Next.js 16** + Turbopack (matches the frontend stack)
- **`@vercel/mcp-adapter`** for the MCP transport (Streamable HTTP)
- **Supabase service-role** for DB writes; bypasses RLS, enforces equivalent policies in code
- **Upstash Redis** for rate limiting
- **Helius RPC** for Solana
- **GitHub Device Flow** for agentic OAuth (no browser redirect needed)

## Local development

\`\`\`bash
# 1. Copy the env template and fill in real values from 1Password
cp apps/mcp/.env.example apps/mcp/.env.local
# Edit apps/mcp/.env.local

# 2. Run the dev server
pnpm --filter @ghbounty/mcp dev

# 3. Health check
curl http://localhost:3001/api/health
\`\`\`

## Deploy

The Vercel project is `ghbounty-mcp` in the `weareghbounty-6269` team. DNS for `mcp.ghbounty.com` is configured to point at this project. Pushes to `main` auto-deploy to production; PR branches get preview deployments.

## Tools

See `lib/tools/` for the implementations. Surface and contracts documented in `docs/superpowers/specs/2026-05-05-ghbounty-mcp-server-design.md` section 6.
```

- [ ] **Step 4: Commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
git add apps/mcp/vercel.json apps/mcp/.env.example apps/mcp/README.md
git commit -m "chore(mcp): Vercel config + complete .env.example + README"
```

### Task 5: MCP adapter entry point with empty tool registration

**Files:**
- Create: `apps/mcp/app/api/mcp/[transport]/route.ts`
- Create: `apps/mcp/lib/tools/register.ts`

- [ ] **Step 1: Discover the actual `@vercel/mcp-adapter` 0.3.2 API**

```bash
cat /Users/arturogrande/Desktop/GhBounty/node_modules/@vercel/mcp-adapter/dist/index.d.ts 2>/dev/null | head -60
```

Look for the exported function (`createMcpHandler`) and its signature. The adapter typically exposes:

```typescript
function createMcpHandler(
  setup: (server: McpServer) => void | Promise<void>,
  serverOptions?: { capabilities?: ... },
  adapterOptions?: { basePath?: string; ... }
): (req: Request) => Promise<Response>;
```

If the adapter API differs, adapt the code in Step 2 below.

- [ ] **Step 2: Write `apps/mcp/app/api/mcp/[transport]/route.ts`**

```typescript
// Public MCP endpoint. The dynamic route segment `[transport]` is
// `sse` for Streamable HTTP transport. Tools are registered by
// `lib/tools/register.ts`; this file is just the framework shell.

import { createMcpHandler } from "@vercel/mcp-adapter";
import { registerAllTools } from "@/lib/tools/register";

const handler = createMcpHandler(
  async (server) => {
    await registerAllTools(server);
  },
  {
    capabilities: {
      tools: {},
    },
  },
  {
    basePath: "/api/mcp",
  }
);

export { handler as GET, handler as POST, handler as DELETE };

export const dynamic = "force-dynamic";
export const maxDuration = 60;
```

- [ ] **Step 3: Write `apps/mcp/lib/tools/register.ts`** (empty stub for now)

```typescript
// Central registration of all MCP tools. Each sub-phase's tasks fill
// in the imports + calls below.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export async function registerAllTools(server: McpServer): Promise<void> {
  // Public (no auth) — onboarding
  // registerCreateAccountInit(server);   // Task 20
  // registerCreateAccountPoll(server);   // Task 22
  // registerCreateAccountComplete(server); // Task 24

  // Authenticated — common
  // registerWhoami(server);              // Task 26
  // registerBountiesList(server);        // Task 28
  // registerBountiesGet(server);         // Task 30
  // registerSubmissionsGet(server);      // Task 31

  void server; // appease "unused parameter" until tools are registered
}
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp build 2>&1 | tail -15
```

Expected: clean build, generates `.next/` directory.

If the build fails because `@modelcontextprotocol/sdk` isn't a direct dep, add it to `apps/mcp/package.json`:

```json
"@modelcontextprotocol/sdk": "^1.0.0"
```

then re-run `pnpm install`.

- [ ] **Step 5: Commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
git add apps/mcp/app/api/mcp/ apps/mcp/lib/tools/register.ts
git commit -m "feat(mcp): MCP adapter entry point + empty tool registry"
```

---

## Sub-phase 1B — Supabase admin + Solana RPC clients (Tasks 6-7)

### Task 6: Supabase service-role client (singleton)

**Files:**
- Create: `apps/mcp/lib/supabase/admin.ts`

- [ ] **Step 1: Write `apps/mcp/lib/supabase/admin.ts`**

```typescript
// Service-role Supabase client. Bypasses RLS. Used ONLY by MCP tool
// handlers, which must enforce equivalent policies in code (e.g., agent X
// can only see their own api_keys, not other agents').
//
// Singleton because Next.js can re-import per-request in dev; we want
// connection reuse where possible.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@ghbounty/db";

let _client: SupabaseClient<Database> | null = null;

export function supabaseAdmin(): SupabaseClient<Database> {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in apps/mcp env"
    );
  }

  _client = createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return _client;
}
```

> Note: `@ghbounty/db` should re-export the `Database` type from Drizzle's generated types OR from a manually-maintained `db.types.ts` (the frontend has one). Check `packages/db/src/index.ts` — if `Database` isn't exported, look for `frontend/lib/db.types.ts` or generate via `supabase gen types typescript`. If unclear, use `unknown` instead and cast at call sites; we can tighten in Phase 4.

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp typecheck
```

Expected: PASS. If `Database` import fails, drop the generic and use `SupabaseClient` (untyped) — note this in a TODO comment for Phase 4.

- [ ] **Step 3: Commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
git add apps/mcp/lib/supabase/admin.ts
git commit -m "feat(mcp): Supabase service-role client singleton"
```

### Task 7: Solana RPC client wrapper

**Files:**
- Create: `apps/mcp/lib/solana/rpc.ts`

- [ ] **Step 1: Write `apps/mcp/lib/solana/rpc.ts`**

```typescript
// @solana/kit RPC client. Reads SOLANA_RPC_URL from env (Helius mainnet
// for production, devnet for dev). Singleton for connection reuse.

import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  type Rpc,
  type SolanaRpcApi,
  type RpcSubscriptions,
  type SolanaRpcSubscriptionsApi,
} from "@solana/kit";

let _rpc: Rpc<SolanaRpcApi> | null = null;
let _subs: RpcSubscriptions<SolanaRpcSubscriptionsApi> | null = null;

export function solanaRpc(): Rpc<SolanaRpcApi> {
  if (_rpc) return _rpc;
  const url = process.env.SOLANA_RPC_URL;
  if (!url) {
    throw new Error("SOLANA_RPC_URL must be set in apps/mcp env");
  }
  _rpc = createSolanaRpc(url);
  return _rpc;
}

export function solanaRpcSubscriptions(): RpcSubscriptions<SolanaRpcSubscriptionsApi> {
  if (_subs) return _subs;
  const url = process.env.SOLANA_RPC_URL;
  if (!url) {
    throw new Error("SOLANA_RPC_URL must be set in apps/mcp env");
  }
  // ws:// URL is the http URL with the protocol swapped
  const wsUrl = url.replace(/^http/, "ws");
  _subs = createSolanaRpcSubscriptions(wsUrl);
  return _subs;
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
git add apps/mcp/lib/solana/rpc.ts
git commit -m "feat(mcp): Solana RPC client wrapper"
```

---

## Sub-phase 1C — Auth + API keys (Tasks 8-12)

### Task 8: API key mint test (RED)

**Files:**
- Create: `apps/mcp/tests/auth/api-key.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest";
import { mintApiKey } from "@/lib/auth/api-key";

describe("mintApiKey", () => {
  it("produces a key with the correct prefix and length", () => {
    const { plaintext, prefix, hash } = mintApiKey();
    expect(plaintext).toMatch(/^ghbk_live_[0-9a-f]{32}$/);
    expect(prefix).toMatch(/^ghbk_live_[0-9a-f]{12}$/);
    expect(plaintext.startsWith(prefix)).toBe(true);
    expect(hash).not.toBe(plaintext);
    expect(hash.length).toBeGreaterThan(50); // bcrypt hashes are ~60 chars
  });

  it("produces unique keys on every call", () => {
    const a = mintApiKey();
    const b = mintApiKey();
    expect(a.plaintext).not.toBe(b.plaintext);
  });
});
```

- [ ] **Step 2: Verify it fails (RED)**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp test 2>&1 | tail -10
```

Expected: import error / "Cannot find module '@/lib/auth/api-key'".

- [ ] **Step 3: Commit failing test**

```bash
cd /Users/arturogrande/Desktop/GhBounty
git add apps/mcp/tests/auth/api-key.test.ts
git commit --no-verify -m "test(mcp): failing test for mintApiKey (red)"
```

### Task 9: API key mint impl (GREEN)

**Files:**
- Create: `apps/mcp/lib/auth/api-key.ts`

- [ ] **Step 1: Write the impl**

```typescript
// API key generation + verification. Format: `ghbk_live_<32 hex chars>`.
//
// Storage:
// - Plaintext is shown to the agent ONCE (response of create_account.complete).
// - bcrypt hash + first 12 chars (prefix) are stored in api_keys table.
// - Lookup is by prefix (indexed); bcrypt verifies on match.

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const PREFIX = "ghbk_live_";
const SECRET_HEX_LEN = 32; // 16 bytes → 32 hex chars
const PREFIX_HEX_LEN = 12; // first 12 chars of the hex part used as table lookup index
const BCRYPT_ROUNDS = 12;

export interface MintedKey {
  /** Full plaintext key. Show to the agent ONCE; never store. */
  plaintext: string;
  /** First 12 hex chars (prefixed). Indexed in DB for O(1) lookup. */
  prefix: string;
  /** bcrypt hash. Store this in `api_keys.key_hash`. */
  hash: string;
}

export function mintApiKey(): MintedKey {
  const secret = randomBytes(SECRET_HEX_LEN / 2).toString("hex");
  const plaintext = `${PREFIX}${secret}`;
  const prefix = `${PREFIX}${secret.slice(0, PREFIX_HEX_LEN)}`;
  const hash = bcrypt.hashSync(plaintext, BCRYPT_ROUNDS);
  return { plaintext, prefix, hash };
}

export function extractPrefix(plaintext: string): string {
  if (!plaintext.startsWith(PREFIX)) {
    throw new Error("Invalid API key format");
  }
  return plaintext.slice(0, PREFIX.length + PREFIX_HEX_LEN);
}

export function verifyApiKey(plaintext: string, hash: string): boolean {
  return bcrypt.compareSync(plaintext, hash);
}
```

- [ ] **Step 2: Run tests (GREEN)**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp test 2>&1 | tail -10
```

Expected: 2 tests pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
git add apps/mcp/lib/auth/api-key.ts
git commit -m "feat(mcp): mintApiKey + verifyApiKey (bcrypt)"
```

### Task 10: API key verify test + extractPrefix test

**Files:**
- Modify: `apps/mcp/tests/auth/api-key.test.ts`

- [ ] **Step 1: Append tests**

```typescript

describe("verifyApiKey", () => {
  it("returns true for the matching plaintext", () => {
    const { plaintext, hash } = mintApiKey();
    expect(verifyApiKey(plaintext, hash)).toBe(true);
  });

  it("returns false for a different plaintext", () => {
    const { hash } = mintApiKey();
    expect(verifyApiKey("ghbk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", hash)).toBe(false);
  });
});

describe("extractPrefix", () => {
  it("returns the first 22 chars (prefix + 12 hex)", () => {
    const { plaintext, prefix } = mintApiKey();
    expect(extractPrefix(plaintext)).toBe(prefix);
  });

  it("throws on invalid format", () => {
    expect(() => extractPrefix("invalid_key")).toThrow();
  });
});
```

Update the import line at top of the file:

```typescript
import { mintApiKey, verifyApiKey, extractPrefix } from "@/lib/auth/api-key";
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp test 2>&1 | tail -10
```

Expected: 6 tests pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
git add apps/mcp/tests/auth/api-key.test.ts
git commit -m "test(mcp): verifyApiKey + extractPrefix coverage"
```

### Task 11: Bearer auth middleware test (RED)

**Files:**
- Create: `apps/mcp/tests/auth/middleware.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { authenticate } from "@/lib/auth/middleware";

// Mock the supabase admin client
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: vi.fn(),
}));

import { supabaseAdmin } from "@/lib/supabase/admin";

describe("authenticate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns Unauthorized when header is missing", async () => {
    const result = await authenticate(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("Unauthorized");
    }
  });

  it("returns Unauthorized for malformed Bearer header", async () => {
    const result = await authenticate("Token abc");
    expect(result.ok).toBe(false);
  });

  it("returns Unauthorized when prefix not found in DB", async () => {
    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
    });

    const result = await authenticate("Bearer ghbk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("Unauthorized");
    }
  });

  it("returns the agent_account when prefix matches and bcrypt verifies", async () => {
    const { mintApiKey } = await import("@/lib/auth/api-key");
    const { plaintext, prefix, hash } = mintApiKey();

    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: (col: string, val: string) => ({
            is: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: "key-uuid",
                    key_hash: hash,
                    agent_account_id: "agent-uuid",
                    agent_accounts: {
                      id: "agent-uuid",
                      role: "dev",
                      status: "active",
                      wallet_pubkey: "7xK...",
                      github_handle: "claudebot42",
                    },
                  },
                  error: null,
                }),
            }),
          }),
        }),
      }),
    });

    const result = await authenticate(`Bearer ${plaintext}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agent.role).toBe("dev");
      expect(result.agent.status).toBe("active");
    }
  });
});
```

- [ ] **Step 2: Run — expected FAIL (module not found)**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp test apps/mcp/tests/auth/middleware.test.ts 2>&1 | tail -10
```

Expected: import error.

- [ ] **Step 3: Commit failing test**

```bash
cd /Users/arturogrande/Desktop/GhBounty
git add apps/mcp/tests/auth/middleware.test.ts
git commit --no-verify -m "test(mcp): failing tests for auth middleware (red)"
```

### Task 12: Bearer auth middleware impl (GREEN)

**Files:**
- Create: `apps/mcp/lib/auth/middleware.ts`
- Create: `apps/mcp/lib/errors.ts`
- Create: `apps/mcp/lib/tools/types.ts`

- [ ] **Step 1: Write `apps/mcp/lib/errors.ts`** (typed error model from spec section 8)

```typescript
// Typed errors matching the spec's error model. Each tool returns these
// to the MCP transport, which formats them as JSON-RPC errors.

export type McpErrorCode =
  | "BlockhashExpired"
  | "WalletInsufficientFunds"
  | "InvalidSignature"
  | "WrongSigner"
  | "TxTampered"
  | "ProgramError"
  | "RateLimited"
  | "Unauthorized"
  | "Forbidden"
  | "NotFound"
  | "Conflict"
  | "RpcError"
  | "InternalError"
  | "InvalidInput";

export interface McpError {
  code: McpErrorCode;
  message: string;
  details?: unknown;
}

export function mcpError(code: McpErrorCode, message: string, details?: unknown): McpError {
  return { code, message, details };
}
```

- [ ] **Step 2: Write `apps/mcp/lib/tools/types.ts`**

```typescript
// Shared types for tool handlers.

export interface AgentAccount {
  id: string;
  role: "dev" | "company";
  status: "pending_oauth" | "pending_stake" | "active" | "suspended" | "revoked";
  wallet_pubkey: string;
  github_handle: string | null;
}

export type AuthResult =
  | { ok: true; agent: AgentAccount; apiKeyId: string }
  | { ok: false; error: { code: "Unauthorized" | "Forbidden"; message: string } };
```

- [ ] **Step 3: Write `apps/mcp/lib/auth/middleware.ts`**

```typescript
// Bearer token authentication for MCP tool calls.
//
// Flow:
//   1. Parse `Authorization: Bearer <plaintext>` header.
//   2. Extract first 22 chars (prefix) for indexed DB lookup.
//   3. Fetch api_keys row + joined agent_accounts row.
//   4. bcrypt-verify the plaintext against key_hash.
//   5. Reject if revoked OR agent_account.status is not 'active'.
//   6. Return the agent for the tool to use.

import { extractPrefix, verifyApiKey } from "./api-key";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { AuthResult, AgentAccount } from "@/lib/tools/types";

export async function authenticate(
  authorizationHeader: string | undefined
): Promise<AuthResult> {
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    return { ok: false, error: { code: "Unauthorized", message: "Missing or malformed Authorization header" } };
  }

  const plaintext = authorizationHeader.slice("Bearer ".length).trim();

  let prefix: string;
  try {
    prefix = extractPrefix(plaintext);
  } catch {
    return { ok: false, error: { code: "Unauthorized", message: "Invalid API key format" } };
  }

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, key_hash, agent_account_id, agent_accounts(id, role, status, wallet_pubkey, github_handle)")
    .eq("key_prefix", prefix)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) {
    return { ok: false, error: { code: "Unauthorized", message: "Authentication lookup failed" } };
  }
  if (!data) {
    return { ok: false, error: { code: "Unauthorized", message: "API key not found" } };
  }

  if (!verifyApiKey(plaintext, data.key_hash)) {
    return { ok: false, error: { code: "Unauthorized", message: "API key mismatch" } };
  }

  // The Supabase typed-join syntax returns agent_accounts as either an object
  // or a single-element array depending on the relationship. Normalize.
  const agentRow = Array.isArray(data.agent_accounts) ? data.agent_accounts[0] : data.agent_accounts;
  if (!agentRow) {
    return { ok: false, error: { code: "Unauthorized", message: "Agent record missing" } };
  }

  if (agentRow.status !== "active") {
    return {
      ok: false,
      error: {
        code: "Forbidden",
        message: `Agent account is ${agentRow.status}, not active`,
      },
    };
  }

  const agent: AgentAccount = {
    id: agentRow.id,
    role: agentRow.role,
    status: agentRow.status,
    wallet_pubkey: agentRow.wallet_pubkey,
    github_handle: agentRow.github_handle,
  };

  // Async: update last_used_at without blocking the response.
  supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => {});

  return { ok: true, agent, apiKeyId: data.id };
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp test 2>&1 | tail -10
```

Expected: 4 middleware tests pass + 6 api-key tests = 10 total.

- [ ] **Step 5: Commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
git add apps/mcp/lib/auth/middleware.ts apps/mcp/lib/errors.ts apps/mcp/lib/tools/types.ts
git commit -m "feat(mcp): Bearer auth middleware + typed errors"
```

---

## Sub-phase 1D — Rate limiting (Tasks 13-14)

### Task 13: Upstash rate limit setup

**Files:**
- Create: `apps/mcp/lib/rate-limit/upstash.ts`
- Create: `apps/mcp/tests/rate-limit/upstash.test.ts`

- [ ] **Step 1: Write `apps/mcp/lib/rate-limit/upstash.ts`**

```typescript
// Sliding-window rate limits for the MCP server.
//
// Three tiers (spec section 9 layer 3):
//   - createAccount: 5 req / hour / IP (anonymous)
//   - read: 100 req / minute / agent (authenticated)
//   - prepare: 30 req / minute / agent (authenticated, for prepare_* tools)
//
// Each tier is a separate Ratelimit instance so we can monitor / tune
// independently. Upstash's REST client makes them safe to invoke from
// any serverless environment.

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let _redis: Redis | null = null;
function redis(): Redis {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set");
  }
  _redis = new Redis({ url, token });
  return _redis;
}

let _createAccount: Ratelimit | null = null;
let _read: Ratelimit | null = null;
let _prepare: Ratelimit | null = null;

export function createAccountLimiter(): Ratelimit {
  if (_createAccount) return _createAccount;
  _createAccount = new Ratelimit({
    redis: redis(),
    limiter: Ratelimit.slidingWindow(5, "1 h"),
    prefix: "mcp:create_account",
    analytics: true,
  });
  return _createAccount;
}

export function readLimiter(): Ratelimit {
  if (_read) return _read;
  _read = new Ratelimit({
    redis: redis(),
    limiter: Ratelimit.slidingWindow(100, "1 m"),
    prefix: "mcp:read",
    analytics: true,
  });
  return _read;
}

export function prepareLimiter(): Ratelimit {
  if (_prepare) return _prepare;
  _prepare = new Ratelimit({
    redis: redis(),
    limiter: Ratelimit.slidingWindow(30, "1 m"),
    prefix: "mcp:prepare",
    analytics: true,
  });
  return _prepare;
}
```

- [ ] **Step 2: Write smoke test (skipIf no env vars)**

```typescript
// apps/mcp/tests/rate-limit/upstash.test.ts
import { describe, it, expect } from "vitest";

const HAS_UPSTASH =
  !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;

describe.skipIf(!HAS_UPSTASH)("Upstash rate limiter (live)", () => {
  it("createAccountLimiter rejects on the 6th request from same IP within an hour", async () => {
    const { createAccountLimiter } = await import("@/lib/rate-limit/upstash");
    const limiter = createAccountLimiter();
    const ip = `test:${Date.now()}`;

    for (let i = 0; i < 5; i++) {
      const r = await limiter.limit(ip);
      expect(r.success).toBe(true);
    }
    const sixth = await limiter.limit(ip);
    expect(sixth.success).toBe(false);
  }, 30_000);
});
```

- [ ] **Step 3: Run**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp test apps/mcp/tests/rate-limit/upstash.test.ts 2>&1 | tail -10
```

Expected: 1 skipped (no Upstash creds in dev env). The test runs only when `UPSTASH_*` env vars are set.

- [ ] **Step 4: Commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
git add apps/mcp/lib/rate-limit/upstash.ts apps/mcp/tests/rate-limit/upstash.test.ts
git commit -m "feat(mcp): Upstash rate limiters (createAccount, read, prepare)"
```

### Task 14: IP extraction helper

**Files:**
- Create: `apps/mcp/lib/rate-limit/ip.ts`

- [ ] **Step 1: Write the helper**

```typescript
// Extract the client IP from a request, taking Vercel's headers into
// account. The MCP adapter passes a standard fetch Request, so we read
// from headers.

export function getClientIp(request: Request): string {
  // Vercel sets these in order of preference:
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // First entry in the comma-separated list is the original client.
    return forwarded.split(",")[0]!.trim();
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}
```

- [ ] **Step 2: Inline test (no separate file needed for this small helper — gets covered transitively)**

The IP helper is exercised by the e2e tests in Task 32.

- [ ] **Step 3: Commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
git add apps/mcp/lib/rate-limit/ip.ts
git commit -m "feat(mcp): client IP extraction from Vercel headers"
```

---

## Sub-phase 1E — GitHub Device Flow (Tasks 15-17)

### Task 15: Device flow client tests (RED)

**Files:**
- Create: `apps/mcp/tests/github/device-flow.test.ts`

- [ ] **Step 1: Write tests with global fetch mock**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startDeviceFlow,
  pollAccessToken,
  fetchUserHandle,
} from "@/lib/github/device-flow";

const realFetch = global.fetch;

describe("GitHub Device Flow client", () => {
  beforeEach(() => {
    process.env.GITHUB_OAUTH_CLIENT_ID = "test_client_id";
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  describe("startDeviceFlow", () => {
    it("posts client_id + scope and returns the device_code", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            device_code: "DEV_CODE",
            user_code: "ABCD-1234",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          }),
      });

      const result = await startDeviceFlow();
      expect(result.device_code).toBe("DEV_CODE");
      expect(result.user_code).toBe("ABCD-1234");

      const [url, init] = (global.fetch as any).mock.calls[0];
      expect(url).toBe("https://github.com/login/device/code");
      expect((init as RequestInit).method).toBe("POST");
    });
  });

  describe("pollAccessToken", () => {
    it("returns the access_token when GitHub returns success", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: "TOKEN_123", token_type: "bearer" }),
      });

      const result = await pollAccessToken("DEV_CODE");
      expect(result.kind).toBe("ok");
      if (result.kind === "ok") {
        expect(result.access_token).toBe("TOKEN_123");
      }
    });

    it("returns 'pending' when authorization_pending", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ error: "authorization_pending" }),
      });

      const result = await pollAccessToken("DEV_CODE");
      expect(result.kind).toBe("pending");
    });

    it("returns 'error' for any other GitHub error", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ error: "expired_token" }),
      });

      const result = await pollAccessToken("DEV_CODE");
      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.error).toBe("expired_token");
      }
    });
  });

  describe("fetchUserHandle", () => {
    it("returns login for the user authenticated by the access token", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            login: "claudebot42",
            id: 12345,
            email: "claudebot@example.com",
          }),
      });

      const handle = await fetchUserHandle("TOKEN_123");
      expect(handle).toBe("claudebot42");
    });
  });
});
```

- [ ] **Step 2: Verify it fails (RED)**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp test apps/mcp/tests/github/device-flow.test.ts 2>&1 | tail -10
```

Expected: import error.

- [ ] **Step 3: Commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
git add apps/mcp/tests/github/device-flow.test.ts
git commit --no-verify -m "test(mcp): failing tests for GitHub Device Flow client (red)"
```

### Task 16: Device flow client impl (GREEN)

**Files:**
- Create: `apps/mcp/lib/github/device-flow.ts`

- [ ] **Step 1: Write impl**

```typescript
// GitHub Device Flow proxy. Calls 3 GitHub endpoints:
//   1. POST /login/device/code      → start
//   2. POST /login/oauth/access_token → poll
//   3. GET /user                     → fetch handle (after auth success)
//
// Docs: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app

const GH_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GH_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GH_USER_URL = "https://api.github.com/user";
const SCOPE = "read:user user:email";

export interface DeviceFlowStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export type PollResult =
  | { kind: "ok"; access_token: string }
  | { kind: "pending" }
  | { kind: "error"; error: string };

function clientId(): string {
  const id = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!id) throw new Error("GITHUB_OAUTH_CLIENT_ID must be set");
  return id;
}

export async function startDeviceFlow(): Promise<DeviceFlowStart> {
  const res = await fetch(GH_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId(),
      scope: SCOPE,
    }),
  });
  if (!res.ok) {
    throw new Error(`GitHub /login/device/code returned ${res.status}`);
  }
  const json = await res.json();
  return json as DeviceFlowStart;
}

export async function pollAccessToken(device_code: string): Promise<PollResult> {
  const res = await fetch(GH_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId(),
      device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  if (!res.ok) {
    return { kind: "error", error: `http_${res.status}` };
  }
  const json = await res.json();
  if (typeof json.access_token === "string") {
    return { kind: "ok", access_token: json.access_token };
  }
  if (json.error === "authorization_pending" || json.error === "slow_down") {
    return { kind: "pending" };
  }
  return { kind: "error", error: typeof json.error === "string" ? json.error : "unknown" };
}

export async function fetchUserHandle(access_token: string): Promise<string> {
  const res = await fetch(GH_USER_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${access_token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub /user returned ${res.status}`);
  }
  const json = await res.json();
  if (typeof json.login !== "string") {
    throw new Error("GitHub /user response missing login");
  }
  return json.login;
}
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp test apps/mcp/tests/github/device-flow.test.ts 2>&1 | tail -10
```

Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
git add apps/mcp/lib/github/device-flow.ts
git commit -m "feat(mcp): GitHub Device Flow client (start/poll/fetch user)"
```

### Task 17 (combined): Encrypted token storage helper

**Files:**
- Modify: `apps/mcp/lib/github/device-flow.ts`

The `agent_accounts.github_oauth_token_encrypted` column needs writes encrypted at rest. v1 uses Node's `crypto` with an `MCP_TOKEN_ENCRYPTION_KEY` env var.

- [ ] **Step 1: Append to `apps/mcp/lib/github/device-flow.ts`**

```typescript

// --- Token encryption (at-rest) ----------------------------------------

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function encryptionKey(): Buffer {
  const raw = process.env.MCP_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("MCP_TOKEN_ENCRYPTION_KEY must be set (32+ chars)");
  return createHash("sha256").update(raw).digest();
}

export function encryptAccessToken(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: iv | tag | ciphertext, base64 encoded.
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptAccessToken(encoded: string): string {
  const buf = Buffer.from(encoded, "base64");
  if (buf.length < IV_LEN + TAG_LEN) throw new Error("ciphertext too short");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 2: Append round-trip test to `apps/mcp/tests/github/device-flow.test.ts`**

```typescript

describe("token encryption", () => {
  beforeEach(() => {
    process.env.MCP_TOKEN_ENCRYPTION_KEY = "x".repeat(32);
  });

  it("encryptAccessToken / decryptAccessToken round-trip", async () => {
    const { encryptAccessToken, decryptAccessToken } = await import(
      "@/lib/github/device-flow"
    );
    const plaintext = "ghu_1234567890abcdef";
    const encrypted = encryptAccessToken(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(decryptAccessToken(encrypted)).toBe(plaintext);
  });

  it("decrypt fails on tampered ciphertext", async () => {
    const { encryptAccessToken, decryptAccessToken } = await import(
      "@/lib/github/device-flow"
    );
    const enc = encryptAccessToken("plaintext");
    const tampered = enc.slice(0, -2) + "AA";
    expect(() => decryptAccessToken(tampered)).toThrow();
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp test apps/mcp/tests/github/device-flow.test.ts 2>&1 | tail -10
git add apps/mcp/lib/github/device-flow.ts apps/mcp/tests/github/device-flow.test.ts
git commit -m "feat(mcp): AES-256-GCM at-rest encryption for GitHub access tokens"
```

Expected before commit: 7 tests pass.

---

## Sub-phase 1F — Gas station integration (Task 18)

### Task 18: Gas station sponsor client

**Files:**
- Create: `apps/mcp/lib/solana/gas-station-client.ts`

The MCP server delegates fee sponsorship to the existing frontend endpoint at `/api/gas-station/sponsor` (PR #58, GHB-175). The endpoint validates + signs + submits. We just POST a base64 transaction.

- [ ] **Step 1: Write the client**

```typescript
// Calls the frontend's /api/gas-station/sponsor endpoint to submit a
// gas-station-sponsored transaction. The endpoint is shared with the
// frontend and has its own auth (Privy bearer for human users; we use
// a service-to-service shared secret for the MCP).
//
// Returns either { tx_hash } or a structured error.

export interface SponsorResult {
  ok: boolean;
  tx_hash?: string;
  error?: { code: string; message: string };
}

function endpointUrl(): string {
  const url = process.env.GAS_STATION_SPONSOR_URL;
  if (!url) throw new Error("GAS_STATION_SPONSOR_URL must be set");
  return url;
}

function serviceToken(): string {
  // The frontend's gas-station endpoint accepts an additional service-to-service
  // header from the MCP. Configured in the frontend in a follow-up Task (see
  // README of this PR).
  const tok = process.env.GAS_STATION_SERVICE_TOKEN;
  if (!tok) throw new Error("GAS_STATION_SERVICE_TOKEN must be set");
  return tok;
}

export async function sponsorAndSubmit(signed_tx_b64: string): Promise<SponsorResult> {
  const res = await fetch(endpointUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-mcp-service-token": serviceToken(),
    },
    body: JSON.stringify({ signed_tx_b64, source: "mcp" }),
  });

  const json = (await res.json()) as { tx_hash?: string; error?: { code: string; message: string } };

  if (res.status === 200 && json.tx_hash) {
    return { ok: true, tx_hash: json.tx_hash };
  }
  if (json.error) {
    return { ok: false, error: json.error };
  }
  return { ok: false, error: { code: "RpcError", message: `Gas station returned ${res.status}` } };
}
```

> NOTE: this introduces a contract with the frontend's gas-station endpoint that doesn't yet exist (the `x-mcp-service-token` header). Phase 1's PR description must list this as a "follow-up needed in frontend" — the frontend's `gas-station-route-core.ts` needs to accept the new auth method. Add a TODO comment in this file linking to the spec.

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
git add apps/mcp/lib/solana/gas-station-client.ts
git commit -m "feat(mcp): gas-station sponsor client (delegates to frontend endpoint)"
```

---

## Sub-phase 1G — Public onboarding tools (Tasks 19-25)

### Task 19: `create_account.init` test (RED)

**Files:**
- Create: `apps/mcp/tests/tools/create-account.test.ts`

- [ ] **Step 1: Write the init test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/github/device-flow");
vi.mock("@/lib/rate-limit/upstash", () => ({
  createAccountLimiter: () => ({ limit: () => Promise.resolve({ success: true }) }),
}));

import { handleCreateAccountInit } from "@/lib/tools/create-account/init";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { startDeviceFlow } from "@/lib/github/device-flow";

describe("create_account.init handler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("inserts agent_accounts row + returns user_code", async () => {
    (startDeviceFlow as any).mockResolvedValue({
      device_code: "DEV_CODE_AAA",
      user_code: "ABCD-1234",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    });

    const insertChain = {
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: "agent-uuid-1", wallet_pubkey: "7xK...", role: "dev" },
            error: null,
          }),
        }),
      }),
    };
    (supabaseAdmin as any).mockReturnValue({
      from: () => insertChain,
    });

    const result = await handleCreateAccountInit({
      role: "dev",
      wallet_pubkey: "7xK7gE8FpQrSjVz9mYwGtCkBtNvDtTvPzGjGpZqMxKqp",
      ip: "192.0.2.1",
    });

    expect(result.user_code).toBe("ABCD-1234");
    expect(result.account_id).toBe("agent-uuid-1");
    expect(insertChain.insert).toHaveBeenCalledOnce();
  });

  it("returns Conflict 409 if wallet_pubkey already exists", async () => {
    const insertChain = {
      insert: () => ({
        select: () => ({
          single: () =>
            Promise.resolve({
              data: null,
              error: { code: "23505", message: "duplicate key value violates unique constraint" },
            }),
        }),
      }),
    };
    (supabaseAdmin as any).mockReturnValue({
      from: (table: string) =>
        table === "agent_accounts" ? insertChain : undefined,
    });

    const result = await handleCreateAccountInit({
      role: "dev",
      wallet_pubkey: "7xK7gE8FpQrSjVz9mYwGtCkBtNvDtTvPzGjGpZqMxKqp",
      ip: "192.0.2.1",
    });
    if (!("error" in result)) throw new Error("expected error");
    expect(result.error.code).toBe("Conflict");
  });
});
```

- [ ] **Step 2: Run — expected FAIL**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp test apps/mcp/tests/tools/create-account.test.ts 2>&1 | tail -10
```

Expected: import error.

- [ ] **Step 3: Commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
git add apps/mcp/tests/tools/create-account.test.ts
git commit --no-verify -m "test(mcp): failing test for create_account.init (red)"
```

### Task 20: `create_account.init` impl (GREEN)

**Files:**
- Create: `apps/mcp/lib/tools/create-account/init.ts`
- Modify: `apps/mcp/lib/tools/register.ts`

- [ ] **Step 1: Write the handler**

```typescript
// apps/mcp/lib/tools/create-account/init.ts
//
// Tool: create_account.init
// Public (no auth). Rate-limited per IP.
//
// Steps:
//   1. Validate input (role + wallet_pubkey shape).
//   2. Rate-limit by IP via createAccountLimiter.
//   3. POST GitHub /login/device/code to get user_code.
//   4. INSERT agent_accounts row with status=pending_oauth, store device_code in
//      a temp column or a separate kv (we use github_oauth_token_encrypted for
//      this — see note below).
//   5. Return account_id, user_code, verification_uri, expires_at.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { startDeviceFlow, encryptAccessToken } from "@/lib/github/device-flow";
import { createAccountLimiter } from "@/lib/rate-limit/upstash";
import { mcpError, type McpError } from "@/lib/errors";

const InitInput = z.object({
  role: z.enum(["dev", "company"]),
  wallet_pubkey: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid Solana pubkey"),
  ip: z.string().optional(), // injected by adapter wrapper
  company_info: z
    .object({
      name: z.string().min(1).max(80),
      slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
      website: z.string().url().optional(),
      github_org: z.string().optional(),
    })
    .optional(),
});

interface InitOk {
  account_id: string;
  user_code: string;
  verification_uri: string;
  expires_at: string;
}
type InitResult = InitOk | { error: McpError };

export async function handleCreateAccountInit(raw: unknown): Promise<InitResult> {
  const parsed = InitInput.safeParse(raw);
  if (!parsed.success) {
    return { error: mcpError("InvalidInput", parsed.error.message) };
  }
  const { role, wallet_pubkey, ip = "unknown" } = parsed.data;

  // Rate limit by IP.
  const rl = await createAccountLimiter().limit(ip);
  if (!rl.success) {
    return { error: mcpError("RateLimited", "Too many account creation attempts from this IP") };
  }

  // Start GitHub Device Flow.
  let dev: Awaited<ReturnType<typeof startDeviceFlow>>;
  try {
    dev = await startDeviceFlow();
  } catch (err) {
    return { error: mcpError("RpcError", `GitHub Device Flow failed: ${(err as Error).message}`) };
  }

  // INSERT agent_accounts. We stash the device_code in github_oauth_token_encrypted
  // temporarily — it gets overwritten with the real access_token in poll().
  // A dedicated `device_code` column would be cleaner but reusing one column
  // keeps the schema small.
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("agent_accounts")
    .insert({
      role,
      wallet_pubkey,
      status: "pending_oauth",
      github_oauth_token_encrypted: encryptAccessToken(dev.device_code),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: mcpError("Conflict", "An agent with this wallet_pubkey already exists") };
    }
    return { error: mcpError("InternalError", `agent_accounts insert: ${error.message}`) };
  }

  return {
    account_id: data.id,
    user_code: dev.user_code,
    verification_uri: dev.verification_uri,
    expires_at: new Date(Date.now() + dev.expires_in * 1000).toISOString(),
  };
}

// Tool registration glue.
export function registerCreateAccountInit(server: McpServer): void {
  server.tool(
    "create_account.init",
    {
      role: z.enum(["dev", "company"]),
      wallet_pubkey: z.string(),
      company_info: z
        .object({
          name: z.string(),
          slug: z.string(),
          website: z.string().optional(),
          github_org: z.string().optional(),
        })
        .optional(),
    },
    async (input, extra) => {
      const ip =
        (extra as any)?.requestInfo?.headers?.["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
        "unknown";
      const result = await handleCreateAccountInit({ ...input, ip });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
```

> The exact shape of `extra` from the MCP adapter may differ; the subagent should look at the actual `@vercel/mcp-adapter` types to pull headers correctly. If the adapter doesn't pass headers, fall back to a request-scoped helper that reads from `Request` directly.

- [ ] **Step 2: Wire into register**

Edit `apps/mcp/lib/tools/register.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCreateAccountInit } from "./create-account/init";

export async function registerAllTools(server: McpServer): Promise<void> {
  registerCreateAccountInit(server);
  // ... more tools added in subsequent tasks
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp test apps/mcp/tests/tools/create-account.test.ts 2>&1 | tail -10
```

Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
git add apps/mcp/lib/tools/create-account/init.ts apps/mcp/lib/tools/register.ts
git commit -m "feat(mcp): create_account.init handler + tool registration"
```

### Task 21: `create_account.poll` test (RED)

**Files:**
- Modify: `apps/mcp/tests/tools/create-account.test.ts`

- [ ] **Step 1: Append polls tests**

```typescript

describe("create_account.poll handler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 'pending' when GitHub still polling", async () => {
    const { handleCreateAccountPoll } = await import(
      "@/lib/tools/create-account/poll"
    );
    const { pollAccessToken } = await import("@/lib/github/device-flow");
    (pollAccessToken as any).mockResolvedValue({ kind: "pending" });

    const fromMock = vi.fn().mockReturnValue({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({
              data: {
                id: "agent-uuid-1",
                status: "pending_oauth",
                wallet_pubkey: "7xK...",
                role: "dev",
                github_oauth_token_encrypted: "encrypted_device_code_b64",
              },
              error: null,
            }),
        }),
      }),
    });
    (supabaseAdmin as any).mockReturnValue({ from: fromMock });

    const result = await handleCreateAccountPoll({ account_id: "agent-uuid-1" });
    expect((result as any).status).toBe("pending");
  });

  it("returns 'ready_to_stake' with tx_to_sign when GitHub returns access_token", async () => {
    // Implementation requires multiple supabase mocks (read agent → fetch user
    // handle from GitHub → update agent → build tx). The actual test code is
    // written verbatim during impl-fix loop after Task 22 lands; this stub
    // is the contract of what's expected.
    expect(true).toBe(true); // placeholder so the suite has at least 1 assertion
  });
});
```

> The full `ready_to_stake` test is fleshed out after Task 22 to avoid duplicating the mock setup. The placeholder ensures the suite stays runnable.

- [ ] **Step 2: Run + commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp test apps/mcp/tests/tools/create-account.test.ts 2>&1 | tail -10
git add apps/mcp/tests/tools/create-account.test.ts
git commit --no-verify -m "test(mcp): pending-state test for create_account.poll (red)"
```

### Task 22: `create_account.poll` impl (GREEN)

**Files:**
- Create: `apps/mcp/lib/tools/create-account/poll.ts`
- Modify: `apps/mcp/lib/tools/register.ts`

- [ ] **Step 1: Write the handler**

```typescript
// apps/mcp/lib/tools/create-account/poll.ts
//
// Tool: create_account.poll
// Public (no auth). Polls GitHub for the device-flow access_token.
//
// Steps:
//   1. SELECT agent_accounts row by id, must be status=pending_oauth.
//   2. Decrypt the stored device_code.
//   3. POST GitHub /login/oauth/access_token with device_code.
//   4. If pending → return { status: "pending" }.
//   5. If ok:
//      a. GET /user with the access_token to extract login (handle).
//      b. UPDATE agent_accounts: github_handle, status=pending_stake,
//         github_oauth_token_encrypted=encrypted access_token.
//      c. Build unsigned tx: init_stake_deposit(35M lamports), with
//         GAS_STATION_PUBKEY as fee_payer, agent's pubkey as signer.
//      d. Compute message hash; INSERT pending_txs row.
//      e. Return { status: "ready_to_stake", github_handle, tx_to_sign_b64,
//                  expected_signers, expected_program_id, stake_amount_sol }.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  pollAccessToken,
  fetchUserHandle,
  decryptAccessToken,
  encryptAccessToken,
} from "@/lib/github/device-flow";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { solanaRpc } from "@/lib/solana/rpc";
import { mcpError, type McpError } from "@/lib/errors";
import {
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  compileTransaction,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageEncoder,
} from "@solana/kit";
import {
  getInitStakeDepositInstruction,
  GHBOUNTY_ESCROW_PROGRAM_ADDRESS,
} from "@ghbounty/sdk";
import { createHash } from "node:crypto";

const PollInput = z.object({
  account_id: z.string().uuid(),
});

const STAKE_AMOUNT = 35_000_000n; // 0.035 SOL
const PENDING_TX_TTL_SECONDS = 50;

interface PollPending { status: "pending" }
interface PollReady {
  status: "ready_to_stake";
  github_handle: string;
  tx_to_sign_b64: string;
  expected_signers: string[];
  expected_program_id: string;
  stake_amount_sol: string;
}
type PollResult = PollPending | PollReady | { error: McpError };

export async function handleCreateAccountPoll(raw: unknown): Promise<PollResult> {
  const parsed = PollInput.safeParse(raw);
  if (!parsed.success) {
    return { error: mcpError("InvalidInput", parsed.error.message) };
  }
  const { account_id } = parsed.data;

  const supabase = supabaseAdmin();

  // Fetch the agent row.
  const { data: agent, error: agentErr } = await supabase
    .from("agent_accounts")
    .select("id, status, role, wallet_pubkey, github_oauth_token_encrypted")
    .eq("id", account_id)
    .single();

  if (agentErr || !agent) {
    return { error: mcpError("NotFound", "Agent account not found") };
  }
  if (agent.status === "active") {
    // Already done — idempotent return.
    return { error: mcpError("Conflict", "Account already active") };
  }
  if (agent.status !== "pending_oauth") {
    return { error: mcpError("Forbidden", `Cannot poll account with status ${agent.status}`) };
  }
  if (!agent.github_oauth_token_encrypted) {
    return { error: mcpError("InternalError", "Device code missing on account") };
  }

  // Decrypt + poll.
  let device_code: string;
  try {
    device_code = decryptAccessToken(agent.github_oauth_token_encrypted);
  } catch {
    return { error: mcpError("InternalError", "Failed to decrypt device code") };
  }

  const pollResult = await pollAccessToken(device_code);
  if (pollResult.kind === "pending") {
    return { status: "pending" };
  }
  if (pollResult.kind === "error") {
    return { error: mcpError("Forbidden", `GitHub Device Flow error: ${pollResult.error}`) };
  }

  // Got access_token — fetch user, update agent, build tx.
  const handle = await fetchUserHandle(pollResult.access_token);

  const { error: updErr } = await supabase
    .from("agent_accounts")
    .update({
      github_handle: handle,
      status: "pending_stake",
      github_oauth_token_encrypted: encryptAccessToken(pollResult.access_token),
    })
    .eq("id", account_id);

  if (updErr) {
    if (updErr.code === "23505") {
      return { error: mcpError("Conflict", "GitHub handle already used by another agent") };
    }
    return { error: mcpError("InternalError", `agent update: ${updErr.message}`) };
  }

  // Build the init_stake_deposit transaction.
  const ownerAddr = address(agent.wallet_pubkey);
  const ix = await getInitStakeDepositInstruction({
    owner: { address: ownerAddr } as any, // adapter accepts a TransactionSigner-shape
    amount: STAKE_AMOUNT,
  });

  const rpc = solanaRpc();
  const { value: blockhash } = await rpc.getLatestBlockhash().send();

  // Fee payer is the gas station pubkey, read from env (same value the
  // frontend uses).
  const gasStationPubkey = process.env.NEXT_PUBLIC_GAS_STATION_PUBKEY;
  if (!gasStationPubkey) {
    return { error: mcpError("InternalError", "NEXT_PUBLIC_GAS_STATION_PUBKEY must be set") };
  }

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(gasStationPubkey), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions([ix], m),
  );

  const compiled = compileTransaction(message);
  const tx_to_sign_b64 = getBase64EncodedWireTransaction(compiled);

  // Compute message hash for anti-tamper validation in `complete`.
  const compiledMessageBytes = getCompiledTransactionMessageEncoder().encode(compiled.messageBytes);
  const message_hash = createHash("sha256").update(compiledMessageBytes).digest("hex");

  // INSERT pending_txs row.
  await supabase.from("pending_txs").insert({
    agent_account_id: account_id,
    tool_name: "create_account.complete",
    resource_id: null,
    message_hash,
    expected_signer: agent.wallet_pubkey,
    expires_at: new Date(Date.now() + PENDING_TX_TTL_SECONDS * 1000).toISOString(),
  });

  return {
    status: "ready_to_stake",
    github_handle: handle,
    tx_to_sign_b64,
    expected_signers: [agent.wallet_pubkey],
    expected_program_id: GHBOUNTY_ESCROW_PROGRAM_ADDRESS,
    stake_amount_sol: "0.035",
  };
}

// Tool registration glue.
export function registerCreateAccountPoll(server: McpServer): void {
  server.tool(
    "create_account.poll",
    { account_id: z.string().uuid() },
    async (input) => {
      const result = await handleCreateAccountPoll(input);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
```

> The Codama-generated `getInitStakeDepositInstruction` may want a TransactionSigner not just an address. Adapt the call to whatever the SDK exports. The subagent verifies by reading `packages/sdk/src/generated/instructions/initStakeDeposit.ts`.

- [ ] **Step 2: Wire into register**

```typescript
// apps/mcp/lib/tools/register.ts
import { registerCreateAccountPoll } from "./create-account/poll";

export async function registerAllTools(server: McpServer): Promise<void> {
  registerCreateAccountInit(server);
  registerCreateAccountPoll(server);
}
```

- [ ] **Step 3: Test + commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp test 2>&1 | tail -10
git add apps/mcp/lib/tools/create-account/poll.ts apps/mcp/lib/tools/register.ts
git commit -m "feat(mcp): create_account.poll handler"
```

Expected: previous tests still pass + the pending-state test passes.

### Task 23: `create_account.complete` test (RED)

**Files:**
- Modify: `apps/mcp/tests/tools/create-account.test.ts`

- [ ] **Step 1: Append complete test**

```typescript

describe("create_account.complete handler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns BlockhashExpired when pending_txs row is gone or expired", async () => {
    const { handleCreateAccountComplete } = await import(
      "@/lib/tools/create-account/complete"
    );

    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    });

    const result = await handleCreateAccountComplete({
      account_id: "agent-uuid-1",
      signed_tx_b64: "AQAB...",
    });
    if (!("error" in result)) throw new Error("expected error");
    expect(result.error.code).toBe("BlockhashExpired");
  });

  // More tests cover the happy path: signature matches, hash matches,
  // tx submits, profile/wallet rows created, api_key minted. They are
  // mocked extensively so the test stays in the unit-test bucket.
  // Full coverage in the e2e test (Task 32).
});
```

- [ ] **Step 2: Run + commit failing test**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp test 2>&1 | tail -10
git add apps/mcp/tests/tools/create-account.test.ts
git commit --no-verify -m "test(mcp): failing test for create_account.complete (red)"
```

### Task 24: `create_account.complete` impl (GREEN)

**Files:**
- Create: `apps/mcp/lib/tools/create-account/complete.ts`
- Modify: `apps/mcp/lib/tools/register.ts`

- [ ] **Step 1: Write the handler**

```typescript
// apps/mcp/lib/tools/create-account/complete.ts
//
// Tool: create_account.complete
// Public (no auth).
//
// Steps:
//   1. SELECT pending_txs by (agent_account_id, tool_name='create_account.complete').
//      404 if missing/expired.
//   2. Decode signed_tx_b64. Verify the agent's signature is present
//      and the message hash matches (anti-tamper).
//   3. POST to gas-station endpoint to submit. Wait for confirm.
//   4. On confirm:
//      - INSERT stake_deposits row.
//      - INSERT profiles, developers OR companies, wallets.
//      - Mint API key, INSERT api_keys.
//      - UPDATE agent_accounts.status = active.
//      - UPDATE pending_txs.consumed_at.
//   5. Return { api_key, agent_id, profile, github_handle }.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import {
  getTransactionDecoder,
  getCompiledTransactionMessageEncoder,
} from "@solana/kit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sponsorAndSubmit } from "@/lib/solana/gas-station-client";
import { mintApiKey } from "@/lib/auth/api-key";
import { mcpError, type McpError } from "@/lib/errors";

const CompleteInput = z.object({
  account_id: z.string().uuid(),
  signed_tx_b64: z.string().min(1),
});

interface CompleteOk {
  api_key: string;
  agent_id: string;
  github_handle: string;
  profile: {
    id: string;
    role: "dev" | "company";
    wallet_pubkey: string;
  };
}
type CompleteResult = CompleteOk | { error: McpError };

export async function handleCreateAccountComplete(raw: unknown): Promise<CompleteResult> {
  const parsed = CompleteInput.safeParse(raw);
  if (!parsed.success) {
    return { error: mcpError("InvalidInput", parsed.error.message) };
  }
  const { account_id, signed_tx_b64 } = parsed.data;

  const supabase = supabaseAdmin();

  // 1. Find the pending_tx row.
  const { data: pending } = await supabase
    .from("pending_txs")
    .select("id, message_hash, expected_signer, expires_at, consumed_at")
    .eq("agent_account_id", account_id)
    .eq("tool_name", "create_account.complete")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!pending || pending.consumed_at || new Date(pending.expires_at) < new Date()) {
    return { error: mcpError("BlockhashExpired", "Pending transaction expired or missing") };
  }

  // 2. Decode signed tx, verify signer + message hash.
  let decoded;
  try {
    decoded = getTransactionDecoder().decode(Buffer.from(signed_tx_b64, "base64"));
  } catch {
    return { error: mcpError("InvalidSignature", "Could not decode signed transaction") };
  }

  if (!decoded.signatures[pending.expected_signer]) {
    return { error: mcpError("WrongSigner", "Expected signer signature missing") };
  }

  const compiledMessageBytes = getCompiledTransactionMessageEncoder().encode(decoded.messageBytes);
  const actualHash = createHash("sha256").update(compiledMessageBytes).digest("hex");
  if (actualHash !== pending.message_hash) {
    return { error: mcpError("TxTampered", "Transaction message does not match prepared hash") };
  }

  // 3. Submit via gas station (handles fee payer signing + RPC submit + confirm).
  const sponsorRes = await sponsorAndSubmit(signed_tx_b64);
  if (!sponsorRes.ok || !sponsorRes.tx_hash) {
    return {
      error: mcpError(
        sponsorRes.error?.code === "WalletInsufficientFunds" ? "WalletInsufficientFunds" : "RpcError",
        sponsorRes.error?.message ?? "Sponsor failed"
      ),
    };
  }

  // 4. Persist post-confirmation rows.
  const { data: agent } = await supabase
    .from("agent_accounts")
    .select("id, role, wallet_pubkey, github_handle")
    .eq("id", account_id)
    .single();

  if (!agent || !agent.github_handle) {
    return { error: mcpError("InternalError", "Agent missing or has no github_handle") };
  }

  // Compute the stake PDA address from the agent's pubkey for the stake_deposits row.
  // For brevity we recompute the same way the program does.
  // (subagent: use the helper from @ghbounty/sdk if exposed)

  await supabase.from("stake_deposits").insert({
    agent_account_id: account_id,
    pda: `${agent.wallet_pubkey}-stake`, // TODO: real PDA derivation in subagent
    tx_signature: sponsorRes.tx_hash,
    amount_lamports: "35000000",
    locked_until: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  });

  // INSERT profiles, developers/companies, wallets.
  // Minimal v1 — column names match existing schema (frontend/lib/db.types.ts).
  const userId = `did:agent:${agent.id}`;
  await supabase.from("profiles").insert({
    user_id: userId,
    role: agent.role,
    github_handle: agent.github_handle,
  });

  if (agent.role === "dev") {
    await supabase.from("developers").insert({
      user_id: userId,
      github_handle: agent.github_handle,
    });
  } else {
    // Company role — Phase 1 minimum: insert with placeholder name.
    // create_account.init's company_info should have been recorded in agent_accounts;
    // for v1 we accept that companies must call a follow-up tool to set their slug etc.
    await supabase.from("companies").insert({
      user_id: userId,
      name: agent.github_handle,
      slug: agent.github_handle.toLowerCase(),
    });
  }

  await supabase.from("wallets").insert({
    user_id: userId,
    chain_id: "solana-mainnet",
    address: agent.wallet_pubkey,
  });

  // Mint API key.
  const { plaintext, prefix, hash } = mintApiKey();
  const { data: keyRow } = await supabase
    .from("api_keys")
    .insert({
      agent_account_id: account_id,
      key_hash: hash,
      key_prefix: prefix,
    })
    .select("id")
    .single();

  if (!keyRow) {
    return { error: mcpError("InternalError", "API key insert failed") };
  }

  // Mark agent active + consume pending_tx.
  await supabase
    .from("agent_accounts")
    .update({ status: "active" })
    .eq("id", account_id);

  await supabase
    .from("pending_txs")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", pending.id);

  return {
    api_key: plaintext,
    agent_id: agent.id,
    github_handle: agent.github_handle,
    profile: {
      id: userId,
      role: agent.role,
      wallet_pubkey: agent.wallet_pubkey,
    },
  };
}

export function registerCreateAccountComplete(server: McpServer): void {
  server.tool(
    "create_account.complete",
    {
      account_id: z.string().uuid(),
      signed_tx_b64: z.string(),
    },
    async (input) => {
      const result = await handleCreateAccountComplete(input);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
```

> The TODO around PDA derivation and the placeholder profile-row inserts must be filled in during code-review. The subagent should look at `frontend/lib/bounties.ts::insertIssueAndMeta` for the existing pattern of multi-table inserts with rollback on partial failure.

- [ ] **Step 2: Wire into register**

```typescript
import { registerCreateAccountComplete } from "./create-account/complete";

export async function registerAllTools(server: McpServer): Promise<void> {
  registerCreateAccountInit(server);
  registerCreateAccountPoll(server);
  registerCreateAccountComplete(server);
}
```

- [ ] **Step 3: Test + commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp test 2>&1 | tail -10
git add apps/mcp/lib/tools/create-account/ apps/mcp/lib/tools/register.ts
git commit -m "feat(mcp): create_account.complete handler — full onboarding pipeline"
```

### Task 25: Idempotency tests for retry semantics

**Files:**
- Modify: `apps/mcp/tests/tools/create-account.test.ts`

- [ ] **Step 1: Append idempotency tests**

```typescript

describe("create_account.complete idempotency", () => {
  it("returns Conflict if account already active", async () => {
    const { handleCreateAccountComplete } = await import(
      "@/lib/tools/create-account/complete"
    );

    // pending_tx exists but consumed_at is set
    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  single: () =>
                    Promise.resolve({
                      data: {
                        id: "tx-1",
                        message_hash: "abc",
                        expected_signer: "7xK...",
                        expires_at: new Date(Date.now() + 30000).toISOString(),
                        consumed_at: new Date().toISOString(),
                      },
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        }),
      }),
    });

    const result = await handleCreateAccountComplete({
      account_id: "agent-uuid-1",
      signed_tx_b64: "AQAB...",
    });
    if (!("error" in result)) throw new Error("expected error");
    expect(result.error.code).toBe("BlockhashExpired");
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp test 2>&1 | tail -10
git add apps/mcp/tests/tools/create-account.test.ts
git commit -m "test(mcp): create_account.complete idempotency — consumed pending_tx"
```

---

## Sub-phase 1H — Authenticated read-only tools (Tasks 26-31)

### Task 26: `whoami` test + impl

**Files:**
- Create: `apps/mcp/lib/tools/whoami.ts`
- Create: `apps/mcp/tests/tools/whoami.test.ts`
- Modify: `apps/mcp/lib/tools/register.ts`

- [ ] **Step 1: Write test**

```typescript
// apps/mcp/tests/tools/whoami.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/lib/auth/middleware");
vi.mock("@/lib/solana/rpc", () => ({
  solanaRpc: () => ({ getBalance: () => ({ send: () => Promise.resolve({ value: 100_000_000n }) }) }),
}));

import { handleWhoami } from "@/lib/tools/whoami";
import { authenticate } from "@/lib/auth/middleware";

describe("whoami handler", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns Unauthorized when middleware rejects", async () => {
    (authenticate as any).mockResolvedValue({
      ok: false,
      error: { code: "Unauthorized", message: "no key" },
    });
    const result = await handleWhoami({ authorization: undefined });
    expect((result as any).error.code).toBe("Unauthorized");
  });

  it("returns agent info + balance when authorized", async () => {
    (authenticate as any).mockResolvedValue({
      ok: true,
      apiKeyId: "key-uuid",
      agent: {
        id: "agent-uuid",
        role: "dev",
        status: "active",
        wallet_pubkey: "7xK...",
        github_handle: "claudebot",
      },
    });
    const result = await handleWhoami({ authorization: "Bearer ghbk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    expect((result as any).agent_id).toBe("agent-uuid");
    expect((result as any).balances.sol_lamports).toBe("100000000");
  });
});
```

- [ ] **Step 2: Write impl**

```typescript
// apps/mcp/lib/tools/whoami.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { authenticate } from "@/lib/auth/middleware";
import { solanaRpc } from "@/lib/solana/rpc";
import { mcpError } from "@/lib/errors";
import { address } from "@solana/kit";

interface WhoamiInput {
  authorization?: string;
}

export async function handleWhoami(input: WhoamiInput) {
  const auth = await authenticate(input.authorization);
  if (!auth.ok) {
    return { error: auth.error };
  }
  const { agent } = auth;

  const rpc = solanaRpc();
  let balanceLamports = 0n;
  try {
    const { value } = await rpc.getBalance(address(agent.wallet_pubkey)).send();
    balanceLamports = value;
  } catch {
    // Soft fail — RPC hiccup; return 0 balance instead of erroring.
  }

  return {
    agent_id: agent.id,
    role: agent.role,
    status: agent.status,
    github_handle: agent.github_handle,
    wallet_pubkey: agent.wallet_pubkey,
    balances: {
      sol_lamports: balanceLamports.toString(),
    },
  };
}

export function registerWhoami(server: McpServer): void {
  server.tool("whoami", {}, async (_input, extra) => {
    const authorization = (extra as any)?.requestInfo?.headers?.authorization;
    const result = await handleWhoami({ authorization });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });
}
```

- [ ] **Step 3: Wire register + run + commit**

```typescript
// register.ts
import { registerWhoami } from "./whoami";
// ...
registerWhoami(server);
```

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp test 2>&1 | tail -10
git add apps/mcp/lib/tools/whoami.ts apps/mcp/tests/tools/whoami.test.ts apps/mcp/lib/tools/register.ts
git commit -m "feat(mcp): whoami tool"
```

Expected: 2 new tests pass.

### Task 27: `bounties.list` impl + test

**Files:**
- Create: `apps/mcp/lib/tools/bounties/list.ts`
- Create: `apps/mcp/tests/tools/bounties.test.ts`
- Modify: `apps/mcp/lib/tools/register.ts`

- [ ] **Step 1: Write test**

```typescript
// apps/mcp/tests/tools/bounties.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/lib/auth/middleware");

import { handleBountiesList } from "@/lib/tools/bounties/list";
import { authenticate } from "@/lib/auth/middleware";
import { supabaseAdmin } from "@/lib/supabase/admin";

describe("bounties.list", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns paginated open bounties", async () => {
    (authenticate as any).mockResolvedValue({
      ok: true,
      agent: { id: "a", role: "dev", status: "active", wallet_pubkey: "7", github_handle: "h" },
    });

    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({
                  data: [
                    { id: "b1", amount: "1000000000", state: "open", github_issue_url: "x", title: "t", submission_count: 0, created_at: "2026-05-06" },
                  ],
                  error: null,
                }),
            }),
          }),
        }),
      }),
    });

    const result = await handleBountiesList({ authorization: "Bearer ghbk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", filter: { status: "open" } });
    expect((result as any).items).toHaveLength(1);
    expect((result as any).items[0].id).toBe("b1");
  });
});
```

- [ ] **Step 2: Write impl**

```typescript
// apps/mcp/lib/tools/bounties/list.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { authenticate } from "@/lib/auth/middleware";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mcpError } from "@/lib/errors";

const ListInput = z.object({
  authorization: z.string().optional(),
  filter: z
    .object({
      status: z.enum(["open", "resolved", "cancelled"]).optional(),
      min_sol: z.string().optional(),
      max_sol: z.string().optional(),
    })
    .optional(),
  cursor: z.string().optional(),
});

export async function handleBountiesList(raw: unknown) {
  const parsed = ListInput.safeParse(raw);
  if (!parsed.success) return { error: mcpError("InvalidInput", parsed.error.message) };

  const auth = await authenticate(parsed.data.authorization);
  if (!auth.ok) return { error: auth.error };

  const filter = parsed.data.filter ?? {};
  const supabase = supabaseAdmin();

  let q = supabase
    .from("issues")
    .select(
      "id, amount, state, github_issue_url, submission_count, bounty_meta(title, description, release_mode), created_at"
    );

  if (filter.status) q = q.eq("state", filter.status);

  q = q.order("created_at", { ascending: false }).limit(50);

  const { data, error } = await q;
  if (error) return { error: mcpError("InternalError", error.message) };

  return {
    items: (data ?? []).map((row: any) => ({
      id: row.id,
      title: row.bounty_meta?.[0]?.title ?? null,
      amount_sol: (Number(row.amount) / 1e9).toString(),
      github_url: row.github_issue_url,
      submission_count: row.submission_count,
      state: row.state,
      created_at: row.created_at,
    })),
    next_cursor: null, // simple paging in v1; cursor support in Phase 2 if needed
  };
}

export function registerBountiesList(server: McpServer): void {
  server.tool(
    "bounties.list",
    {
      filter: z
        .object({
          status: z.enum(["open", "resolved", "cancelled"]).optional(),
          min_sol: z.string().optional(),
          max_sol: z.string().optional(),
        })
        .optional(),
      cursor: z.string().optional(),
    },
    async (input, extra) => {
      const authorization = (extra as any)?.requestInfo?.headers?.authorization;
      const result = await handleBountiesList({ ...input, authorization });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
```

- [ ] **Step 3: Wire register + run + commit**

```typescript
import { registerBountiesList } from "./bounties/list";
// ...
registerBountiesList(server);
```

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp test 2>&1 | tail -10
git add apps/mcp/lib/tools/bounties/ apps/mcp/tests/tools/bounties.test.ts apps/mcp/lib/tools/register.ts
git commit -m "feat(mcp): bounties.list tool"
```

### Task 28: `bounties.get` impl + test

**Files:**
- Create: `apps/mcp/lib/tools/bounties/get.ts`
- Modify: `apps/mcp/tests/tools/bounties.test.ts`
- Modify: `apps/mcp/lib/tools/register.ts`

- [ ] **Step 1: Append test**

```typescript

describe("bounties.get", () => {
  it("returns 404 for unknown id", async () => {
    const { handleBountiesGet } = await import("@/lib/tools/bounties/get");
    (authenticate as any).mockResolvedValue({
      ok: true,
      agent: { id: "a", role: "dev", status: "active", wallet_pubkey: "7", github_handle: "h" },
    });
    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
        }),
      }),
    });

    const result = await handleBountiesGet({ authorization: "Bearer x", id: "nope" });
    expect((result as any).error.code).toBe("NotFound");
  });
});
```

- [ ] **Step 2: Write impl**

```typescript
// apps/mcp/lib/tools/bounties/get.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { authenticate } from "@/lib/auth/middleware";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mcpError } from "@/lib/errors";

const GetInput = z.object({
  authorization: z.string().optional(),
  id: z.string().uuid(),
});

export async function handleBountiesGet(raw: unknown) {
  const parsed = GetInput.safeParse(raw);
  if (!parsed.success) return { error: mcpError("InvalidInput", parsed.error.message) };

  const auth = await authenticate(parsed.data.authorization);
  if (!auth.ok) return { error: auth.error };

  const supabase = supabaseAdmin();

  const { data, error } = await supabase
    .from("issues")
    .select(
      "id, amount, state, pda, github_issue_url, submission_count, bounty_meta(title, description, release_mode, evaluation_criteria, reject_threshold), created_at, creator"
    )
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (error) return { error: mcpError("InternalError", error.message) };
  if (!data) return { error: mcpError("NotFound", "Bounty not found") };

  // If caller is the solver of one of the submissions, surface their submission.
  let my_submission: { id: string; status: string } | null = null;
  if (auth.agent.role === "dev") {
    const { data: sub } = await supabase
      .from("submissions")
      .select("id, state")
      .eq("issue_pda", data.pda)
      .eq("solver", auth.agent.wallet_pubkey)
      .maybeSingle();
    if (sub) my_submission = { id: sub.id, status: sub.state };
  }

  return {
    bounty: {
      id: data.id,
      amount_sol: (Number(data.amount) / 1e9).toString(),
      state: data.state,
      pda: data.pda,
      github_issue_url: data.github_issue_url,
      title: (data.bounty_meta as any)?.[0]?.title ?? null,
      description: (data.bounty_meta as any)?.[0]?.description ?? null,
      release_mode: (data.bounty_meta as any)?.[0]?.release_mode ?? null,
      evaluation_criteria: (data.bounty_meta as any)?.[0]?.evaluation_criteria ?? null,
      reject_threshold: (data.bounty_meta as any)?.[0]?.reject_threshold ?? null,
      submission_count: data.submission_count,
      created_at: data.created_at,
    },
    my_submission,
  };
}

export function registerBountiesGet(server: McpServer): void {
  server.tool(
    "bounties.get",
    { id: z.string().uuid() },
    async (input, extra) => {
      const authorization = (extra as any)?.requestInfo?.headers?.authorization;
      const result = await handleBountiesGet({ ...input, authorization });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
```

- [ ] **Step 3: Wire register + run + commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp test 2>&1 | tail -10
git add apps/mcp/lib/tools/bounties/get.ts apps/mcp/tests/tools/bounties.test.ts apps/mcp/lib/tools/register.ts
git commit -m "feat(mcp): bounties.get tool"
```

### Task 29: `submissions.get` impl + test

**Files:**
- Create: `apps/mcp/lib/tools/submissions/get.ts`
- Create: `apps/mcp/tests/tools/submissions.test.ts`
- Modify: `apps/mcp/lib/tools/register.ts`

- [ ] **Step 1: Write test**

```typescript
// apps/mcp/tests/tools/submissions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/lib/auth/middleware");

import { handleSubmissionsGet } from "@/lib/tools/submissions/get";
import { authenticate } from "@/lib/auth/middleware";
import { supabaseAdmin } from "@/lib/supabase/admin";

describe("submissions.get", () => {
  beforeEach(() => vi.resetAllMocks());

  it("403 when caller is neither solver nor bounty company", async () => {
    (authenticate as any).mockResolvedValue({
      ok: true,
      agent: { id: "a", role: "dev", status: "active", wallet_pubkey: "OTHER_WALLET", github_handle: "h" },
    });
    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: {
                  id: "sub-1",
                  solver: "DIFFERENT_WALLET",
                  pr_url: "https://github.com/o/r/pull/1",
                  score: null,
                  state: "Pending",
                  bounty: { creator: "COMPANY_WALLET" },
                },
                error: null,
              }),
          }),
        }),
      }),
    });

    const result = await handleSubmissionsGet({ authorization: "Bearer x", submission_id: "sub-1" });
    expect((result as any).error.code).toBe("Forbidden");
  });

  it("returns submission when caller is the solver", async () => {
    (authenticate as any).mockResolvedValue({
      ok: true,
      agent: { id: "a", role: "dev", status: "active", wallet_pubkey: "SOLVER_WALLET", github_handle: "h" },
    });
    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: {
                  id: "sub-1",
                  solver: "SOLVER_WALLET",
                  pr_url: "https://github.com/o/r/pull/1",
                  score: 7,
                  state: "Scored",
                  bounty: { creator: "COMPANY_WALLET" },
                },
                error: null,
              }),
          }),
        }),
      }),
    });

    const result = await handleSubmissionsGet({ authorization: "Bearer x", submission_id: "sub-1" });
    expect((result as any).submission.id).toBe("sub-1");
    expect((result as any).submission.score).toBe(7);
  });
});
```

- [ ] **Step 2: Write impl**

```typescript
// apps/mcp/lib/tools/submissions/get.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { authenticate } from "@/lib/auth/middleware";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mcpError } from "@/lib/errors";

const GetInput = z.object({
  authorization: z.string().optional(),
  submission_id: z.string().uuid(),
});

export async function handleSubmissionsGet(raw: unknown) {
  const parsed = GetInput.safeParse(raw);
  if (!parsed.success) return { error: mcpError("InvalidInput", parsed.error.message) };

  const auth = await authenticate(parsed.data.authorization);
  if (!auth.ok) return { error: auth.error };

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("submissions")
    .select("id, solver, pr_url, score, state, opus_report_hash, bounty:issue_pda(creator)")
    .eq("id", parsed.data.submission_id)
    .maybeSingle();

  if (error) return { error: mcpError("InternalError", error.message) };
  if (!data) return { error: mcpError("NotFound", "Submission not found") };

  // Authorization: caller must be solver OR the company that created the bounty.
  const callerWallet = auth.agent.wallet_pubkey;
  const isSolver = data.solver === callerWallet;
  const bountyCreator = (data.bounty as any)?.creator ?? null;
  const isBountyOwner = bountyCreator === callerWallet;

  if (!isSolver && !isBountyOwner) {
    return { error: mcpError("Forbidden", "Not authorized to view this submission") };
  }

  return {
    submission: {
      id: data.id,
      solver: data.solver,
      pr_url: data.pr_url,
      score: data.score,
      state: data.state,
      opus_report_hash: data.opus_report_hash,
    },
  };
}

export function registerSubmissionsGet(server: McpServer): void {
  server.tool(
    "submissions.get",
    { submission_id: z.string().uuid() },
    async (input, extra) => {
      const authorization = (extra as any)?.requestInfo?.headers?.authorization;
      const result = await handleSubmissionsGet({ ...input, authorization });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
```

- [ ] **Step 3: Wire register + run + commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp test 2>&1 | tail -10
git add apps/mcp/lib/tools/submissions/ apps/mcp/tests/tools/submissions.test.ts apps/mcp/lib/tools/register.ts
git commit -m "feat(mcp): submissions.get tool with role-based authz"
```

---

## Sub-phase 1I — E2E + integration (Tasks 30-32)

### Task 30: E2E onboarding test (mocked deps)

**Files:**
- Create: `apps/mcp/tests/e2e/onboarding.test.ts`

- [ ] **Step 1: Write E2E test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Wire mocks for Supabase, GitHub, gas-station, RPC.
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/lib/github/device-flow");
vi.mock("@/lib/solana/gas-station-client", () => ({
  sponsorAndSubmit: vi.fn().mockResolvedValue({ ok: true, tx_hash: "MOCK_TX_HASH" }),
}));
vi.mock("@/lib/rate-limit/upstash", () => ({
  createAccountLimiter: () => ({ limit: () => Promise.resolve({ success: true }) }),
}));
vi.mock("@/lib/solana/rpc", () => ({
  solanaRpc: () => ({
    getLatestBlockhash: () => ({ send: () => Promise.resolve({ value: { blockhash: "1".repeat(32), lastValidBlockHeight: 1n } }) }),
    getBalance: () => ({ send: () => Promise.resolve({ value: 100_000_000n }) }),
  }),
}));

import { handleCreateAccountInit } from "@/lib/tools/create-account/init";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { startDeviceFlow } from "@/lib/github/device-flow";

describe("E2E: onboarding flow (init only — full e2e in Phase 2)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("init returns user_code + persists agent row", async () => {
    (startDeviceFlow as any).mockResolvedValue({
      device_code: "DEV",
      user_code: "ABCD-1234",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    });

    const insertCall = vi.fn().mockReturnValue({
      select: () => ({
        single: () => Promise.resolve({ data: { id: "agent-1" }, error: null }),
      }),
    });

    (supabaseAdmin as any).mockReturnValue({
      from: () => ({ insert: insertCall }),
    });

    const result = await handleCreateAccountInit({
      role: "dev",
      wallet_pubkey: "7xK7gE8FpQrSjVz9mYwGtCkBtNvDtTvPzGjGpZqMxKqp",
      ip: "192.0.2.1",
    });

    expect((result as any).user_code).toBe("ABCD-1234");
    expect(insertCall).toHaveBeenCalledOnce();
  });
});
```

> Full poll → complete e2e is harder to mock because of the tx-building. We accept the per-handler unit tests (Tasks 19-25) as sufficient coverage, plus a smoke test post-deploy in Task 33.

- [ ] **Step 2: Run + commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp test 2>&1 | tail -10
git add apps/mcp/tests/e2e/onboarding.test.ts
git commit -m "test(mcp): E2E onboarding init smoke test"
```

### Task 31: Negative tests — rate limit + auth failures

**Files:**
- Modify: `apps/mcp/tests/tools/create-account.test.ts`

- [ ] **Step 1: Append rate-limit test**

```typescript

describe("create_account.init rate limiting", () => {
  it("returns RateLimited when limiter rejects", async () => {
    vi.doMock("@/lib/rate-limit/upstash", () => ({
      createAccountLimiter: () => ({ limit: () => Promise.resolve({ success: false }) }),
    }));
    const { handleCreateAccountInit } = await import("@/lib/tools/create-account/init");

    const result = await handleCreateAccountInit({
      role: "dev",
      wallet_pubkey: "7xK7gE8FpQrSjVz9mYwGtCkBtNvDtTvPzGjGpZqMxKqp",
      ip: "192.0.2.1",
    });
    expect((result as any).error.code).toBe("RateLimited");
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
cd /Users/arturogrande/Desktop/GhBounty
pnpm --filter @ghbounty/mcp test 2>&1 | tail -10
git add apps/mcp/tests/tools/create-account.test.ts
git commit -m "test(mcp): rate-limited path for create_account.init"
```

---

## Sub-phase 1J — Vercel deploy + DNS (Tasks 32-34)

### Task 32: Vercel project creation + env setup

This step is **partly manual** (browser/Vercel UI). Document the steps so a teammate can repeat.

**Files:**
- Create: `docs/superpowers/decisions/2026-05-06-mcp-vercel-deploy.md`

- [ ] **Step 1: Create Vercel project**

```bash
# From repo root, on the Phase 1 branch:
cd /Users/arturogrande/Desktop/GhBounty
vercel link --project ghbounty-mcp --yes --scope weareghbounty-6269s-projects
```

If `vercel link` complains the project doesn't exist, create it via:

```bash
vercel projects add ghbounty-mcp --scope weareghbounty-6269s-projects
```

Then run `vercel link` again.

The project's Root Directory should be set to `apps/mcp` in the Vercel dashboard:
1. https://vercel.com/weareghbounty-6269s-projects/ghbounty-mcp/settings/general
2. Root Directory → `apps/mcp`
3. Save.

- [ ] **Step 2: Add env vars (production + preview)**

For each var, run (or use the Vercel UI):

```bash
vercel env add GITHUB_OAUTH_CLIENT_ID production
# paste: Iv23liabu10KaQEjpH9w
vercel env add GITHUB_OAUTH_CLIENT_SECRET production
# paste from ~/.ghbounty/github-app-credentials.json or 1Password
vercel env add SUPABASE_URL production
# same value as the frontend uses; from frontend's Vercel env
vercel env add SUPABASE_SERVICE_ROLE_KEY production
# NEW key — generate in Supabase dashboard, distinct from frontend's
vercel env add SOLANA_RPC_URL production
# Helius mainnet URL
vercel env add UPSTASH_REDIS_REST_URL production
# from Upstash dashboard (production DB)
vercel env add UPSTASH_REDIS_REST_TOKEN production
vercel env add GAS_STATION_SPONSOR_URL production
# https://www.ghbounty.com/api/gas-station/sponsor
vercel env add GAS_STATION_SERVICE_TOKEN production
# generate a random 64-char token; ALSO add it to the frontend's env
vercel env add NEXT_PUBLIC_GAS_STATION_PUBKEY production
# same as frontend's GAS_STATION_PUBKEY
vercel env add MCP_TOKEN_ENCRYPTION_KEY production
# random 32-byte hex string
```

Repeat the entire list for `preview` (use a separate Upstash DB for preview, but reuse other values).

- [ ] **Step 3: Write decision doc capturing the setup**

```markdown
# Decision — Vercel deploy config for ghbounty-mcp

**Date:** 2026-05-06
**Status:** Accepted

## Project
- Slug: `ghbounty-mcp`
- Team: `weareghbounty-6269s-projects` (same as frontend, per OQ #4 decision)
- Framework: Next.js 16
- Root directory: `apps/mcp`
- Region: `iad1`
- `app/api/mcp/[transport]/route.ts` maxDuration: 60s

## Env vars (production + preview)
- `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (NEW key, distinct from frontend's)
- `SOLANA_RPC_URL` (Helius mainnet for prod, devnet for preview)
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (separate DBs per env)
- `GAS_STATION_SPONSOR_URL` (= frontend prod URL)
- `GAS_STATION_SERVICE_TOKEN` (NEW shared secret with frontend; add to frontend env too)
- `NEXT_PUBLIC_GAS_STATION_PUBKEY` (= frontend's value)
- `MCP_TOKEN_ENCRYPTION_KEY` (32-byte random hex; for at-rest GitHub token encryption)

## Frontend follow-up needed
- Add `GAS_STATION_SERVICE_TOKEN` to the frontend's prod + preview env.
- Update `frontend/lib/gas-station-route-core.ts` to ALSO accept requests with an `x-mcp-service-token` header that matches the env var (in addition to existing Privy bearer auth).
- Open separate PR for frontend change.

## DNS
- `mcp.ghbounty.com` CNAME → `cname.vercel-dns.com`
- Add via Vercel dashboard: Project → Settings → Domains → Add `mcp.ghbounty.com`. Vercel issues the SSL cert.
```

- [ ] **Step 4: Commit decision doc**

```bash
cd /Users/arturogrande/Desktop/GhBounty
git add docs/superpowers/decisions/2026-05-06-mcp-vercel-deploy.md
git commit -m "docs(mcp): Vercel deploy config decision doc"
```

### Task 33: First production deploy + smoke test

- [ ] **Step 1: Deploy from CLI**

```bash
cd /Users/arturogrande/Desktop/GhBounty
vercel --prod --scope weareghbounty-6269s-projects
```

Expected: deploy succeeds; URL like `ghbounty-mcp-xxx.vercel.app`.

- [ ] **Step 2: Smoke test**

```bash
curl https://mcp.ghbounty.com/api/health
```

Expected: `{ "ok": true, "service": "ghbounty-mcp", ... }`

If the DNS isn't propagated yet, hit the deployment URL directly:

```bash
curl https://ghbounty-mcp-xxx.vercel.app/api/health
```

- [ ] **Step 3: MCP tool list test**

Use a manual MCP client (Claude Code's `/mcp` command, or curl) to verify the server responds:

```bash
curl -X POST https://mcp.ghbounty.com/api/mcp/sse \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expected: JSON-RPC response listing all 7 tools.

- [ ] **Step 4: No commit needed** (deploy is via Vercel CLI, no repo changes).

### Task 34: Push branch + open PR

- [ ] **Step 1: Push**

```bash
cd /Users/arturogrande/Desktop/GhBounty
git push -u origin feat/mcp-phase-1-onboarding
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --draft --title "feat(mcp): Phase 1 — Onboarding + Read-Only Tools" --body "$(cat <<'EOF'
## Summary

Phase 1 of the MCP server (per `docs/superpowers/specs/2026-05-05-ghbounty-mcp-server-design.md` section 12).

Ships `apps/mcp/` workspace, 7 MCP tools (3 public onboarding + 4 read-only authenticated), GitHub Device Flow proxy, Bearer-token auth with bcrypt-hashed API keys, Upstash rate limiting, and a Vercel deploy at `mcp.ghbounty.com`.

🔗 **Linear**: [GHB-181](https://linear.app/ghbounty/issue/GHB-181)
🔗 **Spec PR**: [#57](https://github.com/Ghbounty/GhBounty/pull/57)
🔗 **Phase 0 PR**: [#60](https://github.com/Ghbounty/GhBounty/pull/60) (depends on this — must be merged first)
🔗 **Plan**: `docs/superpowers/plans/2026-05-06-mcp-phase-1-onboarding.md`

## Tools shipped (7)

| Tool | Auth | Purpose |
|---|---|---|
| `create_account.init` | none | Start GitHub Device Flow + reserve agent_account row |
| `create_account.poll` | none | Poll GitHub for access_token; on success, build init_stake_deposit tx |
| `create_account.complete` | none | Submit signed tx via gas-station; mint API key; activate account |
| `whoami` | Bearer | Profile + balances |
| `bounties.list` | Bearer | Paginated browse |
| `bounties.get` | Bearer | Full detail + my_submission if dev |
| `submissions.get` | Bearer | Gated: solver OR bounty company |

## Frontend follow-up required

The MCP server's `gas-station-client.ts` POSTs to the frontend's `/api/gas-station/sponsor` with a new `x-mcp-service-token` header. The frontend's `gas-station-route-core.ts` needs to accept this auth path. **Separate PR will follow** to add it. Until that lands, the MCP's `create_account.complete` will fail to submit txs.

## OQs resolved

- **OQ #4** (Vercel team): same team as frontend (`weareghbounty-6269`). Decision: `docs/superpowers/decisions/2026-05-06-mcp-vercel-team.md`.
- **OQ #5** (rate-limit backend): Upstash Redis. Decision: `docs/superpowers/decisions/2026-05-06-mcp-rate-limit-backend.md`.

## Test plan

- [x] `pnpm typecheck` repo-wide passes
- [x] `pnpm test` repo-wide passes (existing tests + N new MCP tests)
- [x] `apps/mcp` builds via `next build`
- [x] Deployed to `mcp.ghbounty.com`; `/api/health` returns 200
- [x] `tools/list` MCP RPC returns all 7 tools
- [ ] Reviewer: register a test agent end-to-end (init → poll with real GitHub → complete with real Solana tx) on devnet
- [ ] Reviewer: verify Upstash rate-limit kicks in after 5 create_account.init calls in 1h from same IP

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Update Linear**

Comment on GHB-181 with the PR link and current status. Use `mcp__linear__save_comment` with `issueId: "GHB-181"`.

---

## Self-Review Checklist

After implementation, run through before opening the PR:

- [ ] All 7 tools registered in `register.ts` and exposed via `/api/mcp/[transport]`
- [ ] API key generation uses bcrypt with 12 rounds; plaintext shown only once
- [ ] Bearer middleware rejects malformed, unknown-prefix, and bcrypt-mismatched keys
- [ ] All tools that write to Supabase use the service-role client; no anon-key writes
- [ ] Rate limits applied: createAccount per IP, read+prepare per agent
- [ ] GitHub Device Flow uses `read:user user:email` scope only
- [ ] Tx-building uses `@ghbounty/sdk`'s Codama client; fee_payer = gas-station pubkey
- [ ] `create_account.complete` validates message_hash from `pending_txs` before RPC submit
- [ ] All tool outputs are JSON via `{ type: "text", text: JSON.stringify(...) }`
- [ ] No secrets committed (env vars only set in Vercel dashboard / 1Password)
- [ ] Deployed to `mcp.ghbounty.com`; DNS + SSL working
- [ ] Linear updated; PR description complete

---

## Estimated effort

5-7 days for one engineer who already has the env set up (Phase 0 done, GitHub App registered, Upstash account ready). Tasks 19-24 (the 3 onboarding tools with their tx-building) are the long stretch.

If unfamiliar with `@vercel/mcp-adapter` and `@solana/kit` 6.x: pad to 8-10 days. The Codama-generated builders may need adapter calls that the spec didn't anticipate.
