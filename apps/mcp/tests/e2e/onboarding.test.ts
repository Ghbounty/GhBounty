import { describe, it, expect, vi, beforeEach } from "vitest";

// Wire mocks for Supabase, GitHub, gas-station, RPC, and rate-limit.
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/lib/github/device-flow");
vi.mock("@/lib/solana/gas-station-client", () => ({
  sponsorAndSubmit: vi.fn().mockResolvedValue({ ok: true, tx_hash: "MOCK_TX_HASH" }),
}));
vi.mock("@/lib/rate-limit/upstash", () => ({
  createAccountLimiter: () => ({ limit: () => Promise.resolve({ success: true }) }),
}));
vi.mock("@/lib/solana/rpc", () => ({
  solanaRpc: () => ({
    getLatestBlockhash: () => ({
      send: () =>
        Promise.resolve({
          value: { blockhash: "1".repeat(32), lastValidBlockHeight: 1n },
        }),
    }),
    getBalance: () => ({ send: () => Promise.resolve({ value: 100_000_000n }) }),
  }),
}));

import { handleCreateAccountInit } from "@/lib/tools/create-account/init";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { startDeviceFlow } from "@/lib/github/device-flow";

describe("E2E: onboarding init smoke", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.MCP_TOKEN_ENCRYPTION_KEY = "x".repeat(32);
  });

  it("init returns user_code + persists agent row", async () => {
    (startDeviceFlow as any).mockResolvedValue({
      device_code: "DEV",
      user_code: "ABCD-1234",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    });

    const insertCall = vi.fn().mockReturnValue({
      select: () => ({
        single: () => Promise.resolve({ data: { id: "agent-1" }, error: null }),
      }),
    });

    (supabaseAdmin as any).mockReturnValue({
      from: () => ({ insert: insertCall }),
    });

    const result = await handleCreateAccountInit({
      role: "dev",
      wallet_pubkey: "7xK7gE8FpQrSjVz9mYwGtCkBtNvDtTvPzGjGpZqMxKqp",
      ip: "192.0.2.1",
    });

    if ("error" in result) {
      throw new Error(`Expected success, got: ${result.error.code}`);
    }
    expect(result.user_code).toBe("ABCD-1234");
    expect(result.account_id).toBe("agent-1");
    expect(insertCall).toHaveBeenCalledOnce();
  });
});
