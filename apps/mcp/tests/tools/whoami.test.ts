import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/lib/auth/middleware");
vi.mock("@/lib/solana/rpc", () => ({
  solanaRpc: () => ({
    getBalance: () => ({
      send: () => Promise.resolve({ value: 100_000_000n }),
    }),
  }),
}));

import { handleWhoami } from "@/lib/tools/whoami";
import { authenticate } from "@/lib/auth/middleware";

describe("whoami handler", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns Unauthorized when middleware rejects", async () => {
    (authenticate as any).mockResolvedValue({
      ok: false,
      error: { code: "Unauthorized", message: "no key" },
    });
    const result = await handleWhoami({ authorization: undefined });
    expect((result as any).error.code).toBe("Unauthorized");
  });

  it("returns agent info + balance when authorized", async () => {
    (authenticate as any).mockResolvedValue({
      ok: true,
      apiKeyId: "key-uuid",
      agent: {
        id: "agent-uuid",
        role: "dev",
        status: "active",
        wallet_pubkey: "7xK7gE8FpQrSjVz9mYwGtCkBtNvDtTvPzGjGpZqMxKqp",
        github_handle: "claudebot",
      },
    });
    const result = await handleWhoami({ authorization: "Bearer ghbk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    expect((result as any).agent_id).toBe("agent-uuid");
    expect((result as any).balances.sol_lamports).toBe("100000000");
  });
});
