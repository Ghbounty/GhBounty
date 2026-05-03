#!/usr/bin/env bash
# Sandbox entrypoint — minimal stub for GHB-70.
#
# This script's only job in GHB-70 is to make the spawn lifecycle
# observable: when the relayer starts a Fly machine with this image,
# the machine boots, prints the toolchain versions, and exits 0. The
# relayer waits for that exit and confirms the machine destroys itself
# (Fly does this automatically when `auto_destroy: true` is set on the
# config and the main process exits).
#
# GHB-72 will replace the body with the real "clone repo, fetch PR,
# detect runner, run tests" pipeline. The contract with the relayer
# stays the same: read SANDBOX_* env vars for inputs, write a single
# JSON line to stdout as the result, exit non-zero on infra failure.

set -euo pipefail

# If no spec, run the smoke-test path (toolchain versions). Useful for
# `flyctl machines run` to verify the image has all binaries available.
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

# Real pipeline lives in GHB-72. For now, surface that the spec was
# received but no executor is wired yet. Exit 0 so the relayer's
# spawn-lifecycle test still passes.
echo "sandbox: SANDBOX_SPEC received but executor not implemented (GHB-72)" >&2
echo "{\"status\":\"not_implemented\",\"reason\":\"GHB-72 pending\"}"
exit 0
