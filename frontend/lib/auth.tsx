"use client";

import type { ReactNode } from "react";
import { AuthProvider as MockProvider } from "./auth-mock";
import { AuthProvider as SupabaseProvider } from "./auth-supabase";
import { AuthProvider as BypassProvider } from "./auth-bypass";
import { AuthProvider as PrivyProvider } from "./auth-privy";
import {
  useAuthBypass,
  usePrivyBackend,
  useSupabaseBackend,
} from "./auth-context";

export { useAuth } from "./auth-context";

/**
 * Provider precedence (first match wins):
 *   1. NEXT_PUBLIC_AUTH_BYPASS=1   → fake user for testing data layer
 *   2. NEXT_PUBLIC_USE_PRIVY=1     → Privy wallet-connect login
 *   3. NEXT_PUBLIC_USE_SUPABASE=1  → Supabase Auth (email + password)
 *   4. (default)                   → localStorage mock
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const Provider = useAuthBypass
    ? BypassProvider
    : usePrivyBackend
      ? PrivyProvider
      : useSupabaseBackend
        ? SupabaseProvider
        : MockProvider;
  return <Provider>{children}</Provider>;
}
