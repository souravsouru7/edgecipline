"use client";

import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { signOutFirebase } from "@/services/firebaseAuth";
import apiClient, { publishAuthLogout } from "@/services/apiClient";
import { clearAuthToken } from "@/utils/auth";
import { onUserLoggedOut } from "@/services/pushNotifications";
import { finishSignOutOverlay, startSignOutOverlay } from "@/features/auth/signOutOverlay";

// Each remote/plugin step gets this long; a slow server or plugin must never
// hold the user on a screen they asked to leave.
const STEP_TIMEOUT_MS = 2500;
// Shortest time the overlay shows, so a fast sign-out reads as a transition
// rather than a flicker.
const MIN_OVERLAY_MS = 450;

const capped = (promise) =>
  Promise.race([
    Promise.resolve(promise).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, STEP_TIMEOUT_MS)),
  ]);

// Full sign-out, shared by the header, the avatar drawer and the sidebar.
export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const runningRef = useRef(false);

  return useCallback(async () => {
    if (runningRef.current) return; // ignore double taps
    runningRef.current = true;
    startSignOutOverlay(); // instant feedback
    const startedAt = Date.now();

    try {
      // Push unregister and the server logout need the token, so they run
      // first, together, each capped.
      await Promise.all([
        capped(onUserLoggedOut()),
        capped(apiClient.post("/auth/logout")),
      ]);

      // Local teardown: the session is gone on this device before we leave.
      await queryClient.cancelQueries();
      queryClient.clear();
      await clearAuthToken();
      publishAuthLogout("explicit_logout");
      await capped(signOutFirebase());

      const wait = MIN_OVERLAY_MS - (Date.now() - startedAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

      // The login page finishes the overlay once its form is painted.
      router.replace("/login");
    } catch {
      // Never strand the user behind the overlay.
      finishSignOutOverlay();
      router.replace("/login");
    } finally {
      runningRef.current = false;
    }
  }, [router, queryClient]);
}
