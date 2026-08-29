"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { recordPromoTouch } from "@/services/api";
import { getAttributionId } from "@/features/promotions/lib/attribution";

export default function ReferralLandingPage() {
  const params = useParams();
  const router = useRouter();
  const slug = String(params?.slug || "");

  useEffect(() => {
    const anonymousId = getAttributionId();
    recordPromoTouch({
      anonymousId,
      ref: slug,
      landingPath: `/r/${slug}`,
    }).finally(() => {
      router.replace(`/register?ref=${encodeURIComponent(slug)}`);
    });
  }, [slug, router]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F0EEE9", fontFamily: "'Plus Jakarta Sans', sans-serif", color: "#64748B" }}>
      Taking you to Edgecipline…
    </div>
  );
}
