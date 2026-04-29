"use client";

import { createContext, useContext } from "react";
import type { Company, Dev, User } from "./types";

export type AuthContextValue = {
  user: User | null;
  ready: boolean;
  // GHB-165: true when the wallet authenticated through Privy but no
  // `profiles` row exists yet. The route layer uses this to send the user
  // to /app/onboarding instead of /app/auth. Other auth backends leave it
  // `false`.
  pendingOnboarding?: boolean;
  // Surface for errors from the post-auth persist effect. The signup forms
  // submit + open Privy and then await the user redirect; if the persist
  // fails (constraint violation, RLS reject, network), the page has no
  // way to know what happened. We expose the message here so the form
  // can render it instead of staying stuck on "Waiting for wallet…".
  pendingError?: string | null;
  clearPendingError?: () => void;
  loginByEmail: (email: string, password?: string) => Promise<User | null>;
  registerCompany: (
    data: Omit<Company, "id" | "role" | "createdAt">,
    password?: string,
  ) => Promise<Company | null>;
  registerDev: (
    data: Omit<Dev, "id" | "role" | "createdAt">,
    password?: string,
  ) => Promise<Dev | null>;
  updateUser: (patch: Partial<User>) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => void;
};

export const AuthCtx = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export const useSupabaseBackend =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_USE_SUPABASE === "1";

export const useAuthBypass =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_AUTH_BYPASS === "1";

export const usePrivyBackend =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_USE_PRIVY === "1";
