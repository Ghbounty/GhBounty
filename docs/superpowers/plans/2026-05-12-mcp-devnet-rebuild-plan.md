# MCP devnet rebuild — Sprint A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arreglar el bug del handshake SSE en producción, refactorear el MCP server para que sea network-agnostic (sin hardcodes de mainnet/devnet), y switchear el deployment `mcp.ghbounty.com` a devnet como red activa.

**Architecture:** El MCP server (Next.js 16 en Vercel) lee toda la configuración de red (RPC URL, program address, chain_id) desde env vars. El código no menciona "mainnet" o "devnet" en ningún string. Una sola deployment (`mcp.ghbounty.com`) puede apuntar a cualquier red simplemente cambiando envs. Mainnet queda dormido en este sprint.

**Tech Stack:** Next.js 16 (App Router) + Vercel Edge runtime + Supabase (PostgreSQL) + Drizzle ORM + bcryptjs + Vitest + @modelcontextprotocol/sdk.

---

## Prereqs (lee antes de arrancar)

- **Branch local actual:** `gastonfoncea09/ghb-186-sprint-a-mcp-devnet-rebuild-sse-handshake-fix` (los 2 commits de docs ya están).
- **Linear ticket:** GHB-186.
- **Specs:** `docs/superpowers/specs/2026-05-12-mcp-devnet-rebuild-design.md` (revisar antes de cada task si tenés dudas).
- **Acceso necesario:**
  - Vercel project `ghbounty-mcp` para cambiar env vars al final del sprint.
  - Supabase para correr la migration y el SQL del test api_key.
- **Comandos asumidos disponibles:** `pnpm`, `node`, `git`, `curl`.
- **Conceptos blockchain para beginner:**
  - **Devnet** = la red de pruebas pública de Solana donde el SOL se obtiene gratis del faucet. Acá no hay plata real.
  - **RPC URL** = la dirección HTTP del servidor que conecta tu app con la red Solana. Para devnet usamos `https://api.devnet.solana.com` (público) o Helius devnet (más rápido, requiere API key).
  - **Program address** = la dirección on-chain del smart contract Anchor. Distinta por red.

---

## Task 1: Pre-flight — baseline check

**Files:** ninguno (sólo verificación).

- [ ] **Step 1: Verify branch + clean tree**

Run:
```bash
git branch --show-current
git status --short
```
Expected:
- Branch: `gastonfoncea09/ghb-186-sprint-a-mcp-devnet-rebuild-sse-handshake-fix`
- Status: vacío o sólo `apps/mcp/tsconfig.tsbuildinfo` (generado, ignorable)

Si no coincide, parar y avisar.

- [ ] **Step 2: Run baseline tests**

Run:
```bash
pnpm --filter @ghbounty/mcp test
```
Expected: todos los tests existentes pasan en verde. Si algo falla, parar — no podés introducir cambios sobre un baseline roto.

- [ ] **Step 3: Run typecheck**

Run:
```bash
pnpm --filter @ghbounty/mcp typecheck
```
Expected: 0 errores.

- [ ] **Step 4: Run dev server smoke test**

Run en una terminal:
```bash
pnpm --filter @ghbounty/mcp dev
```
En otra terminal:
```bash
curl -sS -i http://localhost:3001/api/health
```
Expected: `HTTP/1.1 200 OK` con JSON `{"ok":true,...}`.

Después matá el dev server con Ctrl-C.

---

## Task 2: Fix SSE handshake — Edge runtime

**Files:**
- Modify: `apps/mcp/app/api/mcp/[transport]/route.ts`

**Context:** El bug del handshake SSE en producción se debe a que Vercel Node serverless runtime buffea respuestas hasta que la función termina. SSE necesita stream persistente. Edge runtime usa streaming nativo de Web APIs.

- [ ] **Step 1: Edit the route to use Edge runtime**

Open `apps/mcp/app/api/mcp/[transport]/route.ts`. Current content (líneas 22-25):

```typescript
export { handler as GET, handler as POST, handler as DELETE };

export const dynamic = "force-dynamic";
export const maxDuration = 60;
```

Change to:

```typescript
export { handler as GET, handler as POST, handler as DELETE };

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "edge";
```

- [ ] **Step 2: Verify dev server still builds**

Run:
```bash
pnpm --filter @ghbounty/mcp dev
```
Expected: dev server arranca sin errores. Si hay errores de compatibilidad con Edge runtime (típicamente `Module not found` o `Can't use X in Edge runtime`), STOP y reportar — el fallback es revertir el cambio y probar otra estrategia (ver `Plan B` en la spec sección 3.1).

En otra terminal:
```bash
curl -sS -i http://localhost:3001/api/health
```
Expected: 200 OK.

Matá el dev server (Ctrl-C).

- [ ] **Step 3: Run full test suite**

Run:
```bash
pnpm --filter @ghbounty/mcp test
pnpm --filter @ghbounty/mcp typecheck
```
Expected: todos en verde.

- [ ] **Step 4: Commit**

```bash
git add apps/mcp/app/api/mcp/[transport]/route.ts
git commit -m "$(cat <<'EOF'
fix(mcp): use Edge runtime for SSE handshake — GHB-186

Vercel Node serverless runtime buffers responses until the function
completes, which is incompatible with SSE persistent streams. Switching
to Edge runtime uses native Web streaming APIs and resolves the
handshake timeout reported in production.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Agnostic refactor — require GHBOUNTY_PROGRAM_ADDRESS env var

**Files:**
- Modify: `apps/mcp/lib/tools/create-account/poll.ts:65-73`
- Test: `apps/mcp/tests/agnostic-config.test.ts` (new)

**Context:** Hoy `getProgramAddress()` tiene un fallback hardcoded a la program address de mainnet. Esto es peligroso: si el env var no está seteada, el código silenciosamente apunta a mainnet. Lo hacemos required.

- [ ] **Step 1: Export getProgramAddress for testability**

Open `apps/mcp/lib/tools/create-account/poll.ts`. Find the function (líneas 65-73):

```typescript
function getProgramAddress(): string {
  // The IDL-generated GHBOUNTY_ESCROW_PROGRAM_ADDRESS is "" (empty).
  // Read the real address from env; fall back to the devnet address from Anchor.toml.
  return (
    process.env.GHBOUNTY_PROGRAM_ADDRESS ??
    "CPZx26QXs3HjwGobr8cVAZEtF1qGzqnNbBdt7h1EwbBg"
  );
}
```

Change to (note: now `export`ed, fallback removed, throws):

```typescript
export function getProgramAddress(): string {
  const addr = process.env.GHBOUNTY_PROGRAM_ADDRESS;
  if (!addr) {
    throw new Error("GHBOUNTY_PROGRAM_ADDRESS must be set");
  }
  return addr;
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/mcp/tests/agnostic-config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getProgramAddress } from "@/lib/tools/create-account/poll";

describe("getProgramAddress", () => {
  const ORIGINAL = process.env.GHBOUNTY_PROGRAM_ADDRESS;

  beforeEach(() => {
    delete process.env.GHBOUNTY_PROGRAM_ADDRESS;
  });

  afterEach(() => {
    if (ORIGINAL !== undefined) {
      process.env.GHBOUNTY_PROGRAM_ADDRESS = ORIGINAL;
    }
  });

  it("throws when GHBOUNTY_PROGRAM_ADDRESS is not set", () => {
    expect(() => getProgramAddress()).toThrow(
      "GHBOUNTY_PROGRAM_ADDRESS must be set"
    );
  });

  it("returns the env value when set", () => {
    process.env.GHBOUNTY_PROGRAM_ADDRESS = "test_program_addr_xyz";
    expect(getProgramAddress()).toBe("test_program_addr_xyz");
  });
});
```

- [ ] **Step 3: Run tests to verify pass**

Run:
```bash
pnpm --filter @ghbounty/mcp test tests/agnostic-config.test.ts
```
Expected: 2 tests pass (both para getProgramAddress).

- [ ] **Step 4: Run full test suite to verify nothing else broke**

Run:
```bash
pnpm --filter @ghbounty/mcp test
pnpm --filter @ghbounty/mcp typecheck
```
Expected: todos en verde.

⚠️ Si algún test existente fallaba porque dependía del fallback (típicamente `tests/tools/create-account.test.ts`), arreglarlo seteando `process.env.GHBOUNTY_PROGRAM_ADDRESS` en su `beforeEach`. Pegar acá el ajuste exacto cuando aparezca.

- [ ] **Step 5: Commit**

```bash
git add apps/mcp/lib/tools/create-account/poll.ts apps/mcp/tests/agnostic-config.test.ts
git commit -m "$(cat <<'EOF'
refactor(mcp): require GHBOUNTY_PROGRAM_ADDRESS env var — GHB-186

Remove hardcoded fallback program address. The address must now come
from env exclusively — fails loud at first use if missing. Avoids
silent misconfiguration where a deployment without the env var would
have unexpectedly defaulted to a mainnet address.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Agnostic refactor — parametrize CHAIN_ID

**Files:**
- Modify: `apps/mcp/lib/tools/create-account/complete.ts:156-158`
- Test: `apps/mcp/tests/agnostic-config.test.ts` (extend)

**Context:** Hoy `complete.ts:157` inserta `chain_id: "solana-mainnet"` literal. Lo cambiamos para leer de env. Como queremos reutilizar la lógica de leer env (para queries de read tools en Task 5), creamos un helper exportable.

- [ ] **Step 1: Add getChainId helper to complete.ts**

Open `apps/mcp/lib/tools/create-account/complete.ts`. Find the wallets insert (líneas 152-158):

```typescript
  await supabase.from("wallets").insert({
    user_id: userId,
    chain_id: "solana-mainnet",
    address: ag.wallet_pubkey,
  });
```

Add a helper function at the top of the file (after imports, before the first existing function). Search the file for "function handleCreateAccountComplete" — insert ABOVE it:

```typescript
export function getChainId(): string {
  const chainId = process.env.CHAIN_ID;
  if (!chainId) {
    throw new Error("CHAIN_ID must be set");
  }
  return chainId;
}
```

Then update the wallets insert:

```typescript
  await supabase.from("wallets").insert({
    user_id: userId,
    chain_id: getChainId(),
    address: ag.wallet_pubkey,
  });
```

- [ ] **Step 2: Extend the test file**

Open `apps/mcp/tests/agnostic-config.test.ts` and ADD this describe block at the end:

```typescript
import { getChainId } from "@/lib/tools/create-account/complete";

describe("getChainId", () => {
  const ORIGINAL = process.env.CHAIN_ID;

  beforeEach(() => {
    delete process.env.CHAIN_ID;
  });

  afterEach(() => {
    if (ORIGINAL !== undefined) {
      process.env.CHAIN_ID = ORIGINAL;
    }
  });

  it("throws when CHAIN_ID is not set", () => {
    expect(() => getChainId()).toThrow("CHAIN_ID must be set");
  });

  it("returns the env value when set", () => {
    process.env.CHAIN_ID = "solana-devnet";
    expect(getChainId()).toBe("solana-devnet");
  });
});
```

Move the `import { getChainId }` line to the top of the file with the other imports.

- [ ] **Step 3: Run tests**

Run:
```bash
pnpm --filter @ghbounty/mcp test tests/agnostic-config.test.ts
```
Expected: 4 tests pass (2 para getProgramAddress + 2 para getChainId).

- [ ] **Step 4: Run full suite**

Run:
```bash
pnpm --filter @ghbounty/mcp test
pnpm --filter @ghbounty/mcp typecheck
```
Expected: todo en verde.

⚠️ Si `tests/tools/create-account.test.ts` falla, agregar `process.env.CHAIN_ID = "solana-mainnet"` en su `beforeEach`. Pegar acá el ajuste cuando aparezca.

- [ ] **Step 5: Commit**

```bash
git add apps/mcp/lib/tools/create-account/complete.ts apps/mcp/tests/agnostic-config.test.ts
git commit -m "$(cat <<'EOF'
refactor(mcp): parametrize chain_id via CHAIN_ID env var — GHB-186

Remove hardcoded "solana-mainnet" string from wallets insert. The
chain_id now comes from process.env.CHAIN_ID exclusively — fails
loud if missing. Sets up the MCP server to be network-agnostic.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Filter read tools by CHAIN_ID

**Files:**
- Modify: `apps/mcp/lib/tools/bounties/list.ts:29-33`
- Modify: `apps/mcp/lib/tools/bounties/get.ts:21-27`
- Test: `apps/mcp/tests/tools/bounties.test.ts` (modify or extend)

**Context:** Hoy `bounties.list` y `bounties.get` no filtran por chain_id, lo que significa que el deployment de devnet **devolvería bounties de mainnet** en sus queries. Hay que filtrar. Esto es una mini-fix que vale lo justo para que devnet sea coherente.

`submissions.get` filtra por `id` (uuid único globalmente), así que no necesita el cambio.

- [ ] **Step 1: Filter bounties.list**

Open `apps/mcp/lib/tools/bounties/list.ts`. Add the import at the top:

```typescript
import { getChainId } from "@/lib/tools/create-account/complete";
```

Find the query (líneas 29-37):

```typescript
  let q: any = supabase
    .from("issues")
    .select(
      "id, amount, state, github_issue_url, submission_count, bounty_meta(title, description, release_mode), created_at"
    );

  if (filter.status) q = q.eq("state", filter.status);

  q = q.order("created_at", { ascending: false }).limit(50);
```

Change to (add `.eq("chain_id", getChainId())`):

```typescript
  let q: any = supabase
    .from("issues")
    .select(
      "id, amount, state, github_issue_url, submission_count, bounty_meta(title, description, release_mode), created_at"
    )
    .eq("chain_id", getChainId());

  if (filter.status) q = q.eq("state", filter.status);

  q = q.order("created_at", { ascending: false }).limit(50);
```

- [ ] **Step 2: Filter bounties.get**

Open `apps/mcp/lib/tools/bounties/get.ts`. Add the import at the top:

```typescript
import { getChainId } from "@/lib/tools/create-account/complete";
```

Find the query (líneas 21-27):

```typescript
  const { data, error } = await supabase
    .from("issues")
    .select(
      "id, amount, state, pda, github_issue_url, submission_count, bounty_meta(title, description, release_mode, evaluation_criteria, reject_threshold), created_at, creator"
    )
    .eq("id", parsed.data.id)
    .maybeSingle();
```

Change to (add `.eq("chain_id", getChainId())`):

```typescript
  const { data, error } = await supabase
    .from("issues")
    .select(
      "id, amount, state, pda, github_issue_url, submission_count, bounty_meta(title, description, release_mode, evaluation_criteria, reject_threshold), created_at, creator"
    )
    .eq("id", parsed.data.id)
    .eq("chain_id", getChainId())
    .maybeSingle();
```

- [ ] **Step 3: Update existing bounties tests**

Open `apps/mcp/tests/tools/bounties.test.ts`. En el top-level `beforeEach` o setup, agregar:

```typescript
process.env.CHAIN_ID = "solana-mainnet"; // existing test fixtures use mainnet
```

Si los tests existentes ya tienen un `beforeEach`, agregar la línea ahí. Si no, agregar:

```typescript
beforeEach(() => {
  process.env.CHAIN_ID = "solana-mainnet";
});
```

- [ ] **Step 4: Run tests**

Run:
```bash
pnpm --filter @ghbounty/mcp test tests/tools/bounties.test.ts
```
Expected: existing tests pass (they continue to find their fixtures because we set CHAIN_ID to match).

- [ ] **Step 5: Run full suite**

Run:
```bash
pnpm --filter @ghbounty/mcp test
pnpm --filter @ghbounty/mcp typecheck
```
Expected: todo en verde.

- [ ] **Step 6: Commit**

```bash
git add apps/mcp/lib/tools/bounties/list.ts apps/mcp/lib/tools/bounties/get.ts apps/mcp/tests/tools/bounties.test.ts
git commit -m "$(cat <<'EOF'
fix(mcp): filter bounties read tools by CHAIN_ID — GHB-186

bounties.list and bounties.get now scope queries to the network the
server is deployed against (read from CHAIN_ID env). Without this,
a devnet deployment would return mainnet rows from the shared DB.
submissions.get is unchanged (filters by globally-unique uuid).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update env.example

**Files:**
- Modify: `apps/mcp/.env.example`

- [ ] **Step 1: Add CHAIN_ID block**

Open `apps/mcp/.env.example`. Add this block somewhere near the other Solana-related vars (e.g., after `SOLANA_RPC_URL`):

```
# Chain identifier used in DB rows and read-tool queries. One of:
#   solana-mainnet   (production with real money)
#   solana-devnet    (test network with faucet SOL)
# Must match a row in chain_registry table. Required.
CHAIN_ID=solana-devnet
```

- [ ] **Step 2: Verify file is valid**

Quick visual check: no duplicate keys, no syntax errors. The file is plain key=value pairs.

- [ ] **Step 3: Commit**

```bash
git add apps/mcp/.env.example
git commit -m "$(cat <<'EOF'
chore(mcp): document CHAIN_ID env var in .env.example — GHB-186

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: DB migration — add solana-devnet to chain_registry

**Files:**
- Create: `packages/db/drizzle/0021_chain_registry_devnet.sql`

**Context:** La tabla `chain_registry` tiene una fila por red. Hoy sólo existe `solana-mainnet`. Para que cualquier insert con `chain_id='solana-devnet'` no rompa por FK violation, hay que agregar la fila.

- [ ] **Step 1: Verify chain_registry schema**

Run:
```bash
grep -A 12 "chainRegistry = pgTable" packages/db/src/schema.ts
```
Expected: confirmar que las columnas requeridas (NOT NULL) son: `chain_id`, `name`, `rpc_url`, `escrow_address`, `explorer_url`, `token_symbol`. Las opcionales con defaults: `x402_supported`, `created_at`.

- [ ] **Step 2: Create the migration file**

Create `packages/db/drizzle/0021_chain_registry_devnet.sql` with:

```sql
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
```

- [ ] **Step 3: Update drizzle journal**

Open `packages/db/drizzle/meta/_journal.json`. Agregar una entrada para la nueva migration. La estructura es un array `entries`. La última entrada actual (la `0020_review_fee`) debería verse algo como:

```json
{
  "idx": 20,
  "version": "7",
  "when": <timestamp>,
  "tag": "0020_review_fee",
  "breakpoints": true
}
```

Agregar después de esa, ANTES del cierre del array:

```json
{
  "idx": 21,
  "version": "7",
  "when": 1747094400000,
  "tag": "0021_chain_registry_devnet",
  "breakpoints": true
}
```

(El timestamp es aproximado para hoy 2026-05-12.)

⚠️ Si tu drizzle-kit version es distinta y el journal usa otro formato, generalo con:
```bash
pnpm --filter @ghbounty/db drizzle-kit generate
```
…y revisar manualmente el diff antes de commitear.

- [ ] **Step 4: Apply migration to local/dev Supabase**

Si tenés acceso al Supabase de devnet/staging:
```bash
pnpm --filter @ghbounty/db drizzle-kit push
```
O ejecutar manualmente el SQL en Supabase SQL Editor.

Para producción: aplicar via Supabase dashboard una vez que vayan a hacer el switch de envs (Task 9).

- [ ] **Step 5: Commit**

```bash
git add packages/db/drizzle/0021_chain_registry_devnet.sql packages/db/drizzle/meta/_journal.json
git commit -m "$(cat <<'EOF'
feat(db): add solana-devnet row to chain_registry — GHB-186

Required so MCP server deployed against devnet can insert rows with
chain_id='solana-devnet' without FK violations. escrow_address is a
placeholder until Sprint B (GHB-187) deploys the Anchor program to
devnet — update at that time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Test api_key minting script

**Files:**
- Create: `apps/mcp/scripts/mint-test-api-key.mjs`

**Context:** Para hacer smoke test de los read tools contra devnet, necesitamos una api_key válida. Como el onboarding agentic está sin validar en devnet, mintamos una manualmente. El script no toca DB — sólo genera el plaintext + hash + prefix y te imprime el SQL para correr en Supabase.

- [ ] **Step 1: Create the script**

Create `apps/mcp/scripts/mint-test-api-key.mjs` (Node ESM, no transpilation needed):

```javascript
#!/usr/bin/env node
// Mints a test api_key for devnet smoke testing.
// Usage: node apps/mcp/scripts/mint-test-api-key.mjs <wallet_pubkey>
//
// Prints the plaintext key (copy it, you only see it once) and the SQL
// statements to insert the agent_account + api_key into Supabase.

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const PREFIX = "ghbk_live_";
const SECRET_HEX_LEN = 32;
const PREFIX_HEX_LEN = 12;
const BCRYPT_ROUNDS = 12;

const wallet = process.argv[2];
if (!wallet) {
  console.error("Usage: node mint-test-api-key.mjs <wallet_pubkey>");
  process.exit(1);
}

const secret = randomBytes(SECRET_HEX_LEN / 2).toString("hex");
const plaintext = `${PREFIX}${secret}`;
const prefix = `${PREFIX}${secret.slice(0, PREFIX_HEX_LEN)}`;
const hash = bcrypt.hashSync(plaintext, BCRYPT_ROUNDS);

console.log("=========================================");
console.log("API key plaintext (COPY NOW — shown once):");
console.log("");
console.log("  " + plaintext);
console.log("");
console.log("=========================================");
console.log("");
console.log("SQL to run in Supabase SQL Editor:");
console.log("");
console.log("-- Step 1: create the agent_account");
console.log("INSERT INTO agent_accounts (role, wallet_pubkey, status)");
console.log(`VALUES ('dev', '${wallet}', 'active')`);
console.log("RETURNING id;");
console.log("");
console.log("-- Step 2: paste the id from step 1 into the agent_account_id below");
console.log("INSERT INTO api_keys (agent_account_id, key_hash, key_prefix)");
console.log(`VALUES ('<PASTE_AGENT_ID_HERE>', '${hash}', '${prefix}');`);
console.log("");
console.log("=========================================");
```

- [ ] **Step 2: Test the script locally**

Run:
```bash
node apps/mcp/scripts/mint-test-api-key.mjs 7xK7gE8FpQrSjVz9mYwGtCkBtNvDtTvPzGjGpZqMxKqp
```
Expected:
- Prints a plaintext api_key starting with `ghbk_live_`.
- Prints SQL with INSERT statements.
- Both SQL blocks have valid syntax.

- [ ] **Step 3: Commit**

```bash
git add apps/mcp/scripts/mint-test-api-key.mjs
git commit -m "$(cat <<'EOF'
feat(mcp): test api_key minting script for devnet smoke testing — GHB-186

One-off Node script that generates a plaintext api_key + bcrypt hash +
prefix, then prints SQL to INSERT a test agent_account + api_key row
into Supabase. Used for manually minting a key on devnet until the
frontend onboarding sprint (GHB-188) ships the proper UI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Vercel envs switch + Supabase migration (manual)

**Files:** ninguno (acción en Vercel UI + Supabase).

**Context:** Este paso cambia el comportamiento del deployment de producción de `mcp.ghbounty.com`. **No es reversible sin downtime** (well, podés revertir env vars pero los usuarios pueden ver inconsistencia mientras tanto). Hacelo cuando tengas la atención dedicada.

⚠️ **No automatizable desde CLI** — Vercel requiere autenticación interactiva y permission management. Pasos manuales.

- [ ] **Step 1: Apply the migration to production Supabase**

Antes de cambiar envs:
1. Abrir Supabase Studio → SQL Editor del proyecto de prod.
2. Ejecutar el contenido de `packages/db/drizzle/0021_chain_registry_devnet.sql`.
3. Verificar:
   ```sql
   SELECT chain_id FROM chain_registry;
   ```
   Expected: lista incluye `solana-devnet`.

- [ ] **Step 2: Update Vercel envs**

En el dashboard de Vercel, proyecto `ghbounty-mcp`, Production envs:

| Variable | Valor nuevo |
|---|---|
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` (o tu Helius devnet URL si tenés API key) |
| `CHAIN_ID` | `solana-devnet` |
| `GHBOUNTY_PROGRAM_ADDRESS` | `CPZx26QXs3HjwGobr8cVAZEtF1qGzqnNbBdt7h1EwbBg` (mantenelo igual por ahora — no se usa por read tools; Sprint B lo cambia al addr de devnet cuando deploye el programa) |

Las otras envs (Supabase, Upstash, GitHub OAuth, GAS_STATION_*) **no se tocan**.

- [ ] **Step 3: Trigger redeploy**

En Vercel dashboard → Deployments → "Redeploy" la última deployment con las nuevas envs.

Esperá a que termine (~1-2 min). Status debe ser "Ready".

- [ ] **Step 4: Health check**

Run:
```bash
curl -sS -i https://mcp.ghbounty.com/api/health
```
Expected: `HTTP/2 200` con JSON `{"ok":true,...}`.

Si no responde 200, **revertir las envs en Vercel y redeployar** — algo está mal con Edge runtime + las deps.

---

## Task 10: Insert test api_key in production Supabase

**Files:** ninguno (acción manual).

- [ ] **Step 1: Generate a fake wallet pubkey for testing**

Un Solana pubkey es un string base58 de 32-44 caracteres. Para testing, podés usar uno cualquiera válido. Ejemplo:

```
7xK7gE8FpQrSjVz9mYwGtCkBtNvDtTvPzGjGpZqMxKqp
```

(Es un pubkey válido en formato, no tiene SOL en devnet pero no importa para los smoke tests.)

- [ ] **Step 2: Run the minting script**

```bash
node apps/mcp/scripts/mint-test-api-key.mjs 7xK7gE8FpQrSjVz9mYwGtCkBtNvDtTvPzGjGpZqMxKqp
```

**Copiá la api_key plaintext del output** — sólo la vas a ver una vez.

- [ ] **Step 3: Run the SQL in production Supabase**

1. Abrir Supabase SQL Editor (proyecto prod).
2. Pegar el SQL de Step 1 del output del script. Run. Anotar el `id` devuelto.
3. Editar el SQL de Step 2: reemplazar `<PASTE_AGENT_ID_HERE>` con el id de arriba. Run.
4. Verificar:
   ```sql
   SELECT id, role, status, wallet_pubkey FROM agent_accounts ORDER BY created_at DESC LIMIT 1;
   SELECT id, key_prefix FROM api_keys ORDER BY created_at DESC LIMIT 1;
   ```

---

## Task 11: Smoke test — read tools against devnet

**Files:** ninguno (verificación manual contra producción).

**Context:** Ejercitamos los 4 read tools (`whoami`, `bounties.list`, `bounties.get`, `submissions.get`) con la api_key recién minteada.

- [ ] **Step 1: Test SSE handshake**

Run:
```bash
curl -sS -m 5 -i -H "Accept: text/event-stream" https://mcp.ghbounty.com/api/mcp/sse 2>&1 | head -10
```
Expected en menos de 2 segundos: HTTP/2 200 + header `content-type: text/event-stream` + un evento `endpoint`.

✅ **Si llega un evento, el bug del handshake está fixeado.**

⚠️ Si sigue colgándose: Plan B — documentar Streamable HTTP en el README en vez de SSE. Ver spec sección 3.1.

- [ ] **Step 2: Test whoami**

Replace `ghbk_live_xxx` con la api_key plaintext que generaste:

```bash
API_KEY="ghbk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# Usando un cliente MCP (preferido) o curl con un POST manual al handler.
# Por simplicidad, exploramos con whoami via Streamable HTTP:
curl -sS -X POST https://mcp.ghbounty.com/api/mcp/mcp \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "whoami",
      "arguments": {}
    }
  }'
```
Expected: response con `"role": "dev"`, `"status": "active"`, `"wallet_pubkey": "7xK..."`, `"sol_lamports": "0"` (la wallet de testing no tiene balance en devnet, eso es OK).

- [ ] **Step 3: Test bounties.list**

```bash
curl -sS -X POST https://mcp.ghbounty.com/api/mcp/mcp \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "bounties.list",
      "arguments": {}
    }
  }'
```
Expected: `{"items": [], "next_cursor": null}` — vacío porque no hay bounties en devnet, lo cual confirma que el filtro `chain_id='solana-devnet'` funcionó (sino devolvería los de mainnet).

- [ ] **Step 4: Test bounties.get with a fake uuid**

```bash
curl -sS -X POST https://mcp.ghbounty.com/api/mcp/mcp \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "bounties.get",
      "arguments": {"id": "00000000-0000-0000-0000-000000000000"}
    }
  }'
```
Expected: error `{"error": {"code": "NotFound", "message": "Bounty not found"}}` — confirma que la query corrió OK contra devnet.

- [ ] **Step 5: Test submissions.get with a fake uuid**

```bash
curl -sS -X POST https://mcp.ghbounty.com/api/mcp/mcp \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "submissions.get",
      "arguments": {"id": "00000000-0000-0000-0000-000000000000"}
    }
  }'
```
Expected: error tipo NotFound. Confirma que el endpoint responde.

✅ Si los 4 pasan, **success criteria del Sprint A están cumplidos**.

---

## Task 12: Update README + supersede note on GHB-181

**Files:**
- Modify: `apps/mcp/README.md`

- [ ] **Step 1: Add onboarding notice section to README**

Open `apps/mcp/README.md`. Agregar al final del archivo (después de la sección `## Tools`):

```markdown

## ⚠️ Onboarding temporarily unavailable via MCP

The agentic onboarding flow (`create_account.init/poll/complete`) is currently **not validated against devnet** and may fail. Working alternative is being built in GHB-188 (frontend MCP onboarding sprint), which moves account creation + stake to the web UI.

Existing api_keys (minted from previous mainnet sessions, or via the admin minting script `scripts/mint-test-api-key.mjs`) continue to work for authenticating MCP tool calls.

Track:
- Current network: see `CHAIN_ID` env var. Server is currently on `solana-devnet` (faucet SOL, no real money).
- Reactivation of onboarding: GHB-188.
- New on-chain tools (`submit_pr`, `check_status`): GHB-187.
```

- [ ] **Step 2: Commit**

```bash
git add apps/mcp/README.md
git commit -m "$(cat <<'EOF'
docs(mcp): README notice about onboarding status — GHB-186

Document that agentic onboarding is temporarily unavailable until
the frontend sprint (GHB-188) ships the alternative UI. Existing
api_keys continue to authenticate. Points to GHB-187/188 for what's
coming next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Update GHB-181 in Linear with supersede note**

(Manual step — using Linear UI or MCP tool.)

Editar la descripción de GHB-181 para agregar al inicio:

```markdown
> ⚠️ **Superseded:** este spec fue parcialmente reemplazado por el plan acordado el 2026-05-12. Ver:
> - `docs/superpowers/specs/2026-05-12-mcp-devnet-rebuild-design.md` (Sprint A — GHB-186)
> - `docs/superpowers/specs/2026-05-12-mcp-sprint-b-onchain-tools-outline.md` (Sprint B — GHB-187)
> - `docs/superpowers/specs/2026-05-12-mcp-frontend-onboarding-outline.md` (Frontend — GHB-188)
>
> La decisión más importante: el agentic onboarding (Device Flow + stake on-chain via MCP) se reemplaza por OAuth + api_keys dashboard estilo industria.
```

---

## Task 13: Push branch + open PR

**Files:** ninguno (acción git).

- [ ] **Step 1: Verify everything is committed**

Run:
```bash
git status --short
```
Expected: vacío (o sólo `apps/mcp/tsconfig.tsbuildinfo` que está autogenerado).

- [ ] **Step 2: Check the log**

Run:
```bash
git log --oneline main..HEAD
```
Expected: la lista de commits del sprint (docs commits + Tasks 2-12 commits, ~10-12 commits totales).

- [ ] **Step 3: Push**

```bash
git push -u origin gastonfoncea09/ghb-186-sprint-a-mcp-devnet-rebuild-sse-handshake-fix
```
Expected: branch creado en remote.

- [ ] **Step 4: Open PR**

```bash
gh pr create --title "MCP devnet rebuild + SSE fix — GHB-186" --body "$(cat <<'EOF'
## Summary

- Fix bug del handshake SSE en producción (Edge runtime)
- Agnostic refactor: `GHBOUNTY_PROGRAM_ADDRESS` y `CHAIN_ID` desde env vars (sin hardcodes)
- Filter de read tools (`bounties.list`, `bounties.get`) por chain_id
- DB migration: agregar `solana-devnet` a `chain_registry`
- Script para mintar test api_key
- README actualizada con notice sobre onboarding

Spec completa: `docs/superpowers/specs/2026-05-12-mcp-devnet-rebuild-design.md`

## Linear

Closes GHB-186.

## Test plan

- [x] Tests existentes pasan + nuevos tests en `agnostic-config.test.ts` pasan
- [x] Typecheck pasa
- [x] `curl /api/mcp/sse` devuelve headers en <2s (post-deploy)
- [x] `whoami`, `bounties.list`, `bounties.get`, `submissions.get` responden OK con api_key minteada contra devnet
- [x] Migration aplicada en Supabase production

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Comentar en GHB-186 con el link al PR**

(Manual o vía MCP Linear tool.)

---

## Resumen final

Cuando todas las tasks estén ✅:

1. PR mergeado → Sprint A completo.
2. Próximo paso: brainstorming + spec completa para GHB-187 (Sprint B — on-chain tools) o GHB-188 (frontend MCP onboarding), según prioridad del equipo.
3. Backup plan si Edge runtime no resuelve SSE: revisar Plan B/C en la spec sección 3.1.
