"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import { getAnalyticsSnapshot } from "@/services/analyticsApi";
import IndianMarketHeader from "@/components/IndianMarketHeader";
import IndianMarketLoadingState from "@/components/IndianMarketLoadingState";
import { MARKETS } from "@/context/MarketContext";
import AICoachFeedWidget from "@/features/ai-coach/components/AICoachFeedWidget";

// Indian counterpart of /analytics/ai-coach: the coach feed gets its own
// destination instead of being buried at the bottom of the analytics page, so
// the dashboard's "View Coaching" card lands somewhere dedicated.
const theme = {
  primary: "#0D9E6E",
  secondary: "#0F1923",
  muted: "#94A3B8",
  border: "#E2E8F0",
  card: "#FFFFFF"
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
    <div
      style={{
        minHeight: "100vh",
        background: "#F4F2EE",
        fontFamily: "'Plus Jakarta Sans',sans-serif",
        color: theme.primary
      }}
    >
      <IndianMarketHeader />

      <main style={{ padding: "28px 24px", maxWidth: 1200, width: "100%", boxSizing: "border-box", margin: "0 auto" }}>
        <div className="indian-analytics-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: theme.secondary, letterSpacing: "-0.02em", margin: 0 }}>AI Coach Feed</h1>
            <p style={{ fontSize: 12, color: theme.muted, fontFamily: "'JetBrains Mono',monospace", margin: "4px 0 0", letterSpacing: "0.04em" }}>
              Insights generated from your actual trading data
            </p>
          </div>
          <Link href="/indian-market/analytics" style={{ fontSize: 12, color: theme.secondary, border: `1px solid ${theme.border}`, borderRadius: 8, padding: "8px 14px", textDecoration: "none", fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, background: "#FFFFFF" }}>
            Analytics
          </Link>
        </div>

        {/* Instrument type tab bar */}
        <div className="indian-analytics-tabs" style={{ display: "flex", gap: 4, marginBottom: 24, borderRadius: 10, border: `1px solid ${theme.border}`, width: "fit-content", padding: 4, background: "#FFFFFF" }}>
          {[{ v: "OPTION", label: "Options Analytics" }, { v: "EQUITY", label: "Intraday Stocks" }].map(({ v, label }) => (
            <button
              key={v}
              type="button"
              onClick={() => setInstrumentType(v)}
              style={{
                padding: "8px 16px",
                border: "none",
                borderRadius: 7,
                background: instrumentType === v ? theme.secondary : "transparent",
                color: instrumentType === v ? "#FFFFFF" : theme.muted,
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.15s",
                fontFamily: "'Plus Jakarta Sans',sans-serif"
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <IndianMarketLoadingState
            title="Loading AI Coach Feed"
            subtitle="Reading your recent trades, rules and reflections"
          />
        ) : (
          <AICoachFeedWidget feed={coachFeed} loading={false} currency="₹" market="Indian_Market" />
        )}
      </main>
    </div>
  );
}
