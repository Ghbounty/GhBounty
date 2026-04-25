"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import type { Role } from "@/lib/types";
import { AppNav } from "./AppNav";

export function Guard({
  role,
  children,
}: {
  role?: Role;
  children: React.ReactNode;
}) {
  const { user, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    if (!user) router.replace("/app/auth");
    else if (role && user.role !== role) {
      router.replace(user.role === "company" ? "/app/company" : "/app/dev");
    }
  }, [ready, user, role, router]);

  if (!ready || !user || (role && user.role !== role)) {
    return (
      <div className="app-loading">
        <span className="loading-dot" />
      </div>
    );
  }

  return (
    <>
      <AppNav />
      <main className="app-main">{children}</main>
    </>
  );
}
