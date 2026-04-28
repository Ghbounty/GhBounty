import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Keypair } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { loadConfig } from "../src/config.js";

const TMP_KEYPAIR = path.join(os.tmpdir(), `ghbounty-test-keypair-${process.pid}.json`);

function writeTmpKeypair(): void {
  const kp = Keypair.generate();
  fs.writeFileSync(TMP_KEYPAIR, JSON.stringify(Array.from(kp.secretKey)));
}

function setEnv(overrides: Record<string, string | undefined>): () => void {
  const original: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    original[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

describe("config", () => {
  beforeEach(() => writeTmpKeypair());
  afterEach(() => {
    if (fs.existsSync(TMP_KEYPAIR)) fs.unlinkSync(TMP_KEYPAIR);
  });

  test("loads with all env vars provided", () => {
    const restore = setEnv({
      RPC_URL: "https://example.com/rpc",
      WS_URL: "wss://example.com/ws",
      PROGRAM_ID: "CPZx26QXs3HjwGobr8cVAZEtF1qGzqnNbBdt7h1EwbBg",
      SCORER_KEYPAIR_PATH: TMP_KEYPAIR,
      STUB_SCORE: "9",
      LOG_LEVEL: "debug",
    });
    try {
      const cfg = loadConfig();
      expect(cfg.rpcUrl).toBe("https://example.com/rpc");
      expect(cfg.wsUrl).toBe("wss://example.com/ws");
      expect(cfg.programId.toBase58()).toBe("CPZx26QXs3HjwGobr8cVAZEtF1qGzqnNbBdt7h1EwbBg");
      expect(cfg.stubScore).toBe(9);
      expect(cfg.logLevel).toBe("debug");
    } finally {
      restore();
    }
  });

  test("derives WS_URL from RPC_URL when WS not set", () => {
    const restore = setEnv({
      RPC_URL: "http://localhost:8899",
      WS_URL: undefined,
      SCORER_KEYPAIR_PATH: TMP_KEYPAIR,
    });
    try {
      const cfg = loadConfig();
      expect(cfg.wsUrl).toBe("ws://localhost:8899");
    } finally {
      restore();
    }
  });

  test("https RPC yields wss WS", () => {
    const restore = setEnv({
      RPC_URL: "https://api.devnet.solana.com",
      WS_URL: undefined,
      SCORER_KEYPAIR_PATH: TMP_KEYPAIR,
    });
    try {
      const cfg = loadConfig();
      expect(cfg.wsUrl).toBe("wss://api.devnet.solana.com");
    } finally {
      restore();
    }
  });

  test("stubScore defaults to 7 when unset", () => {
    const restore = setEnv({
      SCORER_KEYPAIR_PATH: TMP_KEYPAIR,
      STUB_SCORE: undefined,
    });
    try {
      expect(loadConfig().stubScore).toBe(7);
    } finally {
      restore();
    }
  });

  test("rejects out-of-range STUB_SCORE", () => {
    const restore = setEnv({
      SCORER_KEYPAIR_PATH: TMP_KEYPAIR,
      STUB_SCORE: "11",
    });
    try {
      expect(() => loadConfig()).toThrow(/STUB_SCORE/);
    } finally {
      restore();
    }
  });

  test("rejects non-integer STUB_SCORE", () => {
    const restore = setEnv({
      SCORER_KEYPAIR_PATH: TMP_KEYPAIR,
      STUB_SCORE: "abc",
    });
    try {
      expect(() => loadConfig()).toThrow(/STUB_SCORE/);
    } finally {
      restore();
    }
  });

  test("fails when keypair file does not exist", () => {
    const restore = setEnv({
      SCORER_KEYPAIR_PATH: "/nonexistent/path.json",
    });
    try {
      expect(() => loadConfig()).toThrow();
    } finally {
      restore();
    }
  });

  test("loads keypair bytes correctly", () => {
    const restore = setEnv({
      SCORER_KEYPAIR_PATH: TMP_KEYPAIR,
    });
    try {
      const cfg = loadConfig();
      expect(cfg.scorerKeypair.publicKey.toBase58()).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    } finally {
      restore();
    }
  });

  test("SCORER_KEYPAIR_JSON: loads keypair from inline JSON env var", () => {
    const kp = Keypair.generate();
    const restore = setEnv({
      SCORER_KEYPAIR_JSON: JSON.stringify(Array.from(kp.secretKey)),
      SCORER_KEYPAIR_PATH: undefined,
    });
    try {
      const cfg = loadConfig();
      expect(cfg.scorerKeypair.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
    } finally {
      restore();
    }
  });

  test("SCORER_KEYPAIR_JSON: takes precedence over PATH when both set", () => {
    const kp = Keypair.generate();
    const restore = setEnv({
      SCORER_KEYPAIR_JSON: JSON.stringify(Array.from(kp.secretKey)),
      SCORER_KEYPAIR_PATH: "/nonexistent/should-not-be-read.json",
    });
    try {
      const cfg = loadConfig();
      expect(cfg.scorerKeypair.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
    } finally {
      restore();
    }
  });

  test("SCORER_KEYPAIR_JSON: rejects non-array payload", () => {
    const restore = setEnv({
      SCORER_KEYPAIR_JSON: '{"not": "an array"}',
      SCORER_KEYPAIR_PATH: undefined,
    });
    try {
      expect(() => loadConfig()).toThrow(/array of numbers/);
    } finally {
      restore();
    }
  });

  test("SCORER_KEYPAIR_JSON: rejects malformed JSON", () => {
    const restore = setEnv({
      SCORER_KEYPAIR_JSON: "[1,2,3,",
      SCORER_KEYPAIR_PATH: undefined,
    });
    try {
      expect(() => loadConfig()).toThrow(/not valid JSON/);
    } finally {
      restore();
    }
  });

  test("anthropic config: defaults to disabled with sonnet model", () => {
    const restore = setEnv({
      SCORER_KEYPAIR_PATH: TMP_KEYPAIR,
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_MODEL: undefined,
    });
    try {
      const cfg = loadConfig();
      expect(cfg.anthropicApiKey).toBeNull();
      expect(cfg.anthropicModel).toBe("claude-sonnet-4-5-20250929");
    } finally {
      restore();
    }
  });

  test("anthropic config: picks up key and custom model from env", () => {
    const restore = setEnv({
      SCORER_KEYPAIR_PATH: TMP_KEYPAIR,
      ANTHROPIC_API_KEY: "sk-ant-foo",
      ANTHROPIC_MODEL: "claude-opus-4-5-20251014",
    });
    try {
      const cfg = loadConfig();
      expect(cfg.anthropicApiKey).toBe("sk-ant-foo");
      expect(cfg.anthropicModel).toBe("claude-opus-4-5-20251014");
    } finally {
      restore();
    }
  });

  test("anthropic config: empty/whitespace key normalizes to null", () => {
    const restore = setEnv({
      SCORER_KEYPAIR_PATH: TMP_KEYPAIR,
      ANTHROPIC_API_KEY: "   ",
    });
    try {
      const cfg = loadConfig();
      expect(cfg.anthropicApiKey).toBeNull();
    } finally {
      restore();
    }
  });
});
