"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { signOutFirebase } from "@/services/firebaseAuth";
import apiClient, { publishAuthLogout } from "@/services/apiClient";
import { clearAuthToken } from "@/utils/auth";
import { onUserLoggedOut } from "@/services/pushNotifications";

// Full sign-out, shared by the header, the avatar drawer and the sidebar.
export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await onUserLoggedOut();
    try { await apiClient.post("/auth/logout"); } catch {}
    queryClient.clear();
    await clearAuthToken();
    publishAuthLogout("explicit_logout");
    await signOutFirebase();
    router.replace("/login");
  }, [router, queryClient]);
}
