# Topics de estudio del proyecto

Lista de temas a aprender para operar este codebase como cofounder engineer. Ordenados por leverage / urgencia.

## Componentes del sistema

- **Modelo de datos** (`packages/db/src/schema.ts`) — base de todo, todas las apps lo usan
- **Frontend** (`frontend/`) — lo que el usuario ve y toca, ya estás trabajando acá
- **MCP server** (`apps/mcp/`) — interfaz para agentes AI
- **Programa Anchor** (`contracts/solana/`) — lógica on-chain (escrow, submissions, scoring)
- **Relayer** (`relayer/`) — pipeline de AI scoring, escucha Solana 24/7
- **Bounty judge** (`bounty_judge/`) — contratos GenLayer en Python

## Temas transversales

- **Solana fundamentals** — lamports, PDAs, transacciones, devnet vs mainnet, wallet management
- **Privy** — auth + wallet management para users no-crypto
- **Drizzle ORM** — schema-as-code, migrations, queries tipadas
- **Git workflow del equipo** — Linear branch naming, PR conventions, pre-commit hooks
- **Infra y deploy** — Vercel (frontend + MCP), Railway (relayer), Supabase (DB), Fly.io (sandbox)

## Recursos del repo

- `docsGaso/study.md` — mapa "dónde mirar cada cosa"
- `docsGaso/studyPlan.md` — 9 módulos progresivos con ejercicios
- `docsGaso/criticalFlows.md` — los 4 flows críticos del producto
