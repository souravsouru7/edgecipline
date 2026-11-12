"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import { getAnalyticsSnapshot } from "@/services/analyticsApi";
import PageHeader from "@/features/shared/components/PageHeader";
import { Placeholder, SegmentedControl } from "@/features/shared/components/ui";
import { MARKETS } from "@/context/MarketContext";
import AICoachFeedWidget from "@/features/ai-coach/components/AICoachFeedWidget";

// Indian counterpart of /analytics/ai-coach: the coach feed gets its own
// destination instead of being buried at the bottom of the analytics page, so
// the dashboard's "View Coaching" card lands somewhere dedicated.
const theme = {
  primary: "var(--lg-green, #0D9E6E)",
  secondary: "var(--lg-ink, #0F1923)",
  muted: "var(--lg-muted, #94A3B8)",
  border: "var(--lg-line, #E2E8F0)",
  card: "var(--lg-card, #FFFFFF)"
};

export default function IndianAnalyticsAiCoachPage() {
  const { ready } = useRequireAuth();
  const [loading, setLoading] = useState(true);
  const [coachFeed, setCoachFeed] = useState(null);
  // The feed is derived from the snapshot, which is per instrument type —
  // keep the same switch the analytics page uses so the coaching matches
  // whichever book the trader is looking at.
  const [instrumentType, setInstrumentType] = useState("OPTION");

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    const fetchFeed = async () => {
      setLoading(true);
      try {
        const snapshot = await getAnalyticsSnapshot(MARKETS.INDIAN_MARKET, instrumentType, { period: "weekly" });
        if (!cancelled) setCoachFeed(snapshot?.coachFeed || null);
      } catch (error) {
        if (error?.status === 401 || error?.data?.errorCode === "AUTH_REQUIRED") return;
        console.warn("Failed to fetch Indian AI coach feed:", error?.message || error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchFeed();
    return () => { cancelled = true; };
  }, [ready, instrumentType]);

  return (
    <div className="ec-app ec-home">
      <PageHeader themed showMarketSwitcher title="AI coach" />

      <main className="ec-page ec-analytics">
        <div className="ec-log__head">
          <div style={{ minWidth: 0 }}>
            <h1 className="ec-log__title">AI coach feed</h1>
            <p className="ec-log__sub">Indian market · insights generated from your actual trading data</p>
          </div>
          <Link href="/indian-market/analytics" className="ec-psy__back ec-focusable" style={{ marginBottom: 0 }}>
            Analytics
          </Link>
        </div>

        <div style={{ marginBottom: 20 }}>
          <SegmentedControl
            mode="tabs"
            label="Instrument"
            value={instrumentType}
            onChange={setInstrumentType}
            options={[{ value: "OPTION", label: "Options" }, { value: "EQUITY", label: "Intraday stocks" }]}
          />
        </div>

        {loading ? (
          <div style={{ display: "grid", gap: 12 }} aria-busy="true">
            <Placeholder height={120} radius={16} />
            <Placeholder height={120} radius={16} />
            <Placeholder height={120} radius={16} />
          </div>
        ) : (
          <AICoachFeedWidget feed={coachFeed} loading={false} currency="₹" market="Indian_Market" />
        )}
      </main>
    </div>
  );
}
