"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Company, Dev, User } from "./types";
import {
  ensureSeeded,
  findUserByEmail,
  getCurrentUser,
  setSession,
  uid,
  upsertUser,
} from "./store";
import { AuthCtx } from "./auth-context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(() => {
    setUser(getCurrentUser());
  }, []);

  useEffect(() => {
    ensureSeeded();
    setUser(getCurrentUser());
    setReady(true);
  }, []);

  const loginByEmail = useCallback(async (email: string) => {
    const found = findUserByEmail(email);
    if (!found) return null;
    setSession(found.id);
    setUser(found);
    return found;
  }, []);

  const registerCompany = useCallback(
    async (data: Omit<Company, "id" | "role" | "createdAt">) => {
      const c: Company = {
        ...data,
        id: uid("c"),
        role: "company",
        createdAt: Date.now(),
      };
      upsertUser(c);
      setSession(c.id);
      setUser(c);
      return c;
    },
    [],
  );

  const registerDev = useCallback(
    async (data: Omit<Dev, "id" | "role" | "createdAt">) => {
      const d: Dev = {
        ...data,
        id: uid("d"),
        role: "dev",
        createdAt: Date.now(),
      };
      upsertUser(d);
      setSession(d.id);
      setUser(d);
      return d;
    },
    [],
  );

  const logout = useCallback(async () => {
    setSession(null);
    setUser(null);
  }, []);

  const updateUser = useCallback(async (patch: Partial<User>) => {
    setUser((current) => {
      if (!current) return current;
      const next = { ...current, ...patch } as User;
      upsertUser(next);
      return next;
    });
  }, []);

  return (
    <AuthCtx.Provider
      value={{
        user,
        ready,
        loginByEmail,
        registerCompany,
        registerDev,
        updateUser,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}
