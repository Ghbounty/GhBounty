"use client";

import type { ReactNode } from "react";
import { AuthProvider as MockProvider } from "./auth-mock";
import { AuthProvider as SupabaseProvider } from "./auth-supabase";
import { useSupabaseBackend } from "./auth-context";

export { useAuth } from "./auth-context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const Provider = useSupabaseBackend ? SupabaseProvider : MockProvider;
  return <Provider>{children}</Provider>;
}
