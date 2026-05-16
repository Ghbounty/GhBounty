# MCP Frontend Onboarding — OAuth + API Keys + Stake — Design

**Status:** Design (ready for implementation plan)
**Owner:** Gaston Foncea
**Created:** 2026-05-16
**Linear:** [GHB-188](https://linear.app/ghbounty/issue/GHB-188)
**Predecessor:** `2026-05-12-mcp-devnet-rebuild-design.md` (Sprint A) — merged 2026-05-13.
**Supersedes outline:** `2026-05-12-mcp-frontend-onboarding-outline.md`
**Related:** GHB-181 (master spec, superseded), GHB-187 (Sprint B on-chain tools)

---

## 1. Why this sprint exists

The agentic onboarding (14-step coordinated flow combining GitHub Device Flow + on-chain stake) shipped broken — the first real user couldn't complete it. Two structural problems came out of the incident:

1. **Two parallel identity systems** — `profiles` (Privy DID, created on web signup) and `agent_accounts` (wallet pubkey, created on MCP signup) coexist without a foreign key. A user ends up with one or the other, never both. The user who reported the bug had a `profiles` row but no path to mint an api_key.
2. **The agentic onboarding flow is the wrong UX pattern for the industry.** No production AI tool (Linear MCP, Cloudflare MCP, Stripe, GitHub) makes users coordinate a 14-step flow inside an agent. The standard is web signup + per-credential issuance (API keys + OAuth).

This sprint:
- Merges the two identity systems into one (`profiles`).
- Replaces the agentic onboarding with web-based onboarding.
- Adds two ways to connect an agent: **API keys** (Stripe-style) and **OAuth 2.1 with DCR + PKCE** (Linear MCP-style).
- Kills the device-flow code permanently.

---

## 2. Headline decisions

| Decision | Choice | Why |
|---|---|---|
| **Identity model** | Merge `agent_accounts` into `profiles`. Single user identity. | Matches Linear/Stripe/GitHub/Supabase pattern. Eliminates the parallel identity bug. |
| **API key cardinality** | Many named keys per user (Stripe/GitHub style). | Enables rotation without downtime, granular revocation, per-key auditability. Cost: one extra `name` column. |
| **Token expiry** | Forever-until-revoked for both api_keys and OAuth tokens. `expires_at` column reserved (NULL = no expiry) for future TTL. | Matches Linear MCP, Stripe, OpenAI, Anthropic. Saves 3-5 days of refresh-token implementation. Marginal security delta in the actual threat model. |
| **OAuth scopes** | Single `'full'` scope for v1. `scope` column is `text[]` so granularity can be added later without migrating existing tokens. | YAGNI — 90% of v1 users will be one-dev-one-agent. Defers complexity. |
| **Stake gating** | Stake-first hard gate (preserved from cofounders' decision). | Anti-Sybil + slashing capital. Revisited as a product call later if needed. |
| **OAuth client registration** | Dynamic Client Registration (DCR) per RFC 7591 + PKCE. No `client_secret`. | What the MCP spec recommends. What Linear MCP does. Cero fricción for new agent clients. |
| **GitHub linking** | No change to current behavior. `github_handle` stays as a free-text input on signup; Sprint B's watcher verifies `pr.user.login == github_handle` at submit time. | Avoid scope creep. Stake-first already blocks mass-account abuse. Real GitHub OAuth verification can be added in a later sprint. |
| **Credentials UI** | One unified page `/app/credentials` with two sections (API Keys + Connected Apps). | Match Linear's pattern. Less navigation for v1 where each list will be 1-3 items per user. |
| **Device-flow cleanup** | Delete at **start** of sprint (before building new flow). | The agentic flow is already broken in prod (SSE handshake bug had blocked it). Nothing depends on it. Clean slate is simpler than parallel maintenance. |
| **DB migration ownership** | SQL files committed to repo. **Migrations applied by Gaston manually** (`npm run db:migrate` from local) — never auto-run by CI. Implementor signals when SQL is ready; user confirms migration ran before frontend work begins. | Critical destructive operation; human approval gate. |

---

## 3. Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (frontend/) — ghbounty.com                        │
│                                                             │
│  New pages:                                                 │
│    /app/stake            single-shot account activation     │
│    /app/credentials      unified API Keys + Connected Apps  │
│    /oauth/authorize      OAuth consent page                 │
│                                                             │
│  Modified pages:                                            │
│    AppNav.tsx            adds "API & Credentials" to avatar │
│                          dropdown                           │
│    /agents (landing)     rewrite to 3-step quickstart       │
│                                                             │
│  New API routes:                                            │
│    POST   /api/stake                                        │
│    GET    /api/api-keys                                     │
│    POST   /api/api-keys                                     │
│    DELETE /api/api-keys/[id]                                │
│    GET    /api/connected-apps                               │
│    DELETE /api/connected-apps/[id]                          │
│    POST   /api/oauth/register             (DCR)             │
│    POST   /api/oauth/authorize                              │
│    POST   /api/oauth/token                                  │
│    POST   /api/oauth/revoke                                 │
│    GET    /.well-known/oauth-authorization-server           │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Supabase RLS (Privy DID-based)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  DATABASE (packages/db/)                                    │
│                                                             │
│  Schema changes:                                            │
│    profiles            + mcp_status, warnings,              │
│                          github_handle, wallet_pubkey       │
│    api_keys            FK changes to user_id;               │
│                          + name, expires_at columns         │
│    stake_deposits      FK changes to user_id                │
│    pending_txs         FK changes to user_id                │
│    slashing_events     FK changes to user_id                │
│                                                             │
│  New tables:                                                │
│    oauth_clients       DCR registrations                    │
│    oauth_tokens        Issued OAuth access tokens           │
│    oauth_codes         Short-lived authorization codes      │
│                                                             │
│  Dropped tables:                                            │
│    agent_accounts                                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Bearer token in Authorization
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  MCP SERVER (apps/mcp/) — mcp.ghbounty.com                  │
│                                                             │
│  Modified:                                                  │
│    lib/auth/middleware.ts  unified auth: detects api_key    │
│                            (ghbk_live_*) or OAuth token     │
│                            (ghbo_live_*), routes to correct │
│                            lookup table                     │
│                                                             │
│  Deleted (start of sprint):                                 │
│    lib/tools/create-account/init.ts                         │
│    lib/tools/create-account/poll.ts                         │
│    lib/tools/create-account/complete.ts                     │
│    lib/github/device-flow.ts                                │
│    Related entries in lib/tools/register.ts                 │
└─────────────────────────────────────────────────────────────┘
```

### Token type detection (middleware)

The MCP middleware detects token type by prefix:
- `ghbk_live_*` → API key, lookup in `api_keys`.
- `ghbo_live_*` → OAuth access token, lookup in `oauth_tokens`.

Both paths return the same `MCPProfile` shape; tools don't care which auth method was used.

### Token emission boundary

**All credential issuance happens at the frontend (`ghbounty.com/api/*`).** The MCP server only validates tokens. This is a deliberate boundary: the MCP knows nothing about Privy, GitHub, or user signup flows — it just receives a token, validates it, executes tools.

---

## 4. Database schema

### Migration files (committed to `packages/db/drizzle/`)

Two files, applied in order by Gaston manually:

- `0023_mcp_identity_merge.sql` — additive + data migration + FK swap.
- `0024_mcp_rls_rebuild.sql` — drop old `agent_accounts`-based policies, rebuild on `profiles.user_id`.

### `profiles` — extended

Add columns:

| Column | Type | Default | Notes |
|---|---|---|---|
| `mcp_status` | `agent_status` enum | `'pending_stake'` | Reuses existing enum. The `pending_oauth` value is left in place but deprecated (no rows will ever have it after the migration). Removing enum values in Postgres requires recreating the type, which isn't worth the churn — leaving it as a no-op value is harmless. |
| `warnings` | `smallint` | `0` | Slashing-related warning counter, ported from `agent_accounts.warnings`. |
| `github_handle` | `text UNIQUE` | `NULL` | Filled at dev signup form (existing behavior; not OAuth-verified). |
| `wallet_pubkey` | `text UNIQUE` | `NULL` | Filled when Privy attaches a wallet to the user. Null for company-only users. |

### `api_keys` — modified

| Column | Change | Notes |
|---|---|---|
| `agent_account_id` | DROP | After data migration. |
| `user_id` | ADD (`text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE`) | New FK. |
| `name` | ADD (`text NOT NULL`) | User-provided label. 1-64 chars, no uniqueness constraint per-user (let users name things however). |
| `expires_at` | ADD (`timestamptz NULL`) | Reserved for future TTL; `NULL` means no expiry. Middleware ignores it for v1. |

Index unchanged: `(key_prefix)` for O(1) lookup.

### `stake_deposits`, `pending_txs`, `slashing_events`

Same FK swap as `api_keys`: `agent_account_id` → `user_id` referencing `profiles`. No other columns change.

### `oauth_clients` — new table

```sql
CREATE TABLE oauth_clients (
  id text PRIMARY KEY,                    -- e.g. "cl_<uuid>"
  client_name text NOT NULL,              -- "Claude Code"
  redirect_uris text[] NOT NULL,          -- registered redirect URIs
  created_at timestamptz NOT NULL DEFAULT now()
);
```

No `client_secret` — public clients with PKCE. No expiry on registrations.

### `oauth_tokens` — new table

```sql
CREATE TABLE oauth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  name text NOT NULL,                     -- inherits oauth_clients.client_name at issuance for display
  token_hash text NOT NULL,               -- bcrypt
  token_prefix text NOT NULL,             -- first 22 chars: "ghbo_live_<12 hex>"
  scopes text[] NOT NULL DEFAULT ARRAY['full']::text[],
  expires_at timestamptz NULL,            -- NULL = forever (v1 always NULL)
  last_used_at timestamptz NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_tokens_prefix_idx ON oauth_tokens(token_prefix);
```

### `oauth_codes` — new short-lived table

Authorization codes live in a DB table (not in-memory or external KV — neither Vercel KV nor frontend-side Upstash is set up today, and we don't want to introduce a new dependency just for OAuth codes that live 60 seconds).

```sql
CREATE TABLE oauth_codes (
  code text PRIMARY KEY,                       -- "code_<43 chars>" b64url
  user_id text NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  client_id text NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  code_challenge text NOT NULL,
  redirect_uri text NOT NULL,
  scope text NOT NULL DEFAULT 'full',
  expires_at timestamptz NOT NULL,             -- now() + 60s on insert
  consumed_at timestamptz NULL,                -- set on single-use consumption
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_codes_expires_idx ON oauth_codes(expires_at);
```

**Cleanup:** lookup is `WHERE code = $1 AND consumed_at IS NULL AND expires_at > now()`, so stale rows are effectively invisible. A periodic cleanup job (Vercel cron, once per hour) executes `DELETE FROM oauth_codes WHERE expires_at < now() - interval '1 day'` to keep the table small. The cron job is defined in `vercel.json` and lives in `frontend/app/api/cron/cleanup-oauth-codes/route.ts`.

### `agent_accounts` — dropped

After data migration completes successfully, `0023` ends with `DROP TABLE agent_accounts`. Drops cascade via the FKs we just swapped out (so the FKs in `api_keys`, `stake_deposits`, etc. no longer reference it).

### RLS rebuild (`0024`)

All current policies on `api_keys`, `stake_deposits`, `pending_txs`, `slashing_events` reference `agent_accounts`. They're dropped and replaced with policies that check `user_id = auth.jwt() ->> 'sub'` (the Privy DID pattern used elsewhere in the schema).

New tables:
- `oauth_clients`: read-only for all authenticated users (so DCR's `/api/oauth/register` insert can happen via service_role; reads can be open since they have no user-specific data).
- `oauth_tokens`: only the owning user can `SELECT` / `DELETE`. `INSERT` only via `service_role`.
- `oauth_codes`: no public access at all. Only `service_role` reads/writes (called from `/api/oauth/authorize` and `/api/oauth/token`). RLS enabled with no permissive policies.

End of migration: `NOTIFY pgrst, 'reload schema';` (lesson from GHB-191).

### Migration safety

- **Pre-migration step (Gaston manual):** wipe existing test data from `agent_accounts`, `api_keys`, `stake_deposits`, `pending_txs`, `slashing_events` in devnet. Sprint A confirmed these contain no real users. With source tables empty, the data-migration step inside `0023` becomes a no-op and we sidestep edge cases (orphaned rows, FK violations during the swap, etc.).
- Migrations run inside `BEGIN; ... COMMIT;`. Any failure rolls back.
- The implementor MAY merge `0023` + `0024` into a single migration file if RLS dependencies make the two-file split awkward (since old RLS policies reference `agent_accounts` and must be dropped before the table is dropped). The split is for readability, not correctness — one file is acceptable.
- Gaston runs migrations manually from local against devnet via `npm run db:migrate`. CI does not run migrations. Vercel does not run migrations.

---

## 5. Frontend pages

### `/app/stake`

**Purpose:** Single-shot account activation. User stakes 0.035 SOL on-chain.

**Entry conditions:**
- `profile.mcp_status === 'active'` → redirect to `/app/credentials` (already done).
- `profile.wallet_pubkey === null` → show "Connect a wallet first" with Privy wallet-connect trigger.
- Otherwise → show stake screen.

**Visible state machine:**
1. **Idle** — button enabled.
2. **Building tx** — spinner: "Preparing transaction…"
3. **Awaiting signature** — spinner: "Confirm in your wallet"
4. **Submitting** — spinner: "Submitting to Solana…"
5. **Confirming** — spinner + tx signature: "Waiting for confirmation…"
6. **Success** — checkmark + auto-redirect to `/app/credentials` after 2s.
7. **Error** — message + retry button.

**Layout:** Card with copy ("Stake 0.035 SOL ≈ $3 to activate", refundable after 14 days, slashable on fraud), truncated wallet display (`7xKa…9PnD` + wallet type), primary `[Stake 0.035 SOL]`, secondary `[Learn more]`.

### `/app/credentials`

**Purpose:** Unified page for API keys + OAuth connected apps.

**Entry conditions:**
- `profile.mcp_status !== 'active'` → show **persistent banner** at top: "Activate your MCP account to manage credentials → [Stake now]". Sections render but buttons are disabled.
- Otherwise → full functionality.

**Layout:**

```
API & Credentials

  [banner if !active]

  ─── API Keys ──────────────────────────────────────────
  API keys let your agents talk to mcp.ghbounty.com.
                              [+ Generate new key]

  ┌──────────────────────────────────────────────────┐
  │ "Claude Code laptop"                              │
  │ ghbk_live_a7f3…d2c1                               │
  │ Created Apr 12 · Last used 2 min ago              │
  │                                       [Revoke]    │
  └──────────────────────────────────────────────────┘
  ┌──────────────────────────────────────────────────┐
  │ "CI nightly"                                      │
  │ ghbk_live_b9e1…8a5f                               │
  │ Created Apr 14 · Last used 4 hr ago               │
  │                                       [Revoke]    │
  └──────────────────────────────────────────────────┘

  ─── Connected Apps ────────────────────────────────────
  Apps you've authorized via OAuth.

  ┌──────────────────────────────────────────────────┐
  │ Claude Code                                       │
  │ Authorized Apr 10 · Last used 1 hr ago            │
  │                                       [Revoke]    │
  └──────────────────────────────────────────────────┘
```

**Generate key modal (reveal-once):**
1. User clicks `[+ Generate new key]`.
2. Modal: input "Name your key (e.g. Claude Code laptop)".
3. After submit: plaintext shown in monospace + `[Copy]` + warning ("This is the only time you'll see this key. Store it now."). Modal close hides plaintext forever; the list shows prefix only.

**Revoke confirmation:** Modal "Revoke key 'Claude Code laptop'? Any agent using it will lose access immediately. [Cancel] [Revoke]".

### `/oauth/authorize`

**Purpose:** OAuth consent page. Receives `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, `scope=full`, `state`.

**Entry conditions:**
- Not authenticated → redirect to `/app/auth/login?next=<encoded current URL>`.
- Authenticated but `mcp_status !== 'active'` → redirect to `/app/stake?next=<encoded current URL>`.
- Otherwise → render consent.

**Layout:**

```
Authorize <client_name>

<client_name> is requesting access to your GhBounty account.

This will allow <client_name> to:
  • Read your bounties and submissions
  • Submit PRs on your behalf
  • Access your agent profile

You can revoke this access anytime from API & Credentials.

Signed in as: <displayName> (<email>)

           [Authorize]      [Cancel]
```

**Authorize action:**
- `POST /api/oauth/authorize` with the request params + the user's Privy session.
- Backend generates a single-use code (60s TTL, stored in `oauth_codes` table), returns the full redirect URL.
- Frontend executes `window.location.href = redirect_url`.

**Cancel action:**
- Redirect to `<redirect_uri>?error=access_denied&state=<state>`.

### `/agents` — rewrite

Replace the current 14-step agentic-flow content with a 3-step quickstart:

1. **Sign up** at `ghbounty.com` (link).
2. **Activate** by staking 0.035 SOL (link to `/app/stake` + "Learn more").
3. **Connect** via API key or OAuth, with `mcp.json` snippets for each.

### `AppNav.tsx` — modify

Add entry to the avatar dropdown, between "Profile" and "Logout":

```tsx
<button
  type="button"
  role="menuitem"
  className="menu-item"
  onClick={() => {
    setAccountOpen(false);
    router.push("/app/credentials");
  }}
>
  <KeyIcon />
  API & Credentials
</button>
```

Visible to all logged-in users for now (devs and companies). Companies who don't need MCP simply won't generate any keys.

---

## 6. Frontend API routes

All routes are Next.js route handlers in `frontend/app/api/`. Auth resolution uses the existing Privy → Supabase JWT bridge (`/api/auth/privy-bridge`).

### Auth tiers

| Tier | Verification | Used by |
|---|---|---|
| Privy session | JWT from Privy → resolves `user_id` | All `/api/stake`, `/api/api-keys/*`, `/api/connected-apps/*`, `/api/oauth/authorize` |
| PKCE + code | Single-use authorization code matched against stored `code_challenge` | `/api/oauth/token` |
| Bearer (OAuth token) | Existing OAuth token to revoke itself | `/api/oauth/revoke` |
| Public | None | `/api/oauth/register`, `/.well-known/oauth-authorization-server` |

### `POST /api/stake`

- **Auth:** Privy session
- **Body:** `{ wallet_pubkey: string }`
- **Validation:** `wallet_pubkey` must match `profiles.wallet_pubkey` for the authenticated user; `profile.mcp_status` must not already be `active`.
- **Side effects:**
  1. Build `init_stake_deposit` Anchor instruction.
  2. Delegate fee sponsorship to existing `/api/gas-station/sponsor` endpoint.
  3. Wait for user signature (via Privy/wallet hook).
  4. Submit to Solana, wait for confirmation.
  5. On confirm: `INSERT INTO stake_deposits ...`; `UPDATE profiles SET mcp_status = 'active' WHERE user_id = $1`.
- **Response:** `{ tx_signature: string, pda: string, locked_until: ISO date }`.
- **Errors:**
  - `409 already_staked`
  - `400 wallet_mismatch`
  - `503 rpc_error`

### `GET /api/api-keys`

- **Auth:** Privy session
- **Response:** `{ keys: Array<{ id, name, key_prefix, created_at, last_used_at, revoked_at }> }`
- Never returns `key_hash` or plaintext. Lists revoked keys too (UI greys them out).

### `POST /api/api-keys`

- **Auth:** Privy session + `mcp_status === 'active'` (else `403 stake_required`)
- **Body:** `{ name: string }` (1-64 chars, trimmed, non-empty)
- **Side effects:** Call `mintApiKey()` (moved to `packages/shared/`); insert row.
- **Response:** `{ id, name, key_prefix, plaintext: "ghbk_live_..." }` — **plaintext only here, single time.**

### `DELETE /api/api-keys/[id]`

- **Auth:** Privy session + ownership (key.user_id === session user_id)
- **Side effects:** `UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2`.
- **Errors:** `404` if missing or not owned. `410` if already revoked.

### `GET /.well-known/oauth-authorization-server`

- **Auth:** Public
- **Response:** Static JSON per RFC 8414:

```json
{
  "issuer": "https://ghbounty.com",
  "authorization_endpoint": "https://ghbounty.com/oauth/authorize",
  "token_endpoint": "https://ghbounty.com/api/oauth/token",
  "registration_endpoint": "https://ghbounty.com/api/oauth/register",
  "revocation_endpoint": "https://ghbounty.com/api/oauth/revoke",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": ["full"]
}
```

The same path on `mcp.ghbounty.com` returns an HTTP 302 redirect to the frontend version (so MCP-spec-compliant clients can discover starting from the MCP URL).

### `POST /api/oauth/register` (DCR)

- **Auth:** Public
- **Body:** `{ client_name: string, redirect_uris: string[] }`
- **Side effects:** Insert into `oauth_clients` with generated `client_id` (format `cl_<uuid>`).
- **Response:** `{ client_id, client_name, redirect_uris }`
- No `client_secret` issued — PKCE replaces it.

### `POST /api/oauth/authorize`

- **Auth:** Privy session + `mcp_status === 'active'` (route checks before rendering page)
- **Body:** `{ client_id, redirect_uri, code_challenge, code_challenge_method: "S256", scope: "full", state }`
- **Validation:**
  - `client_id` exists in `oauth_clients`.
  - `redirect_uri` matches one of the registered URIs for that client.
  - `code_challenge_method === "S256"` (PKCE mandatory).
- **Side effects:**
  1. Generate `code = randomBytes(32).b64url()` → `code_<43 chars>`.
  2. Store in DB table `oauth_codes` (TTL 60s): `oauth_code:<code>` → `{ user_id, client_id, code_challenge, scope, redirect_uri, expires_at }`.
- **Response:** `{ redirect_url: "<redirect_uri>?code=<code>&state=<state>" }`
- Frontend then executes `window.location.href = redirect_url`.

### `POST /api/oauth/token`

- **Auth:** None (PKCE replaces secret)
- **Body:** `{ grant_type: "authorization_code", code, code_verifier, client_id, redirect_uri }`
- **Validation (in order):**
  1. Code exists in `oauth_codes` with `consumed_at IS NULL` → else `400 invalid_grant`.
  2. Code not expired (`expires_at > now()`) → else `400 invalid_grant`.
  3. `SHA256(code_verifier)` (base64url-encoded) === stored `code_challenge` → else `400 invalid_grant`.
  4. `client_id` matches code's client_id → else `400 invalid_grant`.
  5. `redirect_uri` matches → else `400 invalid_grant`.
- **Side effects:**
  1. Mark code consumed (`UPDATE oauth_codes SET consumed_at = now() WHERE code = $1` — single-use enforcement).
  2. Mint OAuth token (`ghbo_live_<32 hex>`) — function `mintOAuthToken()` in `packages/shared/`, analogous to `mintApiKey()` but with different prefix.
  3. Insert row in `oauth_tokens` with `user_id`, `client_id`, `name = oauth_clients.client_name`, hash, prefix, `scopes = ['full']`, `expires_at = NULL`.
- **Response:**
  ```json
  {
    "access_token": "ghbo_live_<plaintext>",
    "token_type": "Bearer",
    "scope": "full"
  }
  ```

### `POST /api/oauth/revoke`

- **Auth:** Bearer (the token being revoked)
- **Body:** `{ token: string }` (optional — can also use Authorization header)
- **Side effects:** `UPDATE oauth_tokens SET revoked_at = now() WHERE token_hash = $1`.
- **Response:** `{ ok: true }` (always 200, even if token didn't exist — per RFC 7009).

### `GET /api/connected-apps`

- **Auth:** Privy session
- **Response:** `{ apps: Array<{ id, client_name, scope, created_at, last_used_at }> }`
- Returns one entry per active OAuth token (revoked tokens excluded).

### `DELETE /api/connected-apps/[id]`

- **Auth:** Privy session + ownership
- **Side effects:** `UPDATE oauth_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2`.

---

## 7. MCP server changes

### Code to delete (start of sprint)

```
apps/mcp/lib/
├── tools/
│   ├── create-account/
│   │   ├── init.ts          DELETE
│   │   ├── poll.ts          DELETE
│   │   └── complete.ts      DELETE
│   └── register.ts          EDIT — remove the 3 registrations
└── github/
    └── device-flow.ts       DELETE
```

After cleanup, registered tools are exactly the four Sprint A read tools: `whoami`, `bounties.list`, `bounties.get`, `submissions.get`.

### `lib/auth/middleware.ts` — unified auth

Current `authenticate()` only handles api_keys. Refactor to dispatch by prefix:

```ts
export async function authenticate(authHeader: string | undefined): Promise<AuthResult> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return unauthorized("Missing or malformed Authorization header");
  }
  const plaintext = authHeader.slice("Bearer ".length).trim();

  if (plaintext.startsWith("ghbk_live_")) return authenticateApiKey(plaintext);
  if (plaintext.startsWith("ghbo_live_")) return authenticateOAuthToken(plaintext);
  return unauthorized("Invalid token format");
}
```

#### `authenticateApiKey(plaintext)`

Same logic as today, but the Supabase query joins `profiles` instead of `agent_accounts`:

```ts
const { data } = await supabase
  .from("api_keys")
  .select("id, key_hash, user_id, profiles!inner(user_id, role, mcp_status, wallet_pubkey, github_handle)")
  .eq("key_prefix", prefix)
  .is("revoked_at", null)
  .maybeSingle();
```

Then bcrypt verify, then check `profiles.mcp_status === 'active'`, then return `MCPProfile`.

#### `authenticateOAuthToken(plaintext)`

Mirror of the api_key path but against `oauth_tokens`:

```ts
const { data } = await supabase
  .from("oauth_tokens")
  .select("id, token_hash, user_id, scopes, profiles!inner(...)")
  .eq("token_prefix", prefix)
  .is("revoked_at", null)
  .maybeSingle();
```

Same shape returned.

#### Shared types update

`apps/mcp/lib/tools/types.ts`: rename `AgentAccount` → `MCPProfile` with:

```ts
export interface MCPProfile {
  user_id: string;          // Privy DID
  role: "company" | "dev";
  mcp_status: string;       // 'active' | 'pending_stake' | etc.
  wallet_pubkey: string | null;
  github_handle: string | null;
}
```

All four read tools update their handler signatures to receive `MCPProfile` instead of `AgentAccount`. Field reads inside tool bodies update accordingly (mostly substring replacement).

### `mintApiKey()` relocation

Currently at `apps/mcp/lib/auth/api-key.ts`. Moves to `packages/shared/src/api-key.ts` so the frontend (`POST /api/api-keys`) can use it too. MCP middleware re-exports or imports from the shared package.

A new `packages/shared/src/oauth-token.ts` provides `mintOAuthToken()`, `extractOAuthTokenPrefix()`, `verifyOAuthToken()` — analogous structure with `ghbo_live_` prefix.

---

## 8. OAuth flow — end-to-end happy path

```
USER          CLIENT (Claude Code)          FRONTEND                        MCP
────          ────────────────────          ────────                        ───
                  │ Configure mcp.ghbounty.com
                  │
                  │── GET /.well-known/oauth-authorization-server ──────→
                  │←── metadata JSON ────────────────────────────────────
                  │
                  │── POST /api/oauth/register
                  │        { client_name, redirect_uris } ──────────→ insert oauth_clients
                  │←── { client_id } ────────────────────────────────────
                  │
                  │ Generate code_verifier + code_challenge (PKCE)
                  │
                  │ Open browser →
                  │     GET /oauth/authorize?client_id=...&code_challenge=...
                  ↓
USER sees consent page
  • Not authenticated? → /app/auth/login?next=...
  • Not staked? → /app/stake?next=...
  • Else → render consent
  │ [Authorize]
  ↓
                                      POST /api/oauth/authorize
                                      → INSERT INTO oauth_codes (TTL 60s)
                                      → return redirect_url
                                      ↓
                                      window.location = <redirect_uri>?code=...&state=...
                                      ↓
                  ← code intercepted
                  │
                  │── POST /api/oauth/token
                  │        { grant_type, code, code_verifier, client_id, redirect_uri } →
                  │                              validate PKCE, delete code,
                  │                              mint ghbo_live_*, insert oauth_tokens
                  │←── { access_token: "ghbo_live_..." } ─────────────────
                  │
                  │── POST mcp.ghbounty.com/api/mcp/sse
                  │        Authorization: Bearer ghbo_live_... ─────────────────→ authenticate via
                  │                                                                oauth_tokens
                  │←── tool result ──────────────────────────────────────────────
```

Subsequent tool calls reuse the same `access_token`. The user does not see the consent page again until they revoke the token.

### Error paths

| Case | Behavior |
|---|---|
| User cancels consent | Redirect to `<redirect_uri>?error=access_denied&state=<state>`. |
| Not authenticated at `/oauth/authorize` | Redirect to `/app/auth/login?next=<encoded current URL>`. |
| Not staked at `/oauth/authorize` | Redirect to `/app/stake?next=<encoded current URL>`. |
| Code expired (>60s) | `POST /api/oauth/token` returns `400 invalid_grant`. Client restarts the flow. |
| PKCE verifier mismatch | `400 invalid_grant`. Suggests buggy client or attack. |
| Unknown `client_id` | `400 invalid_client`. Client must call DCR first. |
| Token revoked, then used at MCP | `401` with `WWW-Authenticate: Bearer error="invalid_token"`. Client should restart OAuth flow. |

---

## 9. Testing strategy

### Unit tests (vitest)

| Location | Coverage |
|---|---|
| `packages/shared/tests/api-key.test.ts` | Maintained from current `apps/mcp/tests/auth/api-key.test.ts`. |
| `packages/shared/tests/oauth-token.test.ts` | Mirror of api-key tests for OAuth token utils. |
| `apps/mcp/tests/auth/middleware.test.ts` | Token-type dispatch by prefix, lookup in correct table, bcrypt verify, status checks, scope reservation. |
| `frontend/tests/api/api-keys.test.ts` | POST mints + returns plaintext once; GET strips plaintext; DELETE checks ownership. |
| `frontend/tests/api/oauth/token.test.ts` | PKCE S256 match, code single-use enforcement, expiry, client_id binding, redirect_uri binding. |
| `frontend/tests/api/oauth/authorize.test.ts` | Redirect to login if unauthenticated; redirect to stake if not active; code generation correctness. |
| `frontend/tests/api/stake.test.ts` | Tx building, wallet validation, status flip on confirmation. |

### Integration tests (real DB)

| Location | Coverage |
|---|---|
| `frontend/tests/integration/oauth-flow.test.ts` | Full E2E: DCR → authorize → token exchange → call MCP. Browser redirects stubbed; everything else against real DB. |
| `apps/mcp/tests/integration/auth-unified.test.ts` | Same agent calling tools first with api_key, then with OAuth token — both return identical results. |
| `packages/db/tests/migration.test.ts` | Apply `0023` + `0024` to a clean DB with fixture data; verify uniqueness, RLS, table existence. |

### Manual E2E checklist (run on devnet before merge)

1. Signup new dev via `/app/auth/signup/dev`. Reach `/app/dev` with `mcp_status='pending_stake'`.
2. Click avatar → "API & Credentials". See "Stake to activate" banner; generate button disabled.
3. Navigate to `/app/stake`. Click "Stake 0.035 SOL". Phantom signs. Tx confirms. Auto-redirect to `/app/credentials`.
4. Click "Generate new key". Name it "Test laptop". See plaintext once. Copy it. Close modal.
5. Paste plaintext into Claude Code as `Authorization: Bearer`. Call `whoami`. Receive correct profile.
6. Call `bounties.list`, `bounties.get`, `submissions.get`. All succeed.
7. Revoke "Test laptop" from `/app/credentials`. Next Claude Code call returns `401`.
8. Generate a second key. The first key's revocation does not affect the second.
9. In a different Claude Code instance: configure `mcp.ghbounty.com` with **no** api_key. Trigger a tool call. Browser opens `/oauth/authorize`. Click Authorize. Back in Claude Code, tool call succeeds.
10. `/app/credentials` shows "Claude Code" under Connected Apps with recent `last_used_at`.
11. Revoke the connected app. Claude Code receives `401` on next call. OAuth flow restarts.
12. Privacy: with User A logged in, attempt to fetch User B's api_keys via direct API call → blocked by RLS.

All twelve items pass before merge.

---

## 10. Rollout plan

### Implementation order (14 days)

| Days | Phase |
|---|---|
| 1–2 | MCP cleanup: delete `device-flow.ts` + `create-account/*` tools. Remove their registrations from `register.ts`. Move `mintApiKey()` to `packages/shared/`. Add `mintOAuthToken()` skeleton. Verify Sprint A's 4 read tools still pass against current (pre-migration) schema. |
| 3–4 | **DB migration in lockstep with middleware update**, applied together so the MCP doesn't break mid-day: Gaston wipes test data + applies `0023`/`0024` to devnet → implementor immediately updates `apps/mcp/lib/auth/middleware.ts` so the api_key path queries `api_keys.user_id` → `profiles` instead of `agent_accounts`. PostgREST schema reload. Verify Sprint A's 4 read tools STILL pass after the swap. |
| 5–7 | Frontend stake + API keys: `/app/stake`, `/app/credentials` (API Keys section only), `POST/GET/DELETE /api/api-keys`, `POST /api/stake`, AppNav entry. Manual smoke test: signup → stake → generate key → call MCP. |
| 8–11 | OAuth flow: discovery endpoint, DCR endpoint, authorize page + endpoint, token endpoint with PKCE, revoke endpoint, MCP middleware OAuth-token branch (the `ghbo_live_*` prefix path — the api_key path is already updated from days 3–4), Connected Apps section in `/app/credentials`, manual OAuth smoke test. |
| 12 | Landing rewrite `/agents`. README updates. |
| 13 | Bug-fix + integration: run full 12-item checklist. Fix issues found. |
| 14 | Final PR review, merge, Vercel deploy, prod smoke test. |

**Important sequencing note:** the MCP's `authenticateApiKey()` path MUST be updated in the same window as the DB migration (days 3–4), not deferred to OAuth phase. Otherwise the schema swap leaves Sprint A's read tools broken from day 4 until day 8.

### Branch strategy

Single feature branch `gastonfoncea09/ghb-188-mcp-frontend-onboarding` off `main`. Squash-merge at the end. Migration files committed early in the branch so Gaston can run them locally as soon as ready.

### Migration ownership (repeated for emphasis)

- SQL committed to `packages/db/drizzle/0023_*.sql` and `0024_*.sql`.
- Implementor signals via PR comment when the SQL is ready for review.
- Gaston reviews + runs `npm run db:migrate` from local against devnet.
- Gaston confirms in PR thread before frontend work proceeds.
- CI does NOT auto-run migrations. Vercel does NOT auto-run migrations.

### Done criteria

- [ ] All 12 manual E2E items pass.
- [ ] Unit + integration test suites green.
- [ ] `grep -r "device-flow\|create_account.init\|create_account.poll\|create_account.complete"` returns zero hits in `apps/mcp/`.
- [ ] `agent_accounts` table no longer exists in devnet DB.
- [ ] `oauth_clients` and `oauth_tokens` tables present and used.
- [ ] RLS verified: two test users cannot see each other's credentials.
- [ ] Privy bridge still works for signup/login (no regression).
- [ ] Vercel deploy succeeds; `curl mcp.ghbounty.com/.well-known/oauth-authorization-server` returns redirect to frontend metadata.

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Migration corrupts existing profiles data | Test on a dump first. Migrate in a single transaction. Gaston runs manually with backup procedure. |
| Gas-station sponsorship breaks for the new stake tx | Reuse existing `/api/gas-station/sponsor` endpoint validated by Sprint A; smoke test stake tx end-to-end before building UI on top. |
| Claude Code's MCP SDK doesn't support DCR as expected | Verify against `@modelcontextprotocol/sdk` source before starting OAuth implementation. Fallback: temporary hardcoded `client_id` for known clients. |
| `mcp.ghbounty.com/.well-known/...` redirect breaks discovery | Test manually with `curl` and a real MCP client before relying on it. Alternative: serve the metadata directly from the MCP server. |
| PostgREST schema cache becomes stale after migration | `NOTIFY pgrst, 'reload schema';` at the end of `0024`. Lesson from GHB-191. |
| KV (Vercel) unavailable during OAuth flow | Fallback to a temporary `oauth_codes` DB table with `created_at` index + cleanup cron. Not built in v1 — wait for first KV outage to decide. |
| Existing tests against `agent_accounts` break | Update tests in lockstep with the schema. Migration test (`packages/db/tests/migration.test.ts`) catches FK violations early. |

---

## 12. Open questions for implementation

These are deferred to implementation but should be resolved by the implementor before coding:

1. **Privy bridge update**: does the existing `/api/auth/privy-bridge` route return enough fields to populate `profiles.mcp_status` on first login, or does the user creation flow need an explicit upsert? Likely needs an explicit upsert of `mcp_status='pending_stake'` for new rows.
2. **DCR rate limiting**: should `/api/oauth/register` be rate-limited by IP? Not in v1 (no abuse signal yet), but worth flagging.
3. **`redirect_uri` validation rules**: exact match vs prefix match? Default to exact match for security.
4. **Wallet linking flow**: does Privy's `linkWallet()` get called automatically on first login, or does `/app/stake` need to invoke it explicitly? Check Privy docs.
5. **Localhost redirect_uri**: should we whitelist `http://localhost:*` or require explicit registration? OAuth 2.1 best practice: allow `localhost` with any port for native clients.
6. **OAuth token names in `/app/credentials`**: should the user be able to rename connected apps, or is `client_name` (from DCR) fixed? Fixed in v1 for simplicity.

---

## 13. Out of scope (explicitly)

- GitHub OAuth verification of `github_handle` (deferred — current free-text behavior preserved).
- Multiple OAuth scopes (granularity reserved in schema; only `'full'` in v1).
- Refresh tokens (forever-until-revoked in v1).
- Sprint B tools (`submit_pr`, `check_status`) — handled in GHB-187.
- Slashing UI (Sprint B+).
- Stake refund UI (post-14-day refund flow — separate sprint).
- Admin/internal tooling to view aggregated OAuth client stats.
- Audit log of credential operations beyond `last_used_at`.
- Webhook notifications (e.g., "your key was revoked from another device").
