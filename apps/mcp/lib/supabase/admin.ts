// Service-role Supabase client. Bypasses RLS. Used ONLY by MCP tool
// handlers, which must enforce equivalent policies in code (e.g., agent X
// can only see their own api_keys, not other agents').
//
// Singleton because Next.js can re-import per-request in dev; we want
// connection reuse where possible.
//
// TODO Phase 4: import the typed `Database` shape from @ghbounty/db once
// frontend/lib/db.types.ts is shared via the workspace package. For now
// the client is untyped — tool handlers cast at call sites.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in apps/mcp env"
    );
  }

  _client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return _client;
}
