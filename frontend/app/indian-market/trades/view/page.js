"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getTrade, updateTrade } from "@/services/tradeApi";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MARKETS } from "@/context/MarketContext";
import MarketSwitcher from "@/components/MarketSwitcher";
import IndianMarketHeader from "@/components/IndianMarketHeader";
import { invalidateTradeDependentQueries } from "@/utils/queryInvalidation";
import TradeEvidenceGallery from "@/features/trade/components/TradeEvidenceGallery";

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bull:    "#0D9E6E",
  bear:    "#D63B3B",
  gold:    "#B8860B",
  blue:    "#2563EB",
  purple:  "#7C3AED",
  bg:      "#F0EEE9",
  card:    "#FFFFFF",
  border:  "#E2E8F0",
  muted:   "#94A3B8",
  ink:     "#0F1923",
  ink2:    "#334155",
  mono:    "'JetBrains Mono',monospace",
  sans:    "'Plus Jakarta Sans',sans-serif",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt  = (v, dec = 2) => v != null && !isNaN(v) ? `₹${Number(v).toFixed(dec)}` : "—";
const num  = (v) => v != null && !isNaN(v) ? Number(v) : null;
const pct  = (v) => v != null ? `${Number(v).toFixed(1)}%` : "—";

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function formatDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function formatTradeDateLine(trade) {
  if (!trade) return "—";
  return trade.tradeDate
    ? formatDate(trade.tradeDate)
    : formatDateTime(trade.createdAt);
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function Badge({ label, color = C.bull, bg }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
      fontFamily: C.mono,
      color,
      background: bg || color + "18",
      border: `1px solid ${color}33`,
      borderRadius: 6, padding: "3px 8px",
    }}>{label}</span>
  );
}

function StatRow({ label, value, valueColor, mono }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 12, color: C.muted, fontFamily: C.sans }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: valueColor || C.ink, fontFamily: mono ? C.mono : C.sans }}>{value || "—"}</span>
    </div>
  );
}

function SectionCard({ title, icon, children, accent }) {
  return (
    <div style={{
      background: C.card, borderRadius: 14, border: `1px solid ${C.border}`,
      overflow: "hidden", marginBottom: 14,
      boxShadow: "0 2px 12px rgba(15,25,35,0.04)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "14px 18px", borderBottom: `1px solid ${C.border}`,
        background: accent ? `${accent}08` : "transparent",
      }}>
        {icon && <span style={{ fontSize: 15 }}>{icon}</span>}
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: accent || C.ink2, fontFamily: C.mono }}>
          {title}
        </span>
      </div>
      <div style={{ padding: "14px 18px" }}>{children}</div>
    </div>
  );
}

function MoodBar({ value }) {
  const labels = ["", "Stressed", "Anxious", "Neutral", "Focused", "Peak Focus"];
  const colors = ["", C.bear, "#F97316", C.gold, C.bull, "#2563EB"];
  if (!value) return <span style={{ color: C.muted, fontSize: 12 }}>—</span>;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} style={{
            width: 20, height: 6, borderRadius: 3,
            background: i <= value ? colors[value] : C.border,
            transition: "background 0.2s",
          }} />
        ))}
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: colors[value], fontFamily: C.sans }}>{labels[value]}</span>
    </div>
  );
}

function SetupScore({ score }) {
  if (score == null) return <span style={{ color: C.muted, fontSize: 12 }}>—</span>;
  const color = score >= 80 ? C.bull : score >= 50 ? C.gold : C.bear;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1, height: 6, background: C.border, borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${score}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.6s ease" }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 800, color, fontFamily: C.mono, minWidth: 36 }}>{score}%</span>
    </div>
  );
}

function PriceGrid({ entry, exit, sl, tp, type }) {
  const cells = [
    { label: type === "BUY" ? "Buy Price" : "Sell Price", val: fmt(entry), color: type === "BUY" ? C.bull : C.bear },
    { label: type === "BUY" ? "Sell Price" : "Buy Price", val: fmt(exit),  color: type === "BUY" ? C.bear : C.bull },
    { label: "Stop Loss",   val: fmt(sl),  color: C.bear },
    { label: "Take Profit", val: fmt(tp),  color: C.bull },
  ];
  return (
    <div className="price-grid" style={{ display: "grid", gap: 10 }}>
      {cells.map(c => (
        <div key={c.label} style={{
          background: C.bg, borderRadius: 10, padding: "12px 14px",
          border: `1px solid ${C.border}`,
        }}>
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginBottom: 4, fontFamily: C.sans }}>{c.label}</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: c.color || C.ink, fontFamily: C.mono }}>{c.val}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Main content ─────────────────────────────────────────────────────────────
function IndianTradeDetailContent() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const id = searchParams.get("id");
  const [trade, setTrade] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notesEdit, setNotesEdit] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  const fetchTrade = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getTrade(id, MARKETS.INDIAN_MARKET);
      setTrade(data);
      setNotesEdit(data.notes || "");
    } catch {
      setTrade(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchTrade(); }, [fetchTrade]);

  const saveNote = async () => {
    if (!trade || savingNote) return;
    setSavingNote(true);
    try {
      await updateTrade(id, { ...trade, notes: notesEdit }, MARKETS.INDIAN_MARKET);
      invalidateTradeDependentQueries(queryClient);
      setTrade(t => t ? { ...t, notes: notesEdit } : null);
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 2000);
    } catch {
      alert("Failed to save note.");
    } finally {
      setSavingNote(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, fontFamily: C.sans }}>
        <div style={{ width: 36, height: 36, border: `3px solid ${C.border}`, borderTop: `3px solid ${C.bull}`, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <span style={{ color: C.muted, fontSize: 13 }}>Loading trade…</span>
        <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (!trade) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, padding: 24, fontFamily: C.sans }}>
        <p style={{ color: C.bear, marginBottom: 12 }}>Trade not found.</p>
        <Link href="/indian-market/trades" style={{ color: C.bull, fontWeight: 600 }}>← Back to Trade Log</Link>
      </div>
    );
  }

  // ── Derived values ──────────────────────────────────────────────────────────
  const isEquity   = String(trade.instrumentType || "").toUpperCase() === "EQUITY";
  const bull       = parseFloat(trade.profit) >= 0;
  const profitNum  = parseFloat(trade.profit) || 0;
  const optType    = trade.optionType || "CE";
  const lotSizeMap = { NIFTY: 25, "BANK NIFTY": 15, BANKNIFTY: 15, "FIN NIFTY": 25, FINNIFTY: 25, MIDCPNIFTY: 75, SENSEX: 10, BANKEX: 15 };
  const defaultLS  = lotSizeMap[String(trade.underlying || "").toUpperCase().trim()] || 1;
  const lotSize    = trade.lotSize != null && trade.lotSize > 0 ? Number(trade.lotSize) : defaultLS;
  const lots       = trade.quantity != null ? Number(trade.quantity) : 0;
  const totalQty   = Math.round(lots * lotSize);

  const grossPnL   = profitNum;
  const brokerage  = num(trade.brokerage) || 0;
  const stt        = num(trade.sttTaxes) || 0;
  const totalCost  = brokerage + stt;
  const netPnL     = grossPnL - totalCost;

  // Planned R:R
  let plannedRR = null;
  if (trade.riskRewardRatio && trade.riskRewardRatio !== "custom" && trade.riskRewardRatio.includes(":")) {
    plannedRR = trade.riskRewardRatio;
  } else if (trade.riskRewardRatio === "custom" && trade.riskRewardCustom) {
    plannedRR = trade.riskRewardCustom;
  }
  // Actual R:R from prices
  let actualRR = null;
  if (trade.entryPrice && trade.stopLoss && trade.exitPrice) {
    const risk   = Math.abs(trade.entryPrice - trade.stopLoss);
    const actual = Math.abs(trade.exitPrice - trade.entryPrice);
    if (risk > 0) actualRR = (actual / risk).toFixed(2);
  }

  const instrumentName = trade.pair || (trade.underlying && trade.strikePrice != null
    ? `${trade.underlying} ${trade.strikePrice} ${optType}` : "—");

  const underlying = trade.underlying?.toUpperCase() || "NSE";
  const underlyingInitial = underlying.charAt(0);
  const underlyingColor = { N: "#1B5E20", B: "#1A237E", F: "#4A148C", M: "#BF360C", S: "#0D47A1" }[underlyingInitial] || "#1B5E20";

  const confidenceColor = { High: C.bull, Medium: C.gold, Low: C.bear, Overconfident: C.purple }[trade.confidence] || C.muted;
  const entryBasisColor = { Plan: C.bull, Emotion: C.bear, Impulsive: C.bear, Custom: C.blue }[trade.entryBasis] || C.muted;

  const pnlChange = trade.entryPrice && trade.exitPrice
    ? (((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100 * (trade.type === "BUY" ? 1 : -1)).toFixed(2)
    : null;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: C.sans, color: C.ink }}>

      <IndianMarketHeader />

      <main style={{ maxWidth: 600, margin: "0 auto", padding: "16px 12px 48px" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <Link
            href={`/indian-market/trades/edit?id=${id}`}
            style={{
              textDecoration: "none",
              padding: "10px 14px",
              borderRadius: 8,
              background: `${C.blue}12`,
              border: `1px solid ${C.blue}30`,
              color: C.blue,
              fontSize: 12,
              fontWeight: 700,
              fontFamily: C.mono,
              letterSpacing: "0.08em",
            }}
          >
            EDIT TRADE
          </Link>
        </div>

        {/* ── HERO: P&L Banner ── */}
        <div style={{
          borderRadius: 16, overflow: "hidden", marginBottom: 14,
          background: bull
            ? "linear-gradient(135deg,#064E3B 0%,#065F46 60%,#047857 100%)"
            : "linear-gradient(135deg,#7F1D1D 0%,#991B1B 60%,#B91C1C 100%)",
          boxShadow: bull
            ? "0 8px 32px rgba(13,158,110,0.25)"
            : "0 8px 32px rgba(214,59,59,0.25)",
          position: "relative",
        }}>
          {/* Subtle grid overlay */}
          <div style={{ position: "absolute", inset: 0, opacity: 0.06, backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 19px,rgba(255,255,255,0.5) 20px),repeating-linear-gradient(90deg,transparent,transparent 19px,rgba(255,255,255,0.5) 20px)" }} />

          <div className="hero-inner" style={{ position: "relative", padding: "22px 24px 20px" }}>
            {/* Top row: Instrument + badges */}
            <div className="hero-top" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: underlyingColor,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", fontWeight: 800, fontSize: 18,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                  flexShrink: 0,
                }}>
                  {underlyingInitial}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", fontFamily: C.mono, letterSpacing: "0.1em", marginBottom: 3 }}>
                    {trade.segment || "F&O"} · {trade.instrumentType || "OPTION"}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", letterSpacing: "-0.01em", lineHeight: 1.15 }}>
                    {instrumentName}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                <span style={{
                  fontSize: 11, fontWeight: 800, fontFamily: C.mono, letterSpacing: "0.12em",
                  color: trade.type === "BUY" ? "#34D399" : "#FCA5A5",
                  background: "rgba(255,255,255,0.1)",
                  border: `1px solid rgba(255,255,255,0.2)`,
                  borderRadius: 6, padding: "3px 10px",
                }}>
                  {trade.type === "BUY" ? "▲ BUY" : "▼ SELL"}{isEquity ? "" : ` ${optType}`}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.6)",
                  fontFamily: C.mono,
                }}>
                  {trade.tradeType || "INTRADAY"}
                </span>
              </div>
            </div>

            {/* P&L */}
            <div className="hero-bottom" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: C.mono, marginBottom: 4 }}>NET P&L</div>
                <div className="hero-pnl" style={{ fontSize: 38, fontWeight: 900, color: "#fff", fontFamily: C.mono, letterSpacing: "-0.02em", lineHeight: 1 }}>
                  {bull ? "+" : ""}₹{profitNum.toFixed(2)}
                </div>
                {pnlChange && (
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", fontFamily: C.mono, marginTop: 4 }}>
                    {bull ? "▲" : "▼"} {Math.abs(pnlChange)}% per unit
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right" }}>
                {lots > 0 && (
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", fontFamily: C.mono }}>
                    {lots} lot{lots !== 1 ? "s" : ""} × {lotSize} = {totalQty} qty
                  </div>
                )}
                {trade.expiryDate && (
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 4, fontFamily: C.mono }}>
                    Expiry: {formatDate(trade.expiryDate)}
                  </div>
                )}
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 4, fontFamily: C.mono }}>
                  {formatTradeDateLine(trade)}
                </div>
              </div>
            </div>
          </div>

          {/* NSE tag strip at bottom */}
          <div style={{ background: "rgba(0,0,0,0.2)", padding: "8px 24px", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.5)", fontFamily: C.mono, letterSpacing: "0.12em" }}>NSE</span>
            <span style={{ width: 1, height: 10, background: "rgba(255,255,255,0.15)" }} />
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: C.mono }}>
              {isEquity
                ? `${trade.exchange || "NSE"} · Equity ${trade.tradeType || "INTRADAY"}`
                : `${trade.underlying || "NIFTY"} · ${optType === "CE" ? "Call" : "Put"} Option`}
            </span>
            {trade.setupScore != null && (
              <>
                <span style={{ width: 1, height: 10, background: "rgba(255,255,255,0.15)" }} />
                <span style={{ fontSize: 10, color: trade.setupScore >= 70 ? "#34D399" : "#FCA5A5", fontFamily: C.mono }}>
                  Setup {trade.setupScore}%
                </span>
              </>
            )}
          </div>
        </div>

        {/* ── Prices ── */}
        <SectionCard title="ENTRY / EXIT" icon="🎯" accent={C.blue}>
          <PriceGrid
            entry={trade.entryPrice}
            exit={trade.exitPrice}
            sl={trade.stopLoss}
            tp={trade.takeProfit}
            type={trade.type}
          />
        </SectionCard>

        {/* ── P&L Breakdown ── */}
        <SectionCard title="P&L BREAKDOWN" icon="💰" accent={bull ? C.bull : C.bear}>
          <StatRow label="Gross P&L"  value={`${bull ? "+" : ""}${fmt(grossPnL)}`} valueColor={bull ? C.bull : C.bear} mono />
          {brokerage > 0 && <StatRow label="Brokerage" value={`-${fmt(brokerage)}`} valueColor={C.muted} mono />}
          {stt > 0        && <StatRow label="STT / Taxes" value={`-${fmt(stt)}`}  valueColor={C.muted} mono />}
          {totalCost > 0  && <StatRow label="Total Costs" value={`-${fmt(totalCost)}`} valueColor={C.bear} mono />}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 12, marginTop: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Net P&L (after costs)</span>
            <span style={{ fontSize: 18, fontWeight: 900, color: netPnL >= 0 ? C.bull : C.bear, fontFamily: C.mono }}>
              {netPnL >= 0 ? "+" : ""}₹{netPnL.toFixed(2)}
            </span>
          </div>
        </SectionCard>

        {/* ── Trade Details ── */}
        <SectionCard title="TRADE DETAILS" icon="📋" accent={C.ink2} className="section-card">
          {isEquity ? (
            <>
              <StatRow label="Stock Symbol" value={trade.stockSymbol || trade.pair || "—"} />
              <StatRow label="Exchange"     value={trade.exchange || "—"} />
              <StatRow label="Shares Qty"   value={trade.sharesQty != null ? String(trade.sharesQty) : "—"} mono />
              <StatRow label="Sector"       value={trade.sector || "—"} />
            </>
          ) : (
            <>
              <StatRow label="Underlying"  value={trade.underlying || "—"} />
              <StatRow label="Strike Price" value={trade.strikePrice != null ? `₹${trade.strikePrice}` : "—"} mono />
              <StatRow label="Option Type"  value={optType === "CE" ? "🟢 Call (CE)" : "🔴 Put (PE)"} />
              <StatRow label="Lots"      value={lots > 0 ? `${lots} lot${lots !== 1 ? "s" : ""}` : "—"} mono />
              <StatRow label="Lot Size"  value={lotSize ? `${lotSize} qty/lot` : "—"} mono />
              <StatRow label="Total Qty" value={totalQty > 0 ? String(totalQty) : "—"} mono />
            </>
          )}
          <StatRow label="Trade Type"    value={trade.tradeType || "—"} />
          <StatRow label="Entry Basis"
            value={trade.entryBasis === "Custom" && trade.entryBasisCustom ? trade.entryBasisCustom : (trade.entryBasis || "—")}
            valueColor={entryBasisColor}
          />
        </SectionCard>

        {/* ── Risk / Reward ── */}
        <SectionCard title="RISK & REWARD" icon="📐" accent={C.gold}>
          <StatRow label="Planned R:R"   value={plannedRR || "—"} mono />
          <StatRow label="Actual R:R"    value={actualRR ? `${actualRR}R` : "—"} mono valueColor={actualRR && Number(actualRR) >= 1 ? C.bull : C.bear} />
          {trade.setupScore != null && (
            <div style={{ paddingTop: 10 }}>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Setup Quality Score</div>
              <SetupScore score={trade.setupScore} />
            </div>
          )}
          {trade.setupRules?.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 8, fontFamily: C.mono }}>CHECKLIST</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {trade.setupRules.map((r, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: r.followed ? C.bull : C.muted }}>
                    <span style={{ fontSize: 14 }}>{r.followed ? "✅" : "⬜"}</span>
                    <span style={{ textDecoration: r.followed ? "none" : "line-through", opacity: r.followed ? 1 : 0.6 }}>{r.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>

        {/* ── Psychology ── */}
        {(trade.mood || trade.confidence || trade.emotionalTags?.length > 0 || trade.wouldRetake) && (
          <SectionCard title="PSYCHOLOGY" icon="🧠" accent={C.purple}>
            {trade.mood && (
              <div style={{ paddingBottom: 10, borderBottom: `1px solid ${C.border}`, marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>Mood</div>
                <MoodBar value={trade.mood} />
              </div>
            )}
            {trade.confidence && (
              <StatRow label="Confidence" value={trade.confidence} valueColor={confidenceColor} />
            )}
            {trade.wouldRetake && (
              <StatRow
                label="Would Retake?"
                value={trade.wouldRetake}
                valueColor={trade.wouldRetake === "Yes" ? C.bull : C.bear}
              />
            )}
            {trade.emotionalTags?.length > 0 && (
              <div style={{ paddingTop: 10 }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>Emotional Tags</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {trade.emotionalTags.map(tag => (
                    <Badge key={tag} label={tag} color={C.purple} />
                  ))}
                </div>
              </div>
            )}
          </SectionCard>
        )}

        {/* ── Trade notes ── */}
        {(trade.setup || trade.strategy || trade.mistakeTag || trade.lesson) && (
          <SectionCard title="NOTES" icon="📓" accent={C.gold}>
            {trade.strategy && <StatRow label="Trading Setup" value={trade.strategy} />}
            {trade.setup     && <StatRow label="Setup"       value={trade.setup} />}
            {trade.mistakeTag && (
              <StatRow label="Mistake" value={trade.mistakeTag} valueColor={C.bear} />
            )}
            {trade.lesson && (
              <div style={{ paddingTop: 10 }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>Lesson Learned</div>
                <div style={{
                  fontSize: 13, color: C.ink2, lineHeight: 1.6,
                  background: "#FFFBEB", border: `1px solid #FDE68A`,
                  borderRadius: 8, padding: "10px 12px",
                  fontStyle: "italic",
                }}>
                  &quot;{trade.lesson}&quot;
                </div>
              </div>
            )}
          </SectionCard>
        )}

        {/* ── Notes ── */}
        <SectionCard title="NOTES" icon="✏️">
          <textarea
            value={notesEdit}
            onChange={e => setNotesEdit(e.target.value)}
            placeholder="Add your notes, observations, or post-trade thoughts…"
            rows={4}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "12px 14px", borderRadius: 10,
              border: `1.5px solid ${C.border}`,
              fontSize: 13, fontFamily: C.sans,
              color: C.ink, background: C.bg,
              resize: "vertical", outline: "none",
              transition: "border-color 0.2s",
            }}
            onFocus={e => { e.target.style.borderColor = C.bull; }}
            onBlur={e => { e.target.style.borderColor = C.border; saveNote(); }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <button
              onClick={saveNote}
              disabled={savingNote}
              style={{
                padding: "8px 18px", borderRadius: 8,
                border: "none",
                background: noteSaved ? C.bull : C.blue,
                color: "#fff", fontSize: 12, fontWeight: 700,
                fontFamily: C.mono, cursor: savingNote ? "not-allowed" : "pointer",
                transition: "background 0.3s",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              {savingNote ? "Saving…" : noteSaved ? "✓ Saved" : "Save Note"}
            </button>
          </div>
        </SectionCard>

        {/* ── Trade Evidence (gallery: legacy screenshot + tradeImages array) ── */}
        {(trade.screenshot || (trade.tradeImages && trade.tradeImages.length > 0)) && (
          <SectionCard title="TRADE EVIDENCE" icon="📸">
            <TradeEvidenceGallery
              images={trade.tradeImages || []}
              legacyScreenshot={trade.screenshot}
              title=""
            />
          </SectionCard>
        )}

        {/* ── Back button ── */}
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <Link href="/indian-market/trades" style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: 13, color: C.muted, fontWeight: 600,
            textDecoration: "none", padding: "8px 16px",
            borderRadius: 8, border: `1px solid ${C.border}`,
            background: C.card, transition: "color 0.2s",
          }}>
            ← Back to Trade Log
          </Link>
        </div>
      </main>

      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        * { box-sizing: border-box; }

        /* ── Default (desktop) ── */
        .price-grid { grid-template-columns: 1fr 1fr; }
        .hero-top   { flex-wrap: nowrap; }
        .hero-bottom { flex-wrap: nowrap; }
        .hero-pnl   { font-size: 38px; }
        .hero-inner { padding: 22px 24px 20px; }

        /* ── Mobile ≤ 480px ── */
        @media (max-width: 480px) {
          .price-grid  { grid-template-columns: 1fr 1fr; }
          .hero-top    { flex-wrap: wrap; gap: 10px; }
          .hero-bottom { flex-direction: column; align-items: flex-start; }
          .hero-pnl    { font-size: 28px; }
          .hero-inner  { padding: 16px 16px 14px; }
        }

        /* ── Very small ≤ 360px ── */
        @media (max-width: 360px) {
          .price-grid { grid-template-columns: 1fr; }
          .hero-pnl   { font-size: 24px; }
        }
      `}</style>
    </div>
  );
}

export default function IndianTradeDetailPage() {
  return (
    <React.Suspense fallback={
      <div style={{ minHeight: "100vh", background: "#F0EEE9", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#94A3B8", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>Loading…</span>
      </div>
    }>
      <IndianTradeDetailContent />
    </React.Suspense>
  );
}
