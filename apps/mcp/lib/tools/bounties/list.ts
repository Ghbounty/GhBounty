import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { authenticate } from "@/lib/auth/middleware";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mcpError } from "@/lib/errors";
import { getChainId } from "@/lib/config";
import { deriveBountyStatus, fetchBountyEnrichment, filterStatusToBucket } from "./status";

const STATUS_FILTER_VALUES = [
  "open",
  "reviewing",
  "capped",
  "closed",
  "paid",
  // Legacy on-chain state names, mapped onto derived buckets.
  "resolved",
  "cancelled",
] as const;

const FilterSchema = z.object({
  status: z.enum(STATUS_FILTER_VALUES).optional(),
  min_sol: z.string().optional(),
  max_sol: z.string().optional(),
});

const ListInput = z.object({
  authorization: z.string().optional(),
  filter: FilterSchema.optional(),
  cursor: z.string().optional(),
});

export async function handleBountiesList(raw: unknown) {
  const parsed = ListInput.safeParse(raw);
  if (!parsed.success) return { error: mcpError("InvalidInput", parsed.error.message) };

  const auth = await authenticate(parsed.data.authorization);
  if (!auth.ok) return { error: auth.error };

  const filter = parsed.data.filter ?? {};
  const supabase = supabaseAdmin();

  const { data, error } = await supabase
    .from("issues")
    .select(
      "id, pda, amount, state, github_issue_url, submission_count, bounty_meta(title, description, release_mode, closed_by_user, closed_by_cap_at), created_at"
    )
    .eq("chain_id", getChainId())
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return { error: mcpError("InternalError", error.message) };

  const rows = (data ?? []) as any[];
  const enrichment = await fetchBountyEnrichment(
    rows.map((row) => row.pda).filter((pda): pda is string => typeof pda === "string"),
  );

  const items = rows
    .map((row) => {
      const meta = Array.isArray(row.bounty_meta) ? row.bounty_meta[0] : row.bounty_meta;
      // Live count beats the lagging `issues.submission_count` mirror.
      const liveCount = enrichment.counts.get(row.pda);
      const submissionCount = liveCount ?? row.submission_count ?? 0;
      const status = deriveBountyStatus({
        state: row.state,
        closedByUser: meta?.closed_by_user === true,
        closedByCap: meta?.closed_by_cap_at != null,
        submissionCount,
        hasApprovedSubmission: enrichment.approvedPdas.has(row.pda),
      });
      return {
        id: row.id,
        title: meta?.title ?? null,
        amount_sol: (Number(row.amount) / 1e9).toString(),
        github_url: row.github_issue_url,
        submission_count: submissionCount,
        state: row.state,
        // Dashboard-equivalent status bucket — the authoritative
        // claimability signal, unlike the lagging on-chain `state`.
        status,
        chain_id: getChainId(),
        created_at: row.created_at,
      };
    })
    // Status filters match the derived bucket so "open" means actually
    // claimable, not "on-chain state not yet flipped by the relayer".
    .filter((item) => (filter.status ? item.status === filterStatusToBucket(filter.status) : true));

  return {
    items,
    next_cursor: null, // simple paging in v1
  };
}

export function registerBountiesList(server: McpServer): void {
  server.tool(
    "bounties.list",
    {
      filter: FilterSchema.optional(),
      cursor: z.string().optional(),
    },
    async (input, extra) => {
      const authorization = (extra as any)?.requestInfo?.headers?.authorization;
      const result = await handleBountiesList({ ...input, authorization });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
