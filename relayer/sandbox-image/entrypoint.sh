#!/usr/bin/env bash
# Sandbox entrypoint — dispatches between smoke-test and real runner.
#
# Two modes:
#   1. SANDBOX_SPEC env var unset       → smoke test (print toolchain
#                                         versions, exit 0). Same as
#                                         GHB-70 — used to validate the
#                                         image with `flyctl machine run`.
#   2. SANDBOX_SPEC env var present     → exec the GHB-72 runner, which
#                                         clones the PR, detects the
#                                         test runner, and reports JSON.
#
# We exec node directly instead of nesting `node …` under bash so the
# SIGTERM Fly sends on shutdown reaches the node process, not bash.
# Otherwise the node process keeps running until SIGKILL fires, eating
# 5-10s of every shutdown.

set -euo pipefail

if [[ -z "${SANDBOX_SPEC:-}" ]]; then
  echo "sandbox: no SANDBOX_SPEC, running smoke test" >&2
  echo "node:    $(node --version)"
  echo "pnpm:    $(pnpm --version)"
  echo "python:  $(python3 --version)"
  echo "pytest:  $(pytest --version 2>&1 | head -1)"
  echo "rustc:   $(rustc --version)"
  echo "cargo:   $(cargo --version)"
  echo "forge:   $(forge --version | head -1)"
  echo "solana:  $(solana --version)"
  echo "anchor:  $(anchor --version)"
  exit 0
fi

# Real pipeline: hand off to the node runner. `exec` replaces this
# bash process so signal handling stays clean.
exec node /usr/local/bin/sandbox-runner.mjs
