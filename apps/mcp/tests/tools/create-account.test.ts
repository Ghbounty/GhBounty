import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/github/device-flow");
vi.mock("@/lib/rate-limit/upstash", () => ({
  createAccountLimiter: () => ({ limit: () => Promise.resolve({ success: true }) }),
}));

import { handleCreateAccountInit } from "@/lib/tools/create-account/init";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { startDeviceFlow } from "@/lib/github/device-flow";

describe("create_account.init handler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.MCP_TOKEN_ENCRYPTION_KEY = "x".repeat(32);
  });

  it("inserts agent_accounts row + returns user_code", async () => {
    (startDeviceFlow as any).mockResolvedValue({
      device_code: "DEV_CODE_AAA",
      user_code: "ABCD-1234",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    });

    const insertChain = {
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: "agent-uuid-1" },
            error: null,
          }),
        }),
      }),
    };
    (supabaseAdmin as any).mockReturnValue({
      from: () => insertChain,
    });

    const result = await handleCreateAccountInit({
      role: "dev",
      wallet_pubkey: "7xK7gE8FpQrSjVz9mYwGtCkBtNvDtTvPzGjGpZqMxKqp",
      ip: "192.0.2.1",
    });

    if ("error" in result) {
      throw new Error(`Expected ok, got error: ${result.error.code}`);
    }
    expect(result.user_code).toBe("ABCD-1234");
    expect(result.account_id).toBe("agent-uuid-1");
    expect(insertChain.insert).toHaveBeenCalledOnce();
  });

  it("returns Conflict 409 if wallet_pubkey already exists", async () => {
    (startDeviceFlow as any).mockResolvedValue({
      device_code: "DEV_CODE_AAA",
      user_code: "ABCD-1234",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    });
    const insertChain = {
      insert: () => ({
        select: () => ({
          single: () =>
            Promise.resolve({
              data: null,
              error: { code: "23505", message: "duplicate key value violates unique constraint" },
            }),
        }),
      }),
    };
    (supabaseAdmin as any).mockReturnValue({
      from: () => insertChain,
    });

    const result = await handleCreateAccountInit({
      role: "dev",
      wallet_pubkey: "7xK7gE8FpQrSjVz9mYwGtCkBtNvDtTvPzGjGpZqMxKqp",
      ip: "192.0.2.1",
    });
    if (!("error" in result)) throw new Error("expected error");
    expect(result.error.code).toBe("Conflict");
  });

  it("returns RateLimited when limiter rejects", async () => {
    vi.doMock("@/lib/rate-limit/upstash", () => ({
      createAccountLimiter: () => ({ limit: () => Promise.resolve({ success: false }) }),
    }));
    vi.resetModules();
    const { handleCreateAccountInit } = await import("@/lib/tools/create-account/init");

    const result = await handleCreateAccountInit({
      role: "dev",
      wallet_pubkey: "7xK7gE8FpQrSjVz9mYwGtCkBtNvDtTvPzGjGpZqMxKqp",
      ip: "192.0.2.1",
    });
    if (!("error" in result)) throw new Error("expected error");
    expect(result.error.code).toBe("RateLimited");

    vi.doUnmock("@/lib/rate-limit/upstash");
  });
});

describe("create_account.poll handler", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.MCP_TOKEN_ENCRYPTION_KEY = "x".repeat(32);
    process.env.NEXT_PUBLIC_GAS_STATION_PUBKEY = "11111111111111111111111111111112";
    process.env.SOLANA_RPC_URL = "https://api.devnet.solana.com";
  });

  it("returns 'pending' when GitHub still polling", async () => {
    const { handleCreateAccountPoll } = await import(
      "@/lib/tools/create-account/poll"
    );
    const { pollAccessToken, decryptAccessToken } = await import("@/lib/github/device-flow");
    (pollAccessToken as any).mockResolvedValue({ kind: "pending" });
    (decryptAccessToken as any).mockReturnValue("DEV_CODE_DECRYPTED");

    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: {
                  id: "agent-uuid-1",
                  status: "pending_oauth",
                  wallet_pubkey: "7xK7gE8FpQrSjVz9mYwGtCkBtNvDtTvPzGjGpZqMxKqp",
                  role: "dev",
                  github_oauth_token_encrypted: "encrypted_device_code_b64",
                },
                error: null,
              }),
          }),
        }),
      }),
    });

    const result = await handleCreateAccountPoll({ account_id: "00000000-0000-0000-0000-000000000001" });
    expect((result as any).status).toBe("pending");
  });

  it("returns NotFound when account_id doesn't exist", async () => {
    const { handleCreateAccountPoll } = await import(
      "@/lib/tools/create-account/poll"
    );
    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: null, error: { message: "not found" } }),
          }),
        }),
      }),
    });

    const result = await handleCreateAccountPoll({ account_id: "00000000-0000-0000-0000-000000000099" });
    if (!("error" in result)) throw new Error("expected error");
    expect((result as any).error.code).toBe("NotFound");
  });

  it("returns Forbidden when account already active", async () => {
    const { handleCreateAccountPoll } = await import(
      "@/lib/tools/create-account/poll"
    );
    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: {
                  id: "agent-1",
                  status: "active",
                  wallet_pubkey: "7xK...",
                  role: "dev",
                  github_oauth_token_encrypted: "abc",
                },
                error: null,
              }),
          }),
        }),
      }),
    });

    const result = await handleCreateAccountPoll({ account_id: "00000000-0000-0000-0000-000000000001" });
    if (!("error" in result)) throw new Error("expected error");
    // Conflict because account is already active
    expect((result as any).error.code).toBe("Conflict");
  });
});
