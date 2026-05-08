import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/lib/auth/middleware");

import { handleSubmissionsGet } from "@/lib/tools/submissions/get";
import { authenticate } from "@/lib/auth/middleware";
import { supabaseAdmin } from "@/lib/supabase/admin";

describe("submissions.get", () => {
  beforeEach(() => vi.resetAllMocks());

  it("403 when caller is neither solver nor bounty company", async () => {
    (authenticate as any).mockResolvedValue({
      ok: true,
      agent: { id: "a", role: "dev", status: "active", wallet_pubkey: "OTHER_WALLET", github_handle: "h" },
    });
    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: {
                  id: "00000000-0000-0000-0000-000000000001",
                  solver: "DIFFERENT_WALLET",
                  pr_url: "https://github.com/o/r/pull/1",
                  score: null,
                  state: "Pending",
                  bounty: { creator: "COMPANY_WALLET" },
                },
                error: null,
              }),
          }),
        }),
      }),
    });

    const result = await handleSubmissionsGet({
      authorization: "Bearer ghbk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      submission_id: "00000000-0000-0000-0000-000000000001",
    });
    expect((result as any).error.code).toBe("Forbidden");
  });

  it("returns submission when caller is the solver", async () => {
    (authenticate as any).mockResolvedValue({
      ok: true,
      agent: { id: "a", role: "dev", status: "active", wallet_pubkey: "SOLVER_WALLET", github_handle: "h" },
    });
    (supabaseAdmin as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: {
                  id: "00000000-0000-0000-0000-000000000001",
                  solver: "SOLVER_WALLET",
                  pr_url: "https://github.com/o/r/pull/1",
                  score: 7,
                  state: "Scored",
                  bounty: { creator: "COMPANY_WALLET" },
                },
                error: null,
              }),
          }),
        }),
      }),
    });

    const result = await handleSubmissionsGet({
      authorization: "Bearer ghbk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      submission_id: "00000000-0000-0000-0000-000000000001",
    });
    expect((result as any).submission.id).toBe("00000000-0000-0000-0000-000000000001");
    expect((result as any).submission.score).toBe(7);
  });
});
