"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { getTrade } from "@/services/tradeApi";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import PageHeader from "@/features/shared/components/PageHeader";
import TradeEvidenceGallery from "@/features/trade/components/TradeEvidenceGallery";

/* ─────────────────────────────────────────
   DESIGN TOKENS — Light Trading Theme
   Base: warm white #F5F3EE
   Cards: #FFFFFF
   Bull: #0D9E6E (deep green)
   Bear: #D63B3B (deep red)
   Gold: #B8860B
   Text primary: #0F1923
   Text secondary: #4A5568
   Text muted: #94A3B8
   Border: #E2E8F0
───────────────────────────────────────── */

/* ─────────────────────────────────────────
   CANDLESTICK BACKGROUND (subtle, light)
───────────────────────────────────────── */
function CandlestickBackground() {
  useEffect(() => {
    const canvas = document.getElementById("detail-bg-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const draw = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const count = Math.floor(W / 32);
      const candles = [];
      let price = 200;
      for (let i = 0; i < count; i++) {
        const open = price + (Math.random() - 0.5) * 20;
        const close = open + (Math.random() - 0.5) * 28;
        const high = Math.max(open, close) + Math.random() * 12;
        const low = Math.min(open, close) - Math.random() * 12;
        price = close;
        candles.push({ open, close, high, low });
      }
      const all = candles.flatMap(c => [c.high, c.low]);
      const mx = Math.max(...all), mn = Math.min(...all), rng = mx - mn || 1;
      const toY = p => H * 0.1 + (H * 0.8 * (mx - p)) / rng;

      // Subtle grid
      ctx.strokeStyle = "rgba(0,0,0,0.04)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 7; i++) {
        ctx.beginPath(); ctx.moveTo(0,(H/7)*i); ctx.lineTo(W,(H/7)*i); ctx.stroke();
      }

      candles.forEach((c, i) => {
        const x = i * 32 + 16, bull = c.close >= c.open;
        const col = bull ? "rgba(13,158,110,0.18)" : "rgba(214,59,59,0.15)";
        const bTop = toY(Math.max(c.open, c.close)), bBot = toY(Math.min(c.open, c.close));
        ctx.strokeStyle = bull ? "rgba(13,158,110,0.25)" : "rgba(214,59,59,0.22)";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, toY(c.high)); ctx.lineTo(x, toY(c.low)); ctx.stroke();
        ctx.fillStyle = col;
        ctx.fillRect(x - 8, bTop, 16, Math.max(bBot - bTop, 1));
      });

      // MA line
      const ma = candles.map((_, i) => {
        const sl = candles.slice(Math.max(0,i-5),i+1);
        return sl.reduce((a,c) => a+c.close,0)/sl.length;
      });
      ctx.strokeStyle = "rgba(184,134,11,0.3)";
      ctx.lineWidth = 2; ctx.setLineDash([5,5]);
      ctx.beginPath();
      ma.forEach((p,i) => { const x=i*32+16,y=toY(p); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
      ctx.stroke(); ctx.setLineDash([]);
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, []);
  return <canvas id="detail-bg-canvas" style={{ position:"fixed", inset:0, width:"100%", height:"100%", opacity:1, zIndex:0, pointerEvents:"none" }}/>;
}

/* ─────────────────────────────────────────
   TICKER TAPE — dark strip on light bg
───────────────────────────────────────── */
const tickers = [
  {sym:"BTC",val:"+2.34%",bull:true},{sym:"ETH",val:"-1.12%",bull:false},
  {sym:"AAPL",val:"+0.87%",bull:true},{sym:"TSLA",val:"+4.20%",bull:true},
  {sym:"NVDA",val:"-0.55%",bull:false},{sym:"GOLD",val:"+0.62%",bull:true},
  {sym:"SPY",val:"+0.31%",bull:true},{sym:"OIL",val:"-2.18%",bull:false},
  {sym:"AMZN",val:"+1.05%",bull:true},{sym:"USD/JPY",val:"-0.33%",bull:false},
];
function TickerTape() {
  const items = [...tickers, ...tickers];
  return (
    <div style={{
      overflow:"hidden", background:"#0F1923",
      borderBottom:"3px solid #0D9E6E",
      padding:"7px 0", whiteSpace:"nowrap", position:"relative", zIndex:10,
    }}>
      <div style={{ display:"inline-flex", gap:"48px", animation:"ticker 32s linear infinite" }}>
        {items.map((t,i) => (
          <span key={i} style={{ fontSize:"11px", fontFamily:"'JetBrains Mono',monospace", letterSpacing:"0.04em" }}>
            <span style={{ color:"#94A3B8", marginRight:6 }}>{t.sym}</span>
            <span style={{ color: t.bull ? "#22C78E" : "#F87171" }}>
              {t.bull?"▲":"▼"} {t.val}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   MINI SPARKLINE for entry→exit
───────────────────────────────────────── */
function TradeSparkline({ bull }) {
  const bullPts = "0,30 12,26 24,28 36,18 48,20 60,10 72,14 84,4 96,8";
  const bearPts = "0,8  12,12 24,10 36,20 48,16 60,26 72,22 84,30 96,28";
  const points = bull ? bullPts : bearPts;
  const color = bull ? "#0D9E6E" : "#D63B3B";
  const gradId = bull ? "bullGradLight" : "bearGradLight";
  return (
    <svg width="100%" height="60" viewBox="0 0 96 38" preserveAspectRatio="none" fill="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon
        points={`0,30 ${points} 96,38 0,38`}
        fill={`url(#${gradId})`}
      />
      <polyline
        points={points}
        stroke={color} strokeWidth="2"
        fill="none" strokeLinejoin="round" strokeLinecap="round"
      />
    </svg>
  );
}

/* ─────────────────────────────────────────
   STAT CARD
───────────────────────────────────────── */
function StatCard({ label, value, sub, accent, delay = 0 }) {
  return (
    <div style={{
      background: "#FFFFFF",
      border: "1px solid #E2E8F0",
      borderRadius: 12,
      padding: "16px",
      flex: "1 1 140px",
      animation: `fadeUp 0.5s ease ${delay}s both`,
      overflow: "hidden",
      position: "relative",
      boxShadow: "0 2px 12px rgba(15,25,35,0.06), 0 1px 3px rgba(15,25,35,0.04)",
    }}>
      {accent && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg,${accent},${accent}22)` }}/>}
      <div style={{ fontSize: 10, color: "#94A3B8", letterSpacing: "0.12em", marginBottom: 6, fontFamily: "'JetBrains Mono',monospace", fontWeight: 500, marginTop: accent ? 6 : 0 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: accent || "#0F1923", lineHeight: 1.2 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 9, color: "#94A3B8", marginTop: 4, letterSpacing: "0.08em" }}>{sub}</div>}
    </div>
  );
}

/* ─────────────────────────────────────────
   INFO ROW
───────────────────────────────────────── */
function InfoRow({ label, value, valueColor, icon, delay = 0 }) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "14px 0",
      borderBottom: "1px solid #E2E8F0",
      animation: `fadeUp 0.4s ease ${delay}s both`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {icon && <span style={{ color: "#94A3B8" }}>{icon}</span>}
        <span style={{ fontSize: 10, letterSpacing: "0.12em", color: "#4A5568", fontFamily: "'JetBrains Mono',monospace" }}>
          {label}
        </span>
      </div>
      <span style={{
        fontSize: 12,
        fontFamily: "'JetBrains Mono',monospace",
        color: valueColor || "#0F1923",
        fontWeight: 600,
        maxWidth: "55%",
        textAlign: "right",
        wordBreak: "break-word",
      }}>
        {value || "—"}
      </span>
    </div>
  );
}

/* ─────────────────────────────────────────
   LOADING STATE
───────────────────────────────────────── */
function LoadingState() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0D9E6E" strokeWidth="2" style={{ animation: "spin 0.8s linear infinite", marginBottom: 14 }}>
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>
      <div style={{ fontSize: 11, color: "#94A3B8", letterSpacing: "0.14em", fontFamily: "'JetBrains Mono',monospace" }}>
        LOADING TRADE DATA...
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   ICONS
───────────────────────────────────────── */
const icons = {
  pair: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>,
  type: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
  lot: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
  entry: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>,
  exit: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>,
  sl: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>,
  tp: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>,
  strategy: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>,
  session: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  notes: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
};

/* ─────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────── */
function TradeDetailContent() {
  const searchParams = useSearchParams();
  const resolvedParams = useMemo(() => ({ id: searchParams.get('id') }), [searchParams]);
  const [trade, setTrade] = useState(null);
  const [mounted, setMounted] = useState(false);

  const fetchTrade = useCallback(async () => {
    if (resolvedParams?.id) {
      const data = await getTrade(resolvedParams.id);
      setTrade(data);
    }
  }, [resolvedParams]);

  useEffect(() => {
    fetchTrade();
    setMounted(true);
  }, [fetchTrade]);

  const bull = trade ? parseFloat(trade.profit) >= 0 : true;
  const profitCol = bull ? "#0D9E6E" : "#D63B3B";
  const rr = trade?.stopLoss && trade?.entryPrice && trade?.takeProfit
    ? Math.abs((parseFloat(trade.takeProfit) - parseFloat(trade.entryPrice)) /
               (parseFloat(trade.entryPrice) - parseFloat(trade.stopLoss))).toFixed(2)
    : null;

  return (
    <div style={{
      minHeight: "100vh",
      background: "#F0EEE9",
      fontFamily: "'Plus Jakarta Sans',sans-serif",
      color: "#0F1923",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Fonts */}
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet"/>

      {/* Background */}
      <CandlestickBackground/>
      <div style={{ position: "fixed", inset: 0, zIndex: 1, pointerEvents: "none", background: "linear-gradient(135deg, rgba(240,238,233,0.82) 0%, rgba(240,238,233,0.75) 100%)" }}/>

      <PageHeader />

      <TickerTape/>

      {/* Main */}
      <main style={{
        position: "relative",
        zIndex: 5,
        padding: "16px",
        maxWidth: 860,
        margin: "0 auto",
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateY(0)" : "translateY(16px)",
        transition: "all 0.5s cubic-bezier(0.22,1,0.36,1)",
      }}>

        {!trade ? <LoadingState/> : (
          <>
            {/* Page title */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 10 }}>
              <div>
                <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em", color: "#0F1923", lineHeight: 1.1 }}>
                  Trade <span style={{ color: profitCol }}>Detail</span>
                </div>
                <div style={{ fontSize: 10, color: "#94A3B8", letterSpacing: "0.06em", marginTop: 3, fontFamily: "'JetBrains Mono',monospace" }}>
                  FULL BREAKDOWN — AI JOURNAL ENTRY
                </div>
              </div>
              <span style={{
                fontSize: 11, letterSpacing: "0.1em", flexShrink: 0,
                color: trade.type?.toUpperCase() === "LONG" ? "#0D9E6E" : "#D63B3B",
                background: trade.type?.toUpperCase() === "LONG" ? "rgba(13,158,110,0.1)" : "rgba(214,59,59,0.1)",
                border: `1px solid ${trade.type?.toUpperCase() === "LONG" ? "rgba(13,158,110,0.3)" : "rgba(214,59,59,0.3)"}`,
                borderRadius: 20, padding: "5px 14px",
                fontFamily: "'JetBrains Mono',monospace", fontWeight: 700,
              }}>
                {trade.type?.toUpperCase() === "LONG" ? "▲ LONG" : "▼ SHORT"}
              </span>
            </div>

            {/* Hero stat cards — 2 per row on mobile, 4 on desktop */}
            <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <StatCard
                label="PAIR"
                value={trade.pair}
                accent={profitCol}
                delay={0}
              />
              <StatCard
                label="PROFIT / LOSS"
                value={`${bull ? "+" : ""}${trade.profit}`}
                accent={profitCol}
                delay={0.05}
              />
              {rr && (
                <StatCard
                  label="RISK : REWARD"
                  value={`1 : ${rr}`}
                  sub="CALCULATED FROM SL/TP"
                  accent={parseFloat(rr) >= 2 ? "#0D9E6E" : "#B8860B"}
                  delay={0.1}
                />
              )}
              <StatCard
                label="SESSION"
                value={trade.session || "—"}
                delay={0.15}
              />
            </div>

            {/* Sparkline banner */}
            <div style={{
              background: "#FFFFFF",
              border: "1px solid #E2E8F0",
              borderRadius: 14,
              overflow: "hidden",
              marginBottom: 12,
              marginTop: 10,
              position: "relative",
              animation: "fadeUp 0.5s ease 0.1s both",
              boxShadow: "0 2px 12px rgba(15,25,35,0.06)",
            }}>
              <div style={{ height: 3, background: `linear-gradient(90deg,${profitCol},${profitCol}22)` }}/>
              <div style={{ padding: "12px 20px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10, color: "#94A3B8", letterSpacing: "0.12em", fontFamily: "'JetBrains Mono',monospace" }}>
                  TRADE TRAJECTORY
                </span>
                <span style={{ fontSize: 10, color: profitCol, letterSpacing: "0.1em", fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>
                  {bull ? "▲ PROFITABLE" : "▼ LOSS"}
                </span>
              </div>
              <TradeSparkline bull={bull}/>
              {/* Entry / Exit overlaid labels */}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "0 20px 14px" }}>
                <div>
                  <div style={{ fontSize: 9, color: "#94A3B8", letterSpacing: "0.1em", fontFamily: "'JetBrains Mono',monospace" }}>ENTRY</div>
                  <div style={{ fontSize: 12, color: "#4A5568", fontFamily: "'JetBrains Mono',monospace" }}>{trade.entryPrice || "—"}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 9, color: "#94A3B8", letterSpacing: "0.1em", fontFamily: "'JetBrains Mono',monospace" }}>EXIT</div>
                  <div style={{ fontSize: 12, color: profitCol, fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>{trade.exitPrice || "—"}</div>
                </div>
              </div>
            </div>

            {/* Two column layout on desktop, single on mobile */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>

              {/* Left — Trade Metrics */}
              <div style={{
                flex: "1 1 300px",
                background: "#FFFFFF",
                border: "1px solid #E2E8F0",
                borderRadius: 14,
                overflow: "hidden",
                boxShadow: "0 2px 12px rgba(15,25,35,0.06)",
                animation: "fadeUp 0.5s ease 0.15s both",
              }}>
                <div style={{ height: 3, background: "linear-gradient(90deg,#0D9E6E,#0D9E6E22)" }}/>
                <div style={{ padding: "18px 20px", borderBottom: "1px solid #E2E8F0" }}>
                  <div style={{ fontSize: 11, color: "#4A5568", letterSpacing: "0.14em", fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>◆ TRADE METRICS</div>
                </div>
                <div style={{ padding: "6px 20px 18px" }}>
                  <InfoRow label="PAIR" value={trade.pair} icon={icons.pair} valueColor="#0F1923" delay={0.15}/>
                  <InfoRow label="TYPE" value={trade.type?.toUpperCase()} icon={icons.type} valueColor={profitCol} delay={0.18}/>
                  <InfoRow label="LOT SIZE" value={trade.lotSize} icon={icons.lot} delay={0.21}/>
                  <InfoRow label="ENTRY PRICE" value={trade.entryPrice} icon={icons.entry} delay={0.24}/>
                  <InfoRow label="EXIT PRICE" value={trade.exitPrice} icon={icons.exit} valueColor={profitCol} delay={0.27}/>
                  <InfoRow label="STOP LOSS" value={trade.stopLoss} icon={icons.sl} valueColor="#D63B3B" delay={0.30}/>
                  <InfoRow label="TAKE PROFIT" value={trade.takeProfit} icon={icons.tp} valueColor="#0D9E6E" delay={0.33}/>
                  <InfoRow label="PROFIT / LOSS" value={`${bull ? "+" : ""}${trade.profit}`} icon={icons.pair} valueColor={profitCol} delay={0.36}/>
                </div>
              </div>

              {/* Right — Strategy & Notes */}
              <div style={{ flex: "1 1 280px", display: "flex", flexDirection: "column", gap: 16 }}>

                {/* Strategy card */}
                <div style={{
                  background: "#FFFFFF",
                  border: "1px solid #E2E8F0",
                  borderRadius: 14,
                  overflow: "hidden",
                  boxShadow: "0 2px 12px rgba(15,25,35,0.06)",
                  animation: "fadeUp 0.5s ease 0.2s both",
                }}>
                  <div style={{ height: 3, background: "linear-gradient(90deg,#D63B3B,#D63B3B22)" }}/>
                  <div style={{ padding: "18px 20px", borderBottom: "1px solid #E2E8F0" }}>
                    <div style={{ fontSize: 11, color: "#4A5568", letterSpacing: "0.14em", fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>◆ STRATEGY & SESSION</div>
                  </div>
                  <div style={{ padding: "6px 20px 18px" }}>
                  <InfoRow label="STRATEGY" value={trade.strategy} icon={icons.strategy} valueColor="#0F1923" delay={0.22}/>
                    <InfoRow label="SESSION" value={trade.session} icon={icons.session} valueColor="#B8860B" delay={0.25}/>
                    <InfoRow label="RISK : REWARD" value={trade.riskRewardRatio === "custom" ? trade.riskRewardCustom : trade.riskRewardRatio} icon={icons.strategy} valueColor={trade.riskRewardRatio ? "#0D9E6E" : "#94A3B8"} delay={0.28}/>
                  </div>
                </div>

                {/* Notes card */}
                <div style={{
                  background: "#FFFFFF",
                  border: "1px solid #E2E8F0",
                  borderRadius: 14,
                  overflow: "hidden",
                  boxShadow: "0 2px 12px rgba(15,25,35,0.06)",
                  flex: 1,
                  animation: "fadeUp 0.5s ease 0.25s both",
                }}>
                  <div style={{ height: 3, background: "linear-gradient(90deg,#B8860B,#B8860B22)" }}/>
                  <div style={{ padding: "18px 20px", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "#94A3B8" }}>{icons.notes}</span>
                    <div style={{ fontSize: 11, color: "#4A5568", letterSpacing: "0.14em", fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>◆ TRADER NOTES</div>
                  </div>
                  <div style={{ padding: "18px 20px" }}>
                    {trade.notes ? (
                      <p style={{
                        fontSize: 13,
                        color: "#4A5568",
                        fontFamily: "'Plus Jakarta Sans',sans-serif",
                        lineHeight: 1.8,
                        margin: 0,
                        borderLeft: "3px solid #B8860B",
                        paddingLeft: 14,
                      }}>
                        {trade.notes}
                      </p>
                    ) : (
                      <p style={{ fontSize: 11, color: "#94A3B8", letterSpacing: "0.08em", fontStyle: "italic", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
                        NO NOTES RECORDED FOR THIS TRADE.
                      </p>
                    )}
                  </div>
                </div>

                {/* AI Insight placeholder card */}
                <div style={{
                  background: "linear-gradient(135deg, #0F1923 0%, #1a2d3d 100%)",
                  borderRadius: 14,
                  padding: "18px 20px",
                  boxShadow: "0 4px 16px rgba(15,25,35,0.15)",
                  animation: "fadeUp 0.5s ease 0.3s both",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: "rgba(34,199,142,0.15)",
                      border: "1px solid rgba(34,199,142,0.25)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22C78E", animation: "blink 1.2s ease-in-out infinite" }}/>
                    </div>
                    <div style={{ fontSize: 11, color: "#22C78E", letterSpacing: "0.14em", fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>AI ANALYSIS</div>
                  </div>
                  <p style={{ fontSize: 11, color: "#94A3B8", lineHeight: 1.7, letterSpacing: "0.04em", margin: 0, fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
                    AI INSIGHTS WILL APPEAR HERE BASED ON YOUR ENTRY, EXIT, STRATEGY, AND HISTORICAL PATTERN DATA.
                  </p>
                </div>

                {/* Evidence Gallery (renders legacy screenshot + new tradeImages) */}
                {(trade.screenshot || (trade.tradeImages && trade.tradeImages.length > 0)) && (
                  <div style={{
                    background: "#FFFFFF",
                    border: "1px solid #E2E8F0",
                    borderRadius: 14,
                    overflow: "hidden",
                    boxShadow: "0 2px 12px rgba(15,25,35,0.06)",
                    animation: "fadeUp 0.5s ease 0.35s both",
                  }}>
                    <div style={{ height: 3, background: "linear-gradient(90deg,#6366F1,#6366F122)" }}/>
                    <div style={{ padding: "18px 20px" }}>
                      <TradeEvidenceGallery
                        images={trade.tradeImages || []}
                        legacyScreenshot={trade.screenshot}
                        title="◆ TRADE EVIDENCE"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Psychology Section */}
            {(trade.mood || trade.confidence || trade.entryBasis || (trade.emotionalTags?.length > 0) || trade.mistakeTag || trade.lesson || trade.setupScore != null) && (
              <div style={{
                background: "#FFFFFF",
                border: "1px solid #E2E8F0",
                borderRadius: 14,
                overflow: "hidden",
                boxShadow: "0 2px 12px rgba(15,25,35,0.06)",
                marginTop: 16,
                animation: "fadeUp 0.5s ease 0.3s both",
              }}>
                <div style={{ height: 3, background: "linear-gradient(90deg,#6366F1,#6366F122)" }}/>
                <div style={{ padding: "18px 20px", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 16 }}>🧠</span>
                  <div style={{ fontSize: 11, color: "#4A5568", letterSpacing: "0.14em", fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>◆ PSYCHOLOGY & REVIEW</div>
                </div>
                <div style={{ padding: "6px 20px 18px" }}>
                  {trade.entryBasis && (
                    <InfoRow
                      label="ENTRY BASIS"
                      value={trade.entryBasis === "Custom" ? (trade.entryBasisCustom || trade.entryBasis) : trade.entryBasis}
                      delay={0.32}
                    />
                  )}
                  {trade.mood && (
                    <InfoRow
                      label="MOOD (1–5)"
                      value={"★".repeat(trade.mood) + "☆".repeat(5 - trade.mood) + `  (${trade.mood}/5)`}
                      valueColor="#6366F1"
                      delay={0.34}
                    />
                  )}
                  {trade.confidence && (
                    <InfoRow
                      label="CONFIDENCE"
                      value={trade.confidence}
                      valueColor={trade.confidence === "High" ? "#0D9E6E" : trade.confidence === "Overconfident" ? "#D63B3B" : trade.confidence === "Low" ? "#94A3B8" : "#B8860B"}
                      delay={0.36}
                    />
                  )}
                  {trade.wouldRetake && (
                    <InfoRow
                      label="WOULD RETAKE?"
                      value={trade.wouldRetake}
                      valueColor={trade.wouldRetake === "Yes" ? "#0D9E6E" : "#D63B3B"}
                      delay={0.38}
                    />
                  )}
                  {trade.emotionalTags?.length > 0 && (
                    <div style={{ padding: "14px 0", borderBottom: "1px solid #E2E8F0" }}>
                      <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#4A5568", fontFamily: "'JetBrains Mono',monospace", marginBottom: 8 }}>EMOTIONAL TAGS</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {trade.emotionalTags.map((tag, i) => (
                          <span key={i} style={{
                            fontSize: 10,
                            fontFamily: "'JetBrains Mono',monospace",
                            color: "#6366F1",
                            background: "rgba(99,102,241,0.08)",
                            border: "1px solid rgba(99,102,241,0.2)",
                            borderRadius: 20,
                            padding: "3px 10px",
                          }}>{tag}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {trade.mistakeTag && (
                    <InfoRow label="MISTAKE TAG" value={trade.mistakeTag} valueColor="#D63B3B" delay={0.40}/>
                  )}
                  {trade.setupScore != null && (
                    <InfoRow
                      label="SETUP SCORE"
                      value={`${trade.setupScore}%`}
                      valueColor={trade.setupScore >= 70 ? "#0D9E6E" : trade.setupScore >= 40 ? "#B8860B" : "#D63B3B"}
                      delay={0.42}
                    />
                  )}
                  {trade.lesson && (
                    <div style={{ paddingTop: 14 }}>
                      <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#4A5568", fontFamily: "'JetBrains Mono',monospace", marginBottom: 8 }}>LESSON LEARNED</div>
                      <p style={{
                        fontSize: 13,
                        color: "#4A5568",
                        fontFamily: "'Plus Jakarta Sans',sans-serif",
                        lineHeight: 1.8,
                        margin: 0,
                        borderLeft: "3px solid #6366F1",
                        paddingLeft: 14,
                      }}>{trade.lesson}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Bottom actions */}
            <div style={{
              display: "flex",
              gap: 12,
              marginTop: 20,
              flexWrap: "wrap",
              animation: "fadeUp 0.5s ease 0.35s both",
            }}>
              <Link href="/trades" style={{
                flex: "1 1 140px",
                textAlign: "center",
                fontSize: 11,
                letterSpacing: "0.14em",
                fontFamily: "'JetBrains Mono',monospace",
                color: "#4A5568",
                border: "1px solid #E2E8F0",
                background: "#FFFFFF",
                borderRadius: 10,
                padding: "14px",
                textDecoration: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                fontWeight: 600,
                boxShadow: "0 2px 8px rgba(15,25,35,0.05)",
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/>
                </svg>
                BACK TO JOURNAL
              </Link>
              <Link href={`/trades/edit?id=${resolvedParams?.id}`} style={{
                flex: "1 1 140px",
                textAlign: "center",
                fontSize: 11,
                letterSpacing: "0.14em",
                fontFamily: "'JetBrains Mono',monospace",
                color: "#FFFFFF",
                border: "none",
                background: "linear-gradient(135deg, #0F1923 0%, #1a2d3d 100%)",
                borderRadius: 10,
                padding: "14px",
                textDecoration: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                fontWeight: 600,
                boxShadow: "0 4px 16px rgba(15,25,35,0.2)",
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                EDIT TRADE
              </Link>
            </div>
          </>
        )}
      </main>

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes ticker { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @media (min-width: 600px) {
          .stat-grid { grid-template-columns: repeat(4, 1fr) !important; }
          .main-pad { padding: 24px !important; }
        }
      `}</style>
    </div>
  );
}

export default function TradeDetail() {
  return (
    <React.Suspense fallback={<LoadingState />}>
      <TradeDetailContent />
    </React.Suspense>
  );
}
