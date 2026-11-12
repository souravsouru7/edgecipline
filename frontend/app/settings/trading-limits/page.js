"use client";

import { useCallback, useEffect, useState } from "react";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import PageHeader from "@/features/shared/components/PageHeader";
import { Card, ErrorState, Placeholder } from "@/features/shared/components/ui";
import RiskLimitsForm from "@/features/settings/components/RiskLimitsForm";
import { MARKET_META } from "@/features/settings/utils/riskLimits";
import { getRiskLimits } from "@/services/riskLimitsApi";
import { useTheme } from "@/utils/theme";
import { useSystemBars } from "@/features/shared/hooks/useSystemBars";

// Daily loss limit and max trades per day, per market. The server's trade
// alerts (backend/services/smartNotificationEvaluator.js) and the "Protect
// Your Daily Limit" mission read these values.
export default function TradingLimitsPage() {
  const { ready } = useRequireAuth();
  const { theme } = useTheme();
  useSystemBars(theme);
  const [limits, setLimits] = useState(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      setLimits(await getRiskLimits());
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  return (
    <div className="ec-app ec-home">
      <PageHeader themed title="Trading limits" showMarketSwitcher={false} />
      <main className="ec-page" style={{ maxWidth: 760 }}>
        <h1 className="ec-guide__title" style={{ marginBottom: 6 }}>Trading limits</h1>
        <p className="ec-guide__lead" style={{ marginBottom: 24, fontSize: "var(--ec-fs-3)" }}>
          Your own rules for each day. We alert you at 80% and 100% of your daily loss limit (net of wins), and when you reach your max trades. Leave a box blank to turn it off.
        </p>

        {loadError ? (
          <Card><ErrorState title="Couldn't load your limits" onRetry={load} /></Card>
        ) : !limits ? (
          <div style={{ display: "grid", gap: 12 }}>
            <Placeholder height={180} radius={16} />
            <Placeholder height={180} radius={16} />
          </div>
        ) : (
          <div style={{ display: "grid", gap: 20 }}>
            {Object.keys(MARKET_META).map((market) => (
              <section key={market} aria-label={MARKET_META[market].label}>
                <h2 className="ec-dash__eyebrow" style={{ margin: "0 0 8px 4px" }}>{MARKET_META[market].label}</h2>
                <Card>
                  <RiskLimitsForm
                    market={market}
                    initial={limits[market]}
                    onSaved={(updated) => { if (updated && typeof updated === "object") setLimits(updated); }}
                  />
                </Card>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
