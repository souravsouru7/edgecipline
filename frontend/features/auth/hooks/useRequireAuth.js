"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getValidToken } from "@/utils/auth";
import { silentRefresh } from "@/services/apiClient";

/**
 * Drop-in auth guard for protected pages.
 *
 * On first load the memory token is always empty (JS module state resets on
 * every page refresh). Rather than immediately bouncing the user to /login —
 * which then blindly redirects to /dashboard — this hook tries a silent
 * refresh first. If the httpOnly refresh cookie is still valid the user stays
 * on the current page. Only if refresh also fails do we redirect to /login.
 *
 * Returns { ready: boolean } — render nothing (or a loader) while ready===false.
 */
export function useRequireAuth() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (getValidToken()) {
        if (!cancelled) setReady(true);
        return;
      }

      const newToken = await silentRefresh();
      if (cancelled) return;

      if (newToken) {
        setReady(true);
      } else {
        router.replace("/login");
      }
    };

    check();
    return () => { cancelled = true; };
  }, [router]);

  return { ready };
}
