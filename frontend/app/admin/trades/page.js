"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAdminAllTrades } from "@/services/adminApi";

/* ─────────────────────────────────────────
   TRADE MONITORING PAGE – Light theme
───────────────────────────────────────── */
export default function TradesMonitoringPage() {
  const router = useRouter();
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedImage, setSelectedImage] = useState(null);

  useEffect(() => {
    fetchTrades();
  }, []);

  const fetchTrades = async () => {
    try {
      setLoading(true);
      const data = await getAdminAllTrades();
      const fetchedTrades = Array.isArray(data) ? data : data?.trades;
      if (Array.isArray(fetchedTrades)) {
        setTrades(fetchedTrades);
      } else {
        setError("Failed to fetch trades");
      }
    } catch (err) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const filteredTrades = trades.filter(t => {
    const matchesFilter = filter === "all" || t.marketType === filter;
    const matchesSearch = !searchTerm || 
      (t.user?.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.pair || "").toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  return (
    <div style={{
      minHeight: "100vh", background: "#F0EEE9",
      fontFamily: "'Plus Jakarta Sans',sans-serif",
      color: "#0F1923",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* ── HEADER ── */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 28px", height: 60,
        background: "rgba(255,255,255,0.92)", backdropFilter: "blur(20px)",
        borderBottom: "1px solid #E2E8F0",
        boxShadow: "0 1px 12px rgba(15,25,35,0.06)",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => router.push("/admin/dashboard")} style={{ background: "none", border: "none", cursor: "pointer", color: "#0F1923" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <div style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <img src="/mainlogo1.png" alt="Edgecipline" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.04em", color: "#0F1923", lineHeight: 1 }}>TRADE MONITORING</div>
            <div style={{ fontSize: 8, letterSpacing: "0.18em", color: "#B8860B", marginTop: 1, fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>ADMIN PORTAL</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button 
            onClick={() => router.push("/admin/monitoring")}
            style={{ 
              background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 8, padding: "8px 16px",
              fontSize: 11, fontWeight: 700, cursor: "pointer", color: "#64748B",
              display: "flex", alignItems: "center", gap: 8
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
            OCR LOGS
          </button>
        </div>
      </header>

      <div style={{ height: 3, background: "linear-gradient(90deg,#B8860B 0%,#3B82F6 50%,#B8860B 100%)" }} />

      <main style={{ padding: "32px 28px", maxWidth: 1400, margin: "0 auto" }}>
        
        {/* Filters & Search */}
        <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 300, position: "relative" }}>
            <input 
              type="text" placeholder="Search user or symbol..." 
              value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              style={{ width: "100%", padding: "12px 16px 12px 40px", borderRadius: 12, border: "1px solid #E2E8F0", outline: "none", fontSize: 14 }}
            />
            <svg style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </div>
          
          <select 
            value={filter} onChange={e => setFilter(e.target.value)}
            style={{ padding: "12px", borderRadius: 12, border: "1px solid #E2E8F0", outline: "none", fontSize: 14, background: "white" }}
          >
            <option value="all">All Markets</option>
            <option value="Forex">Forex</option>
            <option value="Indian_Market">Indian Market</option>
          </select>
        </div>

        <div style={{
          background: "white", borderRadius: 16, border: "1px solid #E2E8F0",
          boxShadow: "0 1px 6px rgba(0,0,0,0.05)", overflow: "hidden"
        }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #F1F5F9", background: "#F8FAFC" }}>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>TRADE</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>USER</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>MARKET</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>P&L</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>SCREENSHOT</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em", textAlign: "right" }}>DATE</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="6" style={{ padding: "40px", textAlign: "center", color: "#94A3B8" }}>Loading trades...</td></tr>
                ) : filteredTrades.length === 0 ? (
                  <tr><td colSpan="6" style={{ padding: "40px", textAlign: "center", color: "#94A3B8" }}>No trades found matching criteria.</td></tr>
                ) : (
                  filteredTrades.map((trade) => (
                    <tr key={trade._id} style={{ borderBottom: "1px solid #F1F5F9", fontSize: 13 }}>
                      <td style={{ padding: "16px 24px" }}>
                        <div style={{ fontWeight: 800, color: "#0F1923" }}>{trade.pair}</div>
                        <div style={{ 
                          fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
                          color: trade.type === "BUY" ? "#0D9E6E" : "#D63B3B"
                        }}>
                          {trade.type}
                        </div>
                      </td>
                      <td style={{ padding: "16px 24px" }}>
                        <div style={{ fontWeight: 600 }}>{trade.user?.name || "Deleted"}</div>
                        <div style={{ fontSize: 11, color: "#94A3B8", fontFamily: "'JetBrains Mono'" }}>{trade.user?.email}</div>
                      </td>
                      <td style={{ padding: "16px 24px" }}>
                        <div style={{
                          display: "inline-block", padding: "2px 8px", borderRadius: 4,
                          background: trade.marketType === "Forex" ? "#EFF6FF" : "#FFF7ED",
                          color: trade.marketType === "Forex" ? "#3B82F6" : "#B8860B",
                          fontSize: 10, fontWeight: 700
                        }}>
                          {trade.marketType.replace("_", " ")}
                        </div>
                      </td>
                      <td style={{ padding: "16px 24px" }}>
                        <div style={{ 
                          fontWeight: 800, 
                          color: trade.profit >= 0 ? "#0D9E6E" : "#D63B3B"
                        }}>
                          {trade.marketType === "Forex" ? "$" : "₹"}{Math.abs(trade.profit).toLocaleString()}
                        </div>
                      </td>
                      <td style={{ padding: "16px 24px" }}>
                        {trade.screenshot ? (
                          <div 
                            onClick={() => setSelectedImage(trade.screenshot)}
                            style={{ 
                              width: 40, height: 40, border: "1px solid #E2E8F0", borderRadius: 6,
                              overflow: "hidden", cursor: "pointer", background: "#F1F5F9"
                            }}
                          >
                            <img src={trade.screenshot} alt="Trade" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          </div>
                        ) : (
                          <span style={{ fontSize: 10, color: "#94A3B8" }}>No image</span>
                        )}
                      </td>
                      <td style={{ padding: "16px 24px", textAlign: "right", color: "#64748B", fontFamily: "'JetBrains Mono'" }}>
                        {new Date(trade.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Image Preview Modal */}
        {selectedImage && (
          <div 
            style={{
              position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
              background: "rgba(15,25,35,0.85)", backdropFilter: "blur(8px)",
              display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
              padding: 40
            }}
            onClick={() => setSelectedImage(null)}
          >
            <div style={{ maxWidth: "100%", maxHeight: "100%", position: "relative" }}>
              <img src={selectedImage} style={{ maxWidth: "100%", maxHeight: "90vh", borderRadius: 12, boxShadow: "0 20px 50px rgba(0,0,0,0.5)" }} />
              <button 
                style={{ position: "absolute", top: -40, right: 0, background: "none", border: "none", color: "white", fontSize: 32, cursor: "pointer" }}
                onClick={() => setSelectedImage(null)}
              >
                ×
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
