"use client";

import { useEffect, useState } from "react";
import { 
  getAllAdminUsers, 
  deleteAdminUser, 
  toggleAdminUserStatus, 
  extendAdminUserPlan,
  sendAdminCustomNotification
} from "@/services/adminApi";

import AdminHeader from "@/components/AdminHeader";

const notificationTemplates = [
  {
    label: "Morning Push",
    title: "Good morning, trader ☀️",
    body: "Fresh day, fresh discipline. Review your plan before the first trade and protect your capital. 📈",
    deepLink: "/dashboard",
  },
  {
    label: "Risk Check",
    title: "Risk check time 🛡️",
    body: "Pause for 30 seconds: position size, stop loss, and daily loss limit. Trade the plan, not the impulse. ⚡",
    deepLink: "/add-trade",
  },
  {
    label: "Journal Reminder",
    title: "Log your trade 📝",
    body: "Your edge improves when your data is complete. Add the entry, exit, screenshot, and emotion while it is fresh. ✅",
    deepLink: "/add-trade",
  },
  {
    label: "Weekly Review",
    title: "Review your week 📊",
    body: "Look at what worked, what hurt, and what to repeat next week. Small reviews create serious progress. 🔍",
    deepLink: "/weekly-reports",
  },
  {
    label: "Discipline Win",
    title: "Discipline first 🎯",
    body: "A skipped bad setup is still a winning decision. Stay selective and let quality trades come to you. 💪",
    deepLink: "/analytics",
  },
  {
    label: "Subscription",
    title: "Keep your edge active 🚀",
    body: "Your trading journal keeps your progress visible. Renew your plan to continue tracking every improvement. ✨",
    deepLink: "/pricing",
  },
];

/* ─────────────────────────────────────────
   USER MANAGEMENT PAGE – Light theme
───────────────────────────────────────── */
export default function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [extendingId, setExtendingId] = useState(null);
  const [extensionDays, setExtensionDays] = useState(30);
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [sendToAll, setSendToAll] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [customBody, setCustomBody] = useState("");
  const [customDeepLink, setCustomDeepLink] = useState("/notifications");
  const [sendingNotification, setSendingNotification] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const data = await getAllAdminUsers();
      if (Array.isArray(data)) {
        setUsers(data);
      } else {
        setError("Failed to fetch users");
      }
    } catch (err) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Are you sure you want to delete this user? This action cannot be undone.")) return;
    try {
      await deleteAdminUser(id);
      setSuccess("User deleted successfully");
      fetchUsers();
    } catch (err) {
      setError(err.message || "Deletion failed");
    }
  };

  const handleToggleStatus = async (id) => {
    try {
      await toggleAdminUserStatus(id);
      setSuccess("Status updated");
      fetchUsers();
    } catch (err) {
      setError(err.message || "Update failed");
    }
  };

  const handleExtend = async (id) => {
    try {
      await extendAdminUserPlan(id, extensionDays);
      setSuccess(`Plan extended by ${extensionDays} days`);
      setExtendingId(null);
      fetchUsers();
    } catch (err) {
      setError(err.message || "Extension failed");
    }
  };

  const toggleSelectedUser = (id) => {
    setSelectedUserIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAllVisible = () => {
    if (selectedUserIds.length === users.length) {
      setSelectedUserIds([]);
    } else {
      setSelectedUserIds(users.map((user) => user._id));
    }
  };

  const applyNotificationTemplate = (template) => {
    setCustomTitle(template.title);
    setCustomBody(template.body);
    setCustomDeepLink(template.deepLink);
    setError("");
    setSuccess("");
  };

  const handleSendCustomNotification = async () => {
    setError("");
    setSuccess("");
    if (!customTitle.trim() || !customBody.trim()) {
      setError("Notification title and message are required");
      return;
    }
    if (!sendToAll && selectedUserIds.length === 0) {
      setError("Select at least one user or enable send to all");
      return;
    }

    try {
      setSendingNotification(true);
      const result = await sendAdminCustomNotification({
        title: customTitle,
        body: customBody,
        deepLink: customDeepLink || "/notifications",
        sendToAll,
        userIds: sendToAll ? [] : selectedUserIds,
      });
      setSuccess(`Notification created for ${result.created || 0} users. Delivered to ${result.delivered || 0}. No device token: ${result.noDeviceToken || 0}.`);
      setCustomTitle("");
      setCustomBody("");
      setSendToAll(false);
      setSelectedUserIds([]);
    } catch (err) {
      setError(err.message || "Failed to send notification");
    } finally {
      setSendingNotification(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "active": return "#0D9E6E";
      case "expired": return "#D63B3B";
      default: return "#94A3B8";
    }
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#F0EEE9",
      fontFamily: "'Plus Jakarta Sans',sans-serif",
      color: "#0F1923",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />

      <AdminHeader title="USER MANAGEMENT" subtitle="ADMIN PORTAL" />

      {/* Accent bar */}
      <div style={{ height: 3, background: "linear-gradient(90deg,#B8860B 0%,#0D9E6E 50%,#B8860B 100%)" }} />

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
          boxShadow: "0 1px 6px rgba(0,0,0,0.05)", padding: 24, marginBottom: 24
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 18 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0F1923", margin: 0 }}>Custom User Notification</h2>
              <p style={{ margin: "6px 0 0", color: "#64748B", fontSize: 13 }}>
                Send a push and in-app notification to selected users or every user.
              </p>
            </div>
            <div style={{ color: "#94A3B8", fontSize: 12, fontFamily: "'JetBrains Mono',monospace" }}>
              {sendToAll ? "ALL USERS" : `${selectedUserIds.length} SELECTED`}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <input
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder="Notification title"
              maxLength={120}
              style={{ padding: "12px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: 13 }}
            />
            <input
              value={customDeepLink}
              onChange={(e) => setCustomDeepLink(e.target.value)}
              placeholder="/notifications"
              style={{ padding: "12px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: 13 }}
            />
          </div>

          <textarea
            value={customBody}
            onChange={(e) => setCustomBody(e.target.value)}
            placeholder="Write the message users should receive"
            maxLength={500}
            rows={3}
            style={{ width: "100%", padding: "12px", border: "1px solid #CBD5E1", borderRadius: 8, fontSize: 13, resize: "vertical", marginBottom: 14 }}
          />

          <div style={{ marginBottom: 16 }}>
            <div style={{ color: "#64748B", fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", marginBottom: 8 }}>
              PRE-BUILT TEMPLATES
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {notificationTemplates.map((template) => (
                <button
                  key={template.label}
                  type="button"
                  onClick={() => applyNotificationTemplate(template)}
                  title={`Use ${template.label} template`}
                  style={{
                    border: "1px solid #CBD5E1",
                    background: "#F8FAFC",
                    color: "#0F1923",
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: "pointer"
                  }}
                >
                  {template.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#334155", fontSize: 13, fontWeight: 700 }}>
              <input
                type="checkbox"
                checked={sendToAll}
                onChange={(e) => setSendToAll(e.target.checked)}
              />
              Send to every user
            </label>
            <button
              onClick={handleSendCustomNotification}
              disabled={sendingNotification}
              style={{
                background: sendingNotification ? "#94A3B8" : "#0F1923",
                color: "white",
                border: "none",
                borderRadius: 8,
                padding: "11px 16px",
                fontSize: 12,
                fontWeight: 800,
                cursor: sendingNotification ? "not-allowed" : "pointer"
              }}
            >
              {sendingNotification ? "SENDING..." : "SEND NOTIFICATION"}
            </button>
          </div>
        </div>

        <div style={{
          background: "white", borderRadius: 16, border: "1px solid #E2E8F0",
          boxShadow: "0 1px 6px rgba(0,0,0,0.05)", overflow: "hidden"
        }}>
          <div style={{ padding: "24px", borderBottom: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: "#0F1923", margin: 0 }}>Registered Users</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                onClick={toggleSelectAllVisible}
                style={{ border: "1px solid #CBD5E1", background: "white", borderRadius: 8, padding: "8px 10px", fontSize: 11, fontWeight: 800, cursor: "pointer", color: "#334155" }}
              >
                {selectedUserIds.length === users.length && users.length > 0 ? "CLEAR SELECTION" : "SELECT ALL"}
              </button>
              <div style={{ color: "#94A3B8", fontSize: 12, fontFamily: "'JetBrains Mono',monospace" }}>{users.length} TOTAL USERS</div>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #F1F5F9", background: "#F8FAFC" }}>
                  <th style={{ padding: "16px 12px 16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }} />
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>USER</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>PLAN STATUS</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>SIGNUP DATE</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>EXPIRY</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>TRADES</th>
                  <th style={{ padding: "16px 24px", fontSize: 11, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em", textAlign: "right" }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="7" style={{ padding: "40px", textAlign: "center", color: "#94A3B8", fontSize: 13 }}>Loading users...</td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ padding: "40px", textAlign: "center", color: "#94A3B8", fontSize: 13 }}>No users found.</td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user._id} style={{ borderBottom: "1px solid #F1F5F9", fontSize: 13, transition: "background 0.2s" }} onMouseEnter={e => e.currentTarget.style.background = "#FBFBFA"} onMouseLeave={e => e.currentTarget.style.background = "none"}>
                      <td style={{ padding: "16px 12px 16px 24px" }}>
                        <input
                          type="checkbox"
                          checked={selectedUserIds.includes(user._id)}
                          onChange={() => toggleSelectedUser(user._id)}
                          disabled={sendToAll}
                          title="Select user for custom notification"
                        />
                      </td>
                      <td style={{ padding: "16px 24px" }}>
                        <div style={{ fontWeight: 700, color: "#0F1923" }}>{user.name}</div>
                        <div style={{ fontSize: 11, color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace" }}>{user.email}</div>
                      </td>
                      <td style={{ padding: "16px 24px" }}>
                        <div style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          padding: "4px 10px", borderRadius: 20, 
                          background: `${getStatusColor(user.subscriptionStatus)}12`,
                          color: getStatusColor(user.subscriptionStatus),
                          fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em"
                        }}>
                          <div style={{ width: 5, height: 5, borderRadius: "50%", background: getStatusColor(user.subscriptionStatus) }} />
                          {user.subscriptionStatus || "inactive"}
                        </div>
                        <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 4 }}>{user.subscriptionPlan?.toUpperCase() || "FREE"}</div>
                      </td>
                      <td style={{ padding: "16px 24px", color: "#4A5568", fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: "16px 24px", color: "#4A5568", fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>
                        {user.subscriptionExpiry ? new Date(user.subscriptionExpiry).toLocaleDateString() : "N/A"}
                      </td>
                      <td style={{ padding: "16px 24px" }}>
                         <div style={{ fontWeight: 700, color: "#0F1923" }}>{user.tradeCount || 0}</div>
                         <div style={{ fontSize: 9, color: "#94A3B8", display: "flex", gap: 4 }}>
                            <span>F:{user.forexTradeCount || 0}</span>
                            <span>I:{user.indianTradeCount || 0}</span>
                         </div>
                      </td>
                      <td style={{ padding: "16px 24px", textAlign: "right" }}>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                          
                          {/* Extend Action */}
                          <div style={{ position: "relative" }}>
                            <button 
                              onClick={() => setExtendingId(extendingId === user._id ? null : user._id)}
                              style={{ padding: "6px", background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: 6, cursor: "pointer", color: "#64748B" }}
                              title="Extend Plan"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                            </button>
                            
                            {extendingId === user._id && (
                              <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 8, background: "white", padding: "12px", borderRadius: 8, border: "1px solid #E2E8F0", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", zIndex: 10, width: 140 }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: "#64748B", marginBottom: 8 }}>DAYS TO ADD</div>
                                <input type="number" value={extensionDays} onChange={e => setExtensionDays(e.target.value)} style={{ width: "100%", padding: "6px", border: "1px solid #E2E8F0", borderRadius: 4, fontSize: 12, marginBottom: 8 }} />
                                <button onClick={() => handleExtend(user._id)} style={{ width: "100%", background: "#B8860B", color: "white", border: "none", borderRadius: 4, padding: "6px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>APPLY</button>
                              </div>
                            )}
                          </div>

                          {/* Deactivate/Activate Action */}
                          <button 
                            onClick={() => handleToggleStatus(user._id)}
                            style={{ padding: "6px", background: user.subscriptionStatus === "active" ? "#FEF2F2" : "#F0FDF4", border: `1px solid ${user.subscriptionStatus === "active" ? "#FCA5A5" : "#86EFAC"}`, borderRadius: 6, cursor: "pointer", color: user.subscriptionStatus === "active" ? "#B91C1C" : "#15803D" }}
                            title={user.subscriptionStatus === "active" ? "Deactivate" : "Activate"}
                          >
                            {user.subscriptionStatus === "active" ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                            )}
                          </button>

                          {/* Delete Action */}
                          <button 
                            onClick={() => handleDelete(user._id)}
                            style={{ padding: "6px", background: "white", border: "1px solid #FCA5A5", borderRadius: 6, cursor: "pointer", color: "#B91C1C" }}
                            title="Delete User"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
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
