"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { initializePushNotifications } from "@/services/pushNotifications";
import PushNotificationToast from "@/components/PushNotificationToast";

export default function PushNotificationBootstrap() {
  const router = useRouter();

  useEffect(() => {
    initializePushNotifications().catch((error) => {
      console.error("Push notification initialization failed", error);
    });
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
