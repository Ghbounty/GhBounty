"use client";

import { createContext, useContext } from "react";
import type { Company, Dev, User } from "./types";

export type AuthContextValue = {
  user: User | null;
  ready: boolean;
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
