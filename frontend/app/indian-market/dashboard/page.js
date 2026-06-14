"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import {
    getSummary,
    getPerformanceMetrics,
    getDrawdownAnalysis,
    getAIInsights,
    getPnLBreakdown
} from "@/services/analyticsApi";
import Link from "next/link";
import IndianMarketHeader from "@/components/IndianMarketHeader";
import { useMarket, MARKETS } from "@/context/MarketContext";
import { getTrades } from "@/services/tradeApi";
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    Tooltip,
    CartesianGrid,
    ReferenceLine,
    XAxis,
    YAxis
} from "recharts";

const C = {
    bull:    "#0D9E6E",
    bear:    "#D63B3B",
    gold:    "#B8860B",
    blue:    "#2563EB",
    purple:  "#8B5CF6",
    ink:     "#0F1923",
    muted:   "#94A3B8",
    border:  "#E2E8F0",
    bg:      "#F4F2EE",
    card:    "#FFFFFF",
    sub:     "#64748B",
};

/* ── Helpers ──────────────────────────────────────────────────────────── */
function formatINR(val) {
    const n = Number(val);
    if (Number.isNaN(n)) return "₹0";
    return `₹${Math.round(Math.abs(n)).toLocaleString("en-IN")}`;
}
function signedINR(val) {
    const n = Number(val);
    if (Number.isNaN(n)) return "₹0";
    return `${n >= 0 ? "+" : "-"}₹${Math.round(Math.abs(n)).toLocaleString("en-IN")}`;
}
function greetingFor(h) {
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
}

/* ── Ticker tape ──────────────────────────────────────────────────────── */
function TickerTape({ items }) {
    const safe = Array.isArray(items) ? items.filter(Boolean) : [];
    const loop = safe.length > 0 ? [...safe, ...safe] : [];
    return (
        <div style={{ overflow: "hidden", background: C.ink, borderBottom: `3px solid ${C.gold}`, padding: "7px 0", whiteSpace: "nowrap", zIndex: 10 }}>
            <div style={{ display: "inline-flex", gap: 48, animation: loop.length > 0 ? "imTicker 32s linear infinite" : "none" }}>
                {loop.length > 0 ? loop.map((t, i) => (
                    <span key={i} style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.04em" }}>
                        <span style={{ color: "#E8F5E9", marginRight: 8 }}>{t.sym}</span>
                        <span style={{ color: t.bull ? "#A5D6A7" : "#EF9A9A" }}>{t.bull ? "▲" : "▼"} {t.val}</span>
                    </span>
                )) : (
                    <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: "#E8F5E9", letterSpacing: "0.04em" }}>
                        Log trades to activate tape · Recent trades · Real P&L · NSE · BSE
                    </span>
                )}
            </div>
        </div>
    );
}

/* ── Panel (matches Forex DashboardPanel) ─────────────────────────────── */
function Panel({ title, subtitle, children, action, accent = C.bull }) {
    return (
        <section style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, boxShadow: "0 2px 12px rgba(15,25,35,0.04)", overflow: "hidden" }}>
            <div style={{ height: 3, background: `linear-gradient(90deg,${accent},transparent)` }} />
            <div style={{ padding: "16px 20px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>{title}</div>
                        {subtitle && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{subtitle}</div>}
                    </div>
                    {action}
                </div>
                {children}
            </div>
        </section>
    );
}

/* ── Insight item (matches Forex InsightItem) ─────────────────────────── */
function Insight({ label, value, tone = C.bull }) {
    return (
        <div style={{ padding: "10px 12px", borderRadius: 10, background: `${tone}08`, border: `1px solid ${tone}22` }}>
            <div style={{ fontSize: 9, fontWeight: 900, color: tone, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.55, fontWeight: 700 }}>{value}</div>
        </div>
    );
}

/* ── Quick action (matches Forex QuickAction) ─────────────────────────── */
function QuickAction({ href, icon, label, sub, accent = C.bull }) {
    return (
        <Link href={href} className="im-quick-action" style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 70, padding: "12px 14px", borderRadius: 12, border: `1px solid ${C.border}`, background: C.card, color: C.ink, textDecoration: "none" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: `${accent}12`, color: accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {icon}
            </div>
            <div>
                <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.35 }}>{sub}</div>
            </div>
        </Link>
    );
}

/* ── KPI chip (horizontal strip) ─────────────────────────────────────── */
function KpiCard({ label, value, sub, accent }) {
    return (
        <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden", boxShadow: "0 2px 8px rgba(15,25,35,0.04)", flex: "1 1 140px", minWidth: 0 }}>
            <div style={{ height: 3, background: `linear-gradient(90deg,${accent},${accent}22)` }} />
            <div style={{ padding: "14px 16px 12px" }}>
                <div style={{ fontSize: 10, color: C.muted, letterSpacing: "0.1em", fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, marginBottom: 8 }}>{label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace", color: accent, lineHeight: 1, marginBottom: 4 }}>{value}</div>
                {sub && <div style={{ fontSize: 10, color: C.muted }}>{sub}</div>}
            </div>
        </div>
    );
}

/* ── Metric bar ───────────────────────────────────────────────────────── */
function MetricBar({ label, value, sub, percent = 0, color = C.bull }) {
    const p = Math.max(0, Math.min(100, percent));
    return (
        <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 7, gap: 8 }}>
                <div>
                    <div style={{ fontSize: 10, letterSpacing: "0.1em", color: C.muted, fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>{label}</div>
                    {sub && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{sub}</div>}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 800, color }}>{value}</div>
            </div>
            <div style={{ height: 8, background: "#EEF2F7", borderRadius: 999, overflow: "hidden", border: `1px solid ${C.border}` }}>
                <div style={{ height: "100%", width: `${p}%`, background: `linear-gradient(90deg,${color},${color}88)`, borderRadius: 999, transition: "width 0.6s ease" }} />
            </div>
        </div>
    );
}

/* ── New Trade dropdown ───────────────────────────────────────────────── */
function CreateTradeButton() {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const go = (path) => { setOpen(false); router.push(path); };
    const tile = { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 8px", borderRadius: 8, border: "none", cursor: "pointer", background: "rgba(13,158,110,0.06)", transition: "background 0.15s", width: "100%" };
    return (
        <div style={{ position: "relative" }}>
            <button onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: 8, background: `linear-gradient(135deg,${C.bull} 0%,#22C78E 100%)`, color: "#fff", borderRadius: 10, padding: "12px 18px", fontSize: 12, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, letterSpacing: "0.08em", border: "none", boxShadow: "0 4px 16px rgba(13,158,110,0.28)", cursor: "pointer" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                LOG TRADE
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {open && (
                <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 8, background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: "0 8px 32px rgba(15,25,35,0.15)", overflow: "hidden", minWidth: 200, zIndex: 100 }}>
                    <div style={{ padding: "8px 14px 4px", fontSize: 9, fontWeight: 700, color: C.muted, letterSpacing: "0.1em", fontFamily: "'JetBrains Mono',monospace" }}>MANUAL</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, padding: "0 10px 10px" }}>
                        <button onClick={() => go("/indian-market/add-trade")} style={tile} onMouseEnter={e => e.currentTarget.style.background="rgba(13,158,110,0.1)"} onMouseLeave={e => e.currentTarget.style.background="rgba(13,158,110,0.06)"}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.bull} strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            <span style={{ fontSize: 11, fontWeight: 700, color: C.bull }}>Options</span>
                        </button>
                        <button onClick={() => go("/indian-market/add-trade?type=EQUITY")} style={{ ...tile, background: "rgba(37,99,235,0.06)" }} onMouseEnter={e => e.currentTarget.style.background="rgba(37,99,235,0.12)"} onMouseLeave={e => e.currentTarget.style.background="rgba(37,99,235,0.06)"}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                            <span style={{ fontSize: 11, fontWeight: 700, color: C.blue }}>Stock</span>
                        </button>
                    </div>
                    <div style={{ height: 1, background: C.border }} />
                    <div style={{ padding: "8px 14px 4px", fontSize: 9, fontWeight: 700, color: C.muted, letterSpacing: "0.1em", fontFamily: "'JetBrains Mono',monospace" }}>AI EXTRACT</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, padding: "0 10px 10px" }}>
                        <button onClick={() => go("/indian-market/upload-trade")} style={{ ...tile, background: "rgba(184,134,11,0.06)" }} onMouseEnter={e => e.currentTarget.style.background="rgba(184,134,11,0.12)"} onMouseLeave={e => e.currentTarget.style.background="rgba(184,134,11,0.06)"}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.gold} strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                            <span style={{ fontSize: 11, fontWeight: 700, color: C.gold }}>Options</span>
                        </button>
                        <button onClick={() => go("/indian-market/upload-trade?type=EQUITY")} style={{ ...tile, background: "rgba(124,58,237,0.06)" }} onMouseEnter={e => e.currentTarget.style.background="rgba(124,58,237,0.12)"} onMouseLeave={e => e.currentTarget.style.background="rgba(124,58,237,0.06)"}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.purple} strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                            <span style={{ fontSize: 11, fontWeight: 700, color: C.purple }}>Stock</span>
                        </button>
                    </div>
                </div>
            )}
            {open && <div style={{ position: "fixed", inset: 0, zIndex: 50 }} onClick={() => setOpen(false)} />}
        </div>
    );
}

/* ── Empty state ──────────────────────────────────────────────────────── */
function EmptyState() {
    return (
        <div style={{ textAlign: "center", padding: "48px 24px", background: C.card, borderRadius: 16, border: `1px solid ${C.border}` }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: `${C.bull}10`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={C.bull} strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.ink, marginBottom: 8 }}>Log your first trade to unlock your Edge.</div>
            <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 24 }}>Your dashboard will show P&L, win rate, equity curve, and AI intelligence once you start logging trades.</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <Link href="/indian-market/add-trade" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.bull, color: "#fff", borderRadius: 10, padding: "12px 20px", fontSize: 13, fontWeight: 700, textDecoration: "none" }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Log Options Trade
                </Link>
                <Link href="/indian-market/upload-trade" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: `${C.gold}15`, color: C.gold, borderRadius: 10, padding: "12px 20px", fontSize: 13, fontWeight: 700, textDecoration: "none", border: `1px solid ${C.gold}30` }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    Upload Screenshot
                </Link>
            </div>
        </div>
    );
}

/* ── Skeleton strip ───────────────────────────────────────────────────── */
function SkeletonStrip() {
    return (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, marginBottom: 18 }}>
            {[0,1,2,3].map(i => (
                <div key={i} style={{ background: C.card, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border}` }}>
                    <div style={{ height: 3, background: C.border }} />
                    <div style={{ padding: "14px 16px 12px" }}>
                        <div style={{ height: 9, width: "50%", borderRadius: 4, background: C.border, marginBottom: 12 }} />
                        <div style={{ height: 24, width: "70%", borderRadius: 4, background: C.border, marginBottom: 6 }} />
                        <div style={{ height: 8, width: "40%", borderRadius: 4, background: C.border }} />
                    </div>
                </div>
            ))}
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════════════ */
export default function IndianMarketDashboard() {
    const router  = useRouter();
    const { ready } = useRequireAuth();
    const { currentMarket } = useMarket();

    const [stats,        setStats]        = useState(null);
    const [perf,         setPerf]         = useState(null);
    const [drawdown,     setDrawdown]     = useState(null);
    const [ai,           setAi]           = useState(null);
    const [breakdown,    setBreakdown]    = useState(null);
    const [recentTrades, setRecentTrades] = useState([]);
    const [loading,      setLoading]      = useState(true);

    useEffect(() => {
        if (!ready) return;
        setLoading(true);
        Promise.all([
            getSummary(MARKETS.INDIAN_MARKET),
            getPerformanceMetrics(MARKETS.INDIAN_MARKET),
            getDrawdownAnalysis(MARKETS.INDIAN_MARKET),
            getAIInsights(MARKETS.INDIAN_MARKET),
            getPnLBreakdown(MARKETS.INDIAN_MARKET),
            getTrades(MARKETS.INDIAN_MARKET),
        ]).then(([sumRes, perfRes, ddRes, aiRes, pnlRes, tradesRes]) => {
            setStats(sumRes);
            setPerf(perfRes);
            setDrawdown(ddRes);
            setAi(aiRes);
            setBreakdown(pnlRes);
            const list   = Array.isArray(tradesRes) ? tradesRes : (tradesRes?.trades ?? []);
            const sorted = [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            setRecentTrades(sorted.slice(0, 10));
        }).catch(err => console.error("Indian Market dashboard fetch failed:", err))
          .finally(() => setLoading(false));
    }, [ready, currentMarket]);

    /* ── Derived values ─────────────────────────────────────────────── */
    const todayKey       = new Date().toISOString().split("T")[0];
    const todayPnl       = breakdown?.daily?.find(d => d.date === todayKey)?.profit ?? 0;
    const totalTrades    = stats?.totalTrades ?? 0;
    const netPnl         = Number(stats?.netProfit ?? stats?.totalProfit ?? 0);
    const winRate        = parseFloat(stats?.winRate ?? 0);
    const planPct        = parseFloat(ai?.behaviorDiscipline?.ruleEmotion?.planPct || 0);
    const recoveryFactor = parseFloat(drawdown?.recoveryFactor || 0);
    const profitFactor   = perf?.profitFactor === "Infinity" ? "∞" : parseFloat(perf?.profitFactor || 0).toFixed(2);
    const maxWinStreak   = perf?.maxWinStreak ?? 0;
    const hasData        = !loading && totalTrades > 0;

    const tapeItems = recentTrades.slice(0, 6).map(t => {
        const pnl = Number(t.profit || 0);
        return { sym: (t.pair || "TRADE").toString().toUpperCase().slice(0, 24), val: signedINR(pnl), bull: pnl >= 0 };
    });

    const equity = Array.isArray(drawdown?.equityCurve)
        ? drawdown.equityCurve.map((p, idx) => ({ idx, balance: Number(p.balance || 0) }))
        : [];

    /* ── Intelligence ────────────────────────────────────────────────── */
    const topSetup    = ai?.behaviorDiscipline?.topSetups?.[0];
    const strength    = topSetup?.setup || (maxWinStreak >= 2 ? `${maxWinStreak}-trade win streak active` : "Log more trades to reveal your strongest setup.");
    const leak        = planPct < 70 && totalTrades > 3 ? `Plan adherence at ${planPct.toFixed(0)}% — ${(100 - planPct).toFixed(0)}% of trades deviated from plan.` : "No dominant leak detected yet. Keep logging clean trades.";
    const focus       = planPct >= 70 ? `Strong discipline (${planPct.toFixed(0)}%). Focus: protect the streak.` : totalTrades > 5 ? "Run the pre-trade checklist on every setup before entry." : "Complete your first 5 trades to unlock focus recommendations.";
    const aiRec       = topSetup ? `Your ${topSetup.setup} setup is performing. Prioritise it when conditions align.` : "Run the checklist before every trade and keep the sample clean.";

    const hour = new Date().getHours();

    return (
        <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Plus Jakarta Sans',sans-serif", color: C.ink }}>
            <IndianMarketHeader />
            <TickerTape items={tapeItems} />

            <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 20px", boxSizing: "border-box" }}>

                {/* ── Greeting row ────────────────────────────────── */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22, flexWrap: "wrap", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 5 }}>
                            {new Date().toLocaleDateString("en-IN", { weekday: "long", month: "short", day: "numeric" })} · NSE / BSE
                        </div>
                        <h1 style={{ fontSize: 26, fontWeight: 800, color: C.ink, letterSpacing: "-0.025em", margin: 0, lineHeight: 1.15 }}>
                            {greetingFor(hour)}<span style={{ color: C.bull }}>, Trader</span>
                        </h1>
                        <p style={{ fontSize: 13, color: C.sub, margin: "5px 0 0" }}>Here's your edge today.</p>
                    </div>
                    <CreateTradeButton />
                </div>

                {/* ── KPI grid ────────────────────────────────────── */}
                {loading ? <SkeletonStrip /> : (
                    <>
                        {!hasData ? <EmptyState /> : (
                            <>
                                <div className="im-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 18 }}>
                                    <KpiCard
                                        label="TOTAL TRADES"
                                        value={totalTrades}
                                        sub="logged"
                                        accent={C.bull}
                                    />
                                    <KpiCard
                                        label="NET P&L"
                                        value={signedINR(netPnl)}
                                        sub={`Costs: ${formatINR(stats?.totalCosts || 0)}`}
                                        accent={netPnl >= 0 ? C.bull : C.bear}
                                    />
                                    <KpiCard
                                        label="WIN RATE"
                                        value={`${winRate.toFixed(1)}%`}
                                        sub={`${stats?.winningTrades ?? 0}W / ${stats?.losingTrades ?? 0}L`}
                                        accent={winRate >= 50 ? C.bull : C.bear}
                                    />
                                    <KpiCard
                                        label="TODAY P&L"
                                        value={signedINR(todayPnl)}
                                        sub="today's trades"
                                        accent={todayPnl >= 0 ? C.bull : C.bear}
                                    />
                                </div>

                                {/* ── Equity curve ────────────────────────────── */}
                                <div style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, overflow: "hidden", boxShadow: "0 2px 12px rgba(15,25,35,0.05)", marginBottom: 18 }}>
                                    <div style={{ height: 3, background: `linear-gradient(90deg,${netPnl >= 0 ? C.bull : C.bear},transparent)` }} />
                                    <div style={{ padding: "16px 20px" }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                                            <div>
                                                <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>Equity Curve</div>
                                                <div style={{ fontSize: 11, color: C.muted, fontFamily: "'JetBrains Mono',monospace", marginTop: 2 }}>Account growth over time</div>
                                            </div>
                                            <span style={{ fontSize: 11, color: netPnl >= 0 ? C.bull : C.bear, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, background: netPnl >= 0 ? "rgba(13,158,110,0.08)" : "rgba(214,59,59,0.08)", border: `1px solid ${netPnl >= 0 ? "rgba(13,158,110,0.2)" : "rgba(214,59,59,0.2)"}`, borderRadius: 6, padding: "3px 10px" }}>
                                                {netPnl >= 0 ? "▲ BULLISH" : "▼ BEARISH"}
                                            </span>
                                        </div>
                                        <div style={{ height: 210 }}>
                                            {equity.length > 1 ? (
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <AreaChart data={equity} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                                        <defs>
                                                            <linearGradient id="imEqFill" x1="0" y1="0" x2="0" y2="1">
                                                                <stop offset="0%" stopColor={C.bull} stopOpacity={0.22} />
                                                                <stop offset="100%" stopColor={C.bull} stopOpacity={0} />
                                                            </linearGradient>
                                                        </defs>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" strokeOpacity={0.6} />
                                                        <XAxis dataKey="idx" hide tickLine={false} axisLine={false} />
                                                        <YAxis tickLine={false} axisLine={false} tick={{ fill: C.muted, fontSize: 10 }} width={58} tickFormatter={v => formatINR(v)} />
                                                        <Tooltip content={({ active, payload }) => {
                                                            if (!active || !payload?.length) return null;
                                                            return (
                                                                <div style={{ background: "rgba(255,255,255,0.96)", border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px", boxShadow: "0 8px 24px rgba(15,25,35,0.12)" }}>
                                                                    <div style={{ fontSize: 9, color: C.muted, fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.1em" }}>BALANCE</div>
                                                                    <div style={{ fontSize: 15, fontWeight: 900, color: C.ink }}>{formatINR(payload[0].value)}</div>
                                                                </div>
                                                            );
                                                        }} />
                                                        <ReferenceLine y={0} stroke={C.border} strokeWidth={2} strokeDasharray="5 5" />
                                                        <Area type="monotone" dataKey="balance" stroke={C.bull} strokeWidth={2.5} fill="url(#imEqFill)" dot={false} />
                                                    </AreaChart>
                                                </ResponsiveContainer>
                                            ) : (
                                                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 13 }}>
                                                    Log more trades to see your equity curve.
                                                </div>
                                            )}
                                        </div>
                                        {drawdown?.maxDrawdown > 0 && (
                                            <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between" }}>
                                                <div style={{ fontSize: 11, color: C.muted }}>Max drawdown</div>
                                                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, fontWeight: 800, color: C.bear }}>{formatINR(drawdown.maxDrawdown)} ({drawdown.maxDrawdownPercent || 0}%)</div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* ── Intelligence + AI Coach ──────────────────── */}
                                <div className="im-focus-grid" style={{ display: "grid", gridTemplateColumns: "1.35fr 0.65fr", gap: 14, marginBottom: 18 }}>
                                    <Panel
                                        title="Today's Intelligence"
                                        subtitle="Strength, leak, focus, and next action"
                                        accent={C.purple}
                                        action={<Link href="/indian-market/analytics" style={{ fontSize: 11, fontWeight: 800, color: C.purple, textDecoration: "none", whiteSpace: "nowrap" }}>Open Analytics →</Link>}
                                    >
                                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
                                            <Insight label="Biggest Strength" value={strength} tone={C.bull} />
                                            <Insight label="Biggest Leak"     value={leak}     tone={C.bear} />
                                            <Insight label="Next Focus"       value={focus}    tone={C.gold} />
                                            <Insight label="AI Recommendation" value={aiRec}  tone={C.purple} />
                                        </div>
                                    </Panel>

                                    <Panel
                                        title="Edge Snapshot"
                                        subtitle="Key metrics right now"
                                        accent={C.bull}
                                        action={<Link href="/indian-market/discipline" style={{ fontSize: 11, fontWeight: 800, color: C.bull, textDecoration: "none", whiteSpace: "nowrap" }}>Discipline →</Link>}
                                    >
                                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                            <MetricBar label="PLAN ADHERENCE"  value={`${planPct.toFixed(0)}%`}         percent={planPct}                                               color={planPct >= 70 ? C.bull : C.bear} />
                                            <MetricBar label="WIN STREAK"      value={`${maxWinStreak}`}                 percent={Math.min(100, maxWinStreak * 12)}                      color={C.bull} />
                                            <MetricBar label="PROFIT FACTOR"   value={profitFactor}                     percent={perf?.profitFactor === "Infinity" ? 100 : Math.min(100, (parseFloat(profitFactor || 0) / 2) * 100)} color={parseFloat(profitFactor || 0) >= 1.2 ? C.bull : C.bear} />
                                            <MetricBar label="RECOVERY"        value={`${recoveryFactor.toFixed(2)}x`}  percent={Math.min(100, (recoveryFactor / 2) * 100)}             color={C.gold} />
                                        </div>
                                    </Panel>
                                </div>

                                {/* ── Quick Actions ────────────────────────────── */}
                                <Panel title="Quick Actions" subtitle="Plan, execute, journal, review" accent={C.ink}>
                                    <div className="im-actions-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10 }}>
                                        <QuickAction href="/indian-market/add-trade" label="Log Trade" sub="Manual entry" accent={C.bull}
                                            icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>} />
                                        <QuickAction href="/indian-market/upload-trade" label="Upload Screenshot" sub="AI import" accent={C.gold}
                                            icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>} />
                                        <QuickAction href="/checklist" label="Run Checklist" sub="Pre-trade plan" accent={C.purple}
                                            icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>} />
                                        <QuickAction href="/weekly-reports?market=Indian_Market" label="Weekly Report" sub="AI feedback" accent={C.bull}
                                            icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 4h18M5 4v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4"/><path d="M8 8h8M8 12h5M8 16h3"/></svg>} />
                                    </div>
                                </Panel>

                                {/* ── Recent trades ─────────────────────────────── */}
                                {recentTrades.length > 0 && (
                                    <div style={{ marginTop: 18 }}>
                                        <Panel
                                            title="Recent Activity"
                                            subtitle="Your last logged trades"
                                            accent={C.bull}
                                            action={<Link href="/indian-market/trades" style={{ fontSize: 11, fontWeight: 800, color: C.bull, textDecoration: "none", whiteSpace: "nowrap" }}>View all →</Link>}
                                        >
                                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                                {recentTrades.slice(0, 4).map((t, i) => {
                                                    const pnl     = Number(t.profit || 0);
                                                    const isLong  = (t.direction || "").toUpperCase() === "LONG" || (t.direction || "").toUpperCase() === "BUY";
                                                    const isOpt   = (t.tradeType || "").toUpperCase() !== "EQUITY";
                                                    return (
                                                        <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 10, background: "#F8FAFC", border: `1px solid ${C.border}` }}>
                                                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                                                <div style={{ width: 32, height: 32, borderRadius: 8, background: pnl >= 0 ? `${C.bull}12` : `${C.bear}12`, display: "flex", alignItems: "center", justifyContent: "center", color: pnl >= 0 ? C.bull : C.bear, flexShrink: 0 }}>
                                                                    {pnl >= 0
                                                                        ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
                                                                        : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>
                                                                    }
                                                                </div>
                                                                <div>
                                                                    <div style={{ fontSize: 12, fontWeight: 700, color: C.ink }}>{(t.pair || t.symbol || "Trade").toUpperCase()}</div>
                                                                    <div style={{ fontSize: 10, color: C.muted }}>{isOpt ? (t.optionType || "Options") : "Equity"} · {isLong ? "▲ LONG" : "▼ SHORT"}</div>
                                                                </div>
                                                            </div>
                                                            <div style={{ textAlign: "right" }}>
                                                                <div style={{ fontSize: 13, fontWeight: 800, color: pnl >= 0 ? C.bull : C.bear, fontFamily: "'JetBrains Mono',monospace" }}>{signedINR(pnl)}</div>
                                                                <div style={{ fontSize: 10, color: C.muted }}>{t.setup || "—"}</div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </Panel>
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}
            </main>

            <style jsx global>{`
                @keyframes imTicker {
                    from { transform: translateX(0); }
                    to   { transform: translateX(-50%); }
                }
                @media (max-width: 640px) {
                    main { padding: 14px 14px !important; }
                    .im-kpi-grid    { grid-template-columns: repeat(2,1fr) !important; }
                    .im-focus-grid  { grid-template-columns: 1fr !important; }
                    .im-actions-grid { grid-template-columns: 1fr !important; }
                    .im-quick-action { min-height: 58px !important; }
                }
                @media (max-width: 360px) {
                    .im-kpi-grid { grid-template-columns: 1fr !important; }
                }
            `}</style>
        </div>
    );
}
