"use client";

/**
 * GHB-165: Auth provider backed by Privy + Supabase JWT bridge.
 *
 * Active when NEXT_PUBLIC_USE_PRIVY=1.
 *
 * Pipeline:
 *   1. Privy handles wallet sign-in and exposes `getAccessToken()`.
 *   2. We register that getter with `privy-supabase-bridge` so the Supabase
 *      browser client (which is constructed eagerly) can mint HS256 tokens
 *      via `/api/auth/privy-bridge` and attach them as Authorization headers.
 *   3. RLS policies (`auth.jwt() ->> 'sub'`) match the Privy DID stored in
 *      `profiles.user_id`, unlocking authenticated reads/writes.
 *
 * First-time vs returning users:
 *   - First time: Privy authenticated, but no row in `profiles`. We expose
 *     `needsOnboarding=true` via the user object being null while
 *     `privy.authenticated=true`. The route layer decides what to render
 *     (onboarding form, GHB-165 follow-up).
 *   - Returning: profile exists → we hydrate the User from Supabase, same
 *     shape as the Supabase-Auth path.
 *
 * Mock-style data is no longer injected. Components that depend on `user`
 * will simply see `null` until the profile is persisted.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
import type { Database } from "./db.types";
import type { Company, Dev, User } from "./types";
import { AuthCtx } from "./auth-context";
import {
  clearPrivySession,
  registerPrivyTokenGetter,
} from "./privy-supabase-bridge";

type DBClient = SupabaseClient<Database>;

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: false,
});

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Persist company rows. Runs in two steps because we have no transactions
 * across REST calls:
 *   1. Insert into `profiles` (upsert via `onConflict` to be idempotent —
 *      a previous failed attempt may have left a row).
 *   2. Insert into `companies`.
 *
 * If step 2 fails AND we just created the profile row in step 1 (i.e. it
 * didn't exist before), we delete the orphan profile so the next retry
 * starts clean. We don't delete profiles that pre-existed — they may
 * belong to a successful prior signup we don't want to nuke.
 */
async function persistCompanyRow(
  supabase: DBClient,
  privyId: string,
  data: Omit<Company, "id" | "role" | "createdAt">,
): Promise<void> {
  const { data: preExisting } = await supabase
    .from("profiles")
    .select("user_id, role")
    .eq("user_id", privyId)
    .maybeSingle();
  const profileExisted = preExisting !== null;

  if (preExisting && preExisting.role !== "company") {
    throw new Error(
      `This wallet is already registered as a ${preExisting.role}. ` +
        "Use the matching dashboard or log in with a different wallet.",
    );
  }

  if (!profileExisted) {
    const { error: profileErr } = await supabase.from("profiles").insert({
      user_id: privyId,
      role: "company",
      email: data.email || null,
      onboarding_completed: true,
    });
    if (profileErr) {
      throw new Error(`profiles insert: ${profileErr.message}`);
    }
  }

  const slug = slugify(data.name) || privyId.slice(-8);
  const { error: companyErr } = await supabase.from("companies").insert({
    user_id: privyId,
    name: data.name,
    slug,
    description: data.description,
    website: data.website ?? null,
    industry: data.industry ?? null,
    logo_url: data.avatarUrl ?? null,
  });
  if (companyErr) {
    if (!profileExisted) {
      // Roll back the profile we just created so the user can retry
      // cleanly without ending up with an orphan row.
      await supabase.from("profiles").delete().eq("user_id", privyId);
    }
    throw new Error(`companies insert: ${companyErr.message}`);
  }
}

async function persistDevRow(
  supabase: DBClient,
  privyId: string,
  data: Omit<Dev, "id" | "role" | "createdAt">,
): Promise<void> {
  const { data: preExisting } = await supabase
    .from("profiles")
    .select("user_id, role")
    .eq("user_id", privyId)
    .maybeSingle();
  const profileExisted = preExisting !== null;

  if (preExisting && preExisting.role !== "dev") {
    throw new Error(
      `This wallet is already registered as a ${preExisting.role}. ` +
        "Use the matching dashboard or log in with a different wallet.",
    );
  }

  if (!profileExisted) {
    const { error: profileErr } = await supabase.from("profiles").insert({
      user_id: privyId,
      role: "dev",
      email: data.email || null,
      onboarding_completed: true,
    });
    if (profileErr) {
      throw new Error(`profiles insert: ${profileErr.message}`);
    }
  }

  const { error: devErr } = await supabase.from("developers").insert({
    user_id: privyId,
    username: data.username,
    github_handle: data.github ?? null,
    bio: data.bio ?? null,
    skills: data.skills,
    avatar_url: data.avatarUrl ?? null,
  });
  if (devErr) {
    if (!profileExisted) {
      await supabase.from("profiles").delete().eq("user_id", privyId);
    }
    throw new Error(`developers insert: ${devErr.message}`);
  }
}

async function loadUser(supabase: DBClient, userId: string): Promise<User | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (!profile) return null;

  if (profile.role === "company") {
    const { data: company } = await supabase
      .from("companies")
      .select("*")
      .eq("user_id", userId)
      .single();
    if (!company) return null;
    return {
      id: profile.user_id,
      role: "company",
      email: profile.email ?? "",
      name: company.name,
      description: company.description,
      website: company.website ?? undefined,
      industry: company.industry ?? undefined,
      avatarUrl: company.logo_url ?? undefined,
      createdAt: new Date(profile.created_at).getTime(),
    } satisfies Company;
  }

  const { data: dev } = await supabase
    .from("developers")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (!dev) return null;
  return {
    id: profile.user_id,
    role: "dev",
    email: profile.email ?? "",
    username: dev.username,
    bio: dev.bio ?? undefined,
    github: dev.github_handle ?? undefined,
    skills: dev.skills ?? [],
    avatarUrl: dev.avatar_url ?? undefined,
    createdAt: new Date(profile.created_at).getTime(),
  } satisfies Dev;
}

/**
 * Linear sign-up flow. The user fills the form on /app/auth, then clicks
 * "Create account" which:
 *   1. Saves the form data here (we can't insert yet — no Privy auth = no JWT).
 *   2. Triggers the Privy modal.
 *   3. Once Privy authenticates and `privy.user.id` is available, the
 *      hydration effect consumes the pending data and persists it.
 *
 * Stored as a ref-attached field so the consume-once semantics survive
 * re-renders without triggering them.
 */
type PendingRegistration =
  | { role: "company"; data: Omit<Company, "id" | "role" | "createdAt"> }
  | { role: "dev"; data: Omit<Dev, "id" | "role" | "createdAt"> };

function PrivyAuthInner({ children }: { children: ReactNode }) {
  const privy = usePrivy();
  const supabase = useMemo<DBClient>(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [hydrating, setHydrating] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const lastUserIdRef = useRef<string | null>(null);
  const pendingRef = useRef<PendingRegistration | null>(null);

  const clearPendingError = useCallback(() => setPendingError(null), []);

  // Step 1: register the Privy access-token getter with the Supabase bridge.
  // The supabase client uses `getSupabaseAccessToken()` on every request, so
  // this MUST happen before any authenticated query fires.
  useEffect(() => {
    if (!privy.ready) return;
    if (privy.authenticated) {
      registerPrivyTokenGetter(() => privy.getAccessToken());
    } else {
      clearPrivySession();
    }
  }, [privy.ready, privy.authenticated, privy]);

  // Step 2: hydrate User from Supabase once Privy is authenticated.
  //   - Returning user → loadUser fetches the existing profile.
  //   - First-time user with `pendingRef` → run the persist + reload.
  //   - First-time user without pendingRef → leave user null;
  //     `pendingOnboarding` flips true and the route layer sends them
  //     to /app/onboarding (fallback path; the wizard on /app/auth
  //     should populate pendingRef in the happy path).
  useEffect(() => {
    let cancelled = false;
    const privyId = privy.user?.id ?? null;

    if (!privy.ready) return;
    if (!privy.authenticated || !privyId) {
      lastUserIdRef.current = null;
      setUser(null);
      return;
    }
    // Avoid duplicate work if the same user is still authenticated and
    // already hydrated. Pending registrations always re-run.
    if (lastUserIdRef.current === privyId && user && !pendingRef.current) return;

    setHydrating(true);
    void (async () => {
      const pending = pendingRef.current;
      let u: User | null = await loadUser(supabase, privyId);

      if (!u && pending) {
        // First time the wallet hits Supabase — persist what the user
        // filled in on /app/auth, then re-load.
        try {
          if (pending.role === "company") {
            await persistCompanyRow(supabase, privyId, pending.data);
          } else {
            await persistDevRow(supabase, privyId, pending.data);
          }
          u = await loadUser(supabase, privyId);
          if (!cancelled) setPendingError(null);
        } catch (err) {
          console.error("[auth-privy] persist on auth failed:", err);
          if (!cancelled) {
            setPendingError(
              err instanceof Error
                ? err.message
                : "Could not save your profile. Please try again.",
            );
          }
        } finally {
          pendingRef.current = null;
        }
      }

      if (cancelled) return;
      lastUserIdRef.current = privyId;
      setUser(u);
      setHydrating(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privy.ready, privy.authenticated, privy.user?.id, supabase]);

  const refresh = useCallback(() => {
    const privyId = privy.user?.id ?? null;
    if (!privyId) return;
    setHydrating(true);
    void loadUser(supabase, privyId).then((u) => {
      setUser(u);
      setHydrating(false);
    });
  }, [supabase, privy.user?.id]);

  const loginByEmail = useCallback(async () => {
    privy.login();
    return null;
  }, [privy]);

  // Linear flow: caller fills the form on /app/auth, calls register*.
  //   - Already authed (returning user via /app/auth, no profile yet) →
  //     persist immediately and update user state.
  //   - Not authed (first-time signup) → stash the form data in
  //     `pendingRef` and pop the Privy modal. The hydration effect runs
  //     on the resulting authenticated event, sees the pending data,
  //     and finishes the persist + load.
  const registerCompany = useCallback(
    async (data: Omit<Company, "id" | "role" | "createdAt">): Promise<Company | null> => {
      setPendingError(null);
      if (!privy.authenticated) {
        pendingRef.current = { role: "company", data };
        privy.login();
        return null;
      }
      const privyId = privy.user?.id;
      if (!privyId) return null;
      await persistCompanyRow(supabase, privyId, data);
      const u = await loadUser(supabase, privyId);
      if (u && u.role === "company") setUser(u);
      return (u as Company) ?? null;
    },
    [supabase, privy],
  );

  const registerDev = useCallback(
    async (data: Omit<Dev, "id" | "role" | "createdAt">): Promise<Dev | null> => {
      setPendingError(null);
      if (!privy.authenticated) {
        pendingRef.current = { role: "dev", data };
        privy.login();
        return null;
      }
      const privyId = privy.user?.id;
      if (!privyId) return null;
      await persistDevRow(supabase, privyId, data);
      const u = await loadUser(supabase, privyId);
      if (u && u.role === "dev") setUser(u);
      return (u as Dev) ?? null;
    },
    [supabase, privy],
  );

  const updateUser = useCallback(
    async (patch: Partial<User>) => {
      const current = user;
      if (!current) return;
      setUser({ ...current, ...patch } as User);

      const profilePatch: { email?: string | null } = {};
      if (patch.email !== undefined && patch.email !== current.email) {
        profilePatch.email = patch.email || null;
      }
      if (Object.keys(profilePatch).length > 0) {
        await supabase.from("profiles").update(profilePatch).eq("user_id", current.id);
      }

      if (current.role === "company") {
        const c = patch as Partial<Company>;
        const upd: Partial<Database["public"]["Tables"]["companies"]["Update"]> = {};
        if (c.name !== undefined) {
          upd.name = c.name;
          upd.slug = slugify(c.name) || current.id.slice(-8);
        }
        if (c.description !== undefined) upd.description = c.description;
        if (c.website !== undefined) upd.website = c.website ?? null;
        if (c.industry !== undefined) upd.industry = c.industry ?? null;
        if (c.avatarUrl !== undefined) upd.logo_url = c.avatarUrl ?? null;
        if (Object.keys(upd).length > 0) {
          await supabase.from("companies").update(upd).eq("user_id", current.id);
        }
      } else {
        const d = patch as Partial<Dev>;
        const upd: Partial<Database["public"]["Tables"]["developers"]["Update"]> = {};
        if (d.username !== undefined) upd.username = d.username;
        if (d.github !== undefined) upd.github_handle = d.github ?? null;
        if (d.bio !== undefined) upd.bio = d.bio ?? null;
        if (d.skills !== undefined) upd.skills = d.skills;
        if (d.avatarUrl !== undefined) upd.avatar_url = d.avatarUrl ?? null;
        if (Object.keys(upd).length > 0) {
          await supabase.from("developers").update(upd).eq("user_id", current.id);
        }
      }
    },
    [supabase, user],
  );

  const logout = useCallback(async () => {
    await privy.logout();
    clearPrivySession();
    setUser(null);
  }, [privy]);

  // True only once the Privy session is live, the bridge has had a chance
  // to mint, and Supabase still returned no profile. The route layer uses
  // this to choose between /app/auth and /app/onboarding.
  const pendingOnboarding = privy.ready && privy.authenticated && !hydrating && !user;

  return (
    <AuthCtx.Provider
      value={{
        user,
        // Considered ready once Privy resolved AND any in-flight profile
        // fetch finished. Otherwise pages would briefly render with user=null
        // for returning users while we hydrate from Supabase.
        ready: privy.ready && !hydrating,
        pendingOnboarding,
        pendingError,
        clearPendingError,
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
        // Both flows are supported. Wallet shows up first because the
        // PrivyProvider config sets `showWalletLoginFirst: true`. Users
        // who only have email get a magic-link / OTP path; their Privy
        // DID still uniquely identifies them, and the bridge route
        // doesn't care how they authenticated.
        loginMethods: ["email", "wallet"],
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
