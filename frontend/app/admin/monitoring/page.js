"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAdminExtractionLogs } from "@/services/adminApi";

/* ─────────────────────────────────────────
   OCR MONITORING PORTAL – Light theme
───────────────────────────────────────── */
export default function MonitorOCRPage() {
  const router = useRouter();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedLog, setSelectedLog] = useState(null);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const data = await getAdminExtractionLogs();
      if (Array.isArray(data)) {
        setLogs(data);
      } else {
        setError("Failed to fetch logs");
      }
    } catch (err) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const stats = {
    total: logs.length,
    success: logs.filter(l => l.isSuccess).length,
    failed: logs.filter(l => !l.isSuccess).length,
    aiFallbacks: logs.filter(l => l.aiUsed).length
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#F0EEE9",
      fontFamily: "'Plus Jakarta Sans',sans-serif",
      color: "#0F1923",
    }}>

      {/* ── HEADER ── */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 28px", height: 60,
        background: "rgba(255,255,255,0.92)", backdropFilter: "blur(20px)",
        borderBottom: "1px solid #E2E8F0",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => router.push("/admin/trades")} style={{ background: "none", border: "none", cursor: "pointer", color: "#0F1923" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800 }}>OCR EXTRACTION LOGS</div>
            <div style={{ fontSize: 8, color: "#B8860B", letterSpacing: "0.15em", fontFamily: "'JetBrains Mono'" }}>SYSTEM MONITORING</div>
          </div>
        </div>
      </header>

      <div style={{ height: 3, background: "linear-gradient(90deg,#B8860B 0%,#D63B3B 50%,#B8860B 100%)" }} />

      <main style={{ padding: "32px 28px", maxWidth: 1400, margin: "0 auto" }}>
        
        {/* Quick Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 20, marginBottom: 32 }}>
          {[
            { label: "Total Attempts", value: stats.total, color: "#0F1923" },
            { label: "High Confidence", value: stats.success, color: "#0D9E6E" },
            { label: "OCR Failures", value: stats.failed, color: "#D63B3B" },
            { label: "AI Fallbacks", value: stats.aiFallbacks, color: "#3B82F6" },
          ].map(s => (
            <div key={s.label} style={{ background: "white", padding: 20, borderRadius: 16, border: "1px solid #E2E8F0" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 4 }}>{s.label.toUpperCase()}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: selectedLog ? "1fr 400px" : "1fr", gap: 24, transition: "grid-template-columns 0.3s ease" }}>
          
          {/* Logs Table */}
          <div style={{
            background: "white", borderRadius: 16, border: "1px solid #E2E8F0",
            boxShadow: "0 1px 6px rgba(0,0,0,0.05)", overflow: "hidden"
          }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #F1F5F9", background: "#F8FAFC" }}>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B" }}>TIMESTAMP</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B" }}>USER</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B" }}>RESULT</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B" }}>METHOD</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", textAlign: "right" }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="5" style={{ padding: 40, textAlign: "center", color: "#94A3B8" }}>Fetching logs...</td></tr>
                ) : logs.map((log) => (
                  <tr key={log._id} style={{ 
                    borderBottom: "1px solid #F1F5F9", fontSize: 13, cursor: "pointer",
                    background: selectedLog?._id === log._id ? "#F8FAFC" : "none"
                  }} onClick={() => setSelectedLog(log)}>
                    <td style={{ padding: "16px 24px", fontFamily: "'JetBrains Mono'", fontSize: 11, color: "#64748B" }}>
                      {new Date(log.createdAt).toLocaleTimeString()}
                    </td>
                    <td style={{ padding: "16px 24px", fontWeight: 600 }}>
                      {log.user?.name || "Guest"}
                    </td>
                    <td style={{ padding: "16px 24px" }}>
                      <div style={{ 
                        display: "inline-flex", alignItems: "center", gap: 6,
                        color: log.isSuccess ? "#0D9E6E" : "#D63B3B", fontWeight: 700
                      }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
                        {log.isSuccess ? "Success" : "Failed"}
                      </div>
                    </td>
                    <td style={{ padding: "16px 24px" }}>
                       <div style={{
                         fontSize: 10, fontWeight: 700,
                         color: log.aiUsed ? "#3B82F6" : "#0D9E6E"
                       }}>
                         {log.aiUsed ? "AI EXTRACTOR" : "REGEX PARSER"}
                       </div>
                    </td>
                    <td style={{ padding: "16px 24px", textAlign: "right" }}>
                      <button style={{ background: "none", border: "none", color: "#3B82F6", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>INSPECT</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Inspection Panel */}
          {selectedLog && (
            <div style={{
              background: "white", borderRadius: 16, border: "1px solid #E2E8F0",
              padding: 24, position: "sticky", top: 84, height: "calc(100vh - 116px)",
              overflowY: "auto", boxShadow: "-10px 0 30px rgba(0,0,0,0.03)"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Extraction Details</h3>
                <button onClick={() => setSelectedLog(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94A3B8" }}>×</button>
              </div>

              <div style={{ width: "100%", borderRadius: 12, overflow: "hidden", border: "1px solid #E2E8F0", marginBottom: 20 }}>
                <img src={selectedLog.imageUrl} style={{ width: "100%", display: "block" }} />
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 10, fontWeight: 800, color: "#64748B", letterSpacing: "0.05em" }}>PARSED DATA</label>
                <div style={{ 
                  background: "#F8FAFC", padding: 12, borderRadius: 8, marginTop: 6,
                  fontFamily: "'JetBrains Mono'", fontSize: 11, maxHeight: 150, overflowY: "auto"
                }}>
                  <pre style={{ margin: 0 }}>{JSON.stringify(selectedLog.parsedData, null, 2)}</pre>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 10, fontWeight: 800, color: "#64748B", letterSpacing: "0.05em" }}>RAW OCR TEXT</label>
                <div style={{ 
                  background: "#F1F5F9", padding: 12, borderRadius: 8, marginTop: 6,
                  fontFamily: "'JetBrains Mono'", fontSize: 11, maxHeight: 150, overflowY: "auto",
                  color: "#475569"
                }}>
                  {selectedLog.extractedText || "No text extracted"}
                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
