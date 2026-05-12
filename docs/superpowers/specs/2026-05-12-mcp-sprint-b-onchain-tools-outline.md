# MCP Sprint B — on-chain tools (submit_pr, check_status) — OUTLINE

**Status:** Outline (NOT a full spec yet)
**Owner:** TBD
**Created:** 2026-05-12
**Predecessor:** `2026-05-12-mcp-devnet-rebuild-design.md` (Sprint A) debe estar mergeado y deployado antes de arrancar este sprint.
**Related cards:** GHB-114 (submit_pr), GHB-115 (check_status), GHB-182 (security bug en submit_solution)

> ⚠️ **Este es un outline, no una spec completa.** Antes de implementar, hay que correr `superpowers:brainstorming` para refinar decisiones abiertas, edge cases, y trade-offs. El propósito de este archivo es capturar el contexto descubierto durante el brainstorming de Sprint A para que nada se pierda.

---

## Por qué este sprint existe

`submit_pr` y `check_status` son las dos tools que cierran el loop del agente: encontrar un bounty → resolverlo → submitearlo → ver score. Sin ellas el MCP es read-only y los agentes no pueden generar valor real.

Inicialmente estimadas como 3-4 días, durante brainstorming Sprint A descubrimos que son mucho más complejas porque las submissions son **entidades on-chain**, no rows de DB.

---

## Lo que descubrimos en brainstorming Sprint A

### Las submissions son on-chain

Mirando `packages/db/src/schema.ts:109` (tabla `submissions`):
- Tiene `pda` (Program Derived Address) único
- Tiene `solver`, `submission_index`, `opus_report_hash`
- `state` con enum (`pending → scored → winner | auto_rejected`)
- Esto significa que `submit_pr` debe **construir y submitear una tx Solana** llamando al programa Anchor `submit_solution`, igual que `create_account.complete` hace con `init_stake_deposit`.

### Existe un relayer dedicado

`relayer/src/` es un servicio aparte que:
- Mira la blockchain con `watcher.ts`
- Cuando ve una submission nueva, la levanta con `submission-handler.ts`
- Scorea con Claude Opus (`opus.ts`, 4 dimensiones)
- Opcionalmente pide second opinion a GenLayer (`genlayer/`)
- Rankea (`ranking.ts`)
- Escribe `evaluations` en la DB
- Marca la submission como `scored` o `auto_rejected`

Para que `submit_pr`/`check_status` en devnet funcionen, **el relayer también debe correr contra devnet**.

### Existe un bounty_judge

`bounty_judge/` es servicio Python con fixtures que evalúa PRs. No me metí a fondo — investigar antes de implementar.

### GHB-182 es un bug de seguridad bloqueante

El programa Anchor `submit_solution` no valida ownership del PR. Un atacante puede submitear PRs ajenos. Si implementamos `submit_pr` MCP heredamos el bug.

**Decisión a tomar en brainstorming Sprint B:** ¿fixeamos GHB-182 antes de `submit_pr`, o aceptamos el bug en v1 con plan de fix posterior?

---

## Scope provisorio

### Tools a implementar

1. **`submit_pr`** (GHB-114)
   - Input: `{ bounty_id, pr_url }`
   - Auth: Bearer api_key, cuenta debe estar `active` (stakeada)
   - Acciones:
     a. Validar PR (existe? es del repo del bounty? autor matchea github_handle del agent?)
     b. Construir tx para `submit_solution` con PDA derivado
     c. Devolver tx unsigned al agente para que firme
     d. (siguiente call, o tool separada) submitear tx firmada vía gas-station
   - Output: `{ submission_id, status, chain }`

2. **`check_status`** (GHB-115)
   - Input: `{ submission_id }`
   - Auth: Bearer api_key
   - Lee de DB: SELECT submissions + JOIN evaluations
   - Output: `{ score, reasoning, ranking, was_auto_rejected, payment_status, chain, tx_hash }`

### Infra a desplegar

- Programa Anchor `ghbounty_escrow` en devnet (anchor deploy con keypair, fundeada con SOL faucet)
- Gas-station wallet devnet con faucet (~5-10 SOL para sponsorear fees)
- Relayer apuntando a devnet (envs + posiblemente proceso separado del relayer mainnet)
- GitHub OAuth app para devnet (si decidimos validar Device Flow también, ver Sprint A spec)

### Decisión bloqueante

**GHB-182** debe resolverse antes de exponer `submit_pr` públicamente:
- Opción A: fix en programa Anchor (requiere redeploy)
- Opción B: validación en MCP server (PR author == agent github_handle)
- Opción C: validación en relayer (rechazar scoring si no matchea)
- Mi voto inicial: B + C (defensa en profundidad sin redeploy del programa)

---

## Estimación

**~1.5-2 semanas** asumiendo:
- Anchor deploy a devnet → 1 día (si nadie lo hizo antes, puede ser más)
- Relayer a devnet → 2 días (envs + testing)
- `submit_pr` con on-chain tx → 3-4 días
- `check_status` → 1-2 días
- GHB-182 fix → 2-3 días
- Buffer e integration testing → 2-3 días

---

## Pre-requisitos antes de arrancar

- Sprint A mergeado y deployado en producción (devnet).
- Acceso al keypair que va a deployar el programa Anchor en devnet.
- Faucet disponible para fundear gas-station + program-deploy keypair.
- Decisión tomada sobre GHB-182 fix.
- `superpowers:brainstorming` corrido para refinar este outline.

---

## Cosas que NO se decidieron todavía

- ¿Tools separadas `prepare_submission` + `submit_submission`, o una sola `submit_pr` que devuelve tx y otra `confirm_submission` que recibe la firmada? Decidir en brainstorming.
- ¿`check_status` polling-driven (agente pregunta cada N seg) o webhook-driven (no soportado en MCP standard hoy)? Probablemente polling.
- ¿El relayer en devnet corre como Vercel cron, Railway, otro? Investigar setup actual del relayer.
- ¿Bounty_judge participa en devnet o sólo en mainnet?
