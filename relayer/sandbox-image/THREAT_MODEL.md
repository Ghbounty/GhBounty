# Sandbox Threat Model (GHB-74)

This is the security model for the ephemeral Fly.io machines that the
relayer spawns to run PR test suites. It documents what we trust,
what we don't, what we mitigate, and the residual risks we have
explicitly accepted for the MVP.

Audience: anyone modifying `relayer/src/sandbox/`,
`relayer/sandbox-image/`, or the relayer's submission flow. If you
loosen any mitigation listed here, update the table.

## Trust boundaries

```
                +-----------------------+
                | Relayer (host)        |
                | - FLY_API_TOKEN       |
                | - SCORER_KEYPAIR      |
                | - ANTHROPIC_API_KEY   |    1. spec (no secrets)
                | - DATABASE_URL        |  ───────────────────────►
                +-----------------------+
                            ▲
                            │  3. one log line we trust
                            │     (nonced result marker)
                            │
                +-----------------------+
                | Fly machine (sandbox) |
                | - PR's code           |    2. egress allowlisted
                | - test runner         |  ───────────────────────►
                | - scratch /work       |     to known registries
                +-----------------------+        + github
```

Trust is one-way: the relayer hands the sandbox a narrow input spec,
the sandbox executes potentially-malicious test code, and the relayer
trusts ONE thing back — the nonced result line. Everything else the
sandbox emits is treated as untrusted log noise.

## What lives where

| Resource | Lives in | Why |
|----------|----------|-----|
| `FLY_API_TOKEN` | Relayer process only. Never set as env on the spawned machine. | Token can spawn/destroy machines; leaking it to a sandbox would let a malicious PR brick the whole sandbox app. |
| `SCORER_KEYPAIR` (Solana signer) | Relayer process only. | On-chain authority — leak = arbitrary `set_score` calls. |
| `ANTHROPIC_API_KEY`, `GENLAYER_PRIVATE_KEY`, `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Relayer process only. | API + DB credentials. The sandbox has no need for any of them. |
| `gitToken` (relayer's GitHub PAT) | Relayer ⇒ sandbox via `SANDBOX_SPEC.gitToken`. NEVER set today (always `null`). When set: passed to git only via `http.extraHeader`, never in URL or git config. Dies with the machine. | Required for private-repo support. Header-based auth keeps it out of git's reflog and `.git/config`. |
| `resultNonce` (per-run anti-spoof) | Relayer-generated, sent in `SANDBOX_SPEC.resultNonce`, mixed into the result-marker prefix. Scrubbed from env passed to install/test child processes. | A 16-byte secret the runner echoes only inside its prefix string; the PR can't guess it. |
| PR source code | Sandbox `/work/repo` only. Discarded with the machine. | The point of the sandbox. |

## Mitigations and residual risks

| ID | Vector | Mitigation | Residual risk | Tracked |
|----|--------|------------|---------------|---------|
| **T-1** | Compromised PR code reads relayer secrets via shared filesystem / env | Each run is a fresh Firecracker microVM with no shared volumes and no relayer env injected — only `SANDBOX_SPEC` is set. The relayer process runs on a different host entirely. | Negligible: zero shared state by construction. | ✓ enforced |
| **T-2** | Compromised PR machine attacks other sandbox machines (lateral) | Fly Machines are independent microVMs. We don't put them on a Fly private network and we don't deploy a sidecar — there are no peer machines to discover. | Negligible. Future: if we ever add a sidecar for log/metric collection, gate it behind a per-machine ACL. | ✓ enforced |
| **T-3** | Result-line spoofing — PR's test runner prints a fake `__SANDBOX_RESULT__` "tests passed" line to inflate its score | Per-run cryptographic nonce (16 bytes hex) mixed into the marker prefix (`__SANDBOX_RESULT_<nonce>__:`). The PR cannot guess the nonce; even if it reads `SANDBOX_SPEC` env, the runner scrubs that env before exec'ing test/install processes. | Negligible: 128 bits of entropy under a 5-min wall-clock cap. | ✓ enforced |
| **T-4** | PR code exfiltrates source / secrets to attacker-controlled host | Boot-time iptables egress allowlist (`firewall.sh`) — only DNS to a fixed resolver + HTTPS to a curated set of registries (npm/yarn, PyPI, crates, Go proxy) and GitHub. Default policy is `OUTPUT DROP`. | **Accepted**: the PR can still exfiltrate to GitHub itself (gist, fork-push, comments). For the MVP we treat this as out-of-scope — public PRs are already public, and private-repo support is gated by `gitToken` (always null today). |  |
| **T-5** | PR consumes infinite CPU / RAM / disk to delay or crash the sandbox | Wall-clock cap (`FLY_SANDBOX_TIMEOUT_S`, default 300 s) enforced at two layers: Fly destroys the machine, runner.mjs kills its child after `testTimeoutS` with SIGTERM → SIGKILL. Guest sized at 2 CPU / 2 GB / shared kind. Disk is the machine's ephemeral root. | Accepted: a PR can waste up to one machine-run of CPU/RAM. Cost cap is the wall-clock × Fly's per-second price. | ✓ enforced |
| **T-6** | PR forges a fake exit code / status by killing the runner before emit | The runner.mjs always emits a final `__SANDBOX_RESULT_<nonce>__:` line; if a child process kills it (via `kill -1` on PID 1, etc.) Fly returns no result line and the executor flips the outcome to `kind: infra`. The submission handler then renders the "no test results available" prompt section — which Sonnet treats as a moderate penalty. | Accepted: PR can degrade its own evaluation but cannot inflate it. | ✓ enforced |
| **T-7** | `customCommand` becomes an injection vector | The runner intentionally executes `customCommand` via `sh -c` — that's the documented contract. Defence is upstream: the relayer's submission handler always passes `null` today, and the executor's `validateCustomCommand` rejects NULs / control bytes / >4 KB inputs as a guard against accidental misuse. **`customCommand` MUST come from a trusted source (bounty-creator UI), never from PR-supplied data (e.g. `.ghbounty.yml` in the repo).** | Accepted: depends on caller discipline. If/when a future feature exposes `customCommand` to user input, that feature is broken by design and must thread its own validation. | ✓ comment in `types.ts` + validator |
| **T-8** | `SANDBOX_SPEC` malformed by relayer (bug) → runner mis-parses → arbitrary behavior | Runner validates required fields (`repoUrl`, `baseRef`, `resultNonce` 8-128 hex chars) and exits with `kind: infra` on shape errors. The executor falls back to "no test results available" cleanly. | Accepted. | ✓ enforced |
| **T-9** | Image-tag drift — `:v3` is force-pushed to a malicious image | We pin by tag, not digest. Anyone with `flyctl auth docker` push rights to `registry.fly.io/ghbounty-sandbox` can replace the tag content. | **Accepted for MVP**. Mitigation owner: rotate the Fly org-deploy token + audit Fly registry pushes. Future hardening: pin by SHA256 digest in `FLY_SANDBOX_IMAGE` and require explicit tag bumps to rotate. |  |
| **T-10** | Fly API token compromise lets attacker spawn machines / read logs / destroy | Token is org-scoped (not app-scoped — we couldn't get an app-scoped token to work for log fetching). Stored only in Railway env + the local `.env`. Rotated manually if leaked. | **Accepted for MVP**. Future hardening: re-attempt app-scoped token with HTTP logs API + use machine-scoped tokens for the spawn calls. |  |
| **T-11** | Relayer log-fetch fails open (parses untrusted line as result) | `parseResultFromLogs` requires the per-run prefix (T-3) AND a JSON shape that adapts to one of the known status discriminants. Anything else returns `kind: infra` (no test info supplied to Sonnet). | Negligible. | ✓ enforced |
| **T-12** | DNS poisoning inside the sandbox routes registry traffic to attacker IPs | `firewall.sh` pins all whitelist IPs in `/etc/hosts` at boot and forces `/etc/resolv.conf` to a single resolver (1.1.1.1). DNS to anything other than the resolver is blocked at the iptables OUTPUT chain. | Accepted: an attacker who controls 1.1.1.1's response for `github.com` can redirect — but they need that level of upstream access already. |  |

## What we explicitly do NOT defend against

These are out-of-scope for the sandbox layer. Listed here so future
contributors don't quietly assume coverage that isn't there:

- **Supply-chain attacks via dependencies.** A malicious npm/pip/cargo
  package executed as part of `pnpm install` / `pip install -r ...` /
  `cargo build` runs with full sandbox permissions. The boot-time
  egress allowlist limits where it can phone home, but the PR can
  still corrupt its own test results. Mitigation responsibility lives
  in the broader bounty review process, not the sandbox.
- **Side-channel attacks on the Firecracker host.** We rely on Fly's
  host-level isolation. If a Spectre-class break-out is published, we
  patch upstream like everyone else.
- **PR test-runner gaming.** A PR that adds `--assert ...` or pads
  its own assertions is a scoring-quality problem, addressed in the
  Sonnet prompt and second-opinion (GenLayer) layer, not here.
- **Relayer-level attacks.** This document covers the sandbox only.
  Relayer hardening (rate-limits, scorer-key isolation, DB access
  controls) lives elsewhere.

## How to extend safely

When adding a new test runner / install path / capability to the
sandbox image:

1. If it needs network egress to a new origin, **add the hostname to
   `firewall.sh` WHITELIST and bump the image tag.** Do not loosen
   the default DROP policy.
2. If it needs to receive any new field in `SANDBOX_SPEC`, add field
   validation in `runner.mjs`'s spec parsing block — refuse to start
   on bad shapes.
3. If it needs a new env var that comes from the relayer, document
   why the sandbox needs that secret (T-1 is intentionally strict).
   Most "new env vars" turn out to be unnecessary on closer look.
4. Update this document. Untracked mitigations rot.

## References

- GHB-70: Fly machine spawn/wait/destroy + base image
- GHB-71: Test-runner detector
- GHB-72: In-sandbox runner.mjs + executor wiring
- GHB-73: Submission handler integration with fallback
- GHB-74: This document + nonce + customCommand validator + egress allowlist
