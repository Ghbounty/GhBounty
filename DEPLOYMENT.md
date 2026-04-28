# Deployment

Auto-deploy is wired up: a push to `main` ships to prod. The **frontend** runs
on Vercel, the **relayer** on Railway, the **DB** on Supabase, and the **Solana
escrow program** on devnet (Anchor). This doc covers the one-time setup +
ongoing operations.

> **Status:** MVP. There is no staging environment yet. Every push to `main`
> goes to prod. PR previews exist for the frontend (Vercel) but not for the
> relayer.

---

## Architecture map

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌────────────┐
│  Vercel      │    │  Railway     │    │  Supabase    │    │  Solana    │
│  (frontend)  │───▶│  (relayer)   │───▶│  (Postgres)  │    │  (devnet)  │
└──────────────┘    └──────────────┘    └──────────────┘    └────────────┘
     auto              auto from              schema             escrow
   from main             main             via packages/db        program
```

---

## One-time setup

### 1. Frontend — Vercel

1. Sign in at <https://vercel.com> with the project's GitHub account.
2. **Add New → Project** → import `tomazzi14/GhBounty`.
3. **Root Directory:** `frontend`. Vercel auto-detects Next.js + pnpm
   workspace.
4. **Framework Preset:** Next.js (auto).
5. **Build Command:** leave default (`next build`). Vercel runs
   `pnpm install` at the repo root which resolves workspace deps.
6. **Environment Variables** (Settings → Environment Variables):
   - `NEXT_PUBLIC_SUPABASE_URL` — Supabase Project URL
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — anon key
   - `NEXT_PUBLIC_USE_SUPABASE` — `1` for prod, `0` for previews if you want mocks
7. **Deploy.** First build takes ~2 minutes. Subsequent pushes to `main`
   redeploy automatically. Every PR gets a preview URL.

### 2. Relayer — Railway

1. Sign in at <https://railway.app>.
2. **New Project → Deploy from GitHub repo** → select `tomazzi14/GhBounty`.
3. **Root Directory:** repo root (Railway uses `relayer/Dockerfile`).
4. **Service Settings → Build:** Dockerfile path `relayer/Dockerfile`.
5. **Service Settings → Deploy:** branch `main`, auto-deploy on push enabled.
6. **Environment Variables** (Service → Variables):
   - `RPC_URL` — `https://api.devnet.solana.com` (or mainnet when ready)
   - `WS_URL` — leave blank (derived from RPC_URL)
   - `PROGRAM_ID` — Anchor program id (current devnet:
     `CPZx26QXs3HjwGobr8cVAZEtF1qGzqnNbBdt7h1EwbBg`)
   - `SCORER_KEYPAIR_PATH` — see "Secret keys" below
   - `STUB_SCORE` — `7`
   - `CHAIN_ID` — `solana-devnet`
   - `DATABASE_URL` — Supabase connection string (transaction pooler, port 6543)
   - `ANTHROPIC_API_KEY` — your Claude key (Sonnet by default)
   - `ANTHROPIC_MODEL` — `claude-sonnet-4-5-20250929` (or opus once credits arrive)
   - `GITHUB_TOKEN` — optional, for higher rate limits + private repos
   - `LOG_LEVEL` — `info`
7. **Deploy.** First build ~3-5 min (pnpm install across workspaces).

### 3. Database — Supabase

The Supabase project is already created (`kzltawaqgiwoyxxcdofm`). Connection
strings live in 1Password under "ghbounty supabase". Schema and migrations are
versioned in `packages/db/drizzle/`.

### 4. Anchor program — Solana devnet

Already deployed at program id `CPZx26QXs3HjwGobr8cVAZEtF1qGzqnNbBdt7h1EwbBg`.
To redeploy after changes:

```bash
./scripts/deploy-solana.sh
```

---

## Secret keys

### Scorer keypair (Solana)

The relayer signs `set_score` calls with a dedicated keypair. Generate once:

```bash
solana-keygen new --outfile ghbounty-scorer.json
solana-keygen pubkey ghbounty-scorer.json     # → grant SOL for fees
solana airdrop 2 <pubkey> --url devnet
```

In Railway, add the file as a **Secret File** mounted at
`/etc/secrets/scorer.json` and set `SCORER_KEYPAIR_PATH=/etc/secrets/scorer.json`.

### Anthropic API key

Get from <https://console.anthropic.com/settings/keys>. Costs:
- Sonnet 4.5 (default): ~$0.03 per evaluation
- Opus 4.5 (when Founder Inc credits arrive): ~$0.15 per evaluation

### Linear API key (dev tooling, not deployed)

Used only locally for `gh-script` Linear updates. Not needed in any deployed
service.

---

## Database migrations

Migrations live in `packages/db/drizzle/` and are versioned with the rest of
the source. **They do NOT run automatically on deploy.** The current policy
is to apply them manually so a buggy migration can't take down prod silently.

### Apply a pending migration

For Supabase, the easiest path is the SQL Editor:

1. Open `packages/db/drizzle/<latest>_<name>.sql`
2. Open <https://supabase.com/dashboard/project/_/sql/new>
3. Paste the SQL, Run.
4. Confirm by querying the changed table.

For local dev or one-off scripts:

```bash
pnpm db:push      # generates a drizzle-kit push (interactive, applies diff)
pnpm db:migrate   # applies pending migrations from packages/db/drizzle/
```

### Generate a new migration

```bash
# 1. Edit packages/db/src/schema.ts
# 2. Generate
pnpm db:generate
# 3. Inspect packages/db/drizzle/<n>_<auto-name>.sql, rename if you want
# 4. Commit BOTH the schema change and the migration file
# 5. Apply manually (SQL Editor) before merging the PR that needs it
```

---

## Deploy flow

| Trigger                         | Effect                                |
|---------------------------------|---------------------------------------|
| Push to `main`                  | Vercel + Railway redeploy in parallel |
| Open / update PR                | Vercel preview URL                    |
| Schema change merged to `main`  | **Apply migration manually first**    |

CI (`.github/workflows/ci.yml`) runs typecheck + tests on every push and PR.
Vercel and Railway do their own builds independently — they don't block on
CI today. If CI is red but the app builds, the deploy still ships. Plan to
gate on CI once we have E2E coverage worth blocking on.

---

## Pre-commit hooks

Husky runs `pnpm typecheck` + `pnpm test` before every commit (~5 seconds).
Bypass with `git commit --no-verify` only when intentional.

To set up after a fresh clone:

```bash
pnpm install     # `prepare` script wires up .husky/
```

---

## Rollback

### Frontend (Vercel)

Vercel keeps every prior deployment. **Project → Deployments → "..." →
Promote to Production** on the last known good build. Takes 5 seconds.

### Relayer (Railway)

Railway → service → **Deployments** → "Restart" on a prior successful
deploy. Or `git revert <bad-commit> && git push origin main` for a forward
fix.

### Database

Supabase has point-in-time recovery on paid tiers. On the free tier you have
daily snapshots — do not rely on recovery during the MVP, prefer additive
migrations (always nullable, never drop columns yet).

---

## Cost ceilings (current MVP)

| Component | Plan | Monthly |
|---|---|---|
| Vercel | Hobby | $0 |
| Railway | Trial | $5 free credit, then ~$5–10 |
| Supabase | Free | $0 (500 MB DB, 50K MAU) |
| Anthropic | Pay-as-you-go | $5 starter, ~$0.03/eval |
| Solana devnet | n/a | $0 |
| **Total** | | **~$10/mo** at 0–100 evals |

---

## Open items

- `frontend` doesn't yet consume `@ghbounty/db` types directly (lands when
  the schema layer is fully migrated).
- No staging environment. Acceptable for MVP. Add when there are users.
- Auto-deploy is gated only by Vercel/Railway's own build steps, not by CI.
  Plan to gate on CI green once E2E coverage exists.
- DB migrations are manual. Plan to switch to a `drizzle-kit migrate` step
  in the relayer's startup once we trust them more.
