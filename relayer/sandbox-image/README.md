# Ghbounty Sandbox Image

Base image for the ephemeral Fly.io machines that run PR test suites
(GHB-70 → GHB-74). The relayer spawns one machine per submission, the
machine boots from this image, runs the tests, and Fly destroys it.

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
docker build --platform linux/amd64 \
  -t registry.fly.io/ghbounty-sandbox:v1 .

# Push to Fly's registry. First push is slow (~2 GB), subsequent pushes
# only upload the changed layers.
docker push registry.fly.io/ghbounty-sandbox:v1
```

Bump the tag (`v1` → `v2`) every time the Dockerfile changes so the
relayer can pin a specific version via `FLY_SANDBOX_IMAGE` and we
never accidentally roll forward in production.

## Smoke test

After pushing, verify the image runs end-to-end on Fly:

```bash
# Spawn a one-shot machine that runs the entrypoint without a spec.
# The entrypoint will print versions of every toolchain and exit 0.
flyctl machine run \
  --app ghbounty-sandbox \
  --region iad \
  --rm \
  registry.fly.io/ghbounty-sandbox:v1
```

If you see `node:`, `python:`, `rustc:`, `forge:`, `solana:`,
`anchor:` lines and exit code `0`, the image is healthy and the
relayer's `spawnSandbox()` should work against it.

## Local run (no Fly)

For iterating on the entrypoint locally:

```bash
docker build -t ghbounty-sandbox:dev .
docker run --rm ghbounty-sandbox:dev
```

The container exits as soon as the entrypoint finishes — no daemon,
no shell, no persistent state. Same behavior as on Fly.
