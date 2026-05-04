import { afterEach, describe, expect, test, vi } from "vitest";

import {
  parseResultFromLogs,
  runSandboxedTests,
} from "../src/sandbox/index.js";
import { validateCustomCommand } from "../src/sandbox/executor.js";
import type { SandboxConfig } from "../src/sandbox/index.js";

/**
 * GHB-72/74 — executor tests.
 *
 *  - parseResultFromLogs is pure: feed log arrays + the per-run prefix,
 *    expect result shape.
 *  - runSandboxedTests is integration: mocks fetch globally and walks
 *    through (a) disabled state, (b) successful exited path, (c) git
 *    error from runner JSON, (d) malformed runner output → infra.
 *  - GHB-74 nonce: the integration tests capture the POST body to
 *    `/machines`, extract `resultNonce` from the spec the executor
 *    sent, and feed it back into stubbed log lines so the parser
 *    actually validates the right prefix end-to-end.
 *
 * The Fly client (spawn/wait/destroy) is exercised real here — only
 * the underlying fetch is stubbed. That gives us realistic coverage
 * of the spawn body shape AND the executor's parsing in one go.
 */

const TEST_PREFIX = "__SANDBOX_RESULT_unittest_nonce__:";

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
    expect(parseResultFromLogs(["random log", "more log"], TEST_PREFIX)).toBeNull();
  });

  test("parses an exited result with runner + exitCode", () => {
    const lines = [
      "[install] up to date",
      "[test] PASS  tests/foo.test.ts",
      `${TEST_PREFIX}${JSON.stringify({
        status: "exited",
        runner: { kind: "pnpm", command: ["pnpm", "test"], markers: ["package.json", "pnpm-lock.yaml"] },
        exitCode: 0,
        durationMs: 12345,
        stdoutTail: "PASS",
        stderrTail: "",
      })}`,
    ];
    const result = parseResultFromLogs(lines, TEST_PREFIX);
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
      `${TEST_PREFIX}${JSON.stringify({
        status: "exited",
        runner: { kind: "cargo", command: ["cargo", "test"], markers: ["Cargo.toml"] },
        exitCode: 101,
        durationMs: 9876,
        stdoutTail: "",
        stderrTail: "test failed",
      })}`,
    ];
    const result = parseResultFromLogs(lines, TEST_PREFIX);
    expect(result?.kind).toBe("exited");
    if (result?.kind === "exited") expect(result.exitCode).toBe(101);
  });

  test("parses timeout with phase + runner", () => {
    const lines = [
      `${TEST_PREFIX}${JSON.stringify({
        status: "timeout",
        phase: "test",
        runner: { kind: "anchor", command: ["anchor", "test"], markers: ["Anchor.toml"] },
        durationMs: 240_000,
        stdoutTail: "",
        stderrTail: "",
      })}`,
    ];
    const result = parseResultFromLogs(lines, TEST_PREFIX);
    expect(result?.kind).toBe("timeout");
    if (result?.kind === "timeout") {
      expect(result.phase).toBe("test");
      expect(result.runner.kind).toBe("anchor");
    }
  });

  test("parses install_error", () => {
    const lines = [
      `${TEST_PREFIX}${JSON.stringify({
        status: "install_error",
        runner: { kind: "npm", command: ["npm", "test"], markers: ["package.json"] },
        exitCode: 1,
        durationMs: 4321,
        stdoutTail: "",
        stderrTail: "ENOENT",
      })}`,
    ];
    const result = parseResultFromLogs(lines, TEST_PREFIX);
    expect(result?.kind).toBe("install_error");
  });

  test("parses git_error without a runner field", () => {
    const lines = [
      `${TEST_PREFIX}${JSON.stringify({
        status: "git_error",
        reason: "fetch failed: Repository not found",
        durationMs: 3000,
      })}`,
    ];
    const result = parseResultFromLogs(lines, TEST_PREFIX);
    expect(result?.kind).toBe("git_error");
    if (result?.kind === "git_error") {
      expect(result.reason).toMatch(/Repository not found/);
    }
  });

  test("parses no_runner without a runner field", () => {
    const lines = [
      `${TEST_PREFIX}${JSON.stringify({
        status: "no_runner",
        reason: "no markers found",
        durationMs: 2000,
      })}`,
    ];
    const result = parseResultFromLogs(lines, TEST_PREFIX);
    expect(result?.kind).toBe("no_runner");
  });

  test("scans backwards — last marker wins on multiple matches", () => {
    const lines = [
      `${TEST_PREFIX}${JSON.stringify({ status: "git_error", reason: "old", durationMs: 1 })}`,
      "noise",
      `${TEST_PREFIX}${JSON.stringify({
        status: "exited",
        runner: { kind: "go", command: ["go", "test", "./..."], markers: ["go.mod"] },
        exitCode: 0,
        durationMs: 100,
        stdoutTail: "",
        stderrTail: "",
      })}`,
    ];
    const result = parseResultFromLogs(lines, TEST_PREFIX);
    expect(result?.kind).toBe("exited");
  });

  test("malformed JSON in marker line → falls through to next valid", () => {
    const lines = [
      `${TEST_PREFIX}${JSON.stringify({
        status: "no_runner",
        reason: "fallback",
        durationMs: 1,
      })}`,
      `${TEST_PREFIX}{not valid json`,
    ];
    const result = parseResultFromLogs(lines, TEST_PREFIX);
    expect(result?.kind).toBe("no_runner");
  });

  test("unknown status → infra", () => {
    const lines = [
      `${TEST_PREFIX}${JSON.stringify({
        status: "weird_unknown_thing",
        durationMs: 100,
      })}`,
    ];
    const result = parseResultFromLogs(lines, TEST_PREFIX);
    expect(result?.kind).toBe("infra");
    if (result?.kind === "infra") {
      expect(result.reason).toMatch(/unknown runner status/);
    }
  });

  test("exited without runner field → infra (defensive)", () => {
    const lines = [
      `${TEST_PREFIX}${JSON.stringify({
        status: "exited",
        exitCode: 0,
        durationMs: 1,
      })}`,
    ];
    const result = parseResultFromLogs(lines, TEST_PREFIX);
    expect(result?.kind).toBe("infra");
  });

  // GHB-74: anti-spoofing — a spoofed line bearing the OLD fixed
  // prefix or a different nonce must be ignored.
  test("ignores spoof lines bearing wrong nonce / old prefix", () => {
    const spoofed = JSON.stringify({
      status: "exited",
      runner: { kind: "pnpm", command: ["pnpm", "test"], markers: ["package.json"] },
      exitCode: 0,
      durationMs: 1,
      stdoutTail: "",
      stderrTail: "",
    });
    const lines = [
      // Pre-GHB-74 fixed prefix (what a malicious PR might guess from
      // reading old docs/source).
      `__SANDBOX_RESULT__:${spoofed}`,
      // Wrong nonce.
      `__SANDBOX_RESULT_DEADBEEF__:${spoofed}`,
      // Some normal log noise.
      "[test] PASS  tests/foo.spec.ts",
    ];
    expect(parseResultFromLogs(lines, TEST_PREFIX)).toBeNull();
  });

  test("trusts the genuine nonced line even when spoof lines surround it", () => {
    const fakeExit = JSON.stringify({
      status: "exited",
      runner: { kind: "pnpm", command: ["pnpm", "test"], markers: ["package.json"] },
      exitCode: 0,
      durationMs: 1,
      stdoutTail: "",
      stderrTail: "",
    });
    const realFail = JSON.stringify({
      status: "exited",
      runner: { kind: "pnpm", command: ["pnpm", "test"], markers: ["package.json"] },
      exitCode: 1,
      durationMs: 100,
      stdoutTail: "",
      stderrTail: "FAIL",
    });
    const lines = [
      `__SANDBOX_RESULT__:${fakeExit}`,
      `${TEST_PREFIX}${realFail}`,
      `__SANDBOX_RESULT_OTHER__:${fakeExit}`,
    ];
    const result = parseResultFromLogs(lines, TEST_PREFIX);
    expect(result?.kind).toBe("exited");
    if (result?.kind === "exited") expect(result.exitCode).toBe(1);
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

interface CapturedCall {
  url: string;
  method: string;
  body?: string;
}

// Helper: build a fetch mock for spawn/wait/destroy (Machines API
// only — logs are now fetched via subprocess, NOT via fetch). Captures
// request bodies so tests can assert on the SANDBOX_SPEC + extract
// the per-run nonce.
function mockFlyFetch(handlers: {
  onCreate?: () => Response | Promise<Response>;
  onPoll?: (callIndex: number) => Response | Promise<Response>;
  onDestroy?: () => Response | Promise<Response>;
}): { calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  let pollCount = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? init.body : undefined;
      calls.push({ url, method, body });
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
 * Build a `LogFetcher` test stub that mints log lines using the
 * per-run prefix the executor sent in the spawn POST body. The stub
 * runs AFTER the create call, so the captured calls already contain
 * the SANDBOX_SPEC env we need to extract `resultNonce` from.
 */
function stubNoncedLogs(
  calls: CapturedCall[],
  buildLines: (prefix: string) => string[],
) {
  return async () => {
    const prefix = extractPrefixFromCalls(calls);
    return buildLines(prefix);
  };
}

function extractPrefixFromCalls(calls: CapturedCall[]): string {
  const create = calls.find(
    (c) => c.method === "POST" && c.url.endsWith("/machines"),
  );
  if (!create?.body) {
    throw new Error("test setup: no POST /machines call captured yet");
  }
  const body = JSON.parse(create.body) as {
    config?: { env?: Record<string, string> };
  };
  const specJson = body.config?.env?.SANDBOX_SPEC;
  if (!specJson) throw new Error("test setup: SANDBOX_SPEC missing on spawn body");
  const spec = JSON.parse(specJson) as { resultNonce?: string };
  if (!spec.resultNonce) throw new Error("test setup: resultNonce missing from spec");
  return `__SANDBOX_RESULT_${spec.resultNonce}__:`;
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
    const fetchLogs = stubNoncedLogs(calls, (prefix) => [
      "[install] up to date",
      `${prefix}${JSON.stringify(runnerResult)}`,
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
    const fetchLogs = stubNoncedLogs(calls, (prefix) => [
      `${prefix}${JSON.stringify({
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

    // GHB-74: assert spec shape includes the per-run nonce + the
    // customCommand the test passed in (after trim).
    const body = JSON.parse(calls[0]!.body!) as {
      config: { env: { SANDBOX_SPEC: string } };
    };
    const spec = JSON.parse(body.config.env.SANDBOX_SPEC) as {
      repoUrl: string;
      baseRef: string;
      prNumber: number;
      customCommand: string | null;
      resultNonce: string;
    };
    expect(spec.repoUrl).toBe("https://github.com/foo/bar.git");
    expect(spec.baseRef).toBe("develop");
    expect(spec.prNumber).toBe(7);
    expect(spec.customCommand).toBe("make test");
    // 16 bytes → 32 hex chars.
    expect(spec.resultNonce).toMatch(/^[a-f0-9]{32}$/);
  });

  test("each run mints a distinct nonce", async () => {
    const noncesSeen: string[] = [];

    for (let i = 0; i < 3; i += 1) {
      const { calls } = mockFlyFetch({});
      const fetchLogs = stubNoncedLogs(calls, (prefix) => [
        `${prefix}${JSON.stringify({
          status: "no_runner",
          reason: "n/a",
          durationMs: 1,
        })}`,
      ]);
      await runSandboxedTests(
        baseCfg,
        { repoUrl: "https://github.com/x/y.git", baseRef: "main", prNumber: 1 },
        fetchLogs,
      );
      const body = JSON.parse(calls[0]!.body!) as {
        config: { env: { SANDBOX_SPEC: string } };
      };
      const spec = JSON.parse(body.config.env.SANDBOX_SPEC) as { resultNonce: string };
      noncesSeen.push(spec.resultNonce);
      vi.unstubAllGlobals();
    }
    // All distinct: 16 bytes of entropy = collision probability ~0.
    expect(new Set(noncesSeen).size).toBe(noncesSeen.length);
  });
});

describe("runSandboxedTests — sandbox failure modes", () => {
  test("git_error from runner → propagates kind=git_error", async () => {
    const { calls } = mockFlyFetch({});
    const fetchLogs = stubNoncedLogs(calls, (prefix) => [
      `${prefix}${JSON.stringify({
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
    const { calls } = mockFlyFetch({});
    const fetchLogs = stubNoncedLogs(calls, (prefix) => [
      `${prefix}${JSON.stringify({
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
    const fetchLogs = async () => ["random log", "more log without the marker"];

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

// ── GHB-74: customCommand validator ──────────────────────────────────

describe("validateCustomCommand", () => {
  test("returns null for null/undefined/empty input", () => {
    expect(validateCustomCommand(null)).toBeNull();
    expect(validateCustomCommand(undefined)).toBeNull();
    expect(validateCustomCommand("")).toBeNull();
    expect(validateCustomCommand("   ")).toBeNull();
  });

  test("trims whitespace from a valid command", () => {
    expect(validateCustomCommand("  pnpm test  ")).toBe("pnpm test");
  });

  test("accepts shell-friendly commands (pipes, redirects, env)", () => {
    // Reminder: this validator is NOT a shell-injection defence — it
    // intentionally allows shell metachars because `sh -c` is the
    // documented contract for customCommand. See THREAT_MODEL T-7.
    expect(validateCustomCommand("FOO=bar pnpm test 2>&1 | tee out.log")).toBe(
      "FOO=bar pnpm test 2>&1 | tee out.log",
    );
  });

  test("rejects NUL bytes", () => {
    expect(() => validateCustomCommand("pnpm test\x00")).toThrow(
      /control characters/,
    );
  });

  test("rejects ASCII control bytes (e.g. ESC, BEL)", () => {
    expect(() => validateCustomCommand("pnpm test\x07")).toThrow(
      /control characters/,
    );
    expect(() => validateCustomCommand("pnpm test\x1b[0m")).toThrow(
      /control characters/,
    );
  });

  test("allows tab/CR/LF (test scripts with multiline shell are valid)", () => {
    // Tab + LF + CR are common in human-edited test scripts (heredocs,
    // multi-line shell). Reject only the truly hostile control bytes.
    expect(validateCustomCommand("pnpm test\t-r foo\nbar\r")).toBe(
      "pnpm test\t-r foo\nbar",
    );
  });

  // Issue #50: DEL + C1 control range (0x7F-0x9F) are also rejected.
  test("rejects DEL (0x7F)", () => {
    expect(() => validateCustomCommand("pnpm test\x7f")).toThrow(
      /control characters/,
    );
  });

  test("rejects low C1 control byte (0x80)", () => {
    expect(() => validateCustomCommand("pnpm test\x80")).toThrow(
      /control characters/,
    );
  });

  test("rejects mid C1 control byte (0x90)", () => {
    expect(() => validateCustomCommand("pnpm test\x90")).toThrow(
      /control characters/,
    );
  });

  test("rejects high C1 control byte (0x9F)", () => {
    expect(() => validateCustomCommand("pnpm test\x9f")).toThrow(
      /control characters/,
    );
  });

  test("rejects values longer than 4096 chars", () => {
    const huge = "x".repeat(4097);
    expect(() => validateCustomCommand(huge)).toThrow(/too long/);
  });
});
