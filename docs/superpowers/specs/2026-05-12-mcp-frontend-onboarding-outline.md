# MCP frontend onboarding — OAuth + api_keys dashboard — OUTLINE

**Status:** Outline (NOT a full spec yet)
**Owner:** TBD
**Created:** 2026-05-12
**Predecessor:** `2026-05-12-mcp-devnet-rebuild-design.md` (Sprint A) debe estar mergeado.
**Successor / paralelo posible:** `2026-05-12-mcp-sprint-b-onchain-tools-outline.md` (Sprint B).
**Related cards:** GHB-181 (master spec original — superseded por el approach de este outline).

> ⚠️ **Este es un outline, no una spec completa.** Antes de implementar, hay que correr `superpowers:brainstorming` para refinar UX, OAuth scopes, edge cases. El propósito de este archivo es capturar el contexto y la dirección decidida durante el brainstorming de Sprint A.

---

## Por qué este sprint existe

Hoy el onboarding al MCP es un flow agentic de 14 pasos coordinados (GitHub Device Flow + stake on-chain) que está roto y rompe a la primera persona real que lo intentó.

**La dirección estratégica acordada** es matar ese flow y reemplazarlo por dos formas estándar de la industria:

1. **OAuth 2.1** estilo Linear MCP — premium UX, sin copy/paste
2. **API keys dashboard** estilo Stripe — escape hatch para scripts/CI/agentes custom

Esto requiere **trabajo en el frontend** (que es por qué quedó fuera de Sprint A — Sprint A es MCP-only).

---

## Lo que se decidió en brainstorming Sprint A

### Camino B (ambos, no uno solo)

- **OAuth** es el patrón moderno y matchea la UX que el usuario espera (lo experimentó con el MCP de Linear).
- **API keys** sirve como escape hatch para casos donde OAuth no aplica (scripts, CI, agentes custom).
- Tener ambos cubre todos los casos. Para v1 podríamos arrancar con uno y agregar el otro después, pero la decisión fue hacer ambos en este sprint.

### Stake preservado, movido al frontend

El stake de 0.035 SOL (decisión de cofundadores) se mantiene pero **se mueve del MCP al frontend**:
- Pantalla `/app/stake` con botón "Stake 0.035 SOL"
- Wallet firma la tx en navegador (Privy/Phantom/Solflare)
- Gas-station sigue sponsoreando el fee
- Tx llama a `init_stake_deposit` del programa Anchor (igual que hoy)

### Cuándo se matan las tools del MCP

Cuando este sprint esté deployado y validado:
- Borrar `apps/mcp/lib/tools/create-account/init.ts`
- Borrar `apps/mcp/lib/tools/create-account/poll.ts`
- Borrar `apps/mcp/lib/tools/create-account/complete.ts`
- Borrar `apps/mcp/lib/github/device-flow.ts`
- Limpiar `apps/mcp/lib/tools/register.ts` (quitar las 3 registraciones)
- Eventualmente limpiar columnas DB no usadas (`agent_accounts.github_oauth_token_encrypted`, estados `pending_oauth`, `pending_stake` del enum)

---

## Scope provisorio

### Páginas frontend

1. **`/app/stake`**
   - Para usuarios que aún no stakeron
   - Botón "Stake 0.035 SOL para activar tu cuenta"
   - Conecta con wallet (Privy embedded o BYO Phantom/Solflare)
   - Construye tx → firma → gas-station sponsorea → submit → confirm
   - Update DB: `agent_accounts.status = 'active'`, INSERT `stake_deposits`

2. **`/app/api-keys`**
   - List de api_keys del usuario
   - Botón "Generate new API key"
   - **Reveal-once UX**: la plaintext se muestra una sola vez, después sólo el prefix
   - Botón "Revoke" por cada key
   - Backend: POST `/api/api-keys`, DELETE `/api/api-keys/[id]`

3. **`/oauth/authorize`** (OAuth consent page)
   - Pantalla "Claude Code wants access to your ghbounty account. [Authorize] [Cancel]"
   - Muestra scopes solicitados
   - Si user no está logueado, redirige a `/app/auth/login` primero
   - Si user no tiene stake, redirige a `/app/stake` primero

4. **`/app/connected-apps`**
   - List de agentes autorizados via OAuth
   - Por cada uno: nombre, scopes, last_used_at, botón "Revoke"

5. **`/agents`** (landing rewrite)
   - Quickstart de 3 pasos: registrate → stake → conectá tu agente (OAuth o api_key)

### Backend endpoints frontend

1. **`POST /api/stake`** — sponsorea fee del stake (delega a gas-station ya existente)
2. **`POST /api/api-keys`** — mintea api_key, devuelve plaintext una vez
3. **`DELETE /api/api-keys/[id]`** — revoca (set `revoked_at`)
4. **`GET /.well-known/oauth-authorization-server`** — OAuth metadata estándar
5. **`POST /api/oauth/authorize`** — genera authorization code
6. **`POST /api/oauth/token`** — intercambia code por access_token (con PKCE)
7. **`POST /api/oauth/revoke`** — revoca token

### Cambios en MCP

- `apps/mcp/lib/auth/middleware.ts` — aceptar tanto api_keys (formato actual `ghbk_live_*`) como OAuth tokens (formato a definir). Lookup unificado en tablas `api_keys` y `oauth_tokens`.
- Tabla nueva `oauth_tokens` en `packages/db/`: token_hash, user_id, agent_name, scopes, expires_at, revoked_at, last_used_at.

### Cambios en DB

- Nueva tabla `oauth_tokens`.
- Posible nueva tabla `oauth_clients` si soportamos múltiples client_ids (no requerido v1, podemos tener un client_id genérico "público").
- Limpieza de columnas obsoletas en `agent_accounts` (`github_oauth_token_encrypted`, estados `pending_oauth`/`pending_stake`).

---

## Estimación

**~2-2.5 semanas** asumiendo:
- `/app/stake` → 2-3 días (UI + integración wallet + tx-building)
- `/app/api-keys` → 2 días
- OAuth flow completo (consent + endpoints + middleware) → 5-7 días
- `/app/connected-apps` → 1 día
- Landing `/agents` rewrite → 1 día
- Cleanup MCP (matar Device Flow) → 1 día
- Tests + integration → 2-3 días

---

## Pre-requisitos antes de arrancar

- Sprint A mergeado y deployado.
- Decisión sobre cuándo matar Device Flow (al inicio del sprint o al final).
- `superpowers:brainstorming` corrido para refinar UX y OAuth scopes.

---

## Cosas que NO se decidieron todavía

- ¿OAuth scopes granulares (read-only, read-write, etc.) o un solo scope "full access"? Para v1 probablemente full.
- ¿Refresh tokens o sólo access tokens long-lived? OAuth 2.1 recomienda refresh.
- ¿Tokens expiran o duran forever hasta revocación? Linear MCP duran forever; Stripe api_keys también.
- ¿Soporte para múltiples api_keys por usuario o una sola? Más flexible vs más simple.
- ¿Una sola pantalla unificada `/app/credentials` (api_keys + connected apps) o dos separadas?
- Discovery: ¿cómo le decimos al agente que existe el endpoint `/.well-known/oauth-authorization-server`? Estándar MCP lo soporta vía metadata; investigar.
