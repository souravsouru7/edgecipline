"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { getTrade, updateTrade } from "@/services/tradeApi";
import { MARKETS } from "@/context/MarketContext";
import PageHeader from "@/features/shared/components/PageHeader";
import TradeEvidenceGallery from "@/features/trade/components/TradeEvidenceGallery";
import { Button, Money, StatCard, useToast } from "@/features/shared/components/ui";
import { reportUserError } from "@/utils/userMessage";
import { invalidateTradeDependentQueries } from "@/utils/queryInvalidation";
import { useTheme } from "@/utils/theme";
import { useSystemBars } from "@/features/shared/hooks/useSystemBars";
import { getTradeMoment } from "@/features/journal/utils/groupByDay";
import { tradeMistake } from "@/features/journal/utils/tradeDisplay";
import {
  DetailHero, DetailLoading, DetailNotFound, DetailRows, DetailSection, DetailTopBar,
  MoodDots, PriceLadder, Quote, RuleResults, ScoreMeter, TagList,
} from "@/features/trade/components/TradeDetailParts";
import { parseRiskReward } from "@/features/trade/lib/tradeValidation";

const num = (v) => (v != null && v !== "" && !isNaN(v) ? Number(v) : null);
const LOT_SIZES = { NIFTY: 25, "BANK NIFTY": 15, BANKNIFTY: 15, "FIN NIFTY": 25, FINNIFTY: 25, MIDCPNIFTY: 75, SENSEX: 10, BANKEX: 15 };

function formatMoment(trade) {
  const m = getTradeMoment(trade);
  if (!m) return null;
  const opts = { weekday: "short", day: "numeric", month: "short", year: "numeric" };
  if (!m.hasTime) return m.date.toLocaleDateString("en-IN", { ...opts, timeZone: "UTC" });
  return `${m.date.toLocaleDateString("en-IN", opts)}, ${m.date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}`;
}

function IndianTradeDetailContent() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { theme } = useTheme();
  useSystemBars(theme);
  const id = searchParams.get("id");
  const [trade, setTrade] = useState(null);
  const [error, setError] = useState(null);
  const [notesEdit, setNotesEdit] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  const fetchTrade = useCallback(async () => {
    if (!id) { setError({ status: 404 }); return; }
    try {
      const data = await getTrade(id, MARKETS.INDIAN_MARKET);
      setTrade(data);
      setNotesEdit(data?.notes || "");
    } catch (err) {
      setError(err);
    }
  }, [id]);

  useEffect(() => { fetchTrade(); }, [fetchTrade]);

  const saveNote = async () => {
    // Blur also saves: skip when nothing changed.
    if (!trade || savingNote || notesEdit === (trade.notes || "")) return;
    setSavingNote(true);
    try {
      await updateTrade(id, { ...trade, notes: notesEdit }, MARKETS.INDIAN_MARKET);
      invalidateTradeDependentQueries(queryClient);
      setTrade((t) => (t ? { ...t, notes: notesEdit } : null));
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 2000);
    } catch (err) {
      addToast(reportUserError("trade_note_save_failed", err, "We couldn't save your note. Please try again."), "error");
    } finally {
      setSavingNote(false);
    }
  };

  let body;
  if (error) body = <DetailNotFound status={error.status} backHref="/indian-market/trades" />;
  else if (!trade) body = <DetailLoading />;
  else {
    const isEquity = String(trade.instrumentType || "").toUpperCase() === "EQUITY";
    const long = String(trade.type || "").toUpperCase() !== "SELL";
    const optType = trade.optionType || "CE";
    const profit = num(trade.profit);
    const defaultLot = LOT_SIZES[String(trade.underlying || "").toUpperCase().trim()] || 1;
    const lotSize = trade.lotSize != null && trade.lotSize > 0 ? Number(trade.lotSize) : defaultLot;
    const lots = trade.quantity != null ? Number(trade.quantity) : 0;
    const totalQty = Math.round(lots * lotSize);
    const brokerage = num(trade.brokerage) || 0;
    const stt = num(trade.sttTaxes) || 0;
    const totalCost = brokerage + stt;
    const netPnL = profit != null ? profit - totalCost : null;

    let plannedRR = null;
    if (trade.riskRewardRatio && trade.riskRewardRatio !== "custom" && trade.riskRewardRatio.includes(":")) plannedRR = trade.riskRewardRatio;
    // A legacy custom value that isn't a ratio (e.g. "ssd") shows as —.
    else if (trade.riskRewardRatio === "custom" && trade.riskRewardCustom) plannedRR = parseRiskReward(trade.riskRewardCustom).value || null;
    let actualRR = null;
    if (trade.entryPrice && trade.stopLoss && trade.exitPrice) {
      const risk = Math.abs(trade.entryPrice - trade.stopLoss);
      if (risk > 0) actualRR = (Math.abs(trade.exitPrice - trade.entryPrice) / risk).toFixed(2);
    }
    const pnlChange = trade.entryPrice && trade.exitPrice
      ? (((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100 * (long ? 1 : -1)).toFixed(2)
      : null;

    const symbol = isEquity
      ? (trade.stockSymbol || trade.pair || "—")
      : (trade.pair || (trade.underlying && trade.strikePrice != null ? `${trade.underlying} ${trade.strikePrice} ${optType}` : "—"));
    const mistake = tradeMistake(trade);
    const score = trade.setupScore != null && Number.isFinite(Number(trade.setupScore)) ? Number(trade.setupScore) : null;
    const entryBasis = trade.entryBasis === "Custom" && trade.entryBasisCustom ? trade.entryBasisCustom : trade.entryBasis;
    const hasReview = trade.mood || trade.confidence || trade.wouldRetake || trade.emotionalTags?.length || mistake || trade.lesson || entryBasis;
    const hasEvidence = trade.screenshot || trade.tradeImages?.length > 0;
    const inr = (v) => <Money value={v} currency="INR" decimals={2} />;

    body = (
      <>
        <DetailHero
          symbol={symbol}
          long={long}
          sideLabel={`${long ? "Buy" : "Sell"}${isEquity ? "" : ` ${optType}`}`}
          dateText={formatMoment(trade)}
          meta={[
            trade.segment || (isEquity ? "Equity" : "F&O"),
            trade.tradeType || "Intraday",
            trade.expiryDate ? `Expiry ${new Date(trade.expiryDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : null,
          ]}
          profit={profit}
          currency="INR"
          profitLabel="Gross P&L"
          sub={pnlChange ? `${Number(pnlChange) >= 0 ? "▲" : "▼"} ${Math.abs(pnlChange)}% per unit` : null}
          badges={mistake ? <span className="ec-badge ec-badge--warning">{mistake}</span> : null}
        />

        <div className="ec-detail__kpis">
          <StatCard label="Net after costs" value={netPnL != null ? <Money value={netPnL} currency="INR" decimals={2} signed /> : "—"} />
          <StatCard label="Actual R:R" value={actualRR ? `${actualRR}R` : "—"} hint={plannedRR ? `Planned ${plannedRR}` : undefined} />
          <StatCard
            label={isEquity ? "Shares" : "Quantity"}
            value={isEquity ? (trade.sharesQty ?? "—") : (totalQty > 0 ? totalQty : "—")}
            hint={!isEquity && lots > 0 ? `${lots} lot${lots !== 1 ? "s" : ""} × ${lotSize}` : undefined}
          />
          <StatCard label="Checklist" value={score != null ? `${Math.round(score)}%` : "—"} hint={score != null ? (score >= 80 ? "A+ setup" : score >= 50 ? "Partly followed" : "Rules skipped") : "Not scored"} />
        </div>

        <div className="ec-detail__grid">
          <div className="ec-detail__col">
            <DetailSection title="Prices">
              <PriceLadder entry={trade.entryPrice} exit={trade.exitPrice} stopLoss={trade.stopLoss} takeProfit={trade.takeProfit} long={long} />
            </DetailSection>

            <DetailSection title="P&L breakdown">
              <DetailRows rows={[
                { label: "Gross P&L", value: profit != null ? <Money value={profit} currency="INR" decimals={2} signed /> : null },
                { label: "Brokerage", value: brokerage > 0 ? inr(-brokerage) : null },
                { label: "STT / taxes", value: stt > 0 ? inr(-stt) : null },
                { label: "Net after costs", value: netPnL != null ? <strong><Money value={netPnL} currency="INR" decimals={2} signed /></strong> : null },
              ]} />
            </DetailSection>

            <DetailSection title="Instrument">
              <DetailRows rows={isEquity ? [
                { label: "Symbol", value: trade.stockSymbol || trade.pair },
                { label: "Exchange", value: trade.exchange },
                { label: "Shares", value: trade.sharesQty != null ? String(trade.sharesQty) : null, mono: true },
                { label: "Sector", value: trade.sector },
                { label: "Trade type", value: trade.tradeType },
              ] : [
                { label: "Underlying", value: trade.underlying },
                { label: "Strike", value: trade.strikePrice != null ? inr(trade.strikePrice) : null },
                { label: "Option", value: optType === "CE" ? "Call (CE)" : "Put (PE)" },
                { label: "Lots", value: lots > 0 ? `${lots} × ${lotSize} = ${totalQty}` : null, mono: true },
                { label: "Trade type", value: trade.tradeType },
              ]} />
            </DetailSection>

            {(score != null || trade.setupRules?.length > 0) && (
              <DetailSection title="Checklist">
                {score != null && <ScoreMeter score={score} />}
                <RuleResults rules={trade.setupRules} />
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
                    { label: "Setup", value: trade.setup || trade.strategy },
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

            <DetailSection
              title="Notes"
              action={noteSaved ? <span className="ec-remind__status is-ok"><Check size={14} />Saved</span> : null}
            >
              <textarea
                className="ec-input ec-detail__notes"
                value={notesEdit}
                onChange={(e) => setNotesEdit(e.target.value)}
                onBlur={saveNote}
                placeholder="Observations and post-trade thoughts…"
                rows={4}
                aria-label="Trade notes"
              />
              <div className="ec-detail__notes-actions">
                <Button size="sm" variant="secondary" onClick={saveNote} loading={savingNote} disabled={notesEdit === (trade.notes || "")}>
                  Save note
                </Button>
              </div>
            </DetailSection>

            {hasEvidence && (
              <DetailSection title="Screenshots">
                <TradeEvidenceGallery images={trade.tradeImages || []} legacyScreenshot={trade.screenshot} title="" />
              </DetailSection>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="ec-app ec-home">
      <PageHeader themed showMarketSwitcher={false} title="Trade" />
      <main className="ec-page ec-detail">
        <DetailTopBar backHref="/indian-market/trades" editHref={trade && id ? `/indian-market/trades/edit?id=${id}` : null} />
        {body}
      </main>
    </div>
  );
}

export default function IndianTradeDetail() {
  return (
    <React.Suspense fallback={null}>
      <IndianTradeDetailContent />
    </React.Suspense>
  );
}
