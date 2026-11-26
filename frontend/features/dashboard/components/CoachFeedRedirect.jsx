"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Placeholder } from "@/features/shared/components/ui";

// The AI Coach Feed now lives on Home. Old links (bookmarks, notification
// taps, other screens) still resolve: these routes forward to Home's feed.
export default function CoachFeedRedirect({ indian = false }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(`${indian ? "/indian-market/dashboard" : "/dashboard"}#coach-feed`);
  }, [indian, router]);
  return (
    <div className="ec-app ec-home" style={{ padding: 16 }} aria-busy="true">
      <Placeholder height={160} radius={20} />
    </div>
  );
}
