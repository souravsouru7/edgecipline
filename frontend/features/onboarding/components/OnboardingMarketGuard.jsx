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

  const marketQuery = useQuery({
    queryKey: ["onboarding", "state"],
    queryFn: ({ signal }) => getOnboardingState(signal),
    enabled: onboardingMode,
    staleTime: 0,
    refetchOnMount: "always",
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

  if (marketQuery.isPending || shouldRedirect) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F0EEE9", color: "#64748B", fontFamily: "var(--font-plus-jakarta-sans)", fontSize: 13, fontWeight: 700 }}>
        Opening your selected market...
      </main>
    );
  }

  return children;
}
