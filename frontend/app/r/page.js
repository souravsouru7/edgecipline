"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { recordPromoTouch } from "@/services/api";
import { getAttributionId } from "@/features/promotions/lib/attribution";

/**
 * Referral / promo short-link landing.
 *
 * Query-param routing (`/r?ref=`) rather than a `[slug]` segment because the web
 * build is a static export — a dynamic segment would need generateStaticParams
 * and could not serve a slug created after the build. Same pattern as
 * /support/article. A `/r/<slug>` path is still honoured when a CDN rewrite
 * lands it here (the slug is read from the pathname as a fallback). The backend
 * also serves `/api/promotions/r/:slug` for server-side redirects.
 */

function readSlug(searchParams, pathname) {
  const fromQuery = String(searchParams?.get("ref") || "").trim();
  if (fromQuery) return fromQuery;
  const match = String(pathname || "").match(/^\/r\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function ReferralLanding() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const slug = readSlug(searchParams, pathname);

  useEffect(() => {
    if (!slug) {
      router.replace("/register");
      return;
    }
    const anonymousId = getAttributionId();
    recordPromoTouch({
      anonymousId,
      ref: slug,
      landingPath: `/r/${slug}`,
    }).finally(() => {
      router.replace(`/register?ref=${encodeURIComponent(slug)}`);
    });
  }, [slug, router]);

  return <Waiting />;
}

function Waiting() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F0EEE9", fontFamily: "'Plus Jakarta Sans', sans-serif", color: "#64748B" }}>
      Taking you to Edgecipline…
    </div>
  );
}

export default function ReferralLandingPage() {
  return (
    <Suspense fallback={<Waiting />}>
      <ReferralLanding />
    </Suspense>
  );
}
