"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// This page moved to /settings so the URL matches what the nav has always
// called it. Kept as a redirect rather than deleted: old bookmarks, any
// links already sent to users, and the coach's "?section=billing" deep link
// must not start 404ing.
//
// The app is a static export, so next.config redirects are ignored — this has
// to happen client-side.
function ProfileRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const query = searchParams?.toString();
    router.replace(query ? `/settings?${query}` : "/settings");
  }, [router, searchParams]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#F0EEE9",
        fontFamily: "'Plus Jakarta Sans',sans-serif",
        fontSize: 13,
        color: "#64748B",
      }}
    >
      Taking you to Settings...
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense>
      <ProfileRedirect />
    </Suspense>
  );
}
