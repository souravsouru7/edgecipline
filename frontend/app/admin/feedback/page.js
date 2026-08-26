"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { 
  getAdminFeedback, 
  updateAdminFeedbackStatus, 
  deleteAdminFeedback 
} from "@/services/adminApi";
import AdminHeader from "@/components/AdminHeader";


/* ─────────────────────────────────────────
   FEEDBACK MANAGEMENT PAGE – Light theme
───────────────────────────────────────── */
export default function FeedbackManagementPage() {
  const router = useRouter();
  const [feedback, setFeedback] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedItem, setSelectedItem] = useState(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [updatingId, setUpdatingId] = useState(null);

  useEffect(() => {
    fetchFeedback();
  }, []);

  const fetchFeedback = async () => {
    try {
      setLoading(true);
      const data = await getAdminFeedback();
      if (Array.isArray(data)) {
        setFeedback(data);
      } else {
        setError("Failed to fetch feedback");
      }
    } catch (err) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (id, status) => {
    try {
      setUpdatingId(id);
      await updateAdminFeedbackStatus(id, { status, adminNotes });
      setSuccess("Status updated successfully");
      setSelectedItem(null);
      fetchFeedback();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err.message || "Update failed");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this feedback?")) return;
    try {
      await deleteAdminFeedback(id);
      setSuccess("Feedback deleted");
      fetchFeedback();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err.message || "Delete failed");
    }
  };

  const filteredFeedback = feedback.filter(f => 
    filter === "all" || f.type === filter || f.status === filter
  );

  const getStatusColor = (status) => {
    switch (status) {
      case "RESOLVED": return "#0D9E6E";
      case "IN_PROGRESS": return "#3B82F6";
      default: return "#D63B3B";
    }
  };

  const getTypeLabel = (type) => {
    switch (type) {
      case "BUG": return { label: "BUG", color: "#D63B3B", bg: "#FEF2F2" };
      case "FEATURE_REQUEST": return { label: "FEATURE", color: "#3B82F6", bg: "#EFF6FF" };
      default: return { label: "FEEDBACK", color: "#64748B", bg: "#F8FAFC" };
    }
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#F0EEE9",
      fontFamily: "'Plus Jakarta Sans',sans-serif",
      color: "#0F1923",
    }}>

      <AdminHeader title="FEEDBACK & SUPPORT" subtitle="USER VOICE" />

      <div style={{ height: 3, background: "linear-gradient(90deg,#B8860B 0%,#0D9E6E 50%,#B8860B 100%)" }} />

      <main style={{ padding: "32px 28px", maxWidth: 1200, margin: "0 auto" }}>
        
        {/* Alerts */}
        {error && <div style={{ background: "#FEF2F2", color: "#B91C1C", padding: 12, borderRadius: 8, marginBottom: 20 }}>{error}</div>}
        {success && <div style={{ background: "#F0FDF4", color: "#15803D", padding: 12, borderRadius: 8, marginBottom: 20 }}>{success}</div>}

        {/* Filters */}
        <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
          {["all", "BUG", "FEATURE_REQUEST", "PENDING", "RESOLVED"].map(f => (
            <button 
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "8px 16px", borderRadius: 20, border: "1px solid #E2E8F0",
                background: filter === f ? "#B8860B" : "white",
                color: filter === f ? "white" : "#64748B",
                fontSize: 11, fontWeight: 700, cursor: "pointer",
                textTransform: "uppercase", letterSpacing: "0.05em"
              }}
            >
              {f.replace("_", " ")}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: 20 }}>
          {loading ? (
            <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 40, color: "#94A3B8" }}>Loading feedback...</div>
          ) : filteredFeedback.length === 0 ? (
            <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 40, color: "#94A3B8" }}>No feedback found.</div>
          ) : (
            filteredFeedback.map(f => {
              const typeInfo = getTypeLabel(f.type);
              return (
                <div key={f._id} style={{
                  background: "white", borderRadius: 16, border: "1px solid #E2E8F0",
                  padding: 24, boxShadow: "0 1px 6px rgba(0,0,0,0.03)",
                  cursor: "pointer", transition: "all 0.2s"
                }} onClick={() => { setSelectedItem(f); setAdminNotes(f.adminNotes || ""); }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                    <div style={{ 
                      background: typeInfo.bg, color: typeInfo.color, 
                      fontSize: 9, fontWeight: 800, padding: "4px 8px", borderRadius: 4 
                    }}>
                      {typeInfo.label}
                    </div>
                    <div style={{ fontSize: 10, color: getStatusColor(f.status), fontWeight: 700 }}>
                      ● {f.status}
                    </div>
                  </div>
                  <h4 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700 }}>{f.subject}</h4>
                  <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 20px", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {f.message}
                  </p>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #F1F5F9", paddingTop: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 600 }}>{f.user?.name}</div>
                    <div style={{ fontSize: 10, color: "#94A3B8", fontFamily: "'JetBrains Mono'" }}>{new Date(f.createdAt).toLocaleDateString()}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>

      {/* Item Details Modal */}
      {selectedItem && (
        <div style={{
          position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
          background: "rgba(15,25,35,0.7)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000
        }}>
          <div style={{
            background: "white", width: "90%", maxWidth: 600, borderRadius: 20,
            padding: "32px 32px 24px 32px", boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
            maxHeight: "90vh", overflowY: "auto"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#B8860B" }}>{selectedItem.status}</div>
              <button onClick={() => setSelectedItem(null)} style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#94A3B8" }}>×</button>
            </div>

            <h2 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 8px" }}>{selectedItem.subject}</h2>
            <div style={{ fontSize: 12, color: "#64748B", marginBottom: 24, fontFamily: "'JetBrains Mono'" }}>
              From: {selectedItem.user?.name} ({selectedItem.user?.email})
            </div>

            <div style={{ background: "#F8FAFC", padding: 20, borderRadius: 12, marginBottom: 24, fontSize: 14, color: "#1E293B", lineHeight: 1.6 }}>
              {selectedItem.message}
            </div>

            {selectedItem.screenshot && (
              <div style={{ marginBottom: 24 }}>
                <label style={{ fontSize: 11, fontWeight: 800, color: "#64748B", display: "block", marginBottom: 8 }}>ATTACHED SCREENSHOT</label>
                <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", border: "1px solid #E2E8F0" }}>
                  <img 
                    src={selectedItem.screenshot} 
                    alt="Feedback Screenshot" 
                    style={{ 
                      width: "100%", maxHeight: "250px", objectFit: "contain",
                      display: "block", cursor: "pointer", background: "#f8fafc" 
                    }}
                    onClick={() => window.open(selectedItem.screenshot, "_blank")}
                  />
                  <div style={{ 
                    position: "absolute", bottom: 0, left: 0, right: 0, 
                    background: "rgba(0,0,0,0.5)", color: "white", padding: "8px",
                    fontSize: 10, textAlign: "center", backdropFilter: "blur(4px)"
                  }}>
                    Click image to view full size
                  </div>
                </div>
              </div>
            )}

            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 11, fontWeight: 800, color: "#64748B", display: "block", marginBottom: 8 }}>ADMIN NOTES</label>
              <textarea 
                value={adminNotes} onChange={e => setAdminNotes(e.target.value)}
                placeholder="Internal notes about this request..."
                style={{ width: "100%", height: 100, padding: 12, borderRadius: 10, border: "1px solid #E2E8F0", outline: "none", fontSize: 13 }}
              />
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <button 
                onClick={() => handleUpdateStatus(selectedItem._id, "RESOLVED")}
                disabled={updatingId === selectedItem._id}
                style={{ flex: 1, padding: 12, background: "#0D9E6E", color: "white", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                {updatingId === selectedItem._id ? "SAVING..." : "MARK AS RESOLVED"}
              </button>
              <button 
                onClick={() => handleUpdateStatus(selectedItem._id, "IN_PROGRESS")}
                disabled={updatingId === selectedItem._id}
                style={{ flex: 1, padding: 12, background: "#3B82F6", color: "white", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                IN PROGRESS
              </button>
              <button 
                onClick={() => handleDelete(selectedItem._id)}
                style={{ width: 48, height: 48, background: "#FEF2F2", border: "none", borderRadius: 10, color: "#D63B3B", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
