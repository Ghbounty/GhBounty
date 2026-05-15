import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/lib/auth/middleware");

import { handleSubmissionsGet } from "@/lib/tools/submissions/get";
import { authenticate } from "@/lib/auth/middleware";
import { supabaseAdmin } from "@/lib/supabase/admin";

function mockClient(opts: { submission: any; evaluation?: any }) {
  (supabaseAdmin as any).mockReturnValue({
    from: (table: string) => {
      if (table === "submissions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: opts.submission, error: null }),
            }),
          }),
        };
      }
      // evaluations
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: () => Promise.resolve({ data: opts.evaluation ?? null, error: null }),
              }),
            }),
          }),
        }),
      };
    },
  });
}

describe("submissions.get", () => {
  beforeEach(() => vi.resetAllMocks());

  it("403 when caller is neither solver nor bounty company", async () => {
    (authenticate as any).mockResolvedValue({
      ok: true,
      agent: { id: "a", role: "dev", status: "active", wallet_pubkey: "OTHER_WALLET", github_handle: "h" },
    });
    mockClient({
      submission: {
        id: "00000000-0000-0000-0000-000000000001",
        pda: "SUB_PDA",
        solver: "DIFFERENT_WALLET",
        pr_url: "https://github.com/o/r/pull/1",
        state: "pending",
        rank: null,
        opus_report_hash: "h",
        bounty: { creator: "COMPANY_WALLET" },
      },
    });

    const result = await handleSubmissionsGet({
      authorization: "Bearer ghbk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      submission_id: "00000000-0000-0000-0000-000000000001",
    });
    expect((result as any).error.code).toBe("Forbidden");
  });

  it("returns null score when state is pending", async () => {
    (authenticate as any).mockResolvedValue({
      ok: true,
      agent: { id: "a", role: "dev", status: "active", wallet_pubkey: "SOLVER_WALLET", github_handle: "h" },
    });
    mockClient({
      submission: {
        id: "00000000-0000-0000-0000-000000000001",
        pda: "SUB_PDA",
        solver: "SOLVER_WALLET",
        pr_url: "https://github.com/o/r/pull/1",
        state: "pending",
        rank: null,
        opus_report_hash: "h",
        bounty: { creator: "COMPANY_WALLET" },
      },
    });

    const result = await handleSubmissionsGet({
      authorization: "Bearer ghbk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      submission_id: "00000000-0000-0000-0000-000000000001",
    });
    expect((result as any).submission.score).toBeNull();
    expect((result as any).submission.score_source).toBeNull();
    expect((result as any).submission.rank).toBeNull();
    expect((result as any).submission.state).toBe("pending");
  });

  it("returns score + source from latest evaluation when scored", async () => {
    (authenticate as any).mockResolvedValue({
      ok: true,
      agent: { id: "a", role: "dev", status: "active", wallet_pubkey: "SOLVER_WALLET", github_handle: "h" },
    });
    mockClient({
      submission: {
        id: "00000000-0000-0000-0000-000000000001",
        pda: "SUB_PDA",
        solver: "SOLVER_WALLET",
        pr_url: "https://github.com/o/r/pull/1",
        state: "scored",
        rank: 1,
        opus_report_hash: "h",
        bounty: { creator: "COMPANY_WALLET" },
      },
      evaluation: { score: 78, source: "genlayer" },
    });

    const result = await handleSubmissionsGet({
      authorization: "Bearer ghbk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      submission_id: "00000000-0000-0000-0000-000000000001",
    });
    expect((result as any).submission.id).toBe("00000000-0000-0000-0000-000000000001");
    expect((result as any).submission.score).toBe(78);
    expect((result as any).submission.score_source).toBe("genlayer");
    expect((result as any).submission.rank).toBe(1);
  });

  it("returns null score when scored but evaluation row missing", async () => {
    (authenticate as any).mockResolvedValue({
      ok: true,
      agent: { id: "a", role: "dev", status: "active", wallet_pubkey: "SOLVER_WALLET", github_handle: "h" },
    });
    mockClient({
      submission: {
        id: "00000000-0000-0000-0000-000000000001",
        pda: "SUB_PDA",
        solver: "SOLVER_WALLET",
        pr_url: "https://github.com/o/r/pull/1",
        state: "scored",
        rank: 1,
        opus_report_hash: "h",
        bounty: { creator: "COMPANY_WALLET" },
      },
    });

    const result = await handleSubmissionsGet({
      authorization: "Bearer ghbk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      submission_id: "00000000-0000-0000-0000-000000000001",
    });
    expect((result as any).submission.score).toBeNull();
    expect((result as any).submission.score_source).toBeNull();
  });
});
