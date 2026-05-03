import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  destroySandbox,
  SandboxDisabledError,
  spawnSandbox,
  waitForSandboxExit,
} from "../src/sandbox/index.js";
import type { SandboxConfig } from "../src/sandbox/index.js";

/**
 * GHB-70 — unit tests for the Fly Machines lifecycle.
 *
 * The Fly HTTP API is mocked at the global `fetch` boundary so these
 * tests never touch the network. We assert:
 *  - the spawn POST body matches the architecture doc (2 CPU / 2 GB,
 *    auto_destroy, no restart, no services)
 *  - the disabled state throws a typed error the handler can catch
 *  - the poll loop terminates on each documented Fly state
 *  - destroy is best-effort (non-2xx logged, never thrown)
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

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function mockFetch(handler: (call: FetchCall) => Response | Promise<Response>): {
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return handler({ url, init });
    }),
  );
  return { calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("sandbox/fly — disabled state", () => {
  test("spawnSandbox throws SandboxDisabledError when token missing", async () => {
    const cfg: SandboxConfig = { ...baseCfg, apiToken: null };
    await expect(spawnSandbox(cfg)).rejects.toBeInstanceOf(SandboxDisabledError);
  });

  test("spawnSandbox throws SandboxDisabledError when app missing", async () => {
    const cfg: SandboxConfig = { ...baseCfg, appName: null };
    await expect(spawnSandbox(cfg)).rejects.toBeInstanceOf(SandboxDisabledError);
  });

  test("waitForSandboxExit also enforces the disabled guard", async () => {
    const cfg: SandboxConfig = { ...baseCfg, apiToken: null };
    await expect(
      waitForSandboxExit(cfg, {
        machineId: "x",
        appName: "x",
        startedAtMs: 0,
        timeoutS: 1,
      }),
    ).rejects.toBeInstanceOf(SandboxDisabledError);
  });
});

describe("sandbox/fly — spawnSandbox", () => {
  test("POSTs the architecture-doc machine spec to the Fly API", async () => {
    const { calls } = mockFetch(() =>
      jsonResponse(200, { id: "m_abc123", region: "iad", state: "created" }),
    );

    const handle = await spawnSandbox(baseCfg, {
      env: { SANDBOX_SPEC: '{"foo":"bar"}' },
    });
    expect(handle.machineId).toBe("m_abc123");
    expect(handle.appName).toBe(baseCfg.appName);
    expect(calls).toHaveLength(1);

    const call = calls[0]!;
    expect(call.url).toBe(
      `https://api.machines.dev/v1/apps/${baseCfg.appName}/machines`,
    );
    expect(call.init?.method).toBe("POST");
    const headers = new Headers(call.init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${baseCfg.apiToken}`);

    const body = JSON.parse(call.init?.body as string) as Record<string, unknown>;
    expect(body.region).toBe("iad");
    const cfg = body.config as Record<string, unknown>;
    expect(cfg.image).toBe(baseCfg.image);
    expect(cfg.auto_destroy).toBe(true);
    expect(cfg.restart).toEqual({ policy: "no" });
    expect(cfg.services).toEqual([]);
    expect(cfg.guest).toEqual({
      cpus: 2,
      memory_mb: 2048,
      cpu_kind: "shared",
    });
    expect(cfg.env).toEqual({ SANDBOX_SPEC: '{"foo":"bar"}' });
  });

  test("clamps absurd timeoutS to the hard ceiling", async () => {
    mockFetch(() => jsonResponse(200, { id: "m_x", state: "created" }));
    const handle = await spawnSandbox(baseCfg, { timeoutS: 99_999 });
    expect(handle.timeoutS).toBeLessThanOrEqual(600);
  });

  test("falls back to default 300 when timeoutS is invalid", async () => {
    mockFetch(() => jsonResponse(200, { id: "m_x", state: "created" }));
    const handle = await spawnSandbox(baseCfg, { timeoutS: -1 });
    expect(handle.timeoutS).toBe(300);
  });

  test("propagates Fly API errors with the response body in the message", async () => {
    mockFetch(() =>
      jsonResponse(422, { error: "image not found in registry" }),
    );
    await expect(spawnSandbox(baseCfg)).rejects.toThrow(
      /machine create failed.*422.*image not found/,
    );
  });
});

describe("sandbox/fly — waitForSandboxExit", () => {
  beforeEach(() => {
    // Speed up the 2 s poll interval so tests don't sit idle.
    vi.useFakeTimers({ toFake: ["setTimeout"] });
  });

  test("returns exited+exit_code when machine reaches stopped", async () => {
    let pollCount = 0;
    mockFetch(() => {
      pollCount += 1;
      if (pollCount === 1) {
        return jsonResponse(200, { id: "m_1", state: "starting" });
      }
      return jsonResponse(200, {
        id: "m_1",
        state: "stopped",
        exit_event: { exit_code: 0 },
      });
    });

    const handle = {
      machineId: "m_1",
      appName: baseCfg.appName!,
      startedAtMs: Date.now(),
      timeoutS: baseCfg.timeoutS,
    };
    const promise = waitForSandboxExit(baseCfg, handle);
    await vi.advanceTimersByTimeAsync(2_500);
    const result = await promise;
    expect(result.kind).toBe("exited");
    if (result.kind === "exited") expect(result.exitCode).toBe(0);
  });

  test("non-zero exit_code is preserved", async () => {
    mockFetch(() =>
      jsonResponse(200, {
        id: "m_2",
        state: "stopped",
        exit_event: { exit_code: 137 },
      }),
    );
    const handle = {
      machineId: "m_2",
      appName: baseCfg.appName!,
      startedAtMs: Date.now(),
      timeoutS: baseCfg.timeoutS,
    };
    const result = await waitForSandboxExit(baseCfg, handle);
    expect(result.kind).toBe("exited");
    if (result.kind === "exited") expect(result.exitCode).toBe(137);
  });

  test("404 mid-poll is treated as auto_destroy success", async () => {
    mockFetch(() => new Response("", { status: 404 }));
    const handle = {
      machineId: "m_3",
      appName: baseCfg.appName!,
      startedAtMs: Date.now(),
      timeoutS: baseCfg.timeoutS,
    };
    const result = await waitForSandboxExit(baseCfg, handle);
    expect(result.kind).toBe("exited");
  });

  test("state=failed surfaces as infra error", async () => {
    mockFetch(() => jsonResponse(200, { id: "m_4", state: "failed" }));
    const handle = {
      machineId: "m_4",
      appName: baseCfg.appName!,
      startedAtMs: Date.now(),
      timeoutS: baseCfg.timeoutS,
    };
    const result = await waitForSandboxExit(baseCfg, handle);
    expect(result.kind).toBe("infra");
    if (result.kind === "infra") expect(result.reason).toMatch(/failed/);
  });

  test("returns timeout when wall-clock cap is hit", async () => {
    // Set startedAtMs in the past so the deadline (startedAtMs + timeoutS*1000)
    // is already behind Date.now() — the loop should exit on the first
    // iteration without ever issuing a fetch. This avoids needing to fake
    // both the timer and the system clock.
    mockFetch(() => jsonResponse(200, { id: "m_5", state: "started" }));
    const handle = {
      machineId: "m_5",
      appName: baseCfg.appName!,
      startedAtMs: Date.now() - 10_000,
      timeoutS: 1,
    };
    const result = await waitForSandboxExit(baseCfg, handle);
    expect(result.kind).toBe("timeout");
  });
});

describe("sandbox/fly — destroySandbox", () => {
  test("issues DELETE with force=true and Bearer auth", async () => {
    const { calls } = mockFetch(() => new Response("", { status: 200 }));
    await destroySandbox(baseCfg, {
      machineId: "m_x",
      appName: baseCfg.appName!,
      startedAtMs: Date.now(),
      timeoutS: 5,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/machines/m_x?force=true");
    expect(calls[0]!.init?.method).toBe("DELETE");
  });

  test("swallows 404 (machine already auto_destroyed)", async () => {
    mockFetch(() => new Response("", { status: 404 }));
    await expect(
      destroySandbox(baseCfg, {
        machineId: "m_x",
        appName: baseCfg.appName!,
        startedAtMs: Date.now(),
        timeoutS: 5,
      }),
    ).resolves.toBeUndefined();
  });

  test("never throws on transient API errors — destroy is best-effort", async () => {
    mockFetch(() => {
      throw new Error("network down");
    });
    await expect(
      destroySandbox(baseCfg, {
        machineId: "m_x",
        appName: baseCfg.appName!,
        startedAtMs: Date.now(),
        timeoutS: 5,
      }),
    ).resolves.toBeUndefined();
  });
});
