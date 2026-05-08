import { describe, it, expect, vi, beforeEach } from "vitest";
import { authenticate } from "@/lib/auth/middleware";

// Mock the supabase admin client
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: vi.fn(),
}));

import { supabaseAdmin } from "@/lib/supabase/admin";

describe("authenticate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns Unauthorized when header is missing", async () => {
    const result = await authenticate(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("Unauthorized");
    }
  });

  it("returns Unauthorized for malformed Bearer header", async () => {
    const result = await authenticate("Token abc");
    expect(result.ok).toBe(false);
  });

  it("returns Unauthorized when prefix not found in DB", async () => {
    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
    });

    const result = await authenticate("Bearer ghbk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("Unauthorized");
    }
  });

  it("returns the agent_account when prefix matches and bcrypt verifies", async () => {
    const { mintApiKey } = await import("@/lib/auth/api-key");
    const { plaintext, hash } = mintApiKey();

    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: "key-uuid",
                    key_hash: hash,
                    agent_account_id: "agent-uuid",
                    agent_accounts: {
                      id: "agent-uuid",
                      role: "dev",
                      status: "active",
                      wallet_pubkey: "7xK...",
                      github_handle: "claudebot42",
                    },
                  },
                  error: null,
                }),
            }),
          }),
        }),
        update: () => ({
          eq: () => ({
            then: (cb: any) => cb(),
          }),
        }),
      }),
    });

    const result = await authenticate(`Bearer ${plaintext}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agent.role).toBe("dev");
      expect(result.agent.status).toBe("active");
    }
  });

  it("returns Forbidden when agent status is not active", async () => {
    const { mintApiKey } = await import("@/lib/auth/api-key");
    const { plaintext, hash } = mintApiKey();

    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: "key-uuid",
                    key_hash: hash,
                    agent_account_id: "agent-uuid",
                    agent_accounts: {
                      id: "agent-uuid",
                      role: "dev",
                      status: "suspended",
                      wallet_pubkey: "7xK...",
                      github_handle: "claudebot42",
                    },
                  },
                  error: null,
                }),
            }),
          }),
        }),
      }),
    });

    const result = await authenticate(`Bearer ${plaintext}`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("Forbidden");
    }
  });
});
