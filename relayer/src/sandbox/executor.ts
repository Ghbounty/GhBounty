/**
 * GHB-72 — high-level sandbox executor.
 *
 * Stitches GHB-70 (spawn / wait / destroy) with the in-machine
 * runner.mjs (clone + detect + install + test + JSON output) into a
 * single async call the submission handler can use:
 *
 *   const result = await runSandboxedTests(cfg, {
 *     repoUrl, baseRef, prNumber, customCommand, gitToken,
 *   });
 *
 *   switch (result.kind) {
 *     case "exited":        // tests ran (pass/fail by exitCode)
 *     case "timeout":       // ran out of time inside the sandbox
 *     case "install_error": // deps install blew up
 *     case "git_error":     // clone/fetch/checkout failed
 *     case "no_runner":     // detector found no markers
 *     case "disabled":      // FLY_API_TOKEN / app unset
 *     case "infra":         // anything else
 *   }
 *
 * Trust model:
 *   - The Fly machine is treated as hostile. We pipe a SANDBOX_SPEC
 *     JSON in and read a single `__SANDBOX_RESULT__:<json>` line back
 *     from the logs. No persistent state, no shared volumes.
 *   - `gitToken` (when set) is the relayer's own GitHub PAT. It rides
 *     in the SANDBOX_SPEC env, gets used by git via
 *     http.extraHeader, and dies with the machine.
 *
 * The destroy step always runs in a `finally` even when spawn or wait
 * threw — leaked machines cost real money on Fly.
 */

import { spawn } from "node:child_process";

import {
  destroySandbox,
  spawnSandbox,
  waitForSandboxExit,
} from "./fly.js";
import { SandboxDisabledError } from "./fly.js";
import { log } from "../logger.js";
import type {
  ExecutorOptions,
  ExecutorResult,
  RunnerKind,
  SandboxConfig,
  SandboxSpec,
} from "./types.js";

const RESULT_PREFIX = "__SANDBOX_RESULT__:";
const FLYCTL_LOGS_TIMEOUT_MS = 15_000;

/**
 * Signature for the log-fetcher used by the executor. Default impl
 * shells out to `flyctl logs`; tests inject a function that returns
 * pre-canned lines so they don't need flyctl on the test runner.
 *
 * Why subprocess flyctl: the Fly Machines API doesn't expose machine
 * stdout, the legacy /api/v1/apps/X/logs endpoint rejects org-deploy
 * tokens with 401, and the GraphQL schema has no `logs` query. flyctl
 * authenticates via FLY_API_TOKEN env (same value the org token uses
 * for the Machines API), so the subprocess inherits the right auth
 * automatically.
 */
export type LogFetcher = (
  cfg: SandboxConfig & { apiToken: string; appName: string },
  machineId: string,
) => Promise<string[]>;

/**
 * Run the test suite for a PR inside an ephemeral Fly machine.
 * Always returns a typed `ExecutorResult` — never throws for
 * "expected" failure modes (timeout, infra, git, etc.). Throws only
 * when the input is malformed before we even reach Fly.
 *
 * `fetchLogs` defaults to subprocess `flyctl logs`. Tests pass a
 * stub that returns pre-canned lines so they don't need flyctl on
 * the test runner.
 */
export async function runSandboxedTests(
  cfg: SandboxConfig,
  opts: ExecutorOptions,
  fetchLogs: LogFetcher = defaultFetchLogsViaFlyctl,
): Promise<ExecutorResult> {
  if (!cfg.apiToken || !cfg.appName) {
    return {
      kind: "disabled",
      reason: "FLY_API_TOKEN or FLY_SANDBOX_APP unset",
    };
  }

  // Inner deadline. Leave 30 s for spawn + log fetch + tear-down so
  // we never have a "machine got killed mid-emit" race.
  const innerTimeoutS =
    opts.testTimeoutS && opts.testTimeoutS > 0
      ? opts.testTimeoutS
      : Math.max(60, cfg.timeoutS - 30);

  const spec: SandboxSpec = {
    repoUrl: opts.repoUrl,
    baseRef: opts.baseRef,
    prNumber: opts.prNumber,
    customCommand: opts.customCommand?.trim() || null,
    testTimeoutS: innerTimeoutS,
    // Forwarded straight from relayer config in the submission handler
    // — the executor does not look at process.env directly so it stays
    // cleanly testable.
    gitToken: null,
  };

  const startedAtMs = Date.now();

  let handle;
  try {
    handle = await spawnSandbox(cfg, {
      env: { SANDBOX_SPEC: JSON.stringify(spec) },
    });
  } catch (err) {
    if (err instanceof SandboxDisabledError) {
      return { kind: "disabled", reason: err.message };
    }
    return {
      kind: "infra",
      reason: `spawn failed: ${(err as Error).message}`,
      durationMs: Date.now() - startedAtMs,
    };
  }

  let result: ExecutorResult;
  try {
    const sandboxResult = await waitForSandboxExit(cfg, handle);
    if (sandboxResult.kind === "infra") {
      result = {
        kind: "infra",
        reason: sandboxResult.reason,
        durationMs: sandboxResult.durationMs,
      };
    } else if (sandboxResult.kind === "timeout") {
      // Fly killed the machine before the runner emitted a result.
      // We can't tell whether install or test was running — surface
      // as a generic timeout in the test phase with no runner info.
      result = {
        kind: "infra",
        reason: `sandbox machine wall-clock timeout (${sandboxResult.durationMs} ms)`,
        durationMs: sandboxResult.durationMs,
      };
    } else {
      // Machine exited cleanly. Pull logs and try to parse the result.
      // Cast: we've already short-circuited on null token/app at the top.
      const parsed = await fetchAndParseResult(
        cfg as SandboxConfig & { apiToken: string; appName: string },
        handle.machineId,
        fetchLogs,
      );
      if (parsed) {
        result = parsed;
      } else {
        // Runner exited but didn't emit our prefix — usually means it
        // crashed before reaching the emit() call. Treat as infra.
        result = {
          kind: "infra",
          reason: `runner exited with code ${sandboxResult.exitCode} but emitted no parseable result line`,
          durationMs: sandboxResult.durationMs,
        };
      }
    }
  } finally {
    // Always reap the machine. destroySandbox is idempotent + best-effort
    // (swallows 404 + network errors), so this can't mask real failures.
    await destroySandbox(cfg, handle);
  }

  return result;
}

// ── log fetching + parsing ───────────────────────────────────────────

/**
 * Pull the most recent log lines from Fly for the machine, scan
 * backwards for the `__SANDBOX_RESULT__:` prefix, and parse the JSON
 * into an `ExecutorResult`. Returns null if no result line was found
 * or the JSON didn't validate.
 *
 * We poll a couple of times because Fly's log indexer takes ~1-3 s
 * to make recently-emitted lines queryable.
 */
async function fetchAndParseResult(
  cfg: SandboxConfig & { apiToken: string; appName: string },
  machineId: string,
  fetchLogs: LogFetcher,
): Promise<ExecutorResult | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const lines = await fetchLogs(cfg, machineId);
    const parsed = parseResultFromLogs(lines);
    if (parsed) return parsed;
    await sleep(1500);
  }
  return null;
}

/**
 * Default `LogFetcher`: shell out to `flyctl logs`. Captures stdout
 * for up to `FLYCTL_LOGS_TIMEOUT_MS`, then resolves with the lines.
 *
 * We pass FLY_API_TOKEN through as an env var so flyctl uses the same
 * credential the executor uses for the Machines API. flyctl reads
 * this env when its config dir doesn't have a logged-in session,
 * which is the case in production containers.
 *
 * `--no-tail` is critical: it makes flyctl exit after dumping the
 * existing log buffer instead of streaming forever.
 */
async function defaultFetchLogsViaFlyctl(
  cfg: SandboxConfig & { apiToken: string; appName: string },
  machineId: string,
): Promise<string[]> {
  return await new Promise<string[]>((resolve) => {
    const child = spawn(
      "flyctl",
      [
        "logs",
        "--app", cfg.appName,
        "--machine", machineId,
        "--no-tail",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, FLY_API_TOKEN: cfg.apiToken },
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => {
      stdout += c.toString("utf-8");
    });
    child.stderr.on("data", (c) => {
      stderr += c.toString("utf-8");
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, FLYCTL_LOGS_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      // ENOENT is the most common case in dev environments without
      // flyctl installed — log loudly so the operator can install it.
      log.debug("sandbox: flyctl logs subprocess errored", {
        machineId,
        err: String(err),
      });
      resolve([]);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0 && stderr) {
        log.debug("sandbox: flyctl logs non-zero exit", {
          machineId,
          code,
          stderr: stderr.slice(0, 300),
        });
      }
      resolve(stdout.split("\n"));
    });
  });
}

/**
 * Walk lines bottom-up looking for the result prefix. We allow either
 * the last marker line (most recent run) OR an earlier marker (e.g.
 * if a test runner kept logging after the runner emitted its line —
 * shouldn't happen given how we order, but defensive).
 */
export function parseResultFromLogs(lines: string[]): ExecutorResult | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? "";
    const idx = line.indexOf(RESULT_PREFIX);
    if (idx === -1) continue;
    const payload = line.slice(idx + RESULT_PREFIX.length).trim();
    try {
      const obj = JSON.parse(payload) as Record<string, unknown>;
      return adaptRunnerJsonToResult(obj);
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Translate the runner's JSON shape into the executor's
 * `ExecutorResult` discriminated union. Validates required fields per
 * branch — anything malformed becomes an `infra` result so the caller
 * can fall back cleanly.
 */
function adaptRunnerJsonToResult(obj: Record<string, unknown>): ExecutorResult {
  const status = String(obj.status ?? "");
  const durationMs = numberOr(obj.durationMs, 0);
  const stdoutTail = stringOr(obj.stdoutTail, "");
  const stderrTail = stringOr(obj.stderrTail, "");
  const reason = stringOr(obj.reason, "");
  const runner = parseRunner(obj.runner);

  switch (status) {
    case "exited":
      if (!runner) {
        return { kind: "infra", reason: "runner json missing runner field on exited", durationMs };
      }
      return {
        kind: "exited",
        runner,
        exitCode: numberOrNull(obj.exitCode),
        durationMs,
        stdoutTail,
        stderrTail,
      };
    case "timeout": {
      if (!runner) {
        return { kind: "infra", reason: "runner json missing runner field on timeout", durationMs };
      }
      const phase = obj.phase === "install" ? "install" : "test";
      return {
        kind: "timeout",
        phase,
        runner,
        durationMs,
        stdoutTail,
        stderrTail,
      };
    }
    case "install_error":
      if (!runner) {
        return { kind: "infra", reason: "runner json missing runner field on install_error", durationMs };
      }
      return {
        kind: "install_error",
        runner,
        exitCode: numberOrNull(obj.exitCode),
        durationMs,
        stdoutTail,
        stderrTail,
      };
    case "git_error":
      return { kind: "git_error", reason: reason || "git op failed", durationMs };
    case "no_runner":
      return { kind: "no_runner", reason: reason || "no markers found", durationMs };
    default:
      return {
        kind: "infra",
        reason: `unknown runner status: ${status || "<missing>"}`,
        durationMs,
      };
  }
}

function parseRunner(raw: unknown): { kind: RunnerKind; command: string[]; markers: string[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = String(r.kind ?? "") as RunnerKind;
  const command = Array.isArray(r.command) ? r.command.map(String) : null;
  const markers = Array.isArray(r.markers) ? r.markers.map(String) : [];
  if (!kind || !command || command.length === 0) return null;
  return { kind, command, markers };
}

function numberOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
