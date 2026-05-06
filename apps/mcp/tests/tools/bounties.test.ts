import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/lib/auth/middleware");

import { handleBountiesList } from "@/lib/tools/bounties/list";
import { authenticate } from "@/lib/auth/middleware";
import { supabaseAdmin } from "@/lib/supabase/admin";

describe("bounties.list", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns Unauthorized when not authed", async () => {
    (authenticate as any).mockResolvedValue({
      ok: false,
      error: { code: "Unauthorized", message: "no key" },
    });
    const result = await handleBountiesList({ authorization: undefined });
    expect((result as any).error.code).toBe("Unauthorized");
  });

  it("returns paginated open bounties", async () => {
    (authenticate as any).mockResolvedValue({
      ok: true,
      agent: { id: "a", role: "dev", status: "active", wallet_pubkey: "7", github_handle: "h" },
    });

    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({
                  data: [
                    {
                      id: "b1",
                      amount: "1000000000",
                      state: "open",
                      github_issue_url: "x",
                      submission_count: 0,
                      bounty_meta: [{ title: "t" }],
                      created_at: "2026-05-06",
                    },
                  ],
                  error: null,
                }),
            }),
          }),
        }),
      }),
    });

    const result = await handleBountiesList({
      authorization: "Bearer ghbk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      filter: { status: "open" },
    });
    expect((result as any).items).toHaveLength(1);
    expect((result as any).items[0].id).toBe("b1");
    expect((result as any).items[0].amount_sol).toBe("1");
  });
});

describe("bounties.get", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 404 for unknown id", async () => {
    const { handleBountiesGet } = await import("@/lib/tools/bounties/get");
    (authenticate as any).mockResolvedValue({
      ok: true,
      agent: { id: "a", role: "dev", status: "active", wallet_pubkey: "7", github_handle: "h" },
    });
    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    });

    const result = await handleBountiesGet({
      authorization: "Bearer ghbk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      id: "00000000-0000-0000-0000-000000000099",
    });
    expect((result as any).error.code).toBe("NotFound");
  });
});
