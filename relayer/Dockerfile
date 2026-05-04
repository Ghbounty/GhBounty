# Multi-stage Dockerfile for the relayer.
#
# Why tsx instead of `node dist/`:
# Workspace packages (@ghbounty/db, @ghbounty/diff-filter) expose their `main`
# as TypeScript source, not compiled JS. Building each one to dist/ would
# work, but adds ceremony to a small monorepo. tsx loads .ts at runtime,
# costs ~50ms cold-start, and keeps the dev/prod paths identical.
#
# When the project grows: switch to tsup-bundled single-file or add a
# `tsc` build to every workspace package. Out of scope for the MVP.

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
# GHB-73: flyctl is a runtime dep of the sandbox executor. We shell out
# to `flyctl logs` to fetch the runner.mjs result line because the Fly
# logs HTTP endpoints don't accept org-deploy tokens (401) and the
# Machines API doesn't expose stdout. flyctl reads FLY_API_TOKEN env at
# runtime, so the relayer's existing config plumbing is enough — no
# extra session setup needed.
RUN apk add --no-cache curl bash ca-certificates \
 && curl -fsSL https://fly.io/install.sh | FLYCTL_INSTALL=/usr/local sh \
 && flyctl version
WORKDIR /app

# --- deps stage: install workspace dependencies (cached layer) ---
FROM base AS deps
# Lock + workspace manifest first so that re-installs only happen when
# dependencies actually change.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/db/package.json packages/db/
COPY packages/diff-filter/package.json packages/diff-filter/
COPY packages/shared/package.json packages/shared/
COPY relayer/package.json relayer/
RUN pnpm install --frozen-lockfile --filter @ghbounty/relayer...

# --- runtime stage: copy source on top of installed deps ---
FROM deps AS runtime
COPY packages/db packages/db
COPY packages/diff-filter packages/diff-filter
COPY packages/shared packages/shared
COPY relayer relayer

# Run as non-root.
RUN adduser -D -u 1001 ghbounty && chown -R ghbounty:ghbounty /app
USER ghbounty

WORKDIR /app/relayer
ENV NODE_ENV=production
CMD ["pnpm", "start"]
