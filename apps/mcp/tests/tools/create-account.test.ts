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
