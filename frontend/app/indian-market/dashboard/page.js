"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
    getSummary,
    getPerformanceMetrics,
    getDrawdownAnalysis,
    getAIInsights,
    getPnLBreakdown
} from "@/services/analyticsApi";
import Link from "next/link";
import MarketSwitcher from "@/components/MarketSwitcher";
import IndianMarketHeader from "@/components/IndianMarketHeader";
import { useMarket, MARKETS } from "@/context/MarketContext";
import LoadingSpinner from "@/components/LoadingSpinner";
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

/* ─────────────────────────────────────────
   Same as Forex — Bull Green, Deep Navy, Gold
───────────────────────────────────────── */

const theme = {
    bull: "#0D9E6E",
    bear: "#D63B3B",
    gold: "#B8860B",
    primary: "#0D9E6E",
    secondary: "#0F1923",
    muted: "#94A3B8",
    border: "#E2E8F0",
    bg: "#F0EEE9",
    card: "#FFFFFF",
    ink: "#0F1923"
};

/* ─────────────────────────────────────────
   TICKER TAPE — Real recent trades
───────────────────────────────────────── */
function TickerTape({ items }) {
    const safe = Array.isArray(items) ? items.filter(Boolean) : [];
    const loopItems = safe.length > 0 ? [...safe, ...safe] : [];
    return (
        <div style={{
            overflow: "hidden",
            background: theme.secondary,
            borderBottom: `3px solid ${theme.gold}`,
            padding: "7px 0", whiteSpace: "nowrap", position: "relative", zIndex: 10,
        }}>
            <div style={{ display: "inline-flex", gap: "48px", animation: loopItems.length > 0 ? "ticker 32s linear infinite" : "none" }}>
                {loopItems.length > 0 ? (
                    loopItems.map((t, i) => (
                        <span key={i} style={{ fontSize: "11px", fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.04em" }}>
                        <span style={{ color: "#E8F5E9", marginRight: 8 }}>{t.sym}</span>
                        <span style={{ color: t.bull ? "#A5D6A7" : "#EF9A9A" }}>
                                {t.bull ? "▲" : "▼"} {t.val}
                            </span>
                        </span>
                    ))
                ) : (
                    <span style={{ fontSize: "11px", fontFamily: "'JetBrains Mono',monospace", color: "#E8F5E9", letterSpacing: "0.04em" }}>
                        Log trades to activate tape · Recent trades · Real P&L · NSE · BSE
                    </span>
                )}
            </div>
        </div>
    );
}

/* ─────────────────────────────────────────
   STAT CARD
───────────────────────────────────────── */
function StatCard({ label, value, sub, accentColor, icon, delay = 0 }) {
    const displayValue = value !== undefined && value !== null && !isNaN(value) ? value : (value || 0);

    return (
        <div style={{
            background: theme.card, borderRadius: 12,
            border: `1px solid ${theme.border}`,
            flex: "1 1 160px", overflow: "hidden",
            boxShadow: "0 2px 12px rgba(15,25,35,0.06)",
            animation: `fadeUp 0.5s ease ${delay}s both`,
            position: "relative",
        }}>
            <div style={{ height: 3, background: `linear-gradient(90deg,${accentColor},${accentColor}22)` }} />
            <div style={{ padding: "20px 20px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <span style={{ fontSize: 10, color: theme.muted, letterSpacing: "0.12em", fontFamily: "'JetBrains Mono',monospace", fontWeight: 500 }}>
                        {label}
                    </span>
                    {icon && (
                        <div style={{
                            width: 32, height: 32, borderRadius: 8,
                            background: `${accentColor}12`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: accentColor,
                        }}>
                            {icon}
                        </div>
                    )}
                </div>
                <div style={{ fontSize: 30, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: accentColor, lineHeight: 1, marginBottom: 6 }}>
                    {displayValue}
                </div>
                {sub && (
                    <div style={{ fontSize: 10, color: theme.muted, letterSpacing: "0.06em", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
                        {sub}
                    </div>
                )}
            </div>
        </div>
    );
}

/* ─────────────────────────────────────────
   NAV CARD
───────────────────────────────────────── */
function NavCard({ href, label, sub, icon, accentColor = theme.primary, delay = 0 }) {
    return (
        <Link href={href} style={{ textDecoration: "none", flex: "1 1 140px" }}>
            <div
                style={{
                    background: theme.card, borderRadius: 12, padding: "18px",
                    border: `1px solid ${theme.border}`, cursor: "pointer",
                    transition: "all 0.2s ease",
                    boxShadow: "0 2px 8px rgba(15,25,35,0.05)",
                    animation: `fadeUp 0.5s ease ${delay}s both`,
                    position: "relative", overflow: "hidden",
                }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 8px 24px ${accentColor}22`; e.currentTarget.style.borderColor = `${accentColor}55`; e.currentTarget.style.transform = "translateY(-3px)"; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(15,25,35,0.05)"; e.currentTarget.style.borderColor = theme.border; e.currentTarget.style.transform = "translateY(0)"; }}
            >
                <div style={{
                    width: 36, height: 36, borderRadius: 9, marginBottom: 12,
                    background: `${accentColor}12`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: accentColor,
                }}>
                    {icon}
                </div>
                <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 13, fontWeight: 700, color: theme.primary, marginBottom: 4, letterSpacing: "-0.01em" }}>
                    {label}
                </div>
                <div style={{ fontSize: 10, color: theme.muted, fontFamily: "'Plus Jakarta Sans',sans-serif" }}>{sub}</div>
                <div style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", color: `${accentColor}55`, fontSize: 18, fontWeight: 300 }}>›</div>
            </div>
        </Link>
    );
}

function MetricBar({ label, value, sub, percent = 0, color = theme.bull }) {
    const p = Math.max(0, Math.min(100, percent));
    return (
        <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, gap: 10 }}>
                <div>
                    <div style={{ fontSize: 10, letterSpacing: "0.12em", color: theme.muted, fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>
                        {label}
                    </div>
                    {sub && <div style={{ fontSize: 11, color: theme.muted, marginTop: 4 }}>{sub}</div>}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14, fontWeight: 800, color }}>
                    {value}
                </div>
            </div>
            <div style={{ height: 10, background: "#EEF2F7", borderRadius: 999, overflow: "hidden", border: `1px solid ${theme.border}` }}>
                <div style={{ height: "100%", width: `${p}%`, background: `linear-gradient(90deg, ${color}, ${color}88)`, borderRadius: 999, transition: "width 0.6s ease" }} />
            </div>
        </div>
    );
}

function formatINR(val) {
    const n = Number(val);
    if (Number.isNaN(n)) return "₹0";
    return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/* ─────────────────────────────────────────
   CREATE TRADE DROPDOWN BUTTON
───────────────────────────────────────── */
function CreateTradeButton() {
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);

    const handleOptionClick = (path) => {
        setIsOpen(false);
        router.push(path);
    };

    return (
        <div style={{ position: "relative" }}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    display: "flex", alignItems: "center", gap: 10,
                    background: `linear-gradient(135deg, ${theme.primary} 0%, #22C78E 100%)`,
                    color: "#FFFFFF", borderRadius: 10, padding: "12px 20px",
                    fontSize: 12, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700,
                    letterSpacing: "0.08em", border: `1px solid ${theme.gold}44`,
                    boxShadow: "0 4px 16px rgba(13,158,110,0.25), 0 0 20px rgba(184,134,11,0.15)",
                    cursor: "pointer", transition: "all 0.25s ease",
                }}
                onMouseEnter={e => {
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = "0 6px 24px rgba(13,158,110,0.35), 0 0 30px rgba(184,134,11,0.2)";
                }}
                onMouseLeave={e => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "0 4px 16px rgba(13,158,110,0.25), 0 0 20px rgba(184,134,11,0.15)";
                }}
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
                </svg>
                NEW TRADE
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>

            {isOpen && (
                <div style={{
                    position: "absolute", top: "100%", right: 0, marginTop: 8,
                    background: "#FFFFFF", borderRadius: 12, border: `1px solid ${theme.border}`,
                    boxShadow: "0 8px 32px rgba(15,25,35,0.15)", overflow: "hidden", minWidth: 200, zIndex: 100,
                }}>
                    {/* Manual */}
                    <div style={{ padding: "8px 14px 4px", fontSize: 9, fontWeight: 700, color: theme.muted, letterSpacing: "0.1em", fontFamily: "'JetBrains Mono',monospace" }}>MANUAL</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, padding: "0 10px 10px" }}>
                        <button onClick={() => handleOptionClick("/indian-market/add-trade")} style={tileStyle}
                            onMouseEnter={e => e.currentTarget.style.background = "rgba(13,158,110,0.1)"}
                            onMouseLeave={e => e.currentTarget.style.background = "rgba(13,158,110,0.06)"}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={theme.bull} strokeWidth="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                            <span style={{ fontSize: 11, fontWeight: 700, color: theme.bull }}>Options</span>
                        </button>
                        <button onClick={() => handleOptionClick("/indian-market/add-trade?type=EQUITY")} style={{ ...tileStyle, background: "rgba(37,99,235,0.06)" }}
                            onMouseEnter={e => e.currentTarget.style.background = "rgba(37,99,235,0.12)"}
                            onMouseLeave={e => e.currentTarget.style.background = "rgba(37,99,235,0.06)"}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2">
                                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                            </svg>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#2563EB" }}>Stock</span>
                        </button>
                    </div>

                    <div style={{ height: 1, background: theme.border }} />

                    {/* AI Extract */}
                    <div style={{ padding: "8px 14px 4px", fontSize: 9, fontWeight: 700, color: theme.muted, letterSpacing: "0.1em", fontFamily: "'JetBrains Mono',monospace" }}>AI EXTRACT</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, padding: "0 10px 10px" }}>
                        <button onClick={() => handleOptionClick("/indian-market/upload-trade")} style={{ ...tileStyle, background: "rgba(184,134,11,0.06)" }}
                            onMouseEnter={e => e.currentTarget.style.background = "rgba(184,134,11,0.12)"}
                            onMouseLeave={e => e.currentTarget.style.background = "rgba(184,134,11,0.06)"}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={theme.gold} strokeWidth="2">
                                <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
                            </svg>
                            <span style={{ fontSize: 11, fontWeight: 700, color: theme.gold }}>Options</span>
                        </button>
                        <button onClick={() => handleOptionClick("/indian-market/upload-trade?type=EQUITY")} style={{ ...tileStyle, background: "rgba(124,58,237,0.06)" }}
                            onMouseEnter={e => e.currentTarget.style.background = "rgba(124,58,237,0.12)"}
                            onMouseLeave={e => e.currentTarget.style.background = "rgba(124,58,237,0.06)"}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2">
                                <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
                            </svg>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#7C3AED" }}>Stock</span>
                        </button>
                    </div>
                </div>
            )}
            {isOpen && <div style={{ position: "fixed", inset: 0, zIndex: 50 }} onClick={() => setIsOpen(false)} />}
        </div>
    );
}

const tileStyle = { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 8px", borderRadius: 8, border: "none", cursor: "pointer", background: "rgba(13,158,110,0.06)", transition: "background 0.15s ease", width: "100%" };

export default function IndianMarketDashboard() {
    const router = useRouter();
    const { currentMarket, toggleMarket } = useMarket();
    const [stats, setStats] = useState(null);
    const [perf, setPerf] = useState(null);
    const [drawdown, setDrawdown] = useState(null);
    const [ai, setAi] = useState(null);
    const [breakdown, setBreakdown] = useState(null);
    const [recentTrades, setRecentTrades] = useState([]);
    const [mounted, setMounted] = useState(false);

    const fetchStats = async () => {
        try {
            const [summaryRes, perfRes, ddRes, aiRes, pnlRes, tradesRes] = await Promise.all([
                getSummary(MARKETS.INDIAN_MARKET),
                getPerformanceMetrics(MARKETS.INDIAN_MARKET),
                getDrawdownAnalysis(MARKETS.INDIAN_MARKET),
                getAIInsights(MARKETS.INDIAN_MARKET),
                getPnLBreakdown(MARKETS.INDIAN_MARKET),
                getTrades(MARKETS.INDIAN_MARKET)
            ]);

            setStats(summaryRes);
            setPerf(perfRes);
            setDrawdown(ddRes);
            setAi(aiRes);
            setBreakdown(pnlRes);

            const list = Array.isArray(tradesRes) ? tradesRes : (Array.isArray(tradesRes?.trades) ? tradesRes.trades : []);
            const sorted = [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            setRecentTrades(sorted.slice(0, 10));
        } catch (error) {
            console.error("Failed to fetch Indian Market stats:", error);
        }
    };

    useEffect(() => {
        const token = localStorage.getItem("token");
        if (!token) { router.push("/login"); return; }

        setMounted(true);
        fetchStats();

    }, [router, currentMarket]);

    const profitBull = stats ? parseFloat(stats.netProfit ?? stats.totalProfit) >= 0 : true;
    const winBull = stats ? parseFloat(stats.winRate) >= 50 : true;

    if (!mounted) return null;

    const todayKey = new Date().toISOString().split("T")[0];
    const todayPnl = breakdown?.daily?.find(d => d.date === todayKey)?.profit ?? 0;
    const totalTrades = stats?.totalTrades ?? 0;
    const planPct = parseFloat(ai?.behaviorDiscipline?.ruleEmotion?.planPct || 0);
    const recoveryFactor = parseFloat(drawdown?.recoveryFactor || 0);
    const profitFactor = perf?.profitFactor === "∞" ? "∞" : parseFloat(perf?.profitFactor || 0).toFixed(2);
    const maxWinStreak = perf?.maxWinStreak ?? 0;

    const tapeItems = recentTrades.slice(0, 6).map(t => {
        const pnl = Number(t.profit || 0);
        return {
            sym: (t.pair || "TRADE").toString().toUpperCase().slice(0, 26),
            val: `${pnl >= 0 ? "+" : ""}${formatINR(pnl)}`,
            bull: pnl >= 0
        };
    });

    const equity = Array.isArray(drawdown?.equityCurve)
        ? drawdown.equityCurve.map((p, idx) => ({ idx, balance: Number(p.balance || 0) }))
        : [];

    return (
        <div style={{
            minHeight: "100vh",
            background: theme.bg,
            fontFamily: "'Plus Jakarta Sans',sans-serif",
            color: theme.primary,
            position: "relative",
            overflow: "hidden",
        }}>
            <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />

            <IndianMarketHeader />

            <TickerTape items={tapeItems} />

            <main style={{
                position: "relative", zIndex: 5, padding: "28px 20px",
                maxWidth: 1080, margin: "0 auto",
            }}>
                {!stats ? (
                    <LoadingSpinner message="SYNCING OPTIONS..." />
                ) : (
                    <>
                        <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 14 }}>
                            <div>
                                <h1 style={{ fontSize: 28, fontWeight: 800, color: theme.primary, margin: 0 }}>
                                    Options <span style={{ color: theme.secondary }}>Dashboard</span>
                                </h1>
                                <p style={{ fontSize: 12, color: theme.muted, marginTop: 5, fontFamily: "'JetBrains Mono',monospace" }}>
                                    COMMAND CENTER — EDGE • DISCIPLINE • PROFITABILITY
                                </p>
                            </div>
                            <CreateTradeButton />
                        </div>

                        <div style={{ display: "flex", gap: 14, marginBottom: 16, flexWrap: "wrap" }}>
                            <StatCard
                                label="TOTAL TRADES"
                                value={totalTrades}
                                sub="Options trades"
                                accentColor={theme.primary}
                                delay={0}
                                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" /></svg>}
                            />
                            <StatCard
                                label="NET AFTER COSTS"
                                value={`${profitBull ? "+" : ""}${formatINR(stats.netProfit ?? stats.totalProfit)}`}
                                sub={`Costs: ${formatINR(stats.totalCosts || 0)}`}
                                accentColor={profitBull ? theme.bull : theme.bear}
                                delay={0.1}
                                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>}
                            />
                            <StatCard
                                label="WIN RATE"
                                value={`${parseFloat(stats.winRate).toFixed(1)}%`}
                                sub={`${stats.winningTrades || 0}W / ${stats.losingTrades || 0}L`}
                                accentColor={winBull ? theme.bull : theme.bear}
                                delay={0.2}
                                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>}
                            />
                            <StatCard
                                label="TODAY P&L (UTC DAY)"
                                value={`${todayPnl >= 0 ? "+" : ""}${formatINR(todayPnl)}`}
                                sub="From your logged trades today"
                                accentColor={todayPnl >= 0 ? theme.bull : theme.bear}
                                delay={0.25}
                                icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 6v6l4 2" /><circle cx="12" cy="12" r="10" /></svg>}
                            />
                        </div>

                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
                            <NavCard href="/indian-market/trades" label="Options Journal" sub="CE/PE trade log" accentColor={theme.primary} delay={0.3}
                                icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>}
                            />
                            <NavCard href="/indian-market/add-trade" label="New options trade" sub="Log CE/PE trade" accentColor={theme.secondary} delay={0.35}
                                icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>}
                            />
                            <NavCard href="/indian-market/upload-trade" label="Extract from image" sub="AI from screenshot" accentColor={theme.gold} delay={0.4}
                                icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>}
                            />
                            <NavCard href="/indian-market/analytics" label="Options analytics" sub="Depth analysis" accentColor={theme.gold} delay={0.5}
                                icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" /></svg>}
                            />
                            <NavCard href="/indian-market/setups" label="Options setups" sub="Define trading setups + rules" accentColor={theme.primary} delay={0.55}
                                icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h10" /><path d="M7 12h6" /><path d="M7 16h3" /></svg>}
                            />
                            <NavCard href="/checklist" label="Pre-Trade Checklist" sub="Check rules before trading" accentColor={theme.primary} delay={0.57}
                                icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>}
                            />
                            <NavCard href="/weekly-reports?market=Indian_Market" label="Weekly AI Feedback" sub="Last 7 days review" accentColor={theme.gold} delay={0.6}
                                icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M3 4h18M5 4v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4" />
                                    <path d="M8 8h8M8 12h5M8 16h3" />
                                </svg>}
                            />
                        </div>

                        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 24 }}>
                            <div style={{
                                flex: "1 1 520px",
                                background: "linear-gradient(135deg, rgba(13,158,110,0.06), rgba(184,134,11,0.06))",
                                borderRadius: 18,
                                padding: 22,
                                border: `1px solid ${theme.border}`,
                                boxShadow: "0 10px 30px rgba(15,25,35,0.08)",
                                overflow: "hidden",
                                position: "relative"
                            }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
                                    <div>
                                        <div style={{ fontSize: 10, letterSpacing: "0.14em", fontFamily: "'JetBrains Mono',monospace", color: theme.muted, fontWeight: 700 }}>
                                            EDGE OVERVIEW
                                        </div>
                                        <div style={{ fontSize: 18, fontWeight: 900, color: theme.ink, marginTop: 6 }}>
                                            Winning streaks, recovery, discipline — from real data
                                        </div>
                                    </div>
                                    <div style={{
                                        fontSize: 10,
                                        padding: "6px 10px",
                                        background: "rgba(15,23,42,0.06)",
                                        borderRadius: 999,
                                        color: theme.primary,
                                        fontWeight: 800,
                                        border: `1px solid ${theme.border}`,
                                        fontFamily: "'JetBrains Mono',monospace",
                                        letterSpacing: "0.1em"
                                    }}>
                                        MODEL-DRIVEN
                                    </div>
                                </div>

                                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                                    <MetricBar
                                        label="WIN STREAK (MAX)"
                                        value={`${maxWinStreak}`}
                                        sub="From performance metrics"
                                        percent={Math.min(100, (Number(maxWinStreak) || 0) * 12)}
                                        color={theme.bull}
                                    />
                                    <MetricBar
                                        label="LOSS RECOVERY"
                                        value={`${recoveryFactor.toFixed(2)}×`}
                                        sub="Recovery factor (profit / max DD)"
                                        percent={Math.min(100, (recoveryFactor / 2) * 100)}
                                        color={theme.gold}
                                    />
                                    <MetricBar
                                        label="PLAN ADHERENCE"
                                        value={`${planPct.toFixed(1)}%`}
                                        sub="Plan vs emotion / impulsive"
                                        percent={planPct}
                                        color={planPct >= 70 ? theme.bull : theme.bear}
                                    />
                                    <MetricBar
                                        label="PROFIT FACTOR"
                                        value={`${profitFactor}`}
                                        sub="Gross profit / gross loss"
                                        percent={perf?.profitFactor === "∞" ? 100 : Math.min(100, (parseFloat(profitFactor || 0) / 2) * 100)}
                                        color={(perf?.profitFactor === "∞" || parseFloat(profitFactor || 0) >= 1.2) ? theme.bull : theme.bear}
                                    />
                                </div>
                            </div>

                            <div style={{
                                flex: "1 1 360px",
                                background: "#FFF",
                                borderRadius: 18,
                                padding: 22,
                                border: `1px solid ${theme.border}`,
                                boxShadow: "0 10px 30px rgba(15,25,35,0.08)",
                            }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
                                    <div style={{ fontSize: 14, fontWeight: 900, color: theme.ink }}>Equity curve</div>
                                    <div style={{ fontSize: 10, color: theme.muted, fontFamily: "'JetBrains Mono',monospace" }}>
                                        {equity.length > 0 ? `Last ${equity.length} points` : "No equity data yet"}
                                    </div>
                                </div>
                                <div style={{ height: 210 }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={equity} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor={theme.bull} stopOpacity={0.25} />
                                                    <stop offset="100%" stopColor={theme.bull} stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" strokeOpacity={0.6} />
                                            <XAxis dataKey="idx" tickLine={false} axisLine={false} hide />
                                            <YAxis
                                                tickLine={false}
                                                axisLine={false}
                                                tick={{ fill: theme.muted, fontSize: 10 }}
                                                width={56}
                                                tickFormatter={(v) => formatINR(v)}
                                            />
                                            <Tooltip
                                                content={({ active, payload }) => {
                                                    if (!active || !payload || !payload.length) return null;
                                                    const v = payload[0].value;
                                                    return (
                                                        <div style={{ background: "rgba(255,255,255,0.95)", border: `1px solid ${theme.border}`, borderRadius: 12, padding: "10px 12px", boxShadow: "0 10px 30px rgba(15,25,35,0.12)" }}>
                                                            <div style={{ fontSize: 10, color: theme.muted, fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.1em" }}>BALANCE</div>
                                                            <div style={{ fontSize: 16, fontWeight: 900, color: theme.ink }}>{formatINR(v)}</div>
                                                        </div>
                                                    );
                                                }}
                                            />
                                            <ReferenceLine y={0} stroke={theme.border} strokeWidth={2} strokeDasharray="6 6" />
                                            <Area type="monotone" dataKey="balance" stroke={theme.bull} strokeWidth={3} fill="url(#eqFill)" dot={false} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                                <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                                    <div style={{ fontSize: 11, color: theme.muted }}>Max drawdown</div>
                                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: 800, color: theme.bear }}>
                                        {formatINR(drawdown?.maxDrawdown || 0)} ({drawdown?.maxDrawdownPercent || 0}%)
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </main>

            <style jsx global>{`
        @keyframes ticker {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
        </div>
    );
}
