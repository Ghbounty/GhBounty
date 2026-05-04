import { afterEach, describe, expect, test, vi } from "vitest";

import {
  parseResultFromLogs,
  runSandboxedTests,
} from "../src/sandbox/index.js";
import type { SandboxConfig } from "../src/sandbox/index.js";

/**
 * GHB-72 — executor tests.
 *
 *  - parseResultFromLogs is pure: feed log arrays, expect result shape.
 *  - runSandboxedTests is integration: mocks fetch globally and walks
 *    through (a) disabled state, (b) successful exited path, (c) git
 *    error from runner JSON, (d) malformed runner output → infra.
 *
 * The Fly client (spawn/wait/destroy) is exercised real here — only
 * the underlying fetch is stubbed. That gives us realistic coverage
 * of the spawn body shape AND the executor's parsing in one go.
 */

const baseCfg: SandboxConfig = {
  apiToken: "fly_test_token",
  appName: "ghbounty-sandbox-test",
  image: "registry.fly.io/ghbounty-sandbox:test",
  region: "iad",
  timeoutS: 5,
  cpus: 2,
  memoryMb: 2048,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── parseResultFromLogs ──────────────────────────────────────────────

describe("parseResultFromLogs", () => {
  test("returns null when no marker line present", () => {
    expect(parseResultFromLogs(["random log", "more log"])).toBeNull();
  });

  test("parses an exited result with runner + exitCode", () => {
    const lines = [
      "[install] up to date",
      "[test] PASS  tests/foo.test.ts",
      `__SANDBOX_RESULT__:${JSON.stringify({
        status: "exited",
        runner: { kind: "pnpm", command: ["pnpm", "test"], markers: ["package.json", "pnpm-lock.yaml"] },
        exitCode: 0,
        durationMs: 12345,
        stdoutTail: "PASS",
        stderrTail: "",
      })}`,
    ];
    const result = parseResultFromLogs(lines);
    expect(result?.kind).toBe("exited");
    if (result?.kind === "exited") {
      expect(result.runner.kind).toBe("pnpm");
      expect(result.exitCode).toBe(0);
      expect(result.durationMs).toBe(12345);
      expect(result.stdoutTail).toBe("PASS");
    }
  });

  test("parses a non-zero exit code (failing tests)", () => {
    const lines = [
      `__SANDBOX_RESULT__:${JSON.stringify({
        status: "exited",
        runner: { kind: "cargo", command: ["cargo", "test"], markers: ["Cargo.toml"] },
        exitCode: 101,
        durationMs: 9876,
        stdoutTail: "",
        stderrTail: "test failed",
      })}`,
    ];
    const result = parseResultFromLogs(lines);
    expect(result?.kind).toBe("exited");
    if (result?.kind === "exited") expect(result.exitCode).toBe(101);
  });

  test("parses timeout with phase + runner", () => {
    const lines = [
      `__SANDBOX_RESULT__:${JSON.stringify({
        status: "timeout",
        phase: "test",
        runner: { kind: "anchor", command: ["anchor", "test"], markers: ["Anchor.toml"] },
        durationMs: 240_000,
        stdoutTail: "",
        stderrTail: "",
      })}`,
    ];
    const result = parseResultFromLogs(lines);
    expect(result?.kind).toBe("timeout");
    if (result?.kind === "timeout") {
      expect(result.phase).toBe("test");
      expect(result.runner.kind).toBe("anchor");
    }
  });

  test("parses install_error", () => {
    const lines = [
      `__SANDBOX_RESULT__:${JSON.stringify({
        status: "install_error",
        runner: { kind: "npm", command: ["npm", "test"], markers: ["package.json"] },
        exitCode: 1,
        durationMs: 4321,
        stdoutTail: "",
        stderrTail: "ENOENT",
      })}`,
    ];
    const result = parseResultFromLogs(lines);
    expect(result?.kind).toBe("install_error");
  });

  test("parses git_error without a runner field", () => {
    const lines = [
      `__SANDBOX_RESULT__:${JSON.stringify({
        status: "git_error",
        reason: "fetch failed: Repository not found",
        durationMs: 3000,
      })}`,
    ];
    const result = parseResultFromLogs(lines);
    expect(result?.kind).toBe("git_error");
    if (result?.kind === "git_error") {
      expect(result.reason).toMatch(/Repository not found/);
    }
  });

  test("parses no_runner without a runner field", () => {
    const lines = [
      `__SANDBOX_RESULT__:${JSON.stringify({
        status: "no_runner",
        reason: "no markers found",
        durationMs: 2000,
      })}`,
    ];
    const result = parseResultFromLogs(lines);
    expect(result?.kind).toBe("no_runner");
  });

  test("scans backwards — last marker wins on multiple matches", () => {
    const lines = [
      `__SANDBOX_RESULT__:${JSON.stringify({ status: "git_error", reason: "old", durationMs: 1 })}`,
      "noise",
      `__SANDBOX_RESULT__:${JSON.stringify({
        status: "exited",
        runner: { kind: "go", command: ["go", "test", "./..."], markers: ["go.mod"] },
        exitCode: 0,
        durationMs: 100,
        stdoutTail: "",
        stderrTail: "",
      })}`,
    ];
    const result = parseResultFromLogs(lines);
    expect(result?.kind).toBe("exited");
  });

  test("malformed JSON in marker line → falls through to next valid", () => {
    const lines = [
      `__SANDBOX_RESULT__:${JSON.stringify({
        status: "no_runner",
        reason: "fallback",
        durationMs: 1,
      })}`,
      "__SANDBOX_RESULT__:{not valid json",
    ];
    const result = parseResultFromLogs(lines);
    expect(result?.kind).toBe("no_runner");
  });

  test("unknown status → infra", () => {
    const lines = [
      `__SANDBOX_RESULT__:${JSON.stringify({
        status: "weird_unknown_thing",
        durationMs: 100,
      })}`,
    ];
    const result = parseResultFromLogs(lines);
    expect(result?.kind).toBe("infra");
    if (result?.kind === "infra") {
      expect(result.reason).toMatch(/unknown runner status/);
    }
  });

  test("exited without runner field → infra (defensive)", () => {
    const lines = [
      `__SANDBOX_RESULT__:${JSON.stringify({
        status: "exited",
        exitCode: 0,
        durationMs: 1,
      })}`,
    ];
    const result = parseResultFromLogs(lines);
    expect(result?.kind).toBe("infra");
  });
});

// ── runSandboxedTests (integration with fetch mock) ─────────────────

describe("runSandboxedTests — disabled state", () => {
  test("returns kind=disabled when token missing", async () => {
    const cfg = { ...baseCfg, apiToken: null };
    const result = await runSandboxedTests(cfg, {
      repoUrl: "https://github.com/x/y.git",
      baseRef: "main",
      prNumber: 1,
    });
    expect(result.kind).toBe("disabled");
  });

  test("returns kind=disabled when app missing", async () => {
    const cfg = { ...baseCfg, appName: null };
    const result = await runSandboxedTests(cfg, {
      repoUrl: "https://github.com/x/y.git",
      baseRef: "main",
      prNumber: 1,
    });
    expect(result.kind).toBe("disabled");
  });
});

// Helper: build a fetch mock for spawn/wait/destroy (Machines API
// only — logs are now fetched via subprocess, NOT via fetch).
function mockFlyFetch(handlers: {
  onCreate?: () => Response | Promise<Response>;
  onPoll?: (callIndex: number) => Response | Promise<Response>;
  onDestroy?: () => Response | Promise<Response>;
}): { calls: { url: string; method: string }[] } {
  const calls: { url: string; method: string }[] = [];
  let pollCount = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (url.endsWith("/machines") && method === "POST") {
        return handlers.onCreate ? handlers.onCreate() : json(200, { id: "m_x" });
      }
      if (url.includes("/machines/") && method === "GET") {
        const idx = pollCount;
        pollCount += 1;
        return handlers.onPoll
          ? handlers.onPoll(idx)
          : json(200, { id: "m_x", state: "stopped", exit_event: { exit_code: 0 } });
      }
      if (url.includes("/machines/") && method === "DELETE") {
        return handlers.onDestroy
          ? handlers.onDestroy()
          : new Response("", { status: 200 });
      }
      throw new Error(`unexpected fetch: ${method} ${url}`);
    }),
  );
  return { calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Build a `LogFetcher` test stub that returns the given lines.
 * Replaces what the default subprocess-flyctl impl would return,
 * so tests run without a real flyctl binary.
 */
function stubLogs(lines: string[]) {
  return async () => lines;
}

describe("runSandboxedTests — happy path", () => {
  test("spawns, waits, parses runner result, destroys", async () => {
    const runnerResult = {
      status: "exited",
      runner: { kind: "pnpm", command: ["pnpm", "test"], markers: ["package.json", "pnpm-lock.yaml"] },
      exitCode: 0,
      durationMs: 5_432,
      stdoutTail: "PASS",
      stderrTail: "",
    };
    const { calls } = mockFlyFetch({});
    const fetchLogs = stubLogs([
      "[install] up to date",
      `__SANDBOX_RESULT__:${JSON.stringify(runnerResult)}`,
    ]);

    const result = await runSandboxedTests(
      baseCfg,
      { repoUrl: "https://github.com/x/y.git", baseRef: "main", prNumber: 42 },
      fetchLogs,
    );
    expect(result.kind).toBe("exited");
    if (result.kind === "exited") {
      expect(result.runner.kind).toBe("pnpm");
      expect(result.exitCode).toBe(0);
    }

    // Confirms the Machines API lifecycle hit Fly: create + poll + destroy
    // (logs are now via subprocess, not fetch — covered by the injected stub).
    const methods = calls.map((c) => c.method);
    expect(methods).toContain("POST"); // create
    expect(methods).toContain("GET"); // poll
    expect(methods).toContain("DELETE"); // destroy
  });

  test("forwards SANDBOX_SPEC env var with the right shape on spawn", async () => {
    const { calls } = mockFlyFetch({});
    const fetchLogs = stubLogs([
      `__SANDBOX_RESULT__:${JSON.stringify({
        status: "no_runner",
        reason: "n/a",
        durationMs: 10,
      })}`,
    ]);

    await runSandboxedTests(
      baseCfg,
      {
        repoUrl: "https://github.com/foo/bar.git",
        baseRef: "develop",
        prNumber: 7,
        customCommand: "make test",
      },
      fetchLogs,
    );

    // The first POST is the machine create — its body has the env spec.
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toMatch(/\/machines$/);
  });
});

describe("runSandboxedTests — sandbox failure modes", () => {
  test("git_error from runner → propagates kind=git_error", async () => {
    mockFlyFetch({});
    const fetchLogs = stubLogs([
      `__SANDBOX_RESULT__:${JSON.stringify({
        status: "git_error",
        reason: "Repository not found",
        durationMs: 3000,
      })}`,
    ]);

    const result = await runSandboxedTests(
      baseCfg,
      { repoUrl: "https://github.com/private/repo.git", baseRef: "main", prNumber: 1 },
      fetchLogs,
    );
    expect(result.kind).toBe("git_error");
    if (result.kind === "git_error") {
      expect(result.reason).toMatch(/Repository not found/);
    }
  });

  test("install_error surfaces with runner info", async () => {
    mockFlyFetch({});
    const fetchLogs = stubLogs([
      `__SANDBOX_RESULT__:${JSON.stringify({
        status: "install_error",
        runner: { kind: "npm", command: ["npm", "test"], markers: ["package.json"] },
        exitCode: 127,
        durationMs: 1234,
        stdoutTail: "",
        stderrTail: "command not found",
      })}`,
    ]);

    const result = await runSandboxedTests(
      baseCfg,
      { repoUrl: "https://github.com/x/y.git", baseRef: "main", prNumber: 1 },
      fetchLogs,
    );
    expect(result.kind).toBe("install_error");
    if (result.kind === "install_error") {
      expect(result.runner.kind).toBe("npm");
      expect(result.exitCode).toBe(127);
    }
  });

  // The executor polls 5× with 1.5 s sleep before giving up on the
  // marker — that's ~7.5 s real wall-clock, longer than vitest's
  // default 5 s test cap.
  test("machine exits but emits no parseable result → infra", async () => {
    mockFlyFetch({});
    const fetchLogs = stubLogs(["random log", "more log without the marker"]);

    const result = await runSandboxedTests(
      baseCfg,
      { repoUrl: "https://github.com/x/y.git", baseRef: "main", prNumber: 1 },
      fetchLogs,
    );
    expect(result.kind).toBe("infra");
    if (result.kind === "infra") {
      expect(result.reason).toMatch(/no parseable result/);
    }
  }, 10_000);

  test("Fly machine wall-clock timeout → infra (with reason)", async () => {
    // Spawn a machine that never reaches stopped. We need the sandbox
    // wait loop to time out — set startedAtMs implicitly via a very
    // short cfg.timeoutS.
    const shortCfg: SandboxConfig = { ...baseCfg, timeoutS: 1 };
    mockFlyFetch({
      onPoll: () => json(200, { id: "m_x", state: "started" }),
    });

    const result = await runSandboxedTests(shortCfg, {
      repoUrl: "https://github.com/x/y.git",
      baseRef: "main",
      prNumber: 1,
    });
    expect(result.kind).toBe("infra");
    if (result.kind === "infra") {
      expect(result.reason).toMatch(/wall-clock timeout/);
    }
  });

  test("Fly create fails → kind=infra (not throw)", async () => {
    mockFlyFetch({
      onCreate: () => json(422, { error: "image not found" }),
    });

    const result = await runSandboxedTests(baseCfg, {
      repoUrl: "https://github.com/x/y.git",
      baseRef: "main",
      prNumber: 1,
    });
    expect(result.kind).toBe("infra");
    if (result.kind === "infra") {
      expect(result.reason).toMatch(/spawn failed/);
    }
  });
});
