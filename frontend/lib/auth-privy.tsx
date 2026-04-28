"use client";

/**
 * Auth provider backed by Privy (wallet-only mode).
 *
 * Active when NEXT_PUBLIC_USE_PRIVY=1.
 *
 * Scope of this iteration:
 *   1. PrivyProvider wraps the app with wallet-only login (Solana + EVM).
 *   2. After login, Privy gives us the user.id (cm_*) and a linked wallet.
 *   3. We map the Privy user to our `User` shape; role is held client-side
 *      (localStorage hint until we wire the profile lookup against Supabase
 *      via the third-party JWT integration).
 *
 * What's NOT here yet (follow-ups, see GHB-159 + new issue to file):
 *   - Profile creation/lookup in Supabase using Privy JWT as auth token
 *     (needs Supabase Auth → Third-party JWT config in dashboard, plus
 *     `accessToken` callback on the supabase-js client).
 *   - RLS policies that read `auth.jwt() ->> 'sub'` for Privy users.
 *
 * Today the user lands here, signs with their wallet, and we treat them
 * as a fake "company" or "dev" picked from localStorage so the rest of
 * the dashboard renders. Persistence happens in the follow-up issue.
 */

import { useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import type { Company, Dev, User } from "./types";
import { AuthCtx } from "./auth-context";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: false,
});

function readRoleHint(): "company" | "dev" {
  if (typeof window === "undefined") return "company";
  const r = window.localStorage.getItem("privyRole");
  return r === "dev" ? "dev" : "company";
}

function shortenWallet(addr: string): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function mapPrivyToUser(
  privyUser: ReturnType<typeof usePrivy>["user"],
  role: "company" | "dev",
): User | null {
  if (!privyUser) return null;
  const wallet = privyUser.wallet?.address ?? null;
  const display = wallet ? shortenWallet(wallet) : privyUser.id;

  if (role === "company") {
    return {
      id: privyUser.id,
      role: "company",
      email: privyUser.email?.address ?? "",
      name: display,
      description: "Profile completion pending — connect Supabase JWT to load real data.",
      avatarUrl: undefined,
      website: undefined,
      industry: undefined,
      wallet: wallet ?? undefined,
      createdAt: privyUser.createdAt
        ? new Date(privyUser.createdAt).getTime()
        : Date.now(),
    } satisfies Company;
  }
  return {
    id: privyUser.id,
    role: "dev",
    email: privyUser.email?.address ?? "",
    username: display,
    bio: "",
    skills: [],
    github: undefined,
    avatarUrl: undefined,
    wallet: wallet ?? undefined,
    createdAt: privyUser.createdAt
      ? new Date(privyUser.createdAt).getTime()
      : Date.now(),
  } satisfies Dev;
}

function PrivyAuthInner({ children }: { children: ReactNode }) {
  const privy = usePrivy();
  const role = readRoleHint();

  const user = useMemo<User | null>(() => {
    if (!privy.ready || !privy.authenticated) return null;
    return mapPrivyToUser(privy.user, role);
  }, [privy.ready, privy.authenticated, privy.user, role]);

  const loginByEmail = useCallback(async () => {
    privy.login();
    return null;
  }, [privy]);

  const registerCompany = useCallback(
    async (): Promise<Company | null> => {
      privy.login();
      return null;
    },
    [privy],
  );

  const registerDev = useCallback(
    async (): Promise<Dev | null> => {
      privy.login();
      return null;
    },
    [privy],
  );

  const updateUser = useCallback(async () => {
    // No-op until profile persistence is wired against Supabase via JWT.
  }, []);

  const logout = useCallback(async () => {
    await privy.logout();
  }, [privy]);

  const refresh = useCallback(() => {
    // Privy is reactive; nothing to refresh manually.
  }, []);

  return (
    <AuthCtx.Provider
      value={{
        user,
        ready: privy.ready,
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

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!APP_ID) {
    console.error(
      "[auth-privy] NEXT_PUBLIC_PRIVY_APP_ID missing — Privy provider disabled.",
    );
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#00E5D1",
          showWalletLoginFirst: true,
          walletList: [
            "phantom",
            "solflare",
            "backpack",
            "metamask",
            "coinbase_wallet",
            "wallet_connect",
          ],
        },
        loginMethods: ["wallet"],
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
        },
        externalWallets: {
          solana: { connectors: solanaConnectors },
        },
      }}
    >
      <PrivyAuthInner>{children}</PrivyAuthInner>
    </PrivyProvider>
  );
}

/** Re-exported for use inside components that want the raw Privy state. */
export { usePrivy };
