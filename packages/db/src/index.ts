/**
 * @ghbounty/db — single source of truth for the project's database layer.
 *
 * Both the relayer and the frontend import from here. Migrations live in
 * `drizzle/` and are versioned with the rest of the source.
 *
 * Cheatsheet (run from repo root):
 *   pnpm db:generate   # generate a new migration from schema.ts diffs
 *   pnpm db:push       # push schema to DATABASE_URL (dev)
 *   pnpm db:studio     # open drizzle studio
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

export * from "./schema.js";
export { schema };

export interface CreateDbOptions {
  /** Postgres connection string. */
  url: string;
  /**
   * Disable prepared statements. Required for Supabase's transaction-mode
   * pooler (port 6543) — that's the URL most projects use.
   */
  prepare?: boolean;
  /** Max connections in the pool. Default 10. */
  max?: number;
}

export function createDb(options: CreateDbOptions) {
  const queryClient = postgres(options.url, {
    prepare: options.prepare ?? false,
    max: options.max ?? 10,
  });
  return drizzle(queryClient, { schema });
}

export type Db = ReturnType<typeof createDb>;
