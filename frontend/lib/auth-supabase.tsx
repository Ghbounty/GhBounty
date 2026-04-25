"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
import type { Database } from "./db.types";
import type { Company, Dev, User } from "./types";
import { AuthCtx } from "./auth-context";

type DBClient = SupabaseClient<Database>;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
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
      email: profile.email,
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
    email: profile.email,
    username: dev.username,
    bio: dev.bio ?? undefined,
    github: dev.github_handle ?? undefined,
    skills: dev.skills ?? [],
    avatarUrl: dev.avatar_url ?? undefined,
    createdAt: new Date(profile.created_at).getTime(),
  } satisfies Dev;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo<DBClient>(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const userIdRef = useRef<string | null>(null);

  const hydrate = useCallback(
    async (userId: string | null) => {
      userIdRef.current = userId;
      if (!userId) {
        setUser(null);
        return;
      }
      const u = await loadUser(supabase, userId);
      setUser(u);
    },
    [supabase],
  );

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled) return;
      await hydrate(session?.user?.id ?? null);
      if (!cancelled) setReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (cancelled) return;
        await hydrate(session?.user?.id ?? null);
      },
    );
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase, hydrate]);

  const refresh = useCallback(() => {
    if (userIdRef.current) void hydrate(userIdRef.current);
  }, [hydrate]);

  const loginByEmail = useCallback(
    async (email: string, password?: string) => {
      if (!password) return null;
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.user) return null;
      const u = await loadUser(supabase, data.user.id);
      if (u) setUser(u);
      return u;
    },
    [supabase],
  );

  const registerCompany = useCallback(
    async (
      data: Omit<Company, "id" | "role" | "createdAt">,
      password?: string,
    ): Promise<Company | null> => {
      if (!password) throw new Error("Password is required");
      const { data: signUp, error: signUpErr } = await supabase.auth.signUp({
        email: data.email,
        password,
      });
      if (signUpErr) throw new Error(signUpErr.message);
      if (!signUp.user) throw new Error("signUp returned no user");
      const userId = signUp.user.id;

      // If email confirm is required, session is null. The auth row exists
      // but we cannot insert into RLS-protected tables until they sign in.
      if (!signUp.session) return null;

      const { error: profileErr } = await supabase.from("profiles").insert({
        user_id: userId,
        role: "company",
        email: data.email,
      });
      if (profileErr) throw new Error(profileErr.message);

      const { error: companyErr } = await supabase.from("companies").insert({
        user_id: userId,
        name: data.name,
        slug: slugify(data.name) || userId.slice(0, 8),
        description: data.description,
        website: data.website ?? null,
        industry: data.industry ?? null,
        logo_url: data.avatarUrl ?? null,
      });
      if (companyErr) throw new Error(companyErr.message);

      const u = await loadUser(supabase, userId);
      if (u && u.role === "company") setUser(u);
      return (u as Company) ?? null;
    },
    [supabase],
  );

  const registerDev = useCallback(
    async (
      data: Omit<Dev, "id" | "role" | "createdAt">,
      password?: string,
    ): Promise<Dev | null> => {
      if (!password) throw new Error("Password is required");
      const { data: signUp, error: signUpErr } = await supabase.auth.signUp({
        email: data.email,
        password,
      });
      if (signUpErr) throw new Error(signUpErr.message);
      if (!signUp.user) throw new Error("signUp returned no user");
      const userId = signUp.user.id;

      if (!signUp.session) return null;

      const { error: profileErr } = await supabase.from("profiles").insert({
        user_id: userId,
        role: "dev",
        email: data.email,
      });
      if (profileErr) throw new Error(profileErr.message);

      const { error: devErr } = await supabase.from("developers").insert({
        user_id: userId,
        username: data.username,
        github_handle: data.github ?? null,
        bio: data.bio ?? null,
        skills: data.skills,
        avatar_url: data.avatarUrl ?? null,
      });
      if (devErr) throw new Error(devErr.message);

      const u = await loadUser(supabase, userId);
      if (u && u.role === "dev") setUser(u);
      return (u as Dev) ?? null;
    },
    [supabase],
  );

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, [supabase]);

  const updateUser = useCallback(
    async (patch: Partial<User>) => {
      const current = user;
      if (!current) return;
      // optimistic
      setUser({ ...current, ...patch } as User);

      const profilePatch: { email?: string } = {};
      if (patch.email && patch.email !== current.email) profilePatch.email = patch.email;
      if (Object.keys(profilePatch).length > 0) {
        await supabase.from("profiles").update(profilePatch).eq("user_id", current.id);
      }

      if (current.role === "company") {
        const c = patch as Partial<Company>;
        const upd: Partial<Database["public"]["Tables"]["companies"]["Update"]> = {};
        if (c.name !== undefined) {
          upd.name = c.name;
          upd.slug = slugify(c.name) || current.id.slice(0, 8);
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
