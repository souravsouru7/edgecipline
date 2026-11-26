"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getTrade } from "@/services/tradeApi";
import PageHeader from "@/features/shared/components/PageHeader";
import TradeEvidenceGallery from "@/features/trade/components/TradeEvidenceGallery";
import { StatCard } from "@/features/shared/components/ui";
import { useTheme } from "@/utils/theme";
import { useSystemBars } from "@/features/shared/hooks/useSystemBars";
import { getTradeMoment } from "@/features/journal/utils/groupByDay";
import { tradeMistake } from "@/features/journal/utils/tradeDisplay";
import {
  DetailHero, DetailLoading, DetailNotFound, DetailRows, DetailSection, DetailTopBar,
  MoodDots, PriceLadder, Quote, RuleResults, ScoreMeter, TagList,
} from "@/features/trade/components/TradeDetailParts";
import { parseRiskReward } from "@/features/trade/lib/tradeValidation";

function formatMoment(trade) {
  const m = getTradeMoment(trade);
  if (!m) return null;
  const date = m.hasTime
    ? m.date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    : m.date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return m.hasTime ? `${date}, ${m.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : date;
}

function TradeDetailContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const { theme } = useTheme();
  useSystemBars(theme);
  const [trade, setTrade] = useState(null);
  const [error, setError] = useState(null);

  const fetchTrade = useCallback(async () => {
    if (!id) { setError({ status: 404 }); return; }
    try {
      setTrade(await getTrade(id));
    } catch (err) {
      setError(err);
    }
  }, [id]);

  useEffect(() => { fetchTrade(); }, [fetchTrade]);

  let body;
  if (error) body = <DetailNotFound status={error.status} backHref="/trades" />;
  else if (!trade) body = <DetailLoading />;
  else {
    // Stored as BUY/SELL; shown as Long/Short like the journal list.
    const long = ["BUY", "LONG"].includes(String(trade.type || "").toUpperCase());
    const profit = trade.profit != null && Number.isFinite(parseFloat(trade.profit)) ? parseFloat(trade.profit) : null;
    const entry = parseFloat(trade.entryPrice), sl = parseFloat(trade.stopLoss), tp = parseFloat(trade.takeProfit);
    const rr = Number.isFinite(entry) && Number.isFinite(sl) && Number.isFinite(tp) && entry !== sl
      ? Math.abs((tp - entry) / (entry - sl)).toFixed(2)
      : null;
    // A legacy custom value that isn't a ratio (e.g. "ssd") shows as —.
    const plannedRR = trade.riskRewardRatio === "custom"
      ? (parseRiskReward(trade.riskRewardCustom).value || null)
      : trade.riskRewardRatio;
    const mistake = tradeMistake(trade);
    const score = trade.setupScore != null && Number.isFinite(Number(trade.setupScore)) ? Number(trade.setupScore) : null;
    const entryBasis = trade.entryBasis === "Custom" ? (trade.entryBasisCustom || "Custom") : trade.entryBasis;
    const hasReview = trade.mood || trade.confidence || entryBasis || trade.wouldRetake || trade.emotionalTags?.length || mistake || trade.lesson;
    const hasEvidence = trade.screenshot || trade.tradeImages?.length > 0;

    body = (
      <>
        <DetailHero
          symbol={trade.pair || "—"}
          long={long}
          sideLabel={long ? "Long" : "Short"}
          dateText={formatMoment(trade)}
          meta={[trade.session ? `${trade.session} session` : null]}
          profit={profit}
          currency="USD"
          badges={mistake ? <span className="ec-badge ec-badge--warning">{mistake}</span> : null}
        />

        <div className="ec-detail__kpis">
          <StatCard label="Lot size" value={trade.lotSize ?? "—"} />
          <StatCard label="Risk : reward" value={rr ? `1 : ${rr}` : plannedRR || "—"} hint={rr ? "From stop and target" : plannedRR ? "Planned" : undefined} />
          <StatCard label="Checklist" value={score != null ? `${Math.round(score)}%` : "—"} hint={score != null ? (score >= 80 ? "A+ setup" : score >= 50 ? "Partly followed" : "Rules skipped") : "Not scored"} />
          <StatCard label="Strategy" value={trade.setup || trade.strategy || "—"} />
        </div>

        <div className="ec-detail__grid">
          <div className="ec-detail__col">
            <DetailSection title="Prices">
              <PriceLadder entry={trade.entryPrice} exit={trade.exitPrice} stopLoss={trade.stopLoss} takeProfit={trade.takeProfit} long={long} />
              <DetailRows rows={[
                { label: "Planned R:R", value: plannedRR, mono: true },
                { label: "Session", value: trade.session },
              ]} />
            </DetailSection>

            {(score != null || trade.setupRules?.length > 0) && (
              <DetailSection title="Checklist">
                {score != null && <ScoreMeter score={score} />}
                <RuleResults rules={trade.setupRules} />
              </DetailSection>
            )}

            {hasEvidence && (
              <DetailSection title="Screenshots">
                <TradeEvidenceGallery images={trade.tradeImages || []} legacyScreenshot={trade.screenshot} title="" />
              </DetailSection>
            )}
          </div>

          <div className="ec-detail__col">
            <DetailSection title="Review">
              {hasReview ? (
                <>
                  <DetailRows rows={[
                    { label: "Entry basis", value: entryBasis, tone: trade.entryBasis === "Plan" ? "up" : ["Emotion", "Impulsive"].includes(trade.entryBasis) ? "down" : null },
                    { label: "Mood", value: trade.mood ? <MoodDots value={trade.mood} /> : null },
                    { label: "Confidence", value: trade.confidence, tone: trade.confidence === "High" ? "up" : trade.confidence === "Overconfident" ? "down" : null },
                    { label: "Would retake?", value: trade.wouldRetake, tone: trade.wouldRetake === "Yes" ? "up" : trade.wouldRetake ? "down" : null },
                    { label: "Mistake", value: mistake, tone: "warn" },
                  ]} />
                  {trade.emotionalTags?.length > 0 && (
                    <div className="ec-detail__block"><span className="ec-detail__label">Emotions</span><TagList tags={trade.emotionalTags} /></div>
                  )}
                  {trade.lesson && (
                    <div className="ec-detail__block"><span className="ec-detail__label">Lesson</span><Quote>{trade.lesson}</Quote></div>
                  )}
                </>
              ) : (
                <p className="ec-detail__empty">No review yet. Edit the trade to add your mood, mistakes and the lesson.</p>
              )}
            </DetailSection>

            <DetailSection title="Notes">
              {trade.notes ? <Quote>{trade.notes}</Quote> : <p className="ec-detail__empty">No notes for this trade.</p>}
            </DetailSection>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="ec-app ec-home">
      <PageHeader themed showMarketSwitcher={false} title="Trade" />
      <main className="ec-page ec-detail">
        <DetailTopBar backHref="/trades" editHref={trade && id ? `/trades/edit?id=${id}` : null} />
        {body}
      </main>
    </div>
  );
}

export default function TradeDetail() {
  return (
    <React.Suspense fallback={null}>
      <TradeDetailContent />
    </React.Suspense>
  );
}
