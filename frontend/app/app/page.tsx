"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function AppIndex() {
  const { user, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace("/app/auth");
    } else if (user.role === "company") {
      router.replace("/app/company");
    } else {
      router.replace("/app/dev");
    }
  }, [ready, user, router]);

  return (
    <div className="app-loading">
      <span className="loading-dot" />
    </div>
  );
}
