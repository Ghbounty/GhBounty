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
});
