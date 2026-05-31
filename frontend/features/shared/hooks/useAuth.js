"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getValidToken } from "@/utils/auth";
import { silentRefresh } from "@/services/apiClient";

/**
 * useAuth
 * Redirects to /login only after attempting a silent token refresh.
 * On page refresh the in-memory token is always empty, so always try
 * the httpOnly refresh cookie first before giving up.
 */
export function useAuth() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const checkAuth = async () => {
      if (!getValidToken()) {
        const token = await silentRefresh();
        if (cancelled) return;
        if (!token) router.replace("/login");
      }
    };
    checkAuth();
    return () => { cancelled = true; };
  }, [router]);
}
