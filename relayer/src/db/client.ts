import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDb(url: string) {
  const queryClient = postgres(url, { prepare: false });
  return drizzle(queryClient, { schema });
}

export type Db = ReturnType<typeof createDb>;
