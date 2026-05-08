import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { authenticate } from "@/lib/auth/middleware";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mcpError } from "@/lib/errors";

const GetInput = z.object({
  authorization: z.string().optional(),
  submission_id: z.string().uuid(),
});

export async function handleSubmissionsGet(raw: unknown) {
  const parsed = GetInput.safeParse(raw);
  if (!parsed.success) return { error: mcpError("InvalidInput", parsed.error.message) };

  const auth = await authenticate(parsed.data.authorization);
  if (!auth.ok) return { error: auth.error };

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("submissions")
    .select("id, solver, pr_url, score, state, opus_report_hash, bounty:issue_pda(creator)")
    .eq("id", parsed.data.submission_id)
    .maybeSingle();

  if (error) return { error: mcpError("InternalError", error.message) };
  if (!data) return { error: mcpError("NotFound", "Submission not found") };

  const row = data as any;
  const callerWallet = auth.agent.wallet_pubkey;
  const isSolver = row.solver === callerWallet;
  const bountyRel = Array.isArray(row.bounty) ? row.bounty[0] : row.bounty;
  const isBountyOwner = bountyRel?.creator === callerWallet;

  if (!isSolver && !isBountyOwner) {
    return { error: mcpError("Forbidden", "Not authorized to view this submission") };
  }

  return {
    submission: {
      id: row.id,
      solver: row.solver,
      pr_url: row.pr_url,
      score: row.score,
      state: row.state,
      opus_report_hash: row.opus_report_hash,
    },
  };
}

export function registerSubmissionsGet(server: McpServer): void {
  server.tool(
    "submissions.get",
    { submission_id: z.string().uuid() },
    async (input, extra) => {
      const authorization = (extra as any)?.requestInfo?.headers?.authorization;
      const result = await handleSubmissionsGet({ ...input, authorization });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
