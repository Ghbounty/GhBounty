"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function AppIndex() {
  const { user, ready, pendingOnboarding } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    if (pendingOnboarding) {
      // Privy authed but no profile row yet — send through the role-picker
      // signup so they end up on the dedicated dev/company form.
      router.replace("/app/auth/signup");
      return;
    }
    if (!user) {
      router.replace("/app/auth");
    } else if (user.role === "company") {
      router.replace("/app/company");
    } else {
      router.replace("/app/dev");
    }
  }, [ready, user, pendingOnboarding, router]);

  return (
    <div className="app-loading">
      <span className="loading-dot" />
    </div>
  );
}
