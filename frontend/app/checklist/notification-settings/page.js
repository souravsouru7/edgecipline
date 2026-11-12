"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The checklist reminder now lives in Settings. This route stays so old links
// and installed app builds that open it still land in the right place.
export default function ChecklistNotificationSettingsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings/checklist-reminder");
  }, [router]);
  return null;
}
