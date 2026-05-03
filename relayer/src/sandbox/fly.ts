/**
 * Fly.io Machines API client — spawn / wait / destroy ephemeral
 * sandbox machines.
 *
 * Why we hit the HTTP API directly instead of shelling out to flyctl:
 *  - The relayer runs in a container (Railway today, Fly later); we
 *    don't want flyctl as a hard runtime dep on the host.
 *  - The Machines API is stable, documented, and lets us keep the
 *    request/response surface tiny and fully typed.
 *  - Easier to mock in tests — we just intercept fetch.
 *
 * Lifecycle the relayer cares about:
 *   1. spawnSandbox      → POST /v1/apps/:app/machines  (create + start)
 *   2. waitForSandboxExit → poll GET /v1/apps/:app/machines/:id until
 *                          state === "stopped" | "destroyed" or timeout
 *   3. destroySandbox    → DELETE /v1/apps/:app/machines/:id?force=true
 *                          (cleanup; safe to call even when the machine
 *                          already destroyed itself via auto_destroy)
 *
 * The Fly API is typed loosely on purpose — we extract only the fields
 * we actually use. Adding more later is additive.
 *
 * Reference: https://fly.io/docs/machines/api/
 */

import { log } from "../logger.js";
import type {
  SandboxConfig,
  SandboxHandle,
  SandboxResult,
  SpawnOptions,
} from "./types.js";

const FLY_API_BASE = "https://api.machines.dev/v1";
const POLL_INTERVAL_MS = 2_000;
const HARD_TIMEOUT_CEILING_S = 600; // 10 min absolute max, no matter what.

/**
 * Thrown when the sandbox subsystem is invoked while disabled. The
 * submission handler catches this and falls through to GHB-73's
 * "Opus without test results" path.
 */
export class SandboxDisabledError extends Error {
  constructor(reason: string) {
    super(`sandbox disabled: ${reason}`);
    this.name = "SandboxDisabledError";
  }
}

function assertEnabled(cfg: SandboxConfig): asserts cfg is SandboxConfig & {
  apiToken: string;
  appName: string;
} {
  if (!cfg.apiToken) throw new SandboxDisabledError("FLY_API_TOKEN not set");
  if (!cfg.appName) throw new SandboxDisabledError("FLY_SANDBOX_APP not set");
}

interface FlyMachineResponse {
  id: string;
  name?: string;
  state?: string;
  region?: string;
}

interface FlyMachineDetail extends FlyMachineResponse {
  state: string;
  /**
   * Present once the machine has stopped. Fly fills this with the
   * exit code of the main process. Undefined while still running.
   */
  exit_event?: {
    exit_code?: number;
    exited_at?: string;
    requested_stop?: boolean;
  };
}

/**
 * Spawn an ephemeral Fly machine that runs the sandbox image once and
 * destroys itself on exit. Returns immediately after Fly accepts the
 * create call — does NOT wait for the machine to finish.
 *
 * The caller is expected to follow up with `waitForSandboxExit` and,
 * defensively, `destroySandbox` (idempotent — safe even after auto_destroy).
 */
export async function spawnSandbox(
  cfg: SandboxConfig,
  opts: SpawnOptions = {},
): Promise<SandboxHandle> {
  assertEnabled(cfg);

  const timeoutS = clampTimeout(opts.timeoutS ?? cfg.timeoutS);
  const body = {
    // Fly auto-generates a machine name when omitted; we let it.
    region: cfg.region,
    config: {
      image: cfg.image,
      env: opts.env ?? {},
      // GHB-70 contract: one-shot job. The machine boots, runs the
      // entrypoint, exits, and Fly destroys it. No restarts on failure
      // — a crash means real work failed and the relayer needs to know.
      auto_destroy: true,
      restart: { policy: "no" },
      // 2 CPU / 2 GB per the architecture doc. shared CPU class is the
      // cheapest tier and still plenty for `npm test` / `pytest`.
      guest: {
        cpus: cfg.cpus,
        memory_mb: cfg.memoryMb,
        cpu_kind: "shared",
      },
      // No exposed services — the machine is a worker, not a server.
      services: [],
    },
    skip_launch: false,
  };

  const res = await flyFetch(cfg, `/apps/${cfg.appName}/machines`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await safeReadText(res);
    throw new Error(
      `fly: machine create failed (${res.status}): ${truncate(text, 400)}`,
    );
  }
  const machine = (await res.json()) as FlyMachineResponse;
  log.info("sandbox: machine created", {
    machineId: machine.id,
    region: machine.region,
    timeoutS,
  });
  return {
    machineId: machine.id,
    appName: cfg.appName,
    startedAtMs: Date.now(),
    timeoutS,
  };
}

/**
 * Poll Fly until the machine reaches a terminal state ("stopped" or
 * "destroyed"), the wall-clock cap hits, or we observe a hard infra
 * failure ("failed" / "replacing").
 *
 * Returns a `SandboxResult` discriminated union. Never throws for
 * normal outcomes — the caller switches on `kind`.
 */
export async function waitForSandboxExit(
  cfg: SandboxConfig,
  handle: SandboxHandle,
): Promise<SandboxResult> {
  assertEnabled(cfg);
  const deadlineMs = handle.startedAtMs + handle.timeoutS * 1000;

  while (Date.now() < deadlineMs) {
    let detail: FlyMachineDetail;
    try {
      const res = await flyFetch(
        cfg,
        `/apps/${cfg.appName}/machines/${handle.machineId}`,
        { method: "GET" },
      );
      if (!res.ok) {
        // 404 once the machine has self-destroyed via auto_destroy is
        // expected when we miss the "stopped" window. Treat as exited
        // with code 0 — auto_destroy only fires when the entrypoint
        // exited cleanly enough for Fly to garbage-collect it.
        if (res.status === 404) {
          return {
            kind: "exited",
            exitCode: 0,
            durationMs: Date.now() - handle.startedAtMs,
          };
        }
        const text = await safeReadText(res);
        log.debug("sandbox: poll non-OK, retrying", {
          machineId: handle.machineId,
          status: res.status,
          body: truncate(text, 200),
        });
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      detail = (await res.json()) as FlyMachineDetail;
    } catch (err) {
      // Transient network blip — keep polling, don't abort the run.
      log.debug("sandbox: poll fetch failed, retrying", {
        machineId: handle.machineId,
        err: String(err),
      });
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    switch (detail.state) {
      case "stopped":
      case "destroyed": {
        const exitCode = detail.exit_event?.exit_code ?? 0;
        return {
          kind: "exited",
          exitCode,
          durationMs: Date.now() - handle.startedAtMs,
        };
      }
      case "failed":
      case "replacing": {
        return {
          kind: "infra",
          reason: `fly machine entered terminal state: ${detail.state}`,
          durationMs: Date.now() - handle.startedAtMs,
        };
      }
      // "created", "starting", "started", "stopping" → keep polling.
      default:
        break;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  return {
    kind: "timeout",
    durationMs: Date.now() - handle.startedAtMs,
  };
}

/**
 * Force-destroy a machine. Safe to call after auto_destroy has already
 * fired — Fly returns 404 in that case and we treat it as a no-op.
 *
 * Always called from a `finally` in the submission handler so a leaked
 * machine isn't a possibility. Costs are billed per second of runtime,
 * so even a forgotten machine eventually destroys itself, but cleaner
 * to be explicit.
 */
export async function destroySandbox(
  cfg: SandboxConfig,
  handle: SandboxHandle,
): Promise<void> {
  assertEnabled(cfg);
  try {
    const res = await flyFetch(
      cfg,
      `/apps/${cfg.appName}/machines/${handle.machineId}?force=true`,
      { method: "DELETE" },
    );
    // 200/204: deleted. 404: already gone (auto_destroy or prior call).
    // Any other non-2xx is logged but NOT thrown — destroy is best-effort
    // cleanup, the caller has already returned its real result.
    if (!res.ok && res.status !== 404) {
      const text = await safeReadText(res);
      log.warn("sandbox: destroy returned non-OK", {
        machineId: handle.machineId,
        status: res.status,
        body: truncate(text, 200),
      });
    }
  } catch (err) {
    log.warn("sandbox: destroy failed (will rely on auto_destroy)", {
      machineId: handle.machineId,
      err: String(err),
    });
  }
}

// ── internals ──────────────────────────────────────────────────────────

async function flyFetch(
  cfg: SandboxConfig & { apiToken: string },
  path: string,
  init: RequestInit,
): Promise<Response> {
  const url = `${FLY_API_BASE}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.apiToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function clampTimeout(t: number): number {
  if (!Number.isFinite(t) || t <= 0) return 300;
  return Math.min(Math.floor(t), HARD_TIMEOUT_CEILING_S);
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
