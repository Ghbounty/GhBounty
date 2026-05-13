# MCP devnet rebuild — design spec

**Status:** Draft
**Owner:** Gastón Foncea
**Created:** 2026-05-12
**Related cards:** GHB-112 (master implementation ticket), GHB-181 (master spec — partially superseded by this doc), GHB-114 / GHB-115 (Sprint B tools)
**Working notes:** `docsGaso/Feature/mcpTesnetError.md`

---

## Resumen ejecutivo

El MCP server (`mcp.ghbounty.com`) está roto en producción: el handshake SSE no responde y un usuario real reportó que su agente AI no puede conectarse. Este spec define **Sprint A**: arreglar el handshake, hacer el código agnostic de red, y migrar la red activa de mainnet a devnet (decisión de producto: devnet pasa a ser la red de producción mientras el producto madura).

Sprint A se enfoca **sólo en el MCP server**, sin tocar frontend ni implementar nuevas tools. Esto es deliberado: el sprint dura ~5-6 días y deja todo preparado para los sprints subsiguientes (frontend onboarding, Sprint B con `submit_pr`/`check_status`).

---

## Contexto

### Bug reportado

El 2026-05-12 un usuario probando su agente AI reportó vía chat:

1. Su agente no podía hacer el handshake con `https://mcp.ghbounty.com/api/mcp/sse` — todos los intentos (SDK oficial, axios stream, curl, navegador) timeout.
2. Se registró manualmente vía la web. El agente le pedía una `api_key` que no encontraba en el dashboard.

Reproducido localmente:
```bash
curl -sS -m 10 -i https://mcp.ghbounty.com/api/health     # 200 OK <1s
curl -sS -m 10 -i https://mcp.ghbounty.com/api/mcp/sse    # timeout sin ni HTTP headers
```

Causa más probable: la función corre en Node serverless runtime (`apps/mcp/vercel.json`, `maxDuration: 60`) que buffea respuestas hasta el final, incompatible con SSE persistente.

### Decisión de producto: devnet como red de producción

Mainnet pasa a estado dormido. Devnet pasa a ser la red activa de `mcp.ghbounty.com`. Razones:
- Producto pre-launch, no hay justificación para pedirle SOL real a usuarios todavía.
- Validar el flow completo con SOL faucet (gratis) antes de plata real.
- Cuando el producto madure, migración a mainnet será cambio de env vars (gracias al agnostic refactor).

### Gap de producto fuera de scope

Existe un gap relacionado: si un usuario se registra por la web (Privy + GitHub OAuth), nunca recibe una api_key porque `mintApiKey()` sólo se ejecuta en el flow de MCP (`apps/mcp/lib/tools/create-account/complete.ts`). No hay UI en el dashboard para regenerar/ver api_keys. **Resolución en sprint frontend dedicado**, no en este.

---

## Objetivo y success criteria

**Objetivo:** que el MCP server funcione en producción con devnet como red activa, y que el código sea agnostic para que la migración futura a mainnet sea cambio de envs únicamente.

**Success criteria:**

1. `curl -sS -m 5 https://mcp.ghbounty.com/api/mcp/sse` devuelve headers HTTP + un evento `endpoint` SSE en menos de 2 segundos.
2. Las env vars de Vercel para `mcp.ghbounty.com` apuntan a:
   - `SOLANA_RPC_URL` → Helius devnet (o `https://api.devnet.solana.com`)
   - `CHAIN_ID=solana-devnet`
3. Una api_key insertada manualmente en DB permite llamar `whoami`, `bounties.list`, `bounties.get`, `submissions.get` contra `mcp.ghbounty.com` y devuelve datos coherentes con la red devnet (ej: balance en devnet).
4. El código no tiene strings hardcoded `"mainnet"` o `"devnet"` — todo viene de env vars.
5. Tests existentes pasan + tests nuevos para los cambios agnostic.

**Fuera del scope (otros sprints):**

- Frontend (api_keys page, OAuth, `/app/stake`) → sprint frontend dedicado.
- Deploy del programa Anchor en devnet → Sprint B (needed for `submit_pr`).
- Implementar `submit_pr`, `check_status` → Sprint B.
- Validar Device Flow / stake on-chain en devnet → no se prueba porque se borrará en sprint frontend.
- Mantener mainnet activamente operativo — queda dormido. Existing api_keys mainnet siguen autenticando (auth es network-agnostic) pero las tools que tocan Solana hablarán con devnet.

---

## Arquitectura

```
                    Usuario (agente AI)
                            │
                            ▼
                    mcp.ghbounty.com
                    (Vercel, region iad1)
                            │
                            ▼
         ┌──────────────────────────────────────────┐
         │  Next.js app — apps/mcp                  │
         │  - runtime: edge (cambio Sprint A)        │
         │                                          │
         │  Auth middleware (Bearer api_key)        │
         │                                          │
         │  Tools que se mantienen activas:         │
         │   • whoami                               │
         │   • bounties.list, bounties.get          │
         │   • submissions.get                      │
         │                                          │
         │  Tools legacy (vivas, no probadas):       │
         │   • create_account.init/poll/complete    │
         │     (borrado pendiente para sprint        │
         │      frontend cuando exista alternativa) │
         └──────────┬──────────────────┬────────────┘
                    │                  │
                    ▼                  ▼
            ┌──────────────┐   ┌──────────────────┐
            │  Supabase    │   │  Helius devnet   │
            │  (chain_id   │   │  RPC             │
            │   per row)   │   │                  │
            └──────────────┘   └──────────────────┘
```

### Componentes y cambios

#### 1. Fix handshake SSE — `apps/mcp/app/api/mcp/[transport]/route.ts`

Agregar:
```typescript
export const runtime = "edge";
```

Razón: Node serverless runtime de Vercel buffea respuestas hasta que la función termina, lo que rompe SSE persistente. Edge runtime usa el modelo de streaming Web nativamente.

**Plan B si Edge no funciona:** documentar que clientes usen `/api/mcp/mcp` (transporte Streamable HTTP, POST-based) en vez de `/api/mcp/sse`. Aceptamos perder compatibilidad con clientes que sólo soportan el transporte SSE legacy.

**Plan C:** investigar configuración de `mcp-handler` para flush manual. Es research, fuera del scope de este spec.

#### 2. Agnostic refactor — `apps/mcp/lib/tools/create-account/`

**Archivo:** `poll.ts:70-72`

Antes:
```typescript
function getProgramAddress(): string {
  return (
    process.env.GHBOUNTY_PROGRAM_ADDRESS ??
    "CPZx26QXs3HjwGobr8cVAZEtF1qGzqnNbBdt7h1EwbBg"
  );
}
```

Después:
```typescript
function getProgramAddress(): string {
  const addr = process.env.GHBOUNTY_PROGRAM_ADDRESS;
  if (!addr) {
    throw new Error("GHBOUNTY_PROGRAM_ADDRESS must be set");
  }
  return addr;
}
```

**Archivo:** `complete.ts:157`

Antes:
```typescript
await supabase.from("wallets").insert({
  user_id: userId,
  chain_id: "solana-mainnet",
  address: ag.wallet_pubkey,
});
```

Después:
```typescript
const chainId = process.env.CHAIN_ID;
if (!chainId) {
  throw new Error("CHAIN_ID must be set");
}
await supabase.from("wallets").insert({
  user_id: userId,
  chain_id: chainId,
  address: ag.wallet_pubkey,
});
```

#### 3. Env example actualizado — `apps/mcp/.env.example`

Agregar:
```
# Chain identifier used in DB rows. One of: "solana-mainnet", "solana-devnet".
# Must match a row in chain_registry.
CHAIN_ID=solana-devnet
```

#### 4. DB migration — `packages/db/drizzle/`

Nueva migration que hace:
```sql
INSERT INTO chain_registry (chain_id, /* otras columnas requeridas */)
VALUES ('solana-devnet', /* valores */)
ON CONFLICT (chain_id) DO NOTHING;
```

Las columnas exactas dependen del schema de `chain_registry`; verificar antes de redactar la migration.

#### 5. Vercel env vars — `mcp.ghbounty.com` (deployment Production)

| Variable | Valor target |
|---|---|
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` o Helius devnet |
| `CHAIN_ID` | `solana-devnet` |
| `GHBOUNTY_PROGRAM_ADDRESS` | placeholder por ahora (no se usa en read tools); se setea con la addr real del programa cuando se redeploye en Sprint B |
| Otras (Supabase, Upstash, GitHub OAuth, GAS_STATION_*) | sin cambios |

#### 6. Test api_key manual para devnet

Script o SQL manual que:
1. Crea un row en `agent_accounts` con `status='active'`, `chain_id='solana-devnet'`, wallet de testing.
2. Llama a `mintApiKey()` y guarda el `key_hash` + `key_prefix` en `api_keys`.
3. Imprime la api_key plaintext para que el equipo la use en smoke tests.

---

## Flujo de datos

### Lectura (whoami, bounties.list, bounties.get, submissions.get)

```
Cliente MCP
    │ Authorization: Bearer ghbk_live_xxx
    ▼
Auth middleware
    │ extract prefix → SELECT api_keys WHERE key_prefix=...
    │ bcrypt verify
    │ ensure agent_accounts.status='active'
    ▼
Tool handler
    │ ┌─ whoami: SELECT agent + getBalance(devnet RPC)
    │ ├─ bounties.list: SELECT bounties WHERE chain_id=$CHAIN_ID
    │ ├─ bounties.get: SELECT bounty WHERE id=$id AND chain_id=$CHAIN_ID
    │ └─ submissions.get: SELECT submission WHERE id=$id
    ▼
Respuesta JSON al cliente
```

Las queries que filtran por red (bounties) usan `process.env.CHAIN_ID` para mantenerse en su red.

### Onboarding (Device Flow legacy, no validado en Sprint A)

Sigue existiendo en código pero **no se prueba** en devnet. Si un agente lo llama:
- `create_account.init` funciona (sólo habla con GitHub, agnostic).
- `create_account.poll` y `create_account.complete` van a fallar porque el programa Anchor no existe en devnet hasta Sprint B.

Documentar en el README del MCP que el onboarding via MCP está temporalmente fuera de servicio, alternativa por frontend coming soon.

---

## Manejo de errores y edge cases

| Caso | Comportamiento esperado |
|---|---|
| Env var `CHAIN_ID` ausente | Falla loud en el primer request que invoque `complete.ts` (acceso a `process.env.CHAIN_ID`) |
| Env var `GHBOUNTY_PROGRAM_ADDRESS` ausente | Falla loud en el primer request que invoque `poll.ts` |
| Edge runtime no soporta alguna dep | Fallback a Plan B (documentar Streamable HTTP) |
| Mainnet api_key autentica contra devnet deployment | Auth pasa OK; `whoami` devuelve balance 0 (mainnet wallet en devnet no tiene SOL). Aceptado como legacy. |
| `chain_registry` no tiene fila `solana-devnet` | FK violation al insertar en `wallets`. Mitigado por migration. |
| Rate limiting Upstash | Se mantiene la misma instancia que mainnet (rate limits son por IP, agnostic) |

---

## Testing

### Unit tests existentes

Todos los tests en `apps/mcp/tests/` deben seguir pasando. Especialmente:
- `tests/tools/whoami.test.ts`
- `tests/tools/bounties.test.ts`
- `tests/tools/submissions.test.ts`
- `tests/tools/create-account.test.ts`
- `tests/auth/api-key.test.ts`
- `tests/auth/middleware.test.ts`

### Tests nuevos

1. **`tests/agnostic-config.test.ts`** (nuevo):
   - `chain_id` en `complete.ts` se lee de env, no hardcoded.
   - `GHBOUNTY_PROGRAM_ADDRESS` requerido — código throws si no está definido.

2. Actualizar tests existentes que asumen `"solana-mainnet"`:
   - Encontrar y reemplazar para que respeten env var en setUp.

### Smoke test manual (post-deploy)

1. SQL manual: insertar test api_key en DB con `chain_id='solana-devnet'`.
2. Configurar cliente MCP local apuntando a `mcp.ghbounty.com` con esa key.
3. Validar:
   - `whoami` → devuelve agent, balance de la wallet en devnet (probablemente 0 si no se fundeó).
   - `bounties.list` → devuelve lista (vacía está bien si no hay bounties en devnet).
   - `bounties.get` con un ID inexistente → 404 limpio.
   - `submissions.get` con un ID inexistente → 404 limpio.
4. Verificar que `curl /api/mcp/sse` no se cuelga.

### Lo que NO se testea

- Device Flow end-to-end (Path A original).
- Stake on-chain (sin programa en devnet).
- Gas-station integration en devnet.
- `submit_pr` y `check_status` (no existen aún).

---

## Riesgos y supuestos

### Riesgos identificados

| # | Riesgo | Severidad | Mitigación |
|---|---|---|---|
| 1 | Edge runtime no soporta `bcryptjs` u otras deps Node usadas | Media | Verificar antes de mergear. Si rompe, Plan B (Streamable HTTP) |
| 2 | Usuarios mainnet existentes se rompen al switchear | Baja | Asumimos pocos/cero usuarios activos en mainnet. Se acepta como costo. |
| 3 | El usuario que reportó el bug intenta de nuevo y sigue sin poder onboardearse | Media | README del MCP debe documentar que onboarding via MCP está temporalmente fuera de servicio |
| 4 | `mcp-handler` (de `@vercel/mcp-adapter`) podría requerir config adicional en Edge | Media | Investigar docs del package antes de mergear |
| 5 | Upstash Redis envs Vercel marketplace usan `KV_REST_API_*` no `UPSTASH_*` | Baja | Ya está handled (`356f1d3 fix(mcp): accept KV_REST_API_*`) |

### Supuestos

- Gastón (o algún cofounder con acceso) puede editar Vercel env vars del proyecto `ghbounty-mcp`.
- El programa Anchor `ghbounty_escrow` en mainnet (`CPZx26QX...`) seguirá existiendo aunque no lo usemos activamente.
- Las api_keys legacy de mainnet (si existen) se dejan tal cual en DB — no las marcamos `revoked_at`.
- GHB-181 (spec maestro original) se marca en Linear como "superseded by 2026-05-12 spec" pero no se borra (trazabilidad histórica).

---

## Plan de implementación (high-level)

Detallado en el plan generado por `superpowers:writing-plans`. Boceto:

1. **Día 1** — Fix SSE handshake.
   - Investigar Edge runtime compat con deps actuales.
   - Si compatible: agregar `runtime = "edge"`, deploy a preview, validar.
   - Si no: Plan B.
2. **Día 2** — Agnostic refactor.
   - Cambios en `poll.ts:71` y `complete.ts:157`.
   - Tests nuevos.
   - Actualizar `.env.example`.
3. **Día 3** — DB migration para `chain_registry` + script de test api_key.
4. **Día 4** — Switch envs Vercel + smoke test manual + ajustes README.
5. **Día 5-6** — Buffer para imprevistos + actualizar GHB-181 en Linear + cerrar tickets relacionados.

---

## Decisiones explícitas (resumen)

| Decisión | Valor |
|---|---|
| Network estrategia | Devnet pasa a producción. Mainnet dormido. |
| Deployment | Un solo `mcp.ghbounty.com` (no subdomain split) |
| Code agnostic | Sí — todas las hardcodes a env vars |
| DB strategy | Supabase compartida, particionada por `chain_id` |
| Frontend changes | Ninguno en este sprint |
| Device Flow | Vive en código, no se valida en devnet |
| `submit_pr`, `check_status` | Sprint B (no en este) |
| Programa Anchor en devnet | Sprint B |
| Gas-station devnet | Sprint B |
| Stake mechanism | Preservado (decisión de cofundadores), se moverá al frontend en sprint dedicado |

---

## Próximos pasos

Una vez aprobado este spec:

1. `superpowers:writing-plans` genera el plan de implementación detallado.
2. Crear tickets de Linear que falten (bug del SSE, agnostic refactor, devnet env switch).
3. `superpowers:executing-plans` arranca la implementación.
