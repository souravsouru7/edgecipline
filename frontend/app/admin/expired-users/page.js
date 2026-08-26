"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { 
  getExpiredAdminUsers, 
  sendAdminRenewalReminder,
  extendAdminUserPlan 
} from "@/services/adminApi";

/* ─────────────────────────────────────────
   EXPIRED USERS PAGE – Light theme
───────────────────────────────────────── */
export default function ExpiredUsersPage() {
  const router = useRouter();
  const [adminName, setAdminName] = useState("");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [mounted, setMounted] = useState(false);
  
  const [extendingId, setExtendingId] = useState(null);
  const [extensionDays, setExtensionDays] = useState(30);
  const [remindingId, setRemindingId] = useState(null);

  useEffect(() => {
    setMounted(true);
    const name = localStorage.getItem("adminName") || "Admin";
    setAdminName(name);
    fetchExpiredUsers();
  }, []);

  const fetchExpiredUsers = async () => {
    try {
      setLoading(true);
      const data = await getExpiredAdminUsers();
      if (Array.isArray(data)) {
        setUsers(data);
      } else {
        setError("Failed to fetch expired users");
      }
    } catch (err) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleSendReminder = async (id) => {
    try {
      setRemindingId(id);
      await sendAdminRenewalReminder(id);
      setSuccess("Renewal reminder sent successfully");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err.message || "Failed to send reminder");
    } finally {
      setRemindingId(null);
    }
  };

  const handleExtend = async (id) => {
    try {
      await extendAdminUserPlan(id, extensionDays);
      setSuccess(`Plan extended by ${extensionDays} days`);
      setExtendingId(null);
      fetchExpiredUsers(); // Refresh list (user should disappear from expired list)
    } catch (err) {
      setError(err.message || "Extension failed");
    }
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
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.04em", color: "#0F1923", lineHeight: 1 }}>EXPIRED USERS</div>
            <div style={{ fontSize: 8, letterSpacing: "0.18em", color: "#B8860B", marginTop: 1, fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>RETENTION PORTAL</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
           <span style={{ fontSize: 11, fontWeight: 600, color: "#B8860B", fontFamily: "'JetBrains Mono',monospace" }}>{adminName}</span>
        </div>
      </header>

      {/* Accent bar */}
      <div style={{ height: 3, background: "linear-gradient(90deg,#B8860B 0%,#D63B3B 50%,#B8860B 100%)" }} />

      <main style={{ padding: "32px 28px", maxWidth: 1400, margin: "0 auto" }}>
        
        {/* Alerts */}
        {error && (
          <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#B91C1C", padding: "12px 16px", borderRadius: 8, marginBottom: 20, fontSize: 13, display: "flex", justifyContent: "space-between" }}>
            {error} <button onClick={() => setError("")} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit" }}>×</button>
          </div>
        )}
        {success && (
          <div style={{ background: "#F0FDF4", border: "1px solid #86EFAC", color: "#15803D", padding: "12px 16px", borderRadius: 8, marginBottom: 20, fontSize: 13, display: "flex", justifyContent: "space-between" }}>
            {success} <button onClick={() => setSuccess("")} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit" }}>×</button>
          </div>
        )}

        <div style={{
          background: "white", borderRadius: 16, border: "1px solid #E2E8F0",
          boxShadow: "0 1px 6px rgba(0,0,0,0.05)", overflow: "hidden"
        }}>
          <div style={{ padding: "24px", borderBottom: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0F1923", margin: 0 }}>Lapsed Subscriptions</h2>
            <div style={{ color: "#D63B3B", fontSize: 12, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{users.length} EXPIRED USERS</div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #F1F5F9", background: "#F8FAFC" }}>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>USER</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>EXPIRY DATE</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>LAST ACTIVITY</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>PLAN HELD</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em", textAlign: "right" }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="5" style={{ padding: "40px", textAlign: "center", color: "#94A3B8", fontSize: 13 }}>Scanning for expired accounts...</td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan="5" style={{ padding: "40px", textAlign: "center", color: "#94A3B8", fontSize: 13 }}>Great news! No users are currently expired.</td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user._id} style={{ borderBottom: "1px solid #F1F5F9", fontSize: 13 }} onMouseEnter={e => e.currentTarget.style.background = "#FBFBFA"} onMouseLeave={e => e.currentTarget.style.background = "none"}>
                      <td style={{ padding: "16px 24px" }}>
                        <div style={{ fontWeight: 700, color: "#0F1923" }}>{user.name}</div>
                        <div style={{ fontSize: 11, color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace" }}>{user.email}</div>
                      </td>
                      <td style={{ padding: "16px 24px" }}>
                         <div style={{ color: "#D63B3B", fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>
                           {new Date(user.subscriptionExpiry).toLocaleDateString()}
                         </div>
                         <div style={{ fontSize: 10, color: "#94A3B8" }}>
                           {Math.ceil((new Date() - new Date(user.subscriptionExpiry)) / (1000 * 60 * 60 * 24))} days overdue
                         </div>
                      </td>
                      <td style={{ padding: "16px 24px", color: "#4A5568", fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>
                        {user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : "Never logged in"}
                      </td>
                      <td style={{ padding: "16px 24px" }}>
                        <div style={{
                          display: "inline-block", padding: "2px 8px", borderRadius: 4,
                          background: "#F1F5F9", fontSize: 10, fontWeight: 700, color: "#475569"
                        }}>
                          {user.subscriptionPlan?.toUpperCase() || "FREE"}
                        </div>
                      </td>
                      <td style={{ padding: "16px 24px", textAlign: "right" }}>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                          
                          {/* Extension */}
                          <div style={{ position: "relative" }}>
                            <button 
                              onClick={() => setExtendingId(extendingId === user._id ? null : user._id)}
                              style={{ padding: "8px 12px", background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 8, cursor: "pointer", color: "#15803D", fontSize: 11, fontWeight: 700 }}
                            >
                              EXTEND ACCESS
                            </button>
                            
                            {extendingId === user._id && (
                              <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 8, background: "white", padding: "12px", borderRadius: 12, border: "1px solid #E2E8F0", boxShadow: "0 10px 25px rgba(0,0,0,0.1)", zIndex: 10, width: 150, textAlign: "left" }}>
                                <div style={{ fontSize: 10, fontWeight: 800, color: "#64748B", marginBottom: 8, letterSpacing: "0.05em" }}>ADD DAYS</div>
                                <input type="number" value={extensionDays} onChange={e => setExtensionDays(e.target.value)} style={{ width: "100%", padding: "8px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 12, marginBottom: 8 }} />
                                <button onClick={() => handleExtend(user._id)} style={{ width: "100%", background: "#15803D", color: "white", border: "none", borderRadius: 8, padding: "8px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>ACTIVATE</button>
                              </div>
                            )}
                          </div>

                          {/* Reminder */}
                          <button 
                            onClick={() => handleSendReminder(user._id)}
                            disabled={remindingId === user._id}
                            style={{ 
                              padding: "8px 12px", background: "#FFF7ED", border: "1px solid #FDE68A", borderRadius: 8, 
                              cursor: remindingId === user._id ? "default" : "pointer", 
                              color: "#B8860B", fontSize: 11, fontWeight: 700,
                              display: "flex", alignItems: "center", gap: 6
                            }}
                          >
                            {remindingId === user._id ? "SENDING..." : "SEND REMINDER"}
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
                          </button>

                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
