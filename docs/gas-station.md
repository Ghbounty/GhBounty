# Gas Station — operations runbook

Sponsorship layer that lets users with a 0-SOL Privy embedded wallet
interact with the bounty escrow. The frontend partial-signs every
escrow tx; the gas station co-signs as fee payer and submits.

Implementation lives across the monorepo:

| Layer            | Files                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Interface        | `packages/shared/src/gas-station/types.ts`                                                |
| Validator        | `packages/shared/src/gas-station/solana-validator.ts`                                     |
| Solana impl      | `packages/shared/src/gas-station/solana.ts`                                               |
| HTTP route       | `frontend/app/api/gas-station/sponsor/route.ts` + `frontend/lib/gas-station-route-core.ts`|
| Singleton boot   | `frontend/lib/gas-station-singleton.ts`                                                   |
| Frontend client  | `frontend/lib/gas-station-client.ts`                                                      |
| Devnet smoke     | `packages/shared/scripts/gas-station-smoke.ts`                                            |
| Health check     | `packages/shared/scripts/gas-station-health.ts`                                           |

---

## Scope — which instructions are sponsored

The gas station ONLY co-signs the four user-initiated escrow ixs:

| Instruction       | Discriminator      | Caller         |
| ----------------- | ------------------ | -------------- |
| `create_bounty`   | `7a5a0e8f087dc802` | Company        |
| `submit_solution` | `cbe99dbf4625cd00` | Developer      |
| `resolve_bounty`  | `cf2b5deedeb84fdb` | Company        |
| `cancel_bounty`   | `4f416b8f80a5872e` | Company        |

`set_score` is intentionally OUT of scope — that ix is signed by the
relayer's scorer keypair, not via sponsorship. The validator allowlist
(`ALLOWED_DISCRIMINATORS_HEX`) enforces this server-side.

ComputeBudget instructions (`SetComputeUnitLimit`, `SetComputeUnitPrice`)
are tolerated alongside an escrow ix; anything else is rejected with
`extra_unknown_instruction`.

---

## Per-tx budget

Hard caps enforced by the validator (`packages/shared/src/gas-station/solana-validator.ts`):

- `MAX_FEE_LAMPORTS = 50_000` — base fee (5_000 × signers) plus priority
  fee (limit × price ÷ 1_000_000). A tx whose estimated fee exceeds
  this is rejected with `fee_exceeds_cap`.
- `BASE_FEE_LAMPORTS_PER_SIGNATURE = 5_000` — Solana's protocol-level
  base fee per signature, unchanged for years.
- `MAX_TOPUP_LAMPORTS = 50_000_000` — cap on the optional bundled
  `SystemProgram.transfer` (gas station → user) that funds rent for
  a freshly-init'd PDA. Anything above is rejected with
  `topup_transfer_invalid`.

A fully-loaded sponsored tx with topup costs ≤ ~0.05 SOL worst case
(realistically ~0.003 SOL since rent is ~2-3M lamports per PDA). With
a 5-SOL gas-station balance, that's ≥ 100 sponsored topup txs.

## Topup transfer policy (GHB-180)

`create_bounty` and `submit_solution` both `init` a new PDA whose rent
must come from the user (Anchor hardcodes `payer = creator/solver`).
For users with 0 SOL on Privy embedded wallets, we bundle a system
transfer in the same tx so the user has rent at the time the escrow
ix runs:

| Ix                | Bundle topup? | Amount         | Notes                                                     |
| ----------------- | ------------- | -------------- | --------------------------------------------------------- |
| `create_bounty`   | yes           | 5_000_000      | Bounty PDA rent (~3.47M devnet) + buffer.                 |
| `submit_solution` | yes           | 3_000_000      | Submission PDA rent (~2.4M devnet) + buffer.              |
| `resolve_bounty`  | no            | —              | No init; no rent needed.                                  |
| `cancel_bounty`   | no            | —              | No init; no rent needed.                                  |

The validator enforces:

- Source of the topup transfer = the fee payer (gas station).
- Destination is a non-fee-payer signer in the tx (i.e. the user
  who signed the escrow ix). A non-signer destination is rejected —
  that would let an attacker exfiltrate gas-station SOL to any pubkey.
- At most ONE topup transfer per tx.
- Amount ≤ `MAX_TOPUP_LAMPORTS`.

Leftover dust stays in the user wallet — fine, since it's bounded
per-tx and total drainage is capped by the wallet balance + reserve
floor.

---

## Fund management

### Devnet

| Threshold                | Action                                                         |
| ------------------------ | -------------------------------------------------------------- |
| Initial fund             | ~5 SOL (airdrop or transfer from scorer)                       |
| Warn floor (loud)        | < 1 SOL — refill within a day                                  |
| Critical floor (alert)   | < 0.1 SOL — refill immediately, page on-call                   |
| Route reserve (auto-503) | `GAS_STATION_MIN_RESERVE_LAMPORTS` — default 50_000 lamports   |

The route's reserve check happens BEFORE every sponsor attempt and
returns 503 with `reason: "insufficient_reserve"` when balance < reserve.
That's the safety net — the warn/critical floors are the operator-side
alerts that should fire well above it.

### Mainnet

Separate keypair, separate Vercel env, separate password-manager entry.
NEVER reuse the devnet key. See "Mainnet checklist" below.

### Refill procedure (devnet)

1. From a funded keypair (e.g. the scorer):
   ```bash
   solana transfer --from ~/.config/solana/ghbounty-dev.json \
     --url devnet --allow-unfunded-recipient \
     --fee-payer ~/.config/solana/ghbounty-dev.json \
     <gas-station-pubkey> <amount>
   ```
2. Verify: `solana balance <gas-station-pubkey> --url devnet`.
3. Re-run the smoke to confirm the route is healthy:
   ```bash
   GAS_STATION_KEYPAIR_PATH=~/.config/solana/ghbounty-gas-station-dev.json \
     pnpm --filter @ghbounty/shared smoke:gas-station
   ```

Devnet airdrops are rate-limited per-IP and frequently fail; the
"transfer from scorer" path is the reliable fallback.

---

## Key rotation

The keypair is the single secret that protects fund custody. Rotate when:

- A team member with access leaves.
- The key is suspected to have been logged, copied, or otherwise leaked.
- On a fixed cadence (recommended quarterly for mainnet, no schedule on devnet).

### Procedure

1. **Generate** a new keypair on a clean machine:
   ```bash
   solana-keygen new --no-bip39-passphrase --silent \
     --outfile ~/.config/solana/ghbounty-gas-station-<env>-<date>.json
   ```
2. **Fund** the new key (transfer from old key, leaving 0.005 SOL behind
   for the rotation tx itself):
   ```bash
   solana transfer --from <old-key> --url <cluster> \
     --allow-unfunded-recipient --fee-payer <old-key> \
     <new-pubkey> <balance-minus-0.005>
   ```
3. **Update env** in this order, NOT in parallel — rotating both at once
   creates a window where the route returns 422 `wrong_fee_payer`:
   - Set `GAS_STATION_KEYPAIR_JSON` (new) in Vercel/Railway → redeploy.
   - Verify the route works with `pnpm smoke:gas-station` against the
     deployed URL.
   - Set `NEXT_PUBLIC_GAS_STATION_PUBKEY` (new) in Vercel → redeploy
     frontend. Now the partial-signed txs will have the new fee_payer
     in slot 0, matching the new server-side keypair.
4. **Drain** any residual lamports from the old key.
5. **Update password manager**: archive the old entry, add the new one.
6. **Revoke**: securely delete the old key file from any operator machines.

The whole rotation is ~5 min of human time + the redeploy cycle.

---

## Abuse response playbook

Every request to the route emits one structured log line at
`[gas-station-route] {...}` with `privyDid`, status, outcome, and (on
non-ok) reason. Search Vercel logs by `privyDid` to trace a specific
user.

### Symptoms → response

| Symptom                                                        | Response                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| One `privyDid` triggers many `validator_rejected` 422s         | They're crafting bad txs. Confirm the validator caught it; no other action. |
| One `privyDid` triggers many successful sponsorships in a burst | Possible griefing. Add `privyDid` to a temporary blocklist (TODO: not yet implemented — file as follow-up). |
| Wallet draining unusually fast despite normal usage            | Check `lamports` field in `[gas-station]` logs for outliers. If a single tx is >>5_000, the priority-fee cap is being hit. |
| 503 with `insufficient_reserve` despite recent refill          | Race: the floor was set above current balance. Refill or lower `GAS_STATION_MIN_RESERVE_LAMPORTS`. |
| 500 with `rpc_error` reasons piling up                         | RPC endpoint is unhealthy. Switch `RPC_URL` to a backup (Helius, QuickNode, etc.) and redeploy. |

### Hard kill switch

Unset `NEXT_PUBLIC_GAS_STATION_PUBKEY` in Vercel and redeploy. The
frontend `GAS_STATION_ENABLED` flag flips false; the four user flows
fall back to direct sign+send (the user pays the fee). The route
continues to exist but won't be called.

---

## Health check

`packages/shared/scripts/gas-station-health.ts` polls the gas-station
balance and exits with a status that reflects severity:

| Exit code | Meaning                                                     |
| --------- | ----------------------------------------------------------- |
| 0         | Healthy (≥ warn floor)                                      |
| 1         | Warn — balance below `--warn` flag (default 1 SOL on devnet)|
| 2         | Critical — below `--critical` flag (default 0.1 SOL)        |
| 3         | Probe failed (RPC error, missing env, etc.)                 |

Designed to be run by a scheduled job (Vercel cron, GitHub Actions
schedule, external pinger). On non-zero exit, the runner fires
whatever alert channel is wired up (Slack webhook, email, etc.).

Run locally:

```bash
GAS_STATION_KEYPAIR_PATH=~/.config/solana/ghbounty-gas-station-dev.json \
  pnpm --filter @ghbounty/shared health:gas-station
```

Or with explicit pubkey + thresholds:

```bash
pnpm --filter @ghbounty/shared health:gas-station -- \
  --pubkey <pubkey> --rpc https://api.devnet.solana.com \
  --warn 1 --critical 0.1
```

The script does NOT need the keypair to read balance — pubkey alone is
enough. We default to loading the keypair for convenience (matches the
smoke), but `--pubkey` overrides.

---

## Mainnet checklist

Before flipping `NEXT_PUBLIC_GAS_STATION_CHAIN_ID=solana-mainnet`:

- [ ] **Separate keypair**: generate on a clean machine, NEVER reuse devnet.
  Save private key in password manager (1Password / Bitwarden / Vault).
- [ ] **Max balance budget defined**: agree internally on the cap
  (e.g. 10 SOL initially) and never fund above it. Rationale: in the
  worst case the wallet is fully drained, this caps total loss.
- [ ] **Warn / critical floors raised**: mainnet thresholds should be
  proportional to expected daily volume, not the devnet defaults.
  Suggested: warn at 30% of max, critical at 10%.
- [ ] **`GAS_STATION_MIN_RESERVE_LAMPORTS` increased**: bump to ~5_000_000
  (10 sponsored txs of headroom × 100 to give ops time to react before
  the wallet hits zero).
- [ ] **Separate Vercel project / env scope**: do NOT mix mainnet and
  devnet keys in the same env scope. Use Vercel "Production" env for
  mainnet, "Preview" for devnet.
- [ ] **RPC: paid provider**: `api.mainnet-beta.solana.com` rate-limits
  aggressively. Use Helius / QuickNode / Triton with a stable URL.
- [ ] **Confirmation timeout sanity-check**: mainnet block times are
  similar to devnet but the priority-fee market is real. Validate
  `GAS_STATION_CONFIRM_TIMEOUT_MS=60_000` doesn't cut off legitimate
  sponsorships under load.
- [ ] **Health check wired to a real alert channel**: Slack webhook,
  PagerDuty, or email. Devnet noise is OK; mainnet alarms must page.
- [ ] **Smoke against mainnet** (with a tiny tx, e.g. 1-lamport bounty)
  before flipping the frontend env.

---

## Env var reference

### Server-side (Vercel)

| Variable                              | Purpose                                                                          | Default       |
| ------------------------------------- | -------------------------------------------------------------------------------- | ------------- |
| `GAS_STATION_KEYPAIR_JSON`            | 64-byte JSON array, signing key. Wins over `_PATH`.                              | unset         |
| `GAS_STATION_KEYPAIR_PATH`            | File path on disk (local dev). `~` is expanded.                                  | unset         |
| `RPC_URL`                             | Solana RPC the route uses for blockhash + send + confirm.                        | devnet        |
| `CHAIN_ID`                            | `solana-devnet` or `solana-mainnet`. Validates incoming requests.                | solana-devnet |
| `GAS_STATION_MIN_RESERVE_LAMPORTS`    | Below this, route returns 503.                                                   | 50_000        |
| `GAS_STATION_CONFIRM_TIMEOUT_MS`      | Wall-clock cap on `confirmTransaction`.                                          | 60_000        |
| `NEXT_PUBLIC_PRIVY_APP_ID`            | Used by the route to build the JWKS URL for token verification.                  | unset         |

### Client-side (Vercel, prefixed `NEXT_PUBLIC_`)

| Variable                               | Purpose                                                                                                          | Default       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------- |
| `NEXT_PUBLIC_GAS_STATION_PUBKEY`       | Frontend uses this as `feePayer` when building VersionedTransactions. **Unset → gas station feature disabled.** | unset         |
| `NEXT_PUBLIC_GAS_STATION_CHAIN_ID`     | Sent in the sponsor request body. Must match `CHAIN_ID` on the server.                                           | solana-devnet |
