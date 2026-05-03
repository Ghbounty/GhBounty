# Ghbounty Sandbox Image

Base image for the ephemeral Fly.io machines that run PR test suites
(GHB-70 → GHB-74). The relayer spawns one machine per submission, the
machine boots from this image, runs the tests, and Fly destroys it.

## Versions

| Tag | Adds |
|-----|------|
| `v1` | Toolchains only (Node, Python, Rust, Foundry, Solana, Anchor). Smoke-test entrypoint. |
| `v2` | GHB-72 runner.mjs: clones PR, detects test runner, installs deps, runs tests, emits JSON result via `__SANDBOX_RESULT__:` line. |

## What's inside

| Toolchain | Why |
|-----------|-----|
| Node 20 LTS + pnpm | `npm test`, `pnpm test`, vitest, jest |
| Python 3 + pytest | `pytest` |
| Rust stable + cargo | `cargo test` |
| Foundry (forge/cast/anvil) | `forge test` |
| Solana CLI 1.18 + Anchor 0.30.1 (via avm) | `anchor test` |

The detector (GHB-71) picks the runner based on lockfiles in the
target repo, so we always need every binary preinstalled — we can't
apt-get at runtime because the machine runs with restricted egress
(threat model: GHB-74).

## Build & push (one-time, then per-update)

You'll need:
- Docker
- A logged-in `flyctl` (`flyctl auth login`)
- The sandbox app created on Fly:
  ```bash
  flyctl apps create ghbounty-sandbox
  ```

Then from this directory:

```bash
# Auth Docker against Fly's registry (one-time per machine).
flyctl auth docker

# Build for x86_64 even on Apple Silicon — Fly machines are amd64 only.
# Bump the tag whenever the Dockerfile, runner.mjs, or entrypoint.sh
# changes so the relayer can pin a known-good version via FLY_SANDBOX_IMAGE.
docker build --platform linux/amd64 \
  -t registry.fly.io/ghbounty-sandbox:v2 .

# Push to Fly's registry. First push is slow (~1.5 GB for v2),
# subsequent pushes only upload the changed layers.
docker push registry.fly.io/ghbounty-sandbox:v2
```

Bump the tag (`v1` → `v2`) every time the Dockerfile changes so the
relayer can pin a specific version via `FLY_SANDBOX_IMAGE` and we
never accidentally roll forward in production.

## Smoke test (v1 toolchain check)

After pushing, verify the toolchains are healthy:

```bash
# Spawn a one-shot machine without a spec — entrypoint prints versions
# of every toolchain and exits 0.
flyctl machine run \
  --app ghbounty-sandbox \
  --region iad \
  --rm \
  registry.fly.io/ghbounty-sandbox:v2
```

If you see `node:`, `python:`, `rustc:`, `forge:`, `solana:`,
`anchor:` lines and exit code `0`, the image is healthy.

## E2E test (v2 runner against a real PR)

```bash
# A small public Anchor repo PR is the cheapest end-to-end check.
# Replace the spec values with whatever you want to test.
SPEC='{"repoUrl":"https://github.com/coral-xyz/anchor.git","baseRef":"master","prNumber":3500,"testTimeoutS":180}'

flyctl machine run \
  --app ghbounty-sandbox \
  --region iad \
  --rm \
  --env "SANDBOX_SPEC=$SPEC" \
  registry.fly.io/ghbounty-sandbox:v2

# Then read the logs to see what the runner reported:
flyctl logs --app ghbounty-sandbox --no-tail | tail -50 | grep __SANDBOX_RESULT__
```

You should see a line like:
```
__SANDBOX_RESULT__:{"status":"exited","runner":{"kind":"anchor",...},"exitCode":0,...}
```

## Local run (no Fly)

For iterating on the entrypoint locally:

```bash
docker build -t ghbounty-sandbox:dev .
docker run --rm ghbounty-sandbox:dev
```

The container exits as soon as the entrypoint finishes — no daemon,
no shell, no persistent state. Same behavior as on Fly.
