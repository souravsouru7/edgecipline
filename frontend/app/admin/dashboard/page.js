"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAdminStats, getAdminGrowth } from "@/services/adminApi";
import AdminHeader from "@/components/AdminHeader";
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar
} from "recharts";

/* ─────────────────────────────────────────
   ADMIN DASHBOARD – Real Live Data
───────────────────────────────────────── */
/**
 * Dashboard feature cards.
 *
 * Every behaviour below is driven by these fields — never by the title string.
 * The previous version dispatched navigation, the cursor, and the status badge
 * off `card.title === "..."` comparisons, which meant renaming a card silently
 * broke its link, and the badge hardcoded two titles as ACTIVE so the two
 * support cards advertised themselves as "PENDING UI" while being fully built
 * and clickable.
 *
 * `href` is the single source of truth: it decides whether a card is
 * interactive AND whether it reports itself as built.
 */
const FEATURE_CARDS = [
  {
    title: "User Management",
    desc: "Manage roles and subscriptions",
    icon: "👥",
    color: "#0D9E6E",
    href: "/admin/users",
  },
  {
    title: "System Analytics",
    desc: "Monitor trade extraction accuracy and OCR performance logs.",
    icon: "📊",
    color: "#64748B",
    // Two destinations, so the card exposes buttons instead of being one big
    // link. It has no `href` of its own by design.
    actions: [
      { label: "View User Trades", href: "/admin/trades" },
      { label: "OCR Failure Logs", href: "/admin/monitoring" },
    ],
  },
  {
    title: "Payment Tracking",
    desc: "Manage plans and transactions",
    icon: "💰",
    color: "#B8860B",
    href: "/admin/payments",
  },
  {
    title: "Customer Support",
    desc: "Ticket queue, conversations, and the knowledge base.",
    icon: "🎧",
    color: "#0D9E6E",
    href: "/admin/support",
  },
  {
    // Renamed from "Feedback & Support". It handles no support tickets, and
    // sharing the word with the card above made two unrelated systems read as
    // one duplicated feature. This card is /api/admin/feedback (bug reports,
    // adminAuth); the one above is /api/admin/support (the agent console,
    // supportAuth) — different models, controllers, and middleware.
    title: "Bug Reports & Feedback",
    desc: "User-submitted bugs and feature requests.",
    icon: "🐛",
    color: "#64748B",
    href: "/admin/feedback",
  },
  {
    title: "Promotions",
    desc: "Campaigns, coupons, influencers, and promo revenue.",
    icon: "🏷️",
    color: "#7C3AED",
    href: "/admin/promotions",
  },
];

export default function AdminDashboardPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState({
    totalUsers: 0,
    activePaidUsers: 0,
    expiredUsers: 0,
    totalTrades: 0,
    totalRevenue: "0.00",
  });
  const [growthData, setGrowthData] = useState({
    userGrowth: [],
    dailyTrades: []
  });
  const [loading, setLoading] = useState(true);

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    const [statsRes, growthRes] = await Promise.allSettled([
      getAdminStats(),
      getAdminGrowth()
    ]);
    if (statsRes.status === "fulfilled" && statsRes.value) {
      setStats(statsRes.value);
    } else if (statsRes.status === "rejected") {
      console.error("Admin stats error:", statsRes.reason);
    }
    if (growthRes.status === "fulfilled" && growthRes.value) {
      setGrowthData(growthRes.value);
    } else if (growthRes.status === "rejected") {
      console.error("Admin growth error:", growthRes.reason);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setMounted(true);
      fetchDashboardData();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchDashboardData]);

  const statCards = [
    { label: "Total Users", value: stats.totalUsers, color: "#0D9E6E", icon: "👥" },
    { label: "Active Paid", value: stats.activePaidUsers, color: "#3B82F6", icon: "💎" },
    { label: "Expired Users", value: stats.expiredUsers, color: "#D63B3B", icon: "⏳", onClick: () => router.push("/admin/expired-users") },
    { label: "Total Trades", value: stats.totalTrades, color: "#B8860B", icon: "📊" },
    { label: "Revenue", value: `$${stats.totalRevenue}`, color: "#0D9E6E", icon: "💰" },
  ];

  return (
    <div style={{
      minHeight: "100vh", background: "#F0EEE9",
      fontFamily: "'Plus Jakarta Sans',sans-serif",
      color: "#0F1923",
    }}>

      <AdminHeader subtitle="ADMIN DASHBOARD" />

      {/* ── MAIN ── */}
      <main style={{ padding: "24px 28px", maxWidth: 1400, margin: "0 auto" }}>
        {/* Top Section */}
        <div style={{
          marginBottom: 24, display: "flex", alignItems: "flex-end", justifyContent: "space-between",
          opacity: mounted ? 1 : 0, transition: "all 0.5s",
        }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0F1923", margin: 0, marginBottom: 4 }}>
              Main <span style={{ color: "#B8860B" }}>Dashboard</span>
            </h1>
            <p style={{ fontSize: 12, color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace" }}>
              PLATFORM SNAPSHOT • {new Date().toLocaleDateString()}
            </p>
          </div>
          <button 
            onClick={fetchDashboardData}
            style={{
              padding: "10px", background: "white", border: "1px solid #E2E8F0", borderRadius: 8, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: "#4A5568"
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: loading ? "spin 1s linear infinite" : "none" }}>
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            REFRESH
          </button>
        </div>

        {/* Stats Grid */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16, marginBottom: 24,
        }}>
          {statCards.map((stat, i) => (
            <div key={stat.label} style={{
              background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 12,
              padding: "20px", display: "flex", alignItems: "center", gap: 14,
              boxShadow: "0 1px 6px rgba(15,25,35,0.05)",
              animation: `fadeUp 0.4s ease ${i * 0.05}s both`,
              cursor: stat.onClick ? "pointer" : "default"
            }}
              onClick={stat.onClick}
            >
              <div style={{
                width: 44, height: 44, borderRadius: 10,
                background: `${stat.color}12`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 20,
              }}>
                {stat.icon}
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#94A3B8", letterSpacing: "0.08em", fontFamily: "'JetBrains Mono',monospace", marginBottom: 2 }}>
                  {stat.label.toUpperCase()}
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: i === 4 ? "#0D9E6E" : "#0F1923", fontFamily: "'JetBrains Mono',monospace" }}>
                  {loading ? "..." : stat.value}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Charts Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(500px, 1fr))", gap: 20 }}>
          
          {/* User Growth */}
          <div style={{
            background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 16,
            padding: "24px", boxShadow: "0 1px 6px rgba(15,25,35,0.05)",
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0F1923", margin: "0 0 20px" }}>
              User Registration Growth
            </h3>
            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer>
                <AreaChart data={growthData.userGrowth}>
                  <defs>
                    <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#B8860B" stopOpacity={0.15}/>
                      <stop offset="95%" stopColor="#B8860B" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                  <XAxis dataKey="month" fontSize={10} axisLine={false} tickLine={false} dy={10} />
                  <YAxis fontSize={10} axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "8px", fontSize: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}
                    itemStyle={{ color: "#B8860B", fontWeight: 700 }}
                  />
                  <Area type="monotone" dataKey="users" stroke="#B8860B" strokeWidth={3} fillOpacity={1} fill="url(#colorUsers)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Daily Trades */}
          <div style={{
            background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 16,
            padding: "24px", boxShadow: "0 1px 6px rgba(15,25,35,0.05)",
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0F1923", margin: "0 0 20px" }}>
              Daily Platform Activity (Last 30 Days)
            </h3>
            <div style={{ width: "100%", height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={growthData.dailyTrades}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                  <XAxis 
                    dataKey="date" 
                    fontSize={10} 
                    axisLine={false} 
                    tickLine={false} 
                    dy={10} 
                    tickFormatter={(val) => val.split("-").slice(1).join("/")}
                  />
                  <YAxis fontSize={10} axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: "8px", fontSize: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}
                    itemStyle={{ color: "#0D9E6E", fontWeight: 700 }}
                  />
                  <Bar dataKey="count" fill="#0D9E6E" radius={[4, 4, 0, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>

        {/* Feature Cards Grid */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 20, marginTop: 24,
        }}>
          {FEATURE_CARDS.map((card) => {
            const isLink = Boolean(card.href);
            const open = () => { if (card.href) router.push(card.href); };

            return (
            <div key={card.title}
              role={isLink ? "button" : undefined}
              tabIndex={isLink ? 0 : undefined}
              aria-label={isLink ? `Open ${card.title}` : undefined}
              onClick={open}
              // A div is not a button, so keyboard users get nothing for free.
              // Enter and Space have to be wired up by hand or the whole grid
              // is unreachable without a mouse.
              onKeyDown={(e) => {
                if (!isLink || (e.key !== "Enter" && e.key !== " ")) return;
                e.preventDefault(); // Space would otherwise scroll the page
                open();
              }}
              style={{
              background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 14,
              padding: "20px", display: "flex", flexDirection: "column",
              boxShadow: "0 1px 6px rgba(15,25,35,0.04)",
              transition: "transform 0.2s, box-shadow 0.2s",
              cursor: isLink ? "pointer" : "default"
            }}
              // The original `if (...) stmt1; stmt2;` had no braces, so the
              // guard only covered the transform and every card got the lift
              // shadow regardless. Cards without their own href don't lift.
              onMouseEnter={e => { if (isLink) e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(15,25,35,0.08)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 1px 6px rgba(15,25,35,0.04)"; }}
            >
              <div style={{ fontSize: 24, marginBottom: 12 }}>{card.icon}</div>
              <h4 style={{ fontSize: 13, fontWeight: 700, color: "#0F1923", margin: "0 0 4px" }}>{card.title}</h4>
              <p style={{ fontSize: 11, color: "#94A3B8", margin: "0 0 16px" }}>{card.desc}</p>

              {card.actions ? (
                <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
                  {card.actions.map(btn => (
                    <button
                      key={btn.label}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); router.push(btn.href); }}
                      style={{
                        flex: 1, padding: "8px 4px", background: "#F1F5F9", border: "none",
                        borderRadius: 6, fontSize: 9, fontWeight: 800, color: "#475569",
                        cursor: "pointer", transition: "background 0.2s"
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "#E2E8F0"}
                      onMouseLeave={e => e.currentTarget.style.background = "#F1F5F9"}
                    >
                      {btn.label.toUpperCase()}
                    </button>
                  ))}
                </div>
              ) : (
                <div style={{
                  fontSize: 9, color: card.color, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace",
                  letterSpacing: "0.1em", background: `${card.color}08`, padding: "4px 10px", borderRadius: 4, width: "fit-content",
                  marginTop: "auto"
                }}>
                  {/* Derived, not hardcoded: a card with a real destination is
                      built. Add one without an href and it correctly reports
                      itself as unfinished instead of silently claiming ACTIVE. */}
                  {isLink ? "ACTIVE" : "PENDING UI"}
                </div>
              )}
            </div>
            );
          })}
        </div>
      </main>

      <style>{`
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        * { box-sizing:border-box; margin:0; padding:0; }
      `}</style>
    </div>
  );
}
