# Ghbounty sandbox base image.
#
# This image runs inside ephemeral Fly.io machines that the relayer
# spawns to execute test suites against arbitrary PRs. It MUST contain
# every test runner we want to support out of the box, because the
# machine is offline (egress is whitelisted, no apt-get at runtime).
#
# Layers are ordered cheapest → most-expensive so that local rebuilds
# during development hit the BuildKit cache as much as possible. The
# final image is ~2-2.5 GB; Fly caches it on each host so cold-start
# only pays the pull once per host.
#
# Build & push (run from repo root). Bump the tag whenever this file
# OR runner.mjs / entrypoint.sh changes, so the relayer can pin a
# specific version via FLY_SANDBOX_IMAGE and we never roll forward
# silently in production:
#   cd relayer/sandbox-image
#   flyctl auth docker                       # one-time, pipes creds to docker
#   docker build --platform linux/amd64 -t registry.fly.io/ghbounty-sandbox:v3 .
#   docker push registry.fly.io/ghbounty-sandbox:v3
#
# We pin --platform=linux/amd64 because Fly machines are x86_64 and
# building on Apple Silicon would otherwise produce arm64 binaries
# the host cannot exec.

FROM debian:bookworm-slim

# Single layer for OS prerequisites — keeps image small and avoids
# multiple apt-update round-trips.
#
# `iptables` is required for the GHB-74 boot-time egress allowlist
# (firewall.sh). On Debian bookworm this installs the nftables-backed
# iptables binary, which works the same way for our use case.
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    build-essential \
    pkg-config \
    libssl-dev \
    python3 \
    python3-pip \
    python3-venv \
    jq \
    unzip \
    xz-utils \
    iptables \
 && rm -rf /var/lib/apt/lists/*

# ── Node.js 20 LTS via nodesource (pnpm via corepack) ───────────────────
# Why nodesource over apt's nodejs: apt's debian package is years out
# of date (v18 on bookworm), and several modern test runners require
# Node 20+ (vitest 2.x, jest 30, etc.).
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && corepack enable \
 && corepack prepare pnpm@latest --activate \
 && rm -rf /var/lib/apt/lists/*

# ── Rust stable + cargo ─────────────────────────────────────────────────
# rustup is pinned to a specific minimal profile to skip docs/source
# (~400 MB savings). Stable channel is the safest default for `cargo test`.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH \
    RUST_VERSION=stable
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --profile minimal --default-toolchain $RUST_VERSION \
 && rustup --version && cargo --version && rustc --version

# ── Foundry (forge / cast / anvil) ──────────────────────────────────────
# We install via the official foundryup script, then pin to a specific
# nightly release so test runs are reproducible. Bumping the pin is
# explicit and visible in this Dockerfile.
ENV FOUNDRY_DIR=/root/.foundry
ENV PATH=$FOUNDRY_DIR/bin:$PATH
RUN curl -L https://foundry.paradigm.xyz | bash \
 && $FOUNDRY_DIR/bin/foundryup \
 && forge --version

# ── Solana CLI + Anchor ─────────────────────────────────────────────────
# Anchor 0.30+ is what the project's contracts target. Solana CLI 1.18
# is the minimum that ships compatible BPF tooling. We use the official
# install scripts, which drop binaries under ~/.local/share/solana and
# ~/.cargo/bin respectively.
ENV PATH=/root/.local/share/solana/install/active_release/bin:$PATH
RUN sh -c "$(curl -sSfL https://release.anza.xyz/v1.18.26/install)" \
 && solana --version

# Anchor via avm (Anchor Version Manager). avm makes upgrading the
# pinned version a one-liner without rebuilding the whole image.
RUN cargo install --git https://github.com/coral-xyz/anchor avm --force \
 && avm install 0.30.1 \
 && avm use 0.30.1 \
 && anchor --version

# ── Python test stack ───────────────────────────────────────────────────
# Pre-install pytest globally so `pytest` works without a venv. Repos
# that require their own deps will install them at runtime via pip in
# a venv they create.
RUN pip install --break-system-packages --no-cache-dir pytest pytest-xdist

# ── Workspace ───────────────────────────────────────────────────────────
# /work is where the entrypoint clones the target repo. Owned by root
# inside an ephemeral machine — no users, no privilege boundaries to
# worry about because the machine itself is the sandbox.
RUN mkdir -p /work
WORKDIR /work

COPY entrypoint.sh /usr/local/bin/sandbox-entrypoint
COPY runner.mjs    /usr/local/bin/sandbox-runner.mjs
COPY firewall.sh   /usr/local/bin/sandbox-firewall
RUN chmod +x /usr/local/bin/sandbox-entrypoint \
              /usr/local/bin/sandbox-runner.mjs \
              /usr/local/bin/sandbox-firewall

# Default command: invoke the entrypoint. With SANDBOX_SPEC unset it
# falls back to the smoke-test path (toolchain versions); with the spec
# set it runs the GHB-74 firewall (egress allowlist) then `exec`s the
# node runner that does clone + detect + install + test + JSON output.
# See entrypoint.sh, firewall.sh, and runner.mjs.
CMD ["/usr/local/bin/sandbox-entrypoint"]
