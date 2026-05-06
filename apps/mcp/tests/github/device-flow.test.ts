import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  startDeviceFlow,
  pollAccessToken,
  fetchUserHandle,
} from "@/lib/github/device-flow";

const realFetch = global.fetch;

describe("GitHub Device Flow client", () => {
  beforeEach(() => {
    process.env.GITHUB_OAUTH_CLIENT_ID = "test_client_id";
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  describe("startDeviceFlow", () => {
    it("posts client_id + scope and returns the device_code", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            device_code: "DEV_CODE",
            user_code: "ABCD-1234",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          }),
      });

      const result = await startDeviceFlow();
      expect(result.device_code).toBe("DEV_CODE");
      expect(result.user_code).toBe("ABCD-1234");

      const calls = (global.fetch as any).mock.calls;
      expect(calls[0][0]).toBe("https://github.com/login/device/code");
      expect(calls[0][1].method).toBe("POST");
    });
  });

  describe("pollAccessToken", () => {
    it("returns the access_token when GitHub returns success", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: "TOKEN_123", token_type: "bearer" }),
      });

      const result = await pollAccessToken("DEV_CODE");
      expect(result.kind).toBe("ok");
      if (result.kind === "ok") {
        expect(result.access_token).toBe("TOKEN_123");
      }
    });

    it("returns 'pending' when authorization_pending", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ error: "authorization_pending" }),
      });

      const result = await pollAccessToken("DEV_CODE");
      expect(result.kind).toBe("pending");
    });

    it("returns 'error' for any other GitHub error", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ error: "expired_token" }),
      });

      const result = await pollAccessToken("DEV_CODE");
      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.error).toBe("expired_token");
      }
    });
  });

  describe("fetchUserHandle", () => {
    it("returns login for the user authenticated by the access token", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            login: "claudebot42",
            id: 12345,
            email: "claudebot@example.com",
          }),
      });

      const handle = await fetchUserHandle("TOKEN_123");
      expect(handle).toBe("claudebot42");
    });
  });
});

describe("token encryption", () => {
  beforeEach(() => {
    process.env.MCP_TOKEN_ENCRYPTION_KEY = "x".repeat(32);
  });

  it("encryptAccessToken / decryptAccessToken round-trip", async () => {
    const { encryptAccessToken, decryptAccessToken } = await import(
      "@/lib/github/device-flow"
    );
    const plaintext = "ghu_1234567890abcdef";
    const encrypted = encryptAccessToken(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(decryptAccessToken(encrypted)).toBe(plaintext);
  });

  it("decrypt fails on tampered ciphertext", async () => {
    const { encryptAccessToken, decryptAccessToken } = await import(
      "@/lib/github/device-flow"
    );
    const enc = encryptAccessToken("plaintext");
    const tampered = enc.slice(0, -2) + "AA";
    expect(() => decryptAccessToken(tampered)).toThrow();
  });
});
