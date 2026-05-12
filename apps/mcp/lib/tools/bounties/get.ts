import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { authenticate } from "@/lib/auth/middleware";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mcpError } from "@/lib/errors";
import { getChainId } from "@/lib/tools/create-account/complete";

const GetInput = z.object({
  authorization: z.string().optional(),
  id: z.string().uuid(),
});

export async function handleBountiesGet(raw: unknown) {
  const parsed = GetInput.safeParse(raw);
  if (!parsed.success) return { error: mcpError("InvalidInput", parsed.error.message) };

  const auth = await authenticate(parsed.data.authorization);
  if (!auth.ok) return { error: auth.error };

  const supabase = supabaseAdmin();

  const { data, error } = await supabase
    .from("issues")
    .select(
      "id, amount, state, pda, github_issue_url, submission_count, bounty_meta(title, description, release_mode, evaluation_criteria, reject_threshold), created_at, creator"
    )
    .eq("id", parsed.data.id)
    .eq("chain_id", getChainId())
    .maybeSingle();

  if (error) return { error: mcpError("InternalError", error.message) };
  if (!data) return { error: mcpError("NotFound", "Bounty not found") };

  const row = data as any;
  const meta = Array.isArray(row.bounty_meta) ? row.bounty_meta[0] : row.bounty_meta;

  // If caller is a dev, surface their submission for this bounty (if any).
  let my_submission: { id: string; status: string } | null = null;
  if (auth.agent.role === "dev" && row.pda) {
    const { data: sub } = await supabase
      .from("submissions")
      .select("id, state")
      .eq("issue_pda", row.pda)
      .eq("solver", auth.agent.wallet_pubkey)
      .maybeSingle();
    if (sub) my_submission = { id: (sub as any).id, status: (sub as any).state };
  }

  return {
    bounty: {
      id: row.id,
      amount_sol: (Number(row.amount) / 1e9).toString(),
      state: row.state,
      pda: row.pda,
      github_issue_url: row.github_issue_url,
      title: meta?.title ?? null,
      description: meta?.description ?? null,
      release_mode: meta?.release_mode ?? null,
      evaluation_criteria: meta?.evaluation_criteria ?? null,
      reject_threshold: meta?.reject_threshold ?? null,
      submission_count: row.submission_count,
      created_at: row.created_at,
    },
    my_submission,
  };
}

export function registerBountiesGet(server: McpServer): void {
  server.tool(
    "bounties.get",
    { id: z.string().uuid() },
    async (input, extra) => {
      const authorization = (extra as any)?.requestInfo?.headers?.authorization;
      const result = await handleBountiesGet({ ...input, authorization });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
