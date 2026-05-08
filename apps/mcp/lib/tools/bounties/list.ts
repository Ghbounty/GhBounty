import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { authenticate } from "@/lib/auth/middleware";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mcpError } from "@/lib/errors";

const ListInput = z.object({
  authorization: z.string().optional(),
  filter: z
    .object({
      status: z.enum(["open", "resolved", "cancelled"]).optional(),
      min_sol: z.string().optional(),
      max_sol: z.string().optional(),
    })
    .optional(),
  cursor: z.string().optional(),
});

export async function handleBountiesList(raw: unknown) {
  const parsed = ListInput.safeParse(raw);
  if (!parsed.success) return { error: mcpError("InvalidInput", parsed.error.message) };

  const auth = await authenticate(parsed.data.authorization);
  if (!auth.ok) return { error: auth.error };

  const filter = parsed.data.filter ?? {};
  const supabase = supabaseAdmin();

  let q: any = supabase
    .from("issues")
    .select(
      "id, amount, state, github_issue_url, submission_count, bounty_meta(title, description, release_mode), created_at"
    );

  if (filter.status) q = q.eq("state", filter.status);

  q = q.order("created_at", { ascending: false }).limit(50);

  const { data, error } = await q;
  if (error) return { error: mcpError("InternalError", error.message) };

  return {
    items: (data ?? []).map((row: any) => ({
      id: row.id,
      title: Array.isArray(row.bounty_meta) ? row.bounty_meta[0]?.title ?? null : row.bounty_meta?.title ?? null,
      amount_sol: (Number(row.amount) / 1e9).toString(),
      github_url: row.github_issue_url,
      submission_count: row.submission_count,
      state: row.state,
      created_at: row.created_at,
    })),
    next_cursor: null, // simple paging in v1
  };
}

export function registerBountiesList(server: McpServer): void {
  server.tool(
    "bounties.list",
    {
      filter: z
        .object({
          status: z.enum(["open", "resolved", "cancelled"]).optional(),
          min_sol: z.string().optional(),
          max_sol: z.string().optional(),
        })
        .optional(),
      cursor: z.string().optional(),
    },
    async (input, extra) => {
      const authorization = (extra as any)?.requestInfo?.headers?.authorization;
      const result = await handleBountiesList({ ...input, authorization });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
