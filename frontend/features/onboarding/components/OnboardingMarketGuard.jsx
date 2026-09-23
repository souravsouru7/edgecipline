"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getOnboardingState } from "@/features/onboarding/api/onboardingApi";
import { getCanonicalOnboardingPath } from "@/features/onboarding/utils/onboardingMarketRouting.mjs";

const INDIAN_MARKET = "Indian_Market";
const FOREX = "Forex";

export default function OnboardingMarketGuard({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onboardingMode = searchParams?.get("onboarding") === "1";
  const queryString = searchParams?.toString() || "";

  // Shares the wizard's cache key on purpose. It used to force
  // staleTime: 0 + refetchOnMount: "always", which threw away the state the
  // wizard had just fetched and made every hop into a setup or upload page
  // wait on a fresh request behind a full-screen placeholder. A few seconds
  // of reuse is plenty: the only thing read here is preferredMarket, which
  // the user has just chosen and cannot change from these pages.
  const marketQuery = useQuery({
    queryKey: ["onboarding", "state"],
    queryFn: ({ signal }) => getOnboardingState(signal),
    enabled: onboardingMode,
    staleTime: 15 * 1000,
    retry: 1,
  });

  const preferredMarket = marketQuery.data?.preferredMarket;
  const hasKnownMarket = preferredMarket === FOREX || preferredMarket === INDIAN_MARKET;
  const canonicalPath = hasKnownMarket
    ? getCanonicalOnboardingPath(pathname, preferredMarket)
    : pathname;
  const shouldRedirect = onboardingMode && hasKnownMarket && canonicalPath !== pathname;

  useEffect(() => {
    if (!shouldRedirect) return;
    router.replace(`${canonicalPath}${queryString ? `?${queryString}` : ""}`);
  }, [canonicalPath, queryString, router, shouldRedirect]);

  if (!onboardingMode) return children;

  if (marketQuery.isError) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F0EEE9", color: "#0F1923", fontFamily: "var(--font-plus-jakarta-sans)" }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <p style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700 }}>Could not verify your selected market.</p>
          <button
            type="button"
            onClick={() => marketQuery.refetch()}
            disabled={marketQuery.isFetching}
            style={{ border: 0, borderRadius: 8, padding: "10px 16px", background: "#0D9E6E", color: "#FFFFFF", fontSize: 12, fontWeight: 800, cursor: "pointer" }}
          >
            {marketQuery.isFetching ? "Checking..." : "Try again"}
          </button>
        </div>
      </main>
    );
  }

  // Only the FIRST load can have no answer yet. A cached one resolves in the
  // same tick, so this placeholder stops flashing between onboarding pages.
  if (marketQuery.isPending || shouldRedirect) {
    return (
      <main
        role="status"
        aria-live="polite"
        style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F0EEE9", fontFamily: "var(--font-plus-jakarta-sans)" }}
      >
        <div style={{ display: "grid", gap: 12, justifyItems: "center" }}>
          <span
            aria-hidden="true"
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              border: "2px solid rgba(13,158,110,0.25)",
              borderTopColor: "#0D9E6E",
              animation: "marketGuardSpin 0.8s linear infinite",
            }}
          />
          <p style={{ margin: 0, color: "#64748B", fontSize: 13, fontWeight: 700 }}>Opening your market…</p>
        </div>
        <style>{`
          @keyframes marketGuardSpin { to { transform: rotate(360deg); } }
          @media (prefers-reduced-motion: reduce) {
            [style*="marketGuardSpin"] { animation: none !important; }
          }
        `}</style>
      </main>
    );
  }

  return children;
}
