import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/lib/auth/middleware");
vi.mock("@/lib/config", () => ({
  getChainId: () => "solana-mainnet",
  getProgramAddress: () => "test_program_addr",
}));

import { handleBountiesList } from "@/lib/tools/bounties/list";
import { authenticate } from "@/lib/auth/middleware";
import { supabaseAdmin } from "@/lib/supabase/admin";

const AUTHED_PROFILE = {
  ok: true,
  credentialId: "key-uuid",
  credentialKind: "api_key",
  profile: { user_id: "did:privy:a", role: "dev", mcp_status: "active", wallet_pubkey: "7", github_handle: "h" },
};

/**
 * Per-table supabase mock. `issues` serves the bounties list chain
 * (select → eq → order → limit); `submissions` and `submission_reviews`
 * serve the enrichment chains (select → in [→ eq]).
 */
function mockSupabase(tables: {
  issues?: any[];
  submissions?: any[];
  submission_reviews?: any[];
}) {
  (supabaseAdmin as any).mockReturnValue({
    from: (table: string) => {
      if (table === "issues") {
        const terminal = {
          limit: () => Promise.resolve({ data: tables.issues ?? [], error: null }),
          maybeSingle: () => Promise.resolve({ data: tables.issues?.[0] ?? null, error: null }),
        };
        const orderLimit = { order: () => terminal, ...terminal };
        const eq2 = { ...orderLimit, eq: () => orderLimit };
        return { select: () => ({ eq: () => eq2 }) };
      }
      if (table === "submissions") {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: tables.submissions ?? [], error: null }),
          }),
        };
      }
      return {
        select: () => ({
          in: () => ({
            eq: () => Promise.resolve({ data: tables.submission_reviews ?? [], error: null }),
          }),
        }),
      };
    },
  });
}

describe("bounties.list", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CHAIN_ID = "solana-mainnet";
  });

  it("returns Unauthorized when not authed", async () => {
    (authenticate as any).mockResolvedValue({
      ok: false,
      error: { code: "Unauthorized", message: "no key" },
    });
    const result = await handleBountiesList({ authorization: undefined });
    expect((result as any).error.code).toBe("Unauthorized");
  });

  it("returns paginated open bounties", async () => {
    (authenticate as any).mockResolvedValue(AUTHED_PROFILE);
    mockSupabase({
      issues: [
        {
          id: "b1",
          pda: "pda1",
          amount: "1000000000",
          state: "open",
          github_issue_url: "x",
          submission_count: 0,
          bounty_meta: { title: "t" },
          created_at: "2026-05-06",
        },
      ],
    });

    const result = await handleBountiesList({
      authorization: "Bearer ghbk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      filter: { status: "open" },
    });
    expect((result as any).items).toHaveLength(1);
    expect((result as any).items[0].id).toBe("b1");
    expect((result as any).items[0].amount_sol).toBe("1");
    expect((result as any).items[0].status).toBe("open");
    expect((result as any).items[0].chain_id).toBe("solana-mainnet");
  });

  it("derives reviewing/capped/paid statuses from live submission data, not the on-chain mirror", async () => {
    (authenticate as any).mockResolvedValue(AUTHED_PROFILE);
    mockSupabase({
      issues: [
        // reviewing: live submissions exist even though mirror says 0
        {
          id: "rev",
          pda: "pda-rev",
          amount: "1000000000",
          state: "open",
          github_issue_url: "x",
          submission_count: 0,
          bounty_meta: { title: "t" },
          created_at: "2026-05-06",
        },
        // capped: closed_by_cap_at set
        {
          id: "cap",
          pda: "pda-cap",
          amount: "1000000000",
          state: "open",
          github_issue_url: "x",
          submission_count: 2,
          bounty_meta: { title: "t", closed_by_cap_at: "2026-06-01" },
          created_at: "2026-05-05",
        },
        // paid: on-chain state stuck at open, but a review is approved
        {
          id: "paid",
          pda: "pda-paid",
          amount: "1000000000",
          state: "open",
          github_issue_url: "x",
          submission_count: 1,
          bounty_meta: { title: "t" },
          created_at: "2026-05-04",
        },
      ],
      submissions: [
        { id: "s1", issue_pda: "pda-rev" },
        { id: "s2", issue_pda: "pda-paid" },
      ],
      submission_reviews: [{ submission_id: "s2", approved: true }],
    });

    const result = await handleBountiesList({
      authorization: "Bearer ghbk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    const byId = new Map<string, any>((result as any).items.map((i: any) => [i.id, i]));
    expect(byId.get("rev").status).toBe("reviewing");
    expect(byId.get("rev").submission_count).toBe(1);
    expect(byId.get("cap").status).toBe("capped");
    expect(byId.get("paid").status).toBe("paid");
  });

  it("filters on the derived bucket so status=open excludes reviewing bounties", async () => {
    (authenticate as any).mockResolvedValue(AUTHED_PROFILE);
    mockSupabase({
      issues: [
        {
          id: "open",
          pda: "pda-open",
          amount: "1000000000",
          state: "open",
          github_issue_url: "x",
          submission_count: 0,
          bounty_meta: { title: "t" },
          created_at: "2026-05-06",
        },
        {
          id: "rev",
          pda: "pda-rev",
          amount: "1000000000",
          state: "open",
          github_issue_url: "x",
          submission_count: 0,
          bounty_meta: { title: "t" },
          created_at: "2026-05-05",
        },
      ],
      submissions: [{ id: "s1", issue_pda: "pda-rev" }],
    });

    const result = await handleBountiesList({
      authorization: "Bearer ghbk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      filter: { status: "open" },
    });
    expect((result as any).items).toHaveLength(1);
    expect((result as any).items[0].id).toBe("open");
  });
});

describe("bounties.get", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CHAIN_ID = "solana-mainnet";
  });

  it("returns 404 for unknown id", async () => {
    const { handleBountiesGet } = await import("@/lib/tools/bounties/get");
    (authenticate as any).mockResolvedValue(AUTHED_PROFILE);
    mockSupabase({ issues: [] });

    const result = await handleBountiesGet({
      authorization: "Bearer ghbk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      id: "00000000-0000-0000-0000-000000000099",
    });
    expect((result as any).error.code).toBe("NotFound");
  });
});
