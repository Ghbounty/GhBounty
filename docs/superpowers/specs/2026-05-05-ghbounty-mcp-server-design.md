# GhBounty MCP Server — Design Spec

| | |
|---|---|
| **Date** | 2026-05-05 |
| **Status** | Draft, awaiting review |
| **Authors** | Arturo + Claude (brainstorming session) |
| **Linear** | TBD (creates parent issue + sub-issues during writing-plans) |
| **Spec location** | `docs/superpowers/specs/2026-05-05-ghbounty-mcp-server-design.md` |

## 1. Context & motivation

GhBounty wants its product to be **100% agentic** — any AI agent (Claude Code, Cursor, Codex, custom-built) should be able to connect, sign up autonomously, choose its role (dev or company), and operate the marketplace end-to-end. Today the entire UX assumes a human in a browser using Privy + Supabase via a Next.js frontend; there is no public API surface.

This spec proposes a new standalone **MCP (Model Context Protocol) server** hosted on Vercel that exposes the GhBounty marketplace to agents under a non-custodial, BYO-wallet model with on-chain anti-Sybil mechanics. The server is discoverable from the home page so any agent can connect with a single `mcp.json` snippet, generate a Solana keypair locally with `@solana/kit`, complete a one-time GitHub OAuth Device Flow, and stake refundable SOL to be allowed to write.

After signup the agent can:
- **As a dev**: list bounties, submit PRs, poll for AI scoring, receive SOL when their PR wins
- **As a company**: create bounties (funding SOL escrow on-chain), monitor submissions, cancel before any submission lands

**Why this matters**: GhBounty's thesis is "open-source bounties paid in minutes, AI-verified". A discoverable agentic interface is the cleanest expression of that thesis — agents both consume and produce work in the marketplace, with humans optional at every step.

## 2. Headline decisions

| Decision | Choice |
|---|---|
| **Scope of v1** | C — both sides (dev + company), full marketplace |
| **Wallet custody** | B — BYO non-custodial. Agent generates & holds its own Solana keypair. MCP returns serialized unsigned txs; agent signs locally; MCP submits |
| **Sybil defense** | E — refundable on-chain stake (0.005 SOL) **+** GitHub OAuth Device Flow obligatorio |
| **Server architecture** | Y — `apps/mcp` standalone Next.js project on Vercel, deployed to `mcp.ghbounty.com` |
| **Token** | Native SOL (matches current Anchor program). USDC migration deferred to GHB-144 — when it lands, MCP adapts the 4-5 instruction handlers; tool surface stays unchanged |
| **GH OAuth flow** | Device Flow (`gh auth login`-style), not redirect-based. One-time HITL per agent account |
| **Auth on subsequent calls** | API key in `Authorization: Bearer ghbk_live_<32hex>` header |
| **Tx pattern** | Two-step `prepare_*` (returns `tx_to_sign_b64` + `expected_*` sanity-check fields) → agent signs → `submit_signed_*` (validates anti-tamper + submits to RPC) |

**Unit conventions** (used throughout the spec):
- Amounts in tool inputs/outputs use **decimal SOL strings** for human readability (e.g., `"0.005"`, `"1.5"`).
- Internally on-chain everything is **lamports as `u64`** (1 SOL = 1,000,000,000 lamports).
- The MCP server is responsible for converting between the two at the boundary.
- `bigint` values that exceed JS Number's 53-bit safe range (rent, large bounty amounts in lamports) travel as **strings** in JSON — same convention as the existing `issues.amount` column.

## 3. System architecture

```
                         ┌────────────────────────┐
                         │  Home page (Vercel)    │
                         │  ghbounty.com          │
                         │  + "Connect your agent"│
                         │    section: mcp.json   │
                         │    snippet + @solana/  │
                         │    kit quickstart      │
                         └────────────────────────┘

┌─────────────────────┐
│   Cualquier agente  │
│  Claude / Cursor /  │
│  Codex / custom     │
└──────────┬──────────┘
           │ Streamable HTTP MCP transport
           │ Authorization: Bearer ghbk_live_*
           ▼
┌──────────────────────────────────────────────────────────┐
│  apps/mcp  (NEW — Vercel project: ghbounty-mcp)          │
│  Subdomain: mcp.ghbounty.com                             │
│                                                          │
│  Routes:                                                 │
│   • /api/mcp/[transport] (@vercel/mcp-adapter)           │
│   • /api/oauth/github/device (proxy to GH device flow)   │
│   • /api/health                                          │
│                                                          │
│  16 tools (3 public + 13 authenticated). Stateless.      │
│  Each tool:                                              │
│   - validates API key + checks rate limits (Upstash)     │
│   - reads/writes Supabase with service-role key          │
│   - builds unsigned txs against the Anchor program       │
│     using @solana/kit + Codama-generated client          │
└──────────┬───────────────┬────────────────┬──────────────┘
           │               │                │
           ▼               ▼                ▼
   ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐
   │  Supabase   │  │  Solana RPC │  │  Relayer         │
   │  (existing) │  │  (Helius)   │  │  (existing)      │
   │             │  │             │  │                  │
   │  + 5 new    │  │  + 3 new    │  │  Watcher + Opus  │
   │   tables    │  │   instr's   │  │  + GenLayer      │
   │             │  │   (stake    │  │                  │
   │             │  │   ops)      │  │  Extended in P2: │
   │             │  │             │  │  pr.author check │
   │             │  │             │  │  + slashing      │
   └─────────────┘  └─────────────┘  └──────────────────┘
```

### Components

| Component | Type | Location | Purpose |
|---|---|---|---|
| `apps/mcp/` | NEW workspace | repo root | Next.js MCP server, deploys to `mcp.ghbounty.com` |
| `packages/sdk/` | NEW workspace | repo root | Shared types + Codama client + `signKitTx` helper. Published to npm as `@ghbounty/sdk` for agent quickstart |
| Anchor program | EXTEND | `contracts/solana/programs/ghbounty_escrow/` | Add 3 instructions: `init_stake_deposit`, `slash_stake_deposit`, `refund_stake_deposit` |
| Supabase | EXTEND | migrations | Add 5 tables: `agent_accounts`, `api_keys`, `stake_deposits`, `pending_txs`, `slashing_events` |
| Relayer | EXTEND | `relayer/src/` | Add `pr.author.login == github_handle` check post-confirmation. Add slashing-event detection. Add stake-refund cron |
| Frontend | EXTEND | `frontend/app/` | Add `<MCPSection />` to landing + new `/agents` docs page |

### What does NOT change

- Frontend humano (`frontend/`) sigue idéntico — el agente entra por una URL distinta
- Privy auth para humanos sigue igual (no se mezcla con el API key del agente)
- El watcher principal del relayer (Opus + GenLayer) sigue idéntico
- Tablas existentes (`profiles`, `developers`, `companies`, `wallets`, `issues`, `submissions`, `bounty_meta`) — el agente escribe sobre ellas igual que un humano

## 4. Database schema additions

```sql
-- 1. Cuenta del agente, separada de profiles para no contaminar humanos
CREATE TABLE agent_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_pubkey text UNIQUE NOT NULL,
  github_handle text UNIQUE,                        -- NULL hasta completar OAuth
  github_oauth_token_encrypted bytea,
  role text NOT NULL CHECK (role IN ('company','dev')),  -- matches existing pattern in profiles.role

  status text NOT NULL DEFAULT 'pending_oauth',     -- pending_oauth | pending_stake | active | suspended | revoked
  warnings smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. API keys del agente (multiple keys posible vía rotation, pero v1 = 1 active)
CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_account_id uuid NOT NULL REFERENCES agent_accounts(id) ON DELETE CASCADE,
  key_hash text NOT NULL,                           -- bcrypt
  key_prefix text NOT NULL,                         -- "ghbk_live_" + first 12 chars del random
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_prefix_idx ON api_keys(key_prefix) WHERE revoked_at IS NULL;

-- 3. Stake deposits on-chain
CREATE TABLE stake_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_account_id uuid NOT NULL REFERENCES agent_accounts(id) ON DELETE CASCADE,
  pda text NOT NULL,                                -- on-chain PDA address (base58)
  tx_signature text NOT NULL,
  amount_lamports bigint NOT NULL,
  status text NOT NULL DEFAULT 'active',            -- active | frozen | slashed | refunded
  created_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz NOT NULL,                -- now() + 14 days
  refunded_at timestamptz,
  slashed_at timestamptz
);

-- 4. Pending txs (anti-tamper anchor for the two-step protocol)
CREATE TABLE pending_txs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_account_id uuid NOT NULL REFERENCES agent_accounts(id) ON DELETE CASCADE,
  tool_name text NOT NULL,                          -- "bounties.prepare_create"
  resource_id text,                                 -- bounty_meta_id or submission_id
  message_hash text NOT NULL,                       -- SHA-256 del compiled message bytes
  expected_signer text NOT NULL,                    -- agent's wallet pubkey
  expires_at timestamptz NOT NULL,                  -- ~50s after creation
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pending_txs_unconsumed_idx ON pending_txs(agent_account_id, expires_at)
  WHERE consumed_at IS NULL;

-- 5. Slashing events (detected by relayer, aggregated for escalation)
CREATE TABLE slashing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_account_id uuid NOT NULL REFERENCES agent_accounts(id) ON DELETE CASCADE,
  event_type text NOT NULL,                         -- low_quality_spam | bounty_cancel_dos | pr_theft_attempt | prepare_dos | key_sharing
  severity smallint NOT NULL,                       -- 1, 2, or 3
  evidence jsonb NOT NULL,                          -- { pr_url, score, ip_addresses, ... }
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**RLS policies:**
- `agent_accounts`, `api_keys`, `stake_deposits`, `pending_txs`, `slashing_events`: only readable via service-role key (the MCP server). Humans never query these directly.
- The MCP server inserts into existing tables (`profiles`, `developers`, `companies`, `wallets`, `issues`, `submissions`, `bounty_meta`) **bypassing RLS** via service-role key — but enforces equivalent policies in code (e.g., agent can only insert submissions where `solver = agent.wallet_pubkey`).

## 5. Anchor program changes

```rust
// New instructions in contracts/solana/programs/ghbounty_escrow/src/lib.rs

pub fn init_stake_deposit(ctx: Context<InitStakeDeposit>, amount: u64) -> Result<()> {
    require!(amount >= MIN_STAKE_LAMPORTS, EscrowError::StakeTooSmall);
    // Transfer SOL from depositor to stake PDA, init StakeDeposit account
}

pub fn slash_stake_deposit(ctx: Context<SlashStakeDeposit>, amount: u64, reason: String) -> Result<()> {
    require_keys_eq!(ctx.accounts.authority.key(), AUTHORITY_PUBKEY);
    require!(amount <= ctx.accounts.stake.amount, EscrowError::SlashExceedsStake);
    // Transfer slashed lamports from stake PDA to slash treasury PDA
    // Update stake.amount, set status to "slashed"
}

pub fn refund_stake_deposit(ctx: Context<RefundStakeDeposit>) -> Result<()> {
    require_keys_eq!(ctx.accounts.authority.key(), AUTHORITY_PUBKEY);
    require!(Clock::get()?.unix_timestamp >= stake.locked_until, EscrowError::StakeStillLocked);
    // Transfer remaining stake from PDA back to original depositor
}

// New constants
pub const MIN_STAKE_LAMPORTS: u64 = 5_000_000;       // 0.005 SOL
pub const STAKE_LOCK_DAYS: i64 = 14;
```

**Authority key**: same authority key already used elsewhere in the program (TBD — confirm during implementation by reading the existing `release_bounty` handler). Slashing/refund are privileged operations dispatched by the relayer.

## 6. Tool surface (16 tools)

### Public (no auth) — onboarding only

| Tool | Input | Output |
|---|---|---|
| `create_account.init` | `{ role: "dev"\|"company", wallet_pubkey, company_info? }` | `{ account_id, user_code, verification_uri, expires_at }` |
| `create_account.poll` | `{ account_id }` | `{ status, github_handle?, tx_to_sign_b64?, stake_amount_sol?, expected_signers?, expected_program_id? }` |
| `create_account.complete` | `{ account_id, signed_tx_b64 }` | `{ api_key, agent_id, profile }` |

### Authenticated — common (both roles)

| Tool | Input | Output |
|---|---|---|
| `whoami` | `{}` | `{ agent_id, role, github_handle, wallet_pubkey, profile, balances: { sol_lamports, stake_status } }` |
| `bounties.list` | `{ filter?: { status?, min_sol?, max_sol?, language? }, sort?, cursor? }` | `{ items: [{ id, title, amount_sol, github_url, criteria_summary, submissions_count, created_at }], next_cursor }` |
| `bounties.get` | `{ id }` | `{ bounty, my_submission?, on_chain_state }` |
| `submissions.get` | `{ submission_id }` | `{ submission, score, scorer_report, status, tx_hash }` (gated: caller must be solver OR bounty's company) |

### Authenticated — `role: "dev"` only

| Tool | Input | Output |
|---|---|---|
| `submissions.prepare_submit` | `{ bounty_id, pr_url }` | `{ submission_id, tx_to_sign_b64, expected_signers, expected_program_id, expected_instructions, blockhash, expires_at, fee_payer, fee_lamports_estimated }` |
| `submissions.submit_signed` | `{ submission_id, signed_tx_b64 }` | `{ submission_id, tx_hash, status: "pending_score" }` |
| `submissions.list_mine` | `{ filter?, cursor? }` | `{ items, next_cursor }` |

### Authenticated — `role: "company"` only

| Tool | Input | Output |
|---|---|---|
| `bounties.prepare_create` | `{ github_issue_url, amount_sol, criteria, release_mode: "auto", reject_threshold? }` | `{ bounty_meta_id, tx_to_sign_b64, expected_*, total_cost_sol }` |
| `bounties.submit_signed_create` | `{ bounty_meta_id, signed_tx_b64 }` | `{ bounty_id, pda, tx_hash }` |
| `bounties.prepare_cancel` | `{ bounty_id }` | `{ tx_to_sign_b64, expected_*, refund_amount_sol }` |
| `bounties.submit_signed_cancel` | `{ signed_tx_b64 }` | `{ bounty_id, refund_tx_hash }` |
| `bounties.list_mine` | `{ filter?, cursor? }` | `{ items, next_cursor }` |
| `bounties.list_submissions` | `{ bounty_id }` | `{ items: [{ submission_id, solver, pr_url, score, status }] }` |

## 7. Onboarding flow (detail)

```
TIME →

Agent                          MCP server                       External
─────                          ──────────                       ────────
1. Generate keypair locally
   (with @solana/kit)

2. create_account.init(
     role: "dev",
     wallet_pubkey: "7xK..."   ──► POST github.com/login/device/code
   )                                                ◄── { device_code, user_code: "ABCD-1234",
                                                          verification_uri, interval }
                               INSERT agent_accounts
                                 status: pending_oauth
                               STORE device_code (TTL 15min)
   ◄── { account_id, user_code, verification_uri, expires_at }

3. Agent shows human:
   "go to github.com/login/device, enter ABCD-1234"
                                                          ↓
                                                  [Human authorizes once]

4. create_account.poll(         POST github.com/login/oauth/access_token
     account_id            ──►       (every ~5s, with device_code)
   )                                              ◄── { access_token } (when authorized)
                              GET /user → { login: "claudebot42" }
                              UPDATE agent_accounts (handle, status: pending_stake)
                              BUILD unsigned tx: init_stake_deposit(0.005 SOL)
                              GUARD against unique constraint on github_handle
                              INSERT pending_txs row (with message_hash)
   ◄── { status: "ready_to_stake",
         github_handle, tx_to_sign_b64, stake_amount_sol: "0.005",
         expected_signers, expected_program_id }

5. Agent signs locally with @solana/kit

6. create_account.complete(
     account_id,
     signed_tx_b64           ──► VALIDATE signature, message_hash, signer
   )                              SUBMIT to Solana RPC (commitment: confirmed)
                              ON confirm:
                                INSERT stake_deposits row
                                INSERT profiles, developers (or companies), wallets
                                MINT api_key = "ghbk_live_<32hex>"
                                INSERT api_keys (bcrypt hash + prefix)
                                MARK pending_tx consumed
                                UPDATE agent_accounts.status = active
   ◄── { api_key, agent_id, profile, github_handle }
```

**Failure modes:**

| Case | Behavior |
|---|---|
| Device flow timeout (15 min sin authorize) | `agent_accounts.status` queda `pending_oauth`. Agent debe llamar `create_account.init` de nuevo. Idempotente sobre `wallet_pubkey` → si re-llamás, devuelve nuevo `user_code` para la misma row. |
| Mismo wallet llama `init` 2x (race) | Conflict 409 con el `account_id` existente (unique constraint). |
| GitHub handle ya tomado | 409 al `poll` si otro agent ya tomó ese handle. La cuenta queda `pending_oauth`; agent puede re-iniciar con otro GH. |
| Agent firma stake-tx pero la tx falla on-chain | `complete` devuelve 400 con `ProgramError`. Account queda `pending_stake`, agent puede re-intentar firmando con suficiente SOL. |
| Agent pierde API key | v1: pérdida total (rotation queda v2). Documentar en quickstart: guardar la key inmediatamente. |
| Stake confirmed pero MCP crashea antes de mintear API key | Cron en MCP busca `agent_accounts.status='pending_stake'` con `stake_deposits.status='active'`, completa el setup. Idempotente. |
| Role=company en init | Same flow; en `complete` el agent además manda `{ company_name, slug, website, github_org }`. Falla si slug está ocupado. |

## 8. Tx-building protocol

### Server-side stack (`apps/mcp/`)

```ts
import { createTransactionMessage, setTransactionMessageFeePayer,
         setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions,
         compileTransaction, getBase64EncodedWireTransaction,
         partiallySignTransactionMessageWithSigners } from '@solana/kit';
import { getCreateBountyInstructionAsync,
         getSubmitSolutionInstructionAsync,
         getInitStakeDepositInstructionAsync } from '@ghbounty/sdk/codama';
```

- **`@solana/kit` v5.x** for message construction
- **Codama-generated client** from the program IDL (`contracts/solana/idl.json`), published as part of `@ghbounty/sdk`
- **Solana RPC**: Helius mainnet / standard devnet, env-configured

### `prepare_*` response shape

```ts
{
  tx_to_sign_b64: string;            // base64 wire transaction (may be partial-signed if gas-station is fee payer)
  expected_signers: string[];        // ["7xK..."] — must match agent's wallet
  expected_program_id: string;       // "GhBnty11..."
  expected_instructions: Array<{
    name: string;                    // "submit_solution"
    accounts: { name, address, writable }[];
    args: Record<string, unknown>;
  }>;
  blockhash: string;
  expires_at: string;                // ISO 8601, ~50s after build
  fee_payer: "self" | "gas_station";
  fee_lamports_estimated: number;
  // Idempotency keys (depend on tool):
  bounty_meta_id?: string;           // for bounties.prepare_create
  submission_id?: string;            // for submissions.prepare_submit
}
```

### Validation in `submit_signed_*`

Before RPC submit, MCP verifies (all-or-nothing):

1. Decodes the wire tx — if not parseable: `InvalidSignature` (400)
2. Verifies signature against `agent_account.wallet_pubkey` — mismatch: `WrongSigner` (403)
3. Hashes compiled message + matches against `pending_txs.message_hash` — mismatch: `TxTampered` (403)
4. Checks `pending_txs.expires_at` — expired: `BlockhashExpired` (410, agent must re-prepare)
5. Idempotency: if `pending_txs.consumed_at` is set, returns the cached result
6. RPC submit with `commitment: 'confirmed'`. Anchor errors decoded with IDL → `ProgramError { code, name, message }`

### Gas-station integration (Tomi GHB-176)

```ts
const agentSolBalance = await rpc.getBalance(agentPubkey);
const useGasStation = agentSolBalance < 1_000_000n;  // < 0.001 SOL

const message = pipe(
  createTransactionMessage({ version: 0 }),
  m => setTransactionMessageFeePayer(useGasStation ? gasStationPubkey : agentPubkey, m),
  m => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
  m => appendTransactionMessageInstructions(instructions, m),
);

if (useGasStation) {
  // Gas-station relayer signs as fee payer (partial signature)
  const partialSigned = await partiallySignTransactionMessageWithSigners(message, [gasStationSigner]);
  return getBase64EncodedWireTransaction(partialSigned);
}

return getBase64EncodedWireTransaction(compileTransaction(message));
```

**Implication**: agent can start with **0 SOL** in their wallet — only needs SOL for the stake (0.005) and for submission rent (~0.002 per PR submission, since `submit_solution` inits a Submission account with `payer = solver`). Gas fees are sponsored when wallet is below threshold.

### Error model (returned via MCP errors / HTTP status codes)

| Error code | HTTP | Trigger | Recovery |
|---|---|---|---|
| `BlockhashExpired` | 410 | `pending_txs.expires_at < now()` | Call `prepare_*` again |
| `WalletInsufficientFunds` | 402 | wallet doesn't have SOL for stake/bounty | Fund wallet, retry |
| `InvalidSignature` | 400 | wire-tx fails to decode | Check signing code |
| `WrongSigner` | 403 | signer pubkey ≠ agent's wallet | Check signing key |
| `TxTampered` | 403 | message hash mismatch | Re-fetch with `prepare_*`, sign exactly what was returned |
| `ProgramError` | 422 | Anchor program returned error | Check `error.code` and `error.name`; agent-specific |
| `RateLimited` | 429 | exceeded rate limit | Honor `Retry-After` header |
| `Unauthorized` | 401 | missing/invalid API key | Verify key, regenerate if needed |
| `Forbidden` | 403 | role mismatch (dev calling company tool, etc.) | Check `whoami.role` |
| `NotFound` | 404 | resource doesn't exist or caller isn't allowed to see it | Verify ID |
| `Conflict` | 409 | unique constraint violation (PR already submitted, slug taken, etc.) | Reload state |
| `RpcError` | 503 | Solana RPC failure | Retry with backoff |

## 9. Sybil & abuse layers

### Layer 1 — Account creation cost
- **0.005 SOL stake** refundable after 14 days with no active slashing events
- **GitHub handle UNIQUE** — one GH account = one agent account
- **Wallet pubkey UNIQUE** — one wallet = one agent account
- **GH OAuth Device Flow** — agent must possess a real GitHub account (one-time HITL)

### Layer 2 — Proof-of-PR (anti-theft)
- After `submissions.submit_signed` confirms on-chain, the watcher in the relayer fetches `gh api /repos/{owner}/{repo}/pulls/{n}` and verifies `pr.user.login == agent_accounts.github_handle`. Mismatch → submission marked `rejected_pr_theft`, slashing event added (severity 2).
- DB constraint: `submissions UNIQUE (issue_pda, pr_url)` — one PR can only be claimed once per bounty.

### Layer 3 — Rate limits (Upstash Redis or Vercel KV)

| Endpoint group | Anonymous | Authenticated |
|---|---|---|
| `create_account.*` | 5 req / hour / IP | n/a |
| `whoami`, `bounties.list`, `bounties.get`, `submissions.get` | n/a | 100 req / min |
| `prepare_*` | n/a | 30 req / min, max 10 unconsumed in flight |
| `submit_signed_*` | n/a | 30 req / min |
| Any tool | n/a | API key from >5 distinct IPs in 1h → auto-revoke |

### Layer 4 — Behavioral abuse (slashing events)

| Event type | Detection | Severity |
|---|---|---|
| `low_quality_spam` | 3+ submissions with `score < 30` in 24h | 1 |
| `bounty_cancel_dos` | 3+ bounties created and cancelled in <24h | 1 |
| `pr_theft_attempt` | submission with `pr.user.login != github_handle` | 2 |
| `prepare_dos` | 3+ `prepare_*` calls without follow-up `submit_signed_*` in 1h | 1 |
| `key_sharing` | API key used from >5 distinct IPs in 1h | 3 (auto-revoke) |

### Layer 5 — Slashing escalation

| Total severity in window | Action |
|---|---|
| 1 event | Warning (`agent_accounts.warnings++`, no slash) |
| 3+ severity in 7 days | 50% stake slashed, status=`suspended`, no writes until resolved |
| 5+ severity in 30 days | 100% stake slashed, status=`revoked`, `(wallet_pubkey, github_handle)` blacklisted permanently |

Slashing executed by the relayer calling `slash_stake_deposit(amount, reason)` with the program authority key.

### Layer 6 — Economic damping (caps progressivos)

| Account age & activity | Bounty max amount | PRs/day max |
|---|---|---|
| < 7d, 0 PRs accepted | 0.5 SOL | 5 |
| < 7d, 1+ PR accepted | 1 SOL | 20 |
| 7-30d, 1+ PR accepted | 5 SOL | 100 |
| 30+d, 5+ PRs accepted | unlimited | unlimited |

### Layer 7 — Observability

- Every tool call logged: `{ agent_id, tool, latency_ms, error_code, ip, user_agent }` to Vercel Logs
- Internal dashboard (Phase 4): top error rates per agent, top RPC cost per agent, recent slashing events
- Alert: spike of `pr_theft_attempt` events in window → ping `#alerts`

## 10. Home page surface

### `<MCPSection />` component

New section in `frontend/app/page.tsx`, positioned below `<Community />` (or wherever flow makes sense). Layout:

```
┌──────────────────────────────────────────────────────────────┐
│  🔌 Connect your agent                                       │
│                                                              │
│  GhBounty has an MCP server. Any AI agent — Claude, Cursor,  │
│  Codex, custom — can sign up, earn bounties, fund issues,    │
│  and get paid in SOL on Solana, autonomously.                │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ [Tab: Claude Code]  [Tab: Cursor]  [Tab: Custom]       │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ # ~/.claude/mcp.json                                   │  │
│  │ {                                                      │  │
│  │   "mcpServers": {                                      │  │
│  │     "ghbounty": {                                      │  │
│  │       "url": "https://mcp.ghbounty.com/api/mcp/sse"    │  │
│  │     }                                                  │  │
│  │   }                                                    │  │
│  │ }                                                      │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Quickstart (TypeScript + @solana/kit + @ghbounty/sdk)       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ npm install @ghbounty/sdk @solana/kit                  │  │
│  │                                                        │  │
│  │ import { GhBountyClient } from '@ghbounty/sdk';        │  │
│  │ import { generateKeyPairSigner } from '@solana/kit';   │  │
│  │                                                        │  │
│  │ const wallet = await generateKeyPairSigner();          │  │
│  │ const gh = new GhBountyClient();                       │  │
│  │                                                        │  │
│  │ const onboard = await gh.createAccount({               │  │
│  │   role: 'dev',                                         │  │
│  │   walletPubkey: wallet.address,                        │  │
│  │ });                                                    │  │
│  │ // → asks human to authorize at github.com/login/device│  │
│  │ //   with code ABCD-1234. After that, fully autonomous.│  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  [📖 Full agent docs →]   [🔗 mcp.ghbounty.com]              │
└──────────────────────────────────────────────────────────────┘
```

### Components & files

| Asset | Where | What |
|---|---|---|
| `<MCPSection />` | `frontend/components/MCPSection.tsx` | Whole block |
| `<MCPConfigTabs />` | `frontend/components/MCPConfigTabs.tsx` | Tabs with config snippets per MCP client |
| Styles | `frontend/app/globals.css` (append) | `.mcp-section`, `.mcp-tabs`, `.mcp-snippet` |
| `/agents` page | `frontend/app/agents/page.tsx` | Full docs: tools list, error codes, rate limits, slashing rules |
| Subdomain `mcp.ghbounty.com` | DNS + Vercel project | Points to `ghbounty-mcp` project |

### What `@ghbounty/sdk` does internally for `createAccount()`

1. POST `/tools/create_account.init`
2. Prints `user_code` + `verification_uri` to stdout (or invokes a callback)
3. Polls `/tools/create_account.poll` every 5s
4. When response includes `tx_to_sign_b64`, decodes + signs with `@solana/kit` keypair + re-encodes
5. POST `/tools/create_account.complete` with `signed_tx_b64`
6. Persists `api_key` to local config (default: `~/.ghbounty/credentials`)
7. Returns `{ agent_id, api_key, github_handle, wallet }`

This SDK keeps the public quickstart at ~10 lines.

## 11. Out of scope (explicit YAGNI)

| Feature | Why not v1 | When |
|---|---|---|
| `withdraw.*` tools | SOL arrives directly to agent's wallet; standard SPL/SOL transfer tools suffice | Never |
| Manual/assisted release mode | `release_mode: "auto"` is the headline flow | v2 if companies request it |
| `account.regenerate_key` | API key = single source of auth, lose-key = lose-account (just like a wallet seed) | v2 with challenge-signature |
| `stake.prepare_refund` (manual refund) | Cron auto-refund covers it | Only if program authority key disappears |
| Webhooks (notify agent when PR is scored) | Polling on `submissions.get` is enough | v2 |
| Semantic search of bounties | `list` filters cover v1 | v2 with embeddings |
| Multi-wallet per agent | One wallet = one agent, KISS | Probably never |
| Migration SOL → USDC | Dependent on Tomi's GHB-144, doesn't block MCP | When GHB-144 lands |
| MCP-side wallet management (custodial) | Explicit decision: BYO non-custodial | Never |
| OAuth standard (redirect-based) instead of Device Flow | Device Flow strictly better for agents | Never |
| Account abstraction / Squads multisig | Unnecessary complexity for v1 | v2 if large companies request it |
| ERC-8004 trust protocol integration | Cross-chain agent identity, not needed for v1 Solana-only | v3 |

## 12. Implementation phases

### Phase 0 — Foundations (~3-5 days)
- Supabase migration: `agent_accounts`, `api_keys`, `stake_deposits`, `pending_txs`, `slashing_events` + RLS
- Anchor program upgrade: `init_stake_deposit`, `slash_stake_deposit`, `refund_stake_deposit`
- `packages/sdk/` workspace: shared types + IDL embed + Codama-generated client + `signKitTx` helper
- GitHub OAuth App registered (org `Ghbounty`), `client_id` + `client_secret` in Vercel env vars
- Decision log: confirm `AUTHORITY_PUBKEY` matches existing program authority

### Phase 1 — Onboarding + read-only (~5-7 days)
- `apps/mcp/` scaffold with Next.js + `@vercel/mcp-adapter`
- Public tools: `create_account.init`, `.poll`, `.complete`
- Authenticated tools: `whoami`, `bounties.list`, `bounties.get`, `submissions.get`
- Vercel project `ghbounty-mcp` deployed to `mcp.ghbounty.com`
- Rate limiting via Upstash Redis (or Vercel KV)
- E2E tests: agent creates account + lists bounties

### Phase 2 — Dev write capabilities (~4-6 days)
- `submissions.prepare_submit` + `.submit_signed`
- `submissions.list_mine`
- Watcher extension: `pr.author.login == github_handle` check
- E2E tests: agent submits PR and sees scoring

### Phase 3 — Company write capabilities (~4-6 days)
- `bounties.prepare_create` + `.submit_signed_create`
- `bounties.prepare_cancel` + `.submit_signed_cancel`
- `bounties.list_mine` + `bounties.list_submissions`
- E2E tests: agent creates bounty + cancels

### Phase 4 — Abuse & home surface (~3-5 days)
- `slashing_events` detection cron + relayer integration
- Stake refund cron (14-day check)
- `<MCPSection />` in landing + `/agents` docs page (this page is the public docs surface — full tool list, error code table, rate limits, slashing rules)
- Soft launch + monitoring (Vercel Logs dashboards, alert wiring for `pr_theft_attempt` spikes)

**Total estimated**: 19-29 days of focused work for one engineer.

**Each phase is its own `writing-plans` invocation** — this spec covers the full design, but the implementation plan(s) get drafted phase-by-phase to keep each plan small and reviewable. Phase 0 must complete before any other phase can start; Phase 1-3 must complete before Phase 4 (which depends on tools existing to instrument).

## 13. Open questions / risks

| Question | Owner | Resolution by |
|---|---|---|
| `AUTHORITY_PUBKEY` for slash/refund — same as existing release authority, or new dedicated key? | TBD | Phase 0 |
| `@vercel/mcp-adapter` stability — currently in beta. Acceptable to depend on? | TBD | Phase 1 kickoff |
| Gas-station availability (GHB-176/177 by Tomi) — what's the merge ETA? Block Phase 1 if not ready, or fallback to "agent must fund 0.01 SOL manually"? | Tomi | Phase 1 kickoff |
| Vercel project for `ghbounty-mcp` — same team `weareghbounty-6269`, or isolated team for security? | Arturo | Phase 1 |
| Upstash Redis vs Vercel KV for rate limiting — cost/latency comparison | TBD | Phase 1 |
| What does the home page MCPSection mockup *visually* look like — visual companion needed? | Arturo | Phase 4 |

## 14. Success criteria

- An agent (Claude Code, Cursor, custom) can connect to `mcp.ghbounty.com`, sign up autonomously (modulo one-time GH device-flow auth), and submit a PR that gets scored and paid — all without a human touching the GhBounty UI.
- Sybil cost is real: spamming 10k accounts costs ~50 SOL (~$7,500) in stake, irrecoverable if slashed.
- Tool surface stable for ~6 months without breaking changes (even when GHB-144 USDC migration lands, only the program-instruction layer shifts).
- Home page conversion: at least 1 agent signup per month from the MCP section without external promotion.
- Zero custodial liability: GhBounty never holds an agent's private key.
