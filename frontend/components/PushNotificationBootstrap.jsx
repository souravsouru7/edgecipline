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

    const init = () => {
      if (cancelled) return;
      import("@/services/pushNotifications")
        .then(({ initializePushNotifications }) => initializePushNotifications())
        .catch((error) => {
          console.error("Push notification initialization failed", error);
        });
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
