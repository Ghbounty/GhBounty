/**
 * Shared types for the sandbox subsystem (GHB-70/71/72/73/74).
 *
 * Kept in a separate file so the test-runner detector (GHB-71) and the
 * test-execution pipeline (GHB-72) can import the same shapes without
 * a circular dependency on the Fly client.
 */

/**
 * Static configuration the relayer needs to talk to Fly. Sourced from
 * env vars by `loadConfig()`. When `apiToken` or `appName` is null the
 * sandbox subsystem is treated as DISABLED — the submission handler
 * falls through to the fallback path (GHB-73) without spawning anything.
 */
export interface SandboxConfig {
  /** Fly API token. Read-write scoped to the sandbox app. */
  apiToken: string | null;
  /** Fly app that hosts the ephemeral machines (e.g. "ghbounty-sandbox"). */
  appName: string | null;
  /** Image reference (e.g. "registry.fly.io/ghbounty-sandbox:v1"). */
  image: string;
  /** Fly region for spawn (e.g. "iad", "ord"). Cheap US default. */
  region: string;
  /**
   * Per-run wall-clock cap, in seconds. Includes spawn + work + tear-down.
   * The PDF specifies 5 min hard limit; we default to that.
   */
  timeoutS: number;
  /** Guest CPU count. Default 2 per the architecture doc. */
  cpus: number;
  /** Guest memory in MB. Default 2048 per the architecture doc. */
  memoryMb: number;
}

/**
 * What the caller passes to `spawnSandbox`. Held intentionally narrow
 * — this is the GHB-70 surface; richer payloads (PR url, branch, etc.)
 * arrive in GHB-72 via the env channel.
 */
export interface SpawnOptions {
  /**
   * Env vars to set inside the machine. The relayer encodes its work
   * spec here (e.g. `SANDBOX_SPEC` JSON) so the entrypoint can read it
   * without us mounting volumes or piping stdin.
   *
   * NEVER put secrets in here that the target repo could exfiltrate.
   * The threat model (GHB-74) treats the sandbox machine as hostile.
   */
  env?: Record<string, string>;
  /**
   * Optional override for the per-run wall-clock cap. Defaults to
   * `cfg.timeoutS`. Capped at 600 s to keep cost predictable.
   */
  timeoutS?: number;
}

/**
 * Handle returned by `spawnSandbox`. Opaque to callers — only the
 * sandbox module's own functions consume it. Passed to `waitForExit`
 * and `destroySandbox`.
 */
export interface SandboxHandle {
  machineId: string;
  appName: string;
  /** Wall-clock when the machine was created, ms epoch. For timeout math. */
  startedAtMs: number;
  /** Effective timeout in seconds for this run. */
  timeoutS: number;
}

/**
 * Outcome of `waitForExit`. The relayer collapses these into the
 * higher-level submission outcome (success / fallback / penalty).
 *
 * - exited:    machine ran to completion. `exitCode === 0` ⇒ success.
 * - timeout:   wall-clock cap hit before the machine reported exit.
 * - infra:     Fly itself failed (api error, machine never started, …).
 *              Caller should NOT penalize the developer for this — it's
 *              our infra, not their code.
 */
export type SandboxResult =
  | {
      kind: "exited";
      exitCode: number;
      durationMs: number;
    }
  | {
      kind: "timeout";
      durationMs: number;
    }
  | {
      kind: "infra";
      reason: string;
      durationMs: number;
    };
