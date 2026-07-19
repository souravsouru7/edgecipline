"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { markOnboardingStep } from "@/services/api";
import { useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import { getTrades, deleteTrade } from "@/services/tradeApi";
import Link from "next/link";
import MarketSwitcher from "@/components/MarketSwitcher";
import IndianMarketHeader from "@/components/IndianMarketHeader";
import IndianMarketLoadingState from "@/components/IndianMarketLoadingState";
import OnboardingCompleteDialog from "@/features/onboarding/components/OnboardingCompleteDialog";
import { useMarket, MARKETS } from "@/context/MarketContext";
import { invalidateTradeDependentQueries } from "@/utils/queryInvalidation";
import { calculatePerformanceMetrics } from "@/utils/metricEngine";

// Section
const C = {
  bull: "#0D9E6E", bear: "#D63B3B", gold: "#B8860B", blue: "#2563EB",
  purple: "#7C3AED", bg: "#F0EEE9", card: "#FFFFFF", border: "#E2E8F0",
  muted: "#94A3B8", ink: "#0F1923", ink2: "#334155",
  mono: "'JetBrains Mono',monospace", sans: "'Plus Jakarta Sans',sans-serif",
};

// Section
const fmtINR = (v) => v != null ? `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-";
const fmtDate = (d) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
const fmtTime = (d) => new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
const getTradeDisplayDate = (trade) => trade.tradeDate || trade.createdAt;
const fmtTradeDateLine = (trade) => {
  const dateValue = getTradeDisplayDate(trade);
  const dateText = fmtDate(dateValue);
  return trade.tradeDate ? dateText : `${dateText} - ${fmtTime(dateValue)}`;
};
const isEquityTrade = (trade) => {
  const instrumentType = String(trade?.instrumentType || "").toUpperCase();
  if (instrumentType === "EQUITY") return true;
  if (instrumentType === "OPTION") return false;
  // Fallback for trades without instrumentType field
  const optionType = String(trade?.optionType || "").toUpperCase();
  const pair = String(trade?.pair || "").toUpperCase().trim();
  return !(
    optionType === "CE" ||
    optionType === "PE" ||
    trade?.strikePrice != null ||
    /\b(CE|PE|CALL|PUT|FUT)\b/.test(pair)
  );
};

// Section
const TICKERS = [
  { sym: "NIFTY CE", val: "+2.1%", bull: true }, { sym: "NIFTY PE", val: "-1.4%", bull: false },
  { sym: "BANK NIFTY CE", val: "+1.8%", bull: true }, { sym: "BANK NIFTY PE", val: "+0.6%", bull: true },
  { sym: "FIN NIFTY CE", val: "-0.3%", bull: false }, { sym: "MIDCPNIFTY PE", val: "+1.2%", bull: true },
  { sym: "NIFTY CE", val: "+2.1%", bull: true }, { sym: "SENSEX CE", val: "+0.9%", bull: true },
];
function TickerTape() {
  const items = [...TICKERS, ...TICKERS];
  return (
    <div style={{ overflow: "hidden", background: C.ink, borderBottom: `3px solid ${C.bull}`, padding: "7px 0", whiteSpace: "nowrap" }}>
      <div style={{ display: "inline-flex", gap: 48, animation: "ticker 36s linear infinite" }}>
        {items.map((t, i) => (
          <span key={i} style={{ fontSize: 11, fontFamily: C.mono, letterSpacing: "0.04em" }}>
            <span style={{ color: "rgba(255,255,255,0.55)", marginRight: 6 }}>{t.sym}</span>
            <span style={{ color: t.bull ? "#6EE7B7" : "#FCA5A5" }}>{t.bull ? "▲" : "▼"} {t.val}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// Section
function StatBar({ trades }) {
  const performance = calculatePerformanceMetrics(trades);
  const total = performance.totalTrades;
  const wins  = performance.wins;
  const wr    = performance.winRate.toFixed(0);
  const pnl   = performance.grossPnL;
  const bull  = pnl >= 0;

  const stats = [
    { label: "Total Trades",  value: total, mono: false },
    { label: "Win Rate",      value: `${wr}%`,           color: Number(wr) >= 50 ? C.bull : C.bear },
    { label: "Total P&L",     value: `${bull ? "+" : ""}${fmtINR(pnl)}`, color: bull ? C.bull : C.bear },
    { label: "Winners",       value: wins, color: C.bull },
    { label: "Losers",        value: total - wins, color: C.bear },
  ];

  return (
    <div className="stat-bar" style={{ display: "grid", gap: 10, marginBottom: 20 }}>
      {stats.map(s => (
        <div key={s.label} style={{
          background: C.card, borderRadius: 12, border: `1px solid ${C.border}`,
          padding: "14px 16px", textAlign: "center",
          boxShadow: "0 1px 6px rgba(15,25,35,0.04)",
        }}>
          <div style={{ fontSize: 10, color: C.muted, fontFamily: C.mono, letterSpacing: "0.06em", marginBottom: 4 }}>{s.label}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: s.color || C.ink, fontFamily: C.mono }}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

// Section
function DeleteModal({ trade, onConfirm, onCancel }) {
  if (!trade) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(15,25,35,0.6)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{
        background: C.card, borderRadius: 16, padding: 28, maxWidth: 360, width: "100%",
        boxShadow: "0 20px 60px rgba(15,25,35,0.3)",
        animation: "fadeUp 0.2s ease both",
      }}>
        <div style={{ fontSize: 18, marginBottom: 12, textAlign: "center", fontWeight: 800 }}>DELETE</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: C.ink, textAlign: "center", marginBottom: 8 }}>
          Delete Trade?
        </div>
        <div style={{ fontSize: 13, color: C.muted, textAlign: "center", marginBottom: 6 }}>
          This will permanently remove
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.bear, textAlign: "center", fontFamily: C.mono, marginBottom: 24 }}>
          {trade.pair}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: "11px 0", borderRadius: 10, border: `1.5px solid ${C.border}`,
            background: "transparent", fontSize: 13, fontWeight: 700, color: C.ink2, cursor: "pointer",
          }}>Cancel</button>
          <button onClick={onConfirm} style={{
            flex: 1, padding: "11px 0", borderRadius: 10, border: "none",
            background: C.bear, fontSize: 13, fontWeight: 700, color: "#fff", cursor: "pointer",
          }}>Delete</button>
        </div>
      </div>
    </div>
  );
}

// Section
function TradeCard({ trade, onDelete, style: extraStyle }) {
  const profit  = parseFloat(trade.profit) || 0;
  const bull    = profit >= 0;
  const optType = trade.optionType || (trade.pair?.includes(" PE") ? "PE" : "CE");
  const isLong  = trade.type?.toUpperCase() === "BUY";
  const equityTrade = isEquityTrade(trade);

  const lotSizeMap = { NIFTY: 25, "BANK NIFTY": 15, BANKNIFTY: 15, "FIN NIFTY": 25, FINNIFTY: 25, MIDCPNIFTY: 75, SENSEX: 10, BANKEX: 15 };
  const defaultLS  = lotSizeMap[String(trade.underlying || "").toUpperCase().trim()] || 1;
  const lotSize    = trade.lotSize > 0 ? trade.lotSize : defaultLS;
  const lots       = trade.quantity || 0;

  const entryBasisColor = { Plan: C.bull, Emotion: C.bear, Impulsive: C.bear, Custom: C.blue }[trade.entryBasis] || C.muted;

  // Planned R:R label
  let rrLabel = null;
  if (trade.riskRewardRatio && trade.riskRewardRatio !== "custom") rrLabel = trade.riskRewardRatio;
  else if (trade.riskRewardRatio === "custom" && trade.riskRewardCustom) rrLabel = trade.riskRewardCustom;

  return (
    <div style={{
      background: C.card, borderRadius: 14, border: `1px solid ${C.border}`,
      overflow: "hidden", boxShadow: "0 2px 10px rgba(15,25,35,0.05)",
      transition: "box-shadow 0.2s, transform 0.2s",
      ...extraStyle,
    }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 6px 24px rgba(15,25,35,0.1)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 2px 10px rgba(15,25,35,0.05)"; e.currentTarget.style.transform = "translateY(0)"; }}
    >
      {/* Color bar top */}
      <div style={{ height: 3, background: bull ? `linear-gradient(90deg,${C.bull},#22C78E)` : `linear-gradient(90deg,${C.bear},#F87171)` }} />

      <div style={{ padding: "14px 16px" }}>
        {/* Row 1: Instrument + P&L */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            {/* Symbol */}
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                background: bull ? "linear-gradient(135deg,#064E3B,#047857)" : "linear-gradient(135deg,#7F1D1D,#B91C1C)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontWeight: 800, fontSize: 11, fontFamily: C.mono,
              }}>
                {(trade.stockSymbol || trade.underlying || trade.pair || "N").charAt(0)}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, fontFamily: C.mono, letterSpacing: "-0.01em", lineHeight: 1.2 }}>
                  {equityTrade ? (trade.stockSymbol || trade.pair) : (trade.pair || `${trade.underlying} ${trade.strikePrice} ${optType}`)}
                </div>
                <div style={{ fontSize: 10, color: C.muted, fontFamily: C.mono }}>
                  {fmtTradeDateLine(trade)}
                  {equityTrade && trade.sector ? ` - ${trade.sector}` : ""}
                </div>
              </div>
            </div>
          </div>

          {/* P&L */}
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: bull ? C.bull : C.bear, fontFamily: C.mono, letterSpacing: "-0.02em" }}>
              {bull ? "+" : ""}₹{Math.abs(profit).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </div>
            {equityTrade ? (
              trade.sharesQty > 0 && (
                <div style={{ fontSize: 10, color: C.muted, fontFamily: C.mono }}>
                  {trade.sharesQty} shares - {trade.exchange || "NSE"}
                </div>
              )
            ) : (
              lots > 0 && (
                <div style={{ fontSize: 10, color: C.muted, fontFamily: C.mono }}>
                  {lots}L x {lotSize}
                </div>
              )
            )}
          </div>
        </div>

        {/* Row 2: Badges */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {/* Direction */}
          <span style={{
            fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", fontFamily: C.mono,
            color: isLong ? C.bull : C.bear,
            background: isLong ? `${C.bull}15` : `${C.bear}15`,
            border: `1px solid ${isLong ? C.bull : C.bear}40`,
            borderRadius: 5, padding: "3px 8px",
          }}>
            {isLong ? "▲ BUY" : "▼ SELL"}
          </span>

          {/* CE/PE badge (options) or EQUITY badge (stock) */}
          {equityTrade ? (
            <span style={{
              fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", fontFamily: C.mono,
              color: C.blue, background: `${C.blue}10`,
              border: `1px solid ${C.blue}30`, borderRadius: 5, padding: "3px 8px",
            }}>
              EQUITY
            </span>
          ) : (
            <span style={{
              fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", fontFamily: C.mono,
              color: optType === "CE" ? C.bull : C.bear,
              background: optType === "CE" ? `${C.bull}10` : `${C.bear}10`,
              border: `1px solid ${optType === "CE" ? C.bull : C.bear}30`,
              borderRadius: 5, padding: "3px 8px",
            }}>
              {optType === "CE" ? "CE CALL" : "PE PUT"}
            </span>
          )}

          {/* Trade type */}
          {trade.tradeType && (
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", fontFamily: C.mono,
              color: C.muted, background: C.bg, border: `1px solid ${C.border}`,
              borderRadius: 5, padding: "3px 8px",
            }}>
              {trade.tradeType}
            </span>
          )}

          {/* Entry Basis */}
          {trade.entryBasis && (
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", fontFamily: C.mono,
              color: entryBasisColor, background: `${entryBasisColor}10`,
              border: `1px solid ${entryBasisColor}30`,
              borderRadius: 5, padding: "3px 8px",
            }}>
              {trade.entryBasis === "Custom" ? trade.entryBasisCustom : trade.entryBasis}
            </span>
          )}

          {/* R:R */}
          {rrLabel && (
            <span style={{
              fontSize: 9, fontWeight: 700, fontFamily: C.mono, color: C.gold,
              background: `${C.gold}10`, border: `1px solid ${C.gold}30`,
              borderRadius: 5, padding: "3px 8px",
            }}>
              R:R {rrLabel}
            </span>
          )}
        </div>

        {/* Row 3: Prices */}
        <div className="card-price-grid" style={{ display: "grid", gap: 6, marginBottom: 12 }}>
          {(equityTrade ? [
            { label: "Buy Price", val: fmtINR(trade.entryPrice) },
            { label: "Sell Price", val: fmtINR(trade.exitPrice) },
            { label: "Shares", val: trade.sharesQty != null ? String(trade.sharesQty) : "-" },
          ] : [
            { label: "Entry", val: fmtINR(trade.entryPrice) },
            { label: "Exit",  val: fmtINR(trade.exitPrice)  },
            { label: "Strike", val: trade.strikePrice != null ? `₹${Number(trade.strikePrice).toLocaleString("en-IN")}` : "-" },
          ]).map(p => (
            <div key={p.label} style={{ background: C.bg, borderRadius: 7, padding: "7px 10px" }}>
              <div style={{ fontSize: 9, color: C.muted, fontFamily: C.mono, marginBottom: 2 }}>{p.label}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.mono }}>{p.val}</div>
            </div>
          ))}
        </div>

        {/* Setup score bar (if present) */}
        {trade.setupScore != null && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: C.muted, fontFamily: C.mono }}>SETUP SCORE</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: trade.setupScore >= 70 ? C.bull : trade.setupScore >= 40 ? C.gold : C.bear, fontFamily: C.mono }}>
                {trade.setupScore}%
              </span>
            </div>
            <div style={{ height: 4, background: C.border, borderRadius: 2 }}>
              <div style={{
                height: "100%", borderRadius: 2,
                width: `${trade.setupScore}%`,
                background: trade.setupScore >= 70 ? C.bull : trade.setupScore >= 40 ? C.gold : C.bear,
                transition: "width 0.5s ease",
              }} />
            </div>
          </div>
        )}

        {/* Strategy tag */}
        {trade.strategy && (
          <div style={{ marginBottom: 12, fontSize: 11, color: C.ink2, fontStyle: "italic", borderLeft: `2px solid ${C.bull}`, paddingLeft: 8 }}>
            {trade.strategy}
          </div>
        )}

        {/* Row 4: Action buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          <Link
            href={`/indian-market/trades/view?id=${trade._id}`}
            style={{
              flex: 1, textAlign: "center",
              padding: "12px 0", borderRadius: 8,
              background: `${C.bull}15`, border: `1.5px solid ${C.bull}40`,
              fontSize: 11, fontWeight: 700, color: C.bull,
              fontFamily: C.mono, textDecoration: "none", letterSpacing: "0.08em",
              transition: "all 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = C.bull; e.currentTarget.style.color = "#fff"; }}
            onMouseLeave={e => { e.currentTarget.style.background = `${C.bull}15`; e.currentTarget.style.color = C.bull; }}
          >
            VIEW {">"}
          </Link>
          <Link
            href={`/indian-market/trades/edit?id=${trade._id}`}
            style={{
              flex: 1, textAlign: "center",
              padding: "12px 0", borderRadius: 8,
              background: `${C.blue}12`, border: `1.5px solid ${C.blue}30`,
              fontSize: 11, fontWeight: 700, color: C.blue,
              fontFamily: C.mono, textDecoration: "none", letterSpacing: "0.08em",
            }}
          >
            EDIT
          </Link>
          <button
            onClick={() => onDelete(trade)}
            style={{
              padding: "12px 14px", borderRadius: 8,
              background: `${C.bear}12`, border: `1.5px solid ${C.bear}30`,
              fontSize: 11, fontWeight: 700, color: C.bear,
              fontFamily: C.mono, cursor: "pointer", letterSpacing: "0.08em",
              transition: "all 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = C.bear; e.currentTarget.style.color = "#fff"; }}
            onMouseLeave={e => { e.currentTarget.style.background = `${C.bear}12`; e.currentTarget.style.color = C.bear; }}
          >
            DELETE
          </button>
        </div>
      </div>
    </div>
  );
}

// Section
function FilterBar({ filter, setFilter, period, setPeriod, search, setSearch, instrumentType, setInstrumentType }) {
  const filters = [
    { key: "all",  label: "All" },
    { key: "win",  label: "Winners" },
    { key: "loss", label: "Losers" },
    ...(instrumentType !== "EQUITY" ? [
      { key: "CE", label: "Calls" },
      { key: "PE", label: "Puts" },
    ] : []),
  ];
  const periods = [
    { key: "1w", label: "1W" },
    { key: "1m", label: "1M" },
    { key: "3m", label: "3M" },
    { key: "all", label: "ALL" },
  ];
  return (
    <div style={{ marginBottom: 20 }}>
      {/* Instrument type toggle */}
      <div style={{ display: "flex", gap: 0, marginBottom: 12, borderRadius: 8, overflow: "hidden", border: `1.5px solid ${C.border}`, width: "fit-content" }}>
        {[{ v: "OPTION", label: "Options" }, { v: "EQUITY", label: "Intraday Stocks" }].map(({ v, label }) => (
          <button
            key={v}
            onClick={() => { setInstrumentType(v); setFilter("all"); }}
            style={{
              padding: "12px 20px", border: "none",
              background: instrumentType === v ? "#0D9E6E" : C.card,
              color: instrumentType === v ? "#fff" : C.muted,
              fontSize: 12, fontWeight: 700, cursor: "pointer",
              fontFamily: C.mono, transition: "all 0.15s",
            }}
          >
            {label}
          </button>
        ))}
      </div>

    <div className="filter-bar-row" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {/* Search */}
      <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
        <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.muted }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search symbol, trading setup, date..."
          style={{
            width: "100%", boxSizing: "border-box",
            padding: "9px 12px 9px 32px", borderRadius: 8,
            border: `1.5px solid ${C.border}`, fontSize: 12,
            fontFamily: C.sans, background: C.card, outline: "none",
            color: C.ink,
          }}
        />
      </div>

      {/* Filter pills */}
      <div className="filter-pills" style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              padding: "11px 16px", borderRadius: 20, border: "1.5px solid",
              borderColor: filter === f.key ? C.bull : C.border,
              background: filter === f.key ? C.bull : C.card,
              color: filter === f.key ? "#fff" : C.muted,
              fontSize: 11, fontWeight: 700, cursor: "pointer",
              fontFamily: C.mono, transition: "all 0.15s",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="filter-pills" style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        {periods.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            style={{
              padding: "11px 16px", borderRadius: 20, border: "1.5px solid",
              borderColor: period === p.key ? C.ink : C.border,
              background: period === p.key ? C.ink : C.card,
              color: period === p.key ? "#fff" : C.muted,
              fontSize: 11, fontWeight: 700, cursor: "pointer",
              fontFamily: C.mono, transition: "all 0.15s",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
    </div>
  );
}

// Section
function EmptyState() {
  return (
    <div style={{
      textAlign: "center", padding: "60px 20px",
      background: C.card, borderRadius: 14, border: `1px dashed ${C.border}`,
    }}>
      <div style={{ fontSize: 18, marginBottom: 16, fontWeight: 800 }}>TRADES</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: C.ink, marginBottom: 8 }}>No trades yet</div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 24 }}>Log your first options trade to start tracking</div>
      <Link href="/indian-market/add-trade" style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        background: `linear-gradient(135deg,${C.bull},#22C78E)`,
        color: "#fff", padding: "12px 24px", borderRadius: 10,
        textDecoration: "none", fontSize: 12, fontWeight: 800,
        fontFamily: C.mono, letterSpacing: "0.08em",
        boxShadow: `0 4px 14px ${C.bull}40`,
      }}>
        + LOG FIRST TRADE
      </Link>
    </div>
  );
}

// Section
export default function IndianTradesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ready } = useRequireAuth();
  const { currentMarket } = useMarket();
  const searchParams = useSearchParams();
  const onboardingMode = searchParams?.get("onboarding") === "1";
  const [completionDismissed, setCompletionDismissed] = useState(false);
  const showOnboardingComplete = onboardingMode && !completionDismissed;

  useEffect(() => {
    if (!ready) return;
    markOnboardingStep("journalSeen", true).catch(() => {});
  }, [ready]);
  const [trades, setTrades]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingId, setDeletingId]    = useState(null);
  const [deleting, setDeleting]       = useState(false);
  const [filter, setFilter]           = useState("all");
  const [period, setPeriod]           = useState("1m");
  const [search, setSearch]           = useState("");
  const [instrumentType, setInstrumentType] = useState("OPTION");

  useEffect(() => {
    if (!ready) return;
    fetchTrades();
  }, [ready, period]);

  const fetchTrades = async () => {
    setLoading(true);
    try { setTrades(await getTrades(MARKETS.INDIAN_MARKET, { period })); }
    finally { setLoading(false); }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget || deleting) return;
    const id = deleteTarget._id;
    setDeletingId(id);
    setDeleteTarget(null);
    await new Promise(r => setTimeout(r, 280));
    setDeleting(true);
    try {
      await deleteTrade(id, MARKETS.INDIAN_MARKET);
      invalidateTradeDependentQueries(queryClient);
      setTrades(t => t.filter(x => x._id !== id));
    } finally {
      setDeleting(false);
      setDeletingId(null);
    }
  };

  const instrumentTrades = useMemo(() => (
    trades.filter(t =>
      instrumentType === "EQUITY"
        ? isEquityTrade(t)
        : !isEquityTrade(t)
    )
  ), [trades, instrumentType]);

  const filtered = useMemo(() => {
    let list = instrumentTrades;
    if (filter === "win")  list = list.filter(t => (t.profit || 0) > 0);
    if (filter === "loss") list = list.filter(t => (t.profit || 0) < 0);
    if (filter === "CE")   list = list.filter(t => (t.optionType || "CE") === "CE");
    if (filter === "PE")   list = list.filter(t => (t.optionType || "CE") === "PE");
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(t =>
        (t.pair || "").toLowerCase().includes(q) ||
        (t.stockSymbol || "").toLowerCase().includes(q) ||
        (t.strategy || "").toLowerCase().includes(q) ||
        (t.underlying || "").toLowerCase().includes(q) ||
        (t.sector || "").toLowerCase().includes(q) ||
        new Date(getTradeDisplayDate(t)).toLocaleDateString("en-IN").toLowerCase().includes(q)
      );
    }
    return list;
  }, [instrumentTrades, filter, search]);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: C.sans, color: C.ink }}>

      <IndianMarketHeader />

      <TickerTape />


      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 20px 60px" }}>
        {onboardingMode && (
          <div style={{
            padding: "14px 16px", borderRadius: 12,
            background: "linear-gradient(135deg, rgba(34,199,142,0.1), rgba(13,158,110,0.04))",
            border: "1px solid rgba(34,199,142,0.3)",
            marginBottom: 18, display: "flex", alignItems: "flex-start", gap: 12,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              background: "rgba(34,199,142,0.2)", color: "#0D9E6E",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, fontWeight: 900,
            }}>OK</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", color: "#0D9E6E", fontFamily: "'JetBrains Mono', monospace", marginBottom: 3 }}>
                ACTIVATION COMPLETE - YOUR TRADE LOG
              </div>
              <div style={{ fontSize: 13, color: "#0F1923", fontWeight: 700, marginBottom: 2 }}>
                Nice - you logged your first trade!
              </div>
              <div style={{ fontSize: 12, color: "#64748B", lineHeight: 1.55 }}>
                Every trade lives here. Filter by setup, date, or result. The more you log, the smarter your analytics get.
              </div>
            </div>
          </div>
        )}

        {/* Page title + CTA */}
        <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 900, color: C.ink, margin: 0, letterSpacing: "-0.02em" }}>
              {instrumentType === "EQUITY" ? "Stocks Trade Log" : "Options Trade Log"}
            </h1>
            <p style={{ fontSize: 12, color: C.muted, margin: "4px 0 0", fontFamily: C.mono }}>
              NSE / BSE - {instrumentType === "EQUITY" ? "Intraday Equities" : "Options"}
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Link href="/indian-market/upload-trade" style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "10px 18px", borderRadius: 10,
              border: `1.5px solid ${C.bull}`, color: C.bull,
              background: `${C.bull}10`, textDecoration: "none",
              fontSize: 12, fontWeight: 700, fontFamily: C.mono,
            }}>
              Upload
            </Link>
            <Link href="/indian-market/add-trade" style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "10px 20px", borderRadius: 10,
              background: `linear-gradient(135deg,${C.bull},#22C78E)`,
              color: "#fff", textDecoration: "none",
              fontSize: 12, fontWeight: 800, fontFamily: C.mono,
              boxShadow: `0 4px 14px ${C.bull}40`,
              letterSpacing: "0.06em",
            }}>
              + NEW TRADE
            </Link>
          </div>
        </div>

        {/* Stats bar */}
        {!loading && trades.length > 0 && <StatBar trades={instrumentTrades} />}

        {/* Filters */}
        {!loading && trades.length > 0 && (
          <FilterBar filter={filter} setFilter={setFilter} period={period} setPeriod={setPeriod} search={search} setSearch={setSearch} instrumentType={instrumentType} setInstrumentType={setInstrumentType} />
        )}

        {/* Content */}
        {loading ? (
          <IndianMarketLoadingState
            title="Loading Indian Market trade log"
            subtitle="Preparing NSE / BSE trades and filters"
            dense
          />
        ) : filtered.length === 0 && trades.length === 0 ? (
          <EmptyState />
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: C.muted, fontSize: 13 }}>
            No trades match your filter.{" "}
            <button onClick={() => { setFilter("all"); setSearch(""); }} style={{ background: "none", border: "none", color: C.bull, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
              Clear filters
            </button>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 11, color: C.muted, fontFamily: C.mono, marginBottom: 14 }}>
              Showing {filtered.length} of {trades.length} trades - {period.toUpperCase()} window
            </div>
            <div className="trade-grid" style={{ display: "grid", gap: 14 }}>
              {filtered.map((trade, idx) => (
                <TradeCard
                  key={trade._id}
                  trade={trade}
                  onDelete={setDeleteTarget}
                  style={{
                    animation: deletingId === trade._id
                      ? "tradeExit 0.28s ease forwards"
                      : `fadeUp 0.35s ease ${Math.min(idx, 8) * 0.05}s both`,
                    pointerEvents: deletingId === trade._id ? "none" : "auto",
                  }}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {/* Delete modal */}
      <DeleteModal
        trade={deleteTarget}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
      {showOnboardingComplete && (
        <OnboardingCompleteDialog
          onClose={() => setCompletionDismissed(true)}
          onDashboard={() => router.replace("/indian-market/dashboard?onboarded=1")}
        />
      )}

      <style>{`
        @keyframes ticker    { from{transform:translateX(0)} to{transform:translateX(-50%)} }
        @keyframes fadeUp    { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin      { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes tradeExit { 0%{opacity:1;transform:translateX(0)} 100%{opacity:0;transform:translateX(40px)} }
        * { box-sizing: border-box; }
        input::placeholder { color: #CBD5E1; }

/* Section */
        .stat-bar        { grid-template-columns: repeat(5, 1fr); }
        .trade-grid      { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
        .card-price-grid { grid-template-columns: 1fr 1fr 1fr; }
        .header-nav      { display: flex; }
        .page-header     { flex-direction: row; }
        .filter-bar-row  { flex-direction: row; }

/* Section */
        @media (max-width: 768px) {
          .stat-bar        { grid-template-columns: repeat(3, 1fr); }
          .trade-grid      { grid-template-columns: repeat(2, 1fr); }
          .card-price-grid { grid-template-columns: 1fr 1fr 1fr; }
          .header-nav      { display: none; }
        }

/* Section */
        @media (max-width: 480px) {
          .stat-bar           { grid-template-columns: repeat(2, 1fr); }
          .trade-grid         { grid-template-columns: 1fr; }
          .card-price-grid    { grid-template-columns: 1fr 1fr; }
          .page-header        { flex-direction: column; align-items: flex-start; }
          .filter-bar-row     { flex-direction: column; align-items: stretch; }
          .filter-pills       { overflow-x: auto; padding-bottom: 4px; }
          .mobile-bottom-nav  {
            display: flex !important;
            position: fixed; bottom: 0; left: 0; right: 0;
            background: #fff; border-top: 1px solid #E2E8F0;
            z-index: 100; padding-bottom: env(safe-area-inset-bottom);
          }
          main { padding-bottom: 80px !important; }
        }
      `}</style>
    </div>
  );
}
