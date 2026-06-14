"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    setMounted(true);
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
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
  };

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
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />

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
          {[
            { title: "User Management", desc: "Manage roles and subscriptions", icon: "👥", color: "#0D9E6E" },
            { 
              title: "System Analytics", 
              desc: "Monitor trade extraction accuracy and OCR performance logs.", 
              status: "Operational", 
              icon: "📊",
              actions: [
                { label: "View User Trades", onClick: () => router.push("/admin/trades") },
                { label: "OCR Failure Logs", onClick: () => router.push("/admin/monitoring") }
              ]
            },
            { title: "Payment Tracking", desc: "Manage plans and transactions", icon: "💰", color: "#B8860B" },
            { 
              title: "Feedback & Support", 
              desc: "View user bug reports and feature requests.", 
              icon: "⚙️", 
              color: "#64748B",
              onClick: () => router.push("/admin/feedback")
            },
          ].map((card, i) => (
            <div key={card.title} 
              onClick={() => {
                if(card.title === "User Management") router.push("/admin/users");
                if(card.title === "Payment Tracking") router.push("/admin/payments");
                if(card.onClick) card.onClick();
              }}
              style={{
              background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 14,
              padding: "20px", display: "flex", flexDirection: "column",
              boxShadow: "0 1px 6px rgba(15,25,35,0.04)",
              transition: "transform 0.2s, box-shadow 0.2s",
              cursor: (card.title === "User Management" || card.title === "Payment Tracking" || card.title === "Feedback & Support") ? "pointer" : "default"
            }}
              onMouseEnter={e => { if(card.title !== "System Analytics") e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(15,25,35,0.08)"; }}
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
                      onClick={(e) => { e.stopPropagation(); btn.onClick(); }}
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
                  {card.title === "User Management" || card.title === "Payment Tracking" ? "ACTIVE" : "PENDING UI"}
                </div>
              )}
            </div>
          ))}
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
