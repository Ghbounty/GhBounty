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

// ── GHB-71: test runner detector ──────────────────────────────────────

/**
 * Every test runner the sandbox image knows how to invoke. `custom`
 * is the escape hatch the company config gets to override everything
 * (per the GHB-71 ticket: "Fallback: comando custom definido por la
 * empresa"). When the detector returns `custom`, the command is
 * executed via `sh -c` so it can include pipes, env, redirection, etc.
 */
export type RunnerKind =
  | "anchor"
  | "forge"
  | "cargo"
  | "go"
  | "pnpm"
  | "yarn"
  | "npm"
  | "pytest"
  | "custom";

/**
 * What the detector returns. Consumed by GHB-72's executor, which
 * spawns the command inside the sandbox machine and captures
 * stdout/stderr/exit code.
 *
 * `cwd` is RELATIVE to the cloned repo root — empty string means the
 * repo root itself. Always relative so the executor stays in control
 * of absolute paths inside the machine.
 */
export interface RunnerSpec {
  kind: RunnerKind;
  /**
   * argv form (no shell escaping needed). The executor passes this
   * directly to the OS — no `sh -c` wrapper unless `kind === "custom"`,
   * which has shell features baked in.
   */
  command: string[];
  cwd: string;
  /**
   * Marker files / signals that triggered this match. Used for logs
   * and for the future "detector explained itself" UI surface.
   */
  markers: string[];
}

export interface DetectOptions {
  /**
   * If set (non-empty after trim), takes absolute precedence over
   * auto-detection. Sourced from the bounty config when the company
   * needs to override the heuristic (monorepo subdir, custom test
   * harness, etc.).
   */
  customCommand?: string | null;
}

// ── GHB-72: full sandbox executor (clone PR → install → test) ─────────

/**
 * Spec the relayer ships to the sandbox machine via the SANDBOX_SPEC
 * env var. Mirrored on the runner.mjs side — keep field names in sync.
 *
 * `prNumber` is optional: when omitted, the runner tests `baseRef`
 * directly (useful for harness smoke tests). In production every
 * submission has a PR.
 *
 * `gitToken` is forwarded as a GitHub bearer token via
 * http.extraHeader, so private repos and 5000-req/h rate limits work.
 * It NEVER ends up in the URL or git config.
 *
 * `customCommand` MUST come from a trusted source (relayer config /
 * bounty-creator UI), NEVER from the PR's content. The runner
 * executes it via `sh -c` which is full RCE inside the sandbox by
 * design — that's fine when the input is trusted, catastrophic
 * otherwise. See THREAT_MODEL.md "T-7" for the full reasoning.
 *
 * `testTimeoutS` is the inner deadline for the install + test phases
 * combined. Should be < SandboxConfig.timeoutS to leave the relayer
 * room to read the result before Fly tears the machine down.
 *
 * `resultNonce` is a per-run cryptographically-random hex string
 * (GHB-74). The runner emits its result line with prefix
 *   __SANDBOX_RESULT_<nonce>__:<json>
 * and the executor only trusts lines bearing the same nonce. Stops a
 * malicious PR from spoofing a "tests passed" line in its own stdout
 * (the PR can't see SANDBOX_SPEC env unless it explicitly reads it,
 * but even then, scrubbing the env before exec'ing test runners +
 * the nonce check are belt-and-suspenders).
 */
export interface SandboxSpec {
  repoUrl: string;
  baseRef: string;
  prNumber: number | null;
  customCommand: string | null;
  testTimeoutS: number;
  gitToken: string | null;
  resultNonce: string;
}

/**
 * What the relayer hands to `runSandboxedTests`. Always derives
 * `SandboxSpec` from this plus relayer config.
 */
export interface ExecutorOptions {
  repoUrl: string;
  baseRef: string;
  prNumber: number | null;
  customCommand?: string | null;
  /** Optional override of the inner test deadline. */
  testTimeoutS?: number;
}

/**
 * High-level outcome handed back to the submission handler. Mirrors
 * the JSON shape `runner.mjs` emits, with one extra field
 * (`sandboxResult`) describing how the Fly machine itself terminated.
 *
 * The submission handler collapses these into score-affecting signals
 * (passed / failed / no-tests-available) plus telemetry for ops.
 */
export type ExecutorResult =
  | {
      // Runner ran, tests completed (pass OR fail — read exitCode).
      kind: "exited";
      runner: { kind: RunnerKind; command: string[]; markers: string[] };
      exitCode: number | null;
      durationMs: number;
      stdoutTail: string;
      stderrTail: string;
    }
  | {
      // Either the install or the test phase exceeded testTimeoutS.
      kind: "timeout";
      phase: "install" | "test";
      runner: { kind: RunnerKind; command: string[]; markers: string[] };
      durationMs: number;
      stdoutTail: string;
      stderrTail: string;
    }
  | {
      // `npm ci` / `pip install` etc. failed before tests could run.
      // Surfaced separately so the relayer can distinguish "broken
      // deps" from "broken tests" in scoring + ops telemetry.
      kind: "install_error";
      runner: { kind: RunnerKind; command: string[]; markers: string[] };
      exitCode: number | null;
      durationMs: number;
      stdoutTail: string;
      stderrTail: string;
    }
  | {
      // git clone / fetch / checkout failed (private repo without
      // token, deleted PR, network blip…). Not the developer's fault.
      kind: "git_error";
      reason: string;
      durationMs: number;
    }
  | {
      // Detector returned null: the repo doesn't have any test
      // markers we recognize. Caller's the GHB-73 fallback path.
      kind: "no_runner";
      reason: string;
      durationMs: number;
    }
  | {
      // Sandbox subsystem disabled (FLY_API_TOKEN / FLY_SANDBOX_APP
      // unset) — relayer skips spawn entirely.
      kind: "disabled";
      reason: string;
    }
  | {
      // Anything else: Fly create failed, machine never started, the
      // runner crashed without emitting a result line, etc. Not the
      // developer's fault either; relayer logs + falls back.
      kind: "infra";
      reason: string;
      durationMs: number;
    };
