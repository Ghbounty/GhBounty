/**
 * Service-role Supabase client for backend-only api routes.
 *
 * The `cookies`-based client (`./server.ts`) uses the anon key + the
 * user's session, so RLS applies. Routes that need to read across users
 * (admin paths, audit-table inserts, the cancel-refund flow) need the
 * service-role key, which bypasses RLS entirely.
 *
 * NEVER expose this client to the browser. The env var
 * `SUPABASE_SERVICE_ROLE_KEY` is intentionally not prefixed with
 * `NEXT_PUBLIC_` so Next.js refuses to ship it to the client bundle.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db.types";

let cached: SupabaseClient<Database> | null = null;

/**
 * Build (or return the cached) service-role Supabase client.
 *
 * Throws when env vars are missing rather than silently building a
 * misconfigured client — surfaces as a 500 in the calling route.
 */
export function getServiceRoleClient(): SupabaseClient<Database> {
  if (cached) return cached;
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error(
      "Supabase URL not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL)",
    );
  }
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  cached = createClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cached;
}
