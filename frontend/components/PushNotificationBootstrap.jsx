"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import PushNotificationToast from "@/components/PushNotificationToast";

export default function PushNotificationBootstrap() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let idleId = null;
    let timerId = null;

    // initializePushNotifications() calls PushNotifications.requestPermissions(),
    // which raises the OS notification dialog. Only do that for a user who is
    // already signed in — otherwise a first-time user is asked to allow
    // notifications on the login screen, before they know what the app is.
    // Freshly registered users get this via useLogin, which initialises push
    // once authentication succeeds.
    const init = async () => {
      if (cancelled) return;
      try {
        const { hydrateAuthToken } = await import("@/utils/auth");
        const token = await hydrateAuthToken();
        if (cancelled || !token) return;

        const { initializePushNotifications } = await import("@/services/pushNotifications");
        await initializePushNotifications();
      } catch (error) {
        console.error("Push notification initialization failed", error);
      }
    };

    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(init, { timeout: 3500 });
    } else {
      timerId = window.setTimeout(init, 1600);
    }

    return () => {
      cancelled = true;
      if (idleId != null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timerId != null) window.clearTimeout(timerId);
    };
  }, []);

  useEffect(() => {
    const handleRoute = (event) => {
      const target = event.detail?.target || "/dashboard";
      router.push(target);
    };

    window.addEventListener("edgecipline:notification-route", handleRoute);
    return () => window.removeEventListener("edgecipline:notification-route", handleRoute);
  }, [router]);

  return <PushNotificationToast />;
}
