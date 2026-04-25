/**
 * Data access layer that branches between mock (localStorage) and
 * real Supabase queries based on NEXT_PUBLIC_USE_SUPABASE.
 *
 * Components consume async functions from here and don't care about the
 * backend. Add new queries here as we migrate features.
 */

import type { Company } from "./types";
import { useSupabaseBackend } from "./auth-context";
import { loadUsers } from "./store";
import { createClient } from "@/utils/supabase/client";

type CompanyRow = {
  user_id: string;
  name: string;
  slug: string;
  description: string;
  website: string | null;
  industry: string | null;
  logo_url: string | null;
  profile: { email: string; created_at: string } | null;
};

function rowToCompany(row: CompanyRow): Company {
  return {
    id: row.user_id,
    role: "company",
    email: row.profile?.email ?? "",
    name: row.name,
    description: row.description,
    website: row.website ?? undefined,
    industry: row.industry ?? undefined,
    avatarUrl: row.logo_url ?? undefined,
    createdAt: row.profile?.created_at
      ? new Date(row.profile.created_at).getTime()
      : Date.now(),
  };
}

export async function fetchCompanies(): Promise<Company[]> {
  if (!useSupabaseBackend) {
    return loadUsers().filter((u): u is Company => u.role === "company");
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("companies")
    .select(
      "user_id, name, slug, description, website, industry, logo_url, profile:profiles!inner(email, created_at)",
    )
    .returns<CompanyRow[]>();
  if (error) {
    console.error("[fetchCompanies]", error);
    return [];
  }
  return (data ?? []).map(rowToCompany);
}

export async function fetchCompany(id: string): Promise<Company | null> {
  if (!useSupabaseBackend) {
    return (
      (loadUsers().find((u) => u.role === "company" && u.id === id) as
        | Company
        | undefined) ?? null
    );
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("companies")
    .select(
      "user_id, name, slug, description, website, industry, logo_url, profile:profiles!inner(email, created_at)",
    )
    .eq("user_id", id)
    .single<CompanyRow>();
  if (error) {
    console.error("[fetchCompany]", error);
    return null;
  }
  return data ? rowToCompany(data) : null;
}
