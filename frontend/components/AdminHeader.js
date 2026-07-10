"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { 
  getAdminNotifications, 
  markAdminNotificationAsRead, 
  markAllAdminNotificationsAsRead,
  clearAdminSession,
} from "@/services/adminApi";

export default function AdminHeader({ title, subtitle }) {
  const router = useRouter();
  const [adminName] = useState(() =>
    typeof window === "undefined"
      ? "Admin"
      : localStorage.getItem("adminName") || "Admin"
  );
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await getAdminNotifications();
      if (Array.isArray(data)) setNotifications(data);
    } catch (err) {
      console.error("Notifications error:", err);
    }
  }, []);

  useEffect(() => {
    const initialFetch = setTimeout(fetchNotifications, 0);
    const interval = setInterval(fetchNotifications, 60000);
    return () => {
      clearTimeout(initialFetch);
      clearInterval(interval);
    };
  }, [fetchNotifications]);

  const handleLogout = async () => {
    await clearAdminSession();
    router.push("/admin/login");
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <>
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 28px", height: 60,
        background: "rgba(255,255,255,0.92)", backdropFilter: "blur(20px)",
        borderBottom: "1px solid #E2E8F0",
        boxShadow: "0 1px 12px rgba(15,25,35,0.06)",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => router.push("/admin/dashboard")} style={{ background: "none", border: "none", cursor: "pointer", color: "#0F1923", display: "flex", alignItems: "center" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          </button>
          <div style={{ width: 150, height: 38, display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
            <img src="/mainlogo1.png" alt="Edgecipline" style={{ width: "100%", height: "100%", objectFit: "contain", objectPosition: "left center" }} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* Notification Bell */}
          <div style={{ position: "relative" }}>
            <button 
              onClick={() => setShowNotifications(!showNotifications)}
              style={{ 
                background: "none", border: "none", cursor: "pointer", 
                color: "#64748B", display: "flex", alignItems: "center", justifyContent: "center",
                transition: "color 0.2s"
              }}
              onMouseEnter={e => e.currentTarget.style.color = "#0F1923"}
              onMouseLeave={e => e.currentTarget.style.color = "#64748B"}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
              {unreadCount > 0 && (
                <div style={{ 
                  position: "absolute", top: -2, right: -2, background: "#D63B3B", 
                  color: "white", fontSize: 8, fontWeight: 800, minWidth: 14, height: 14, 
                  borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
                  border: "2px solid white"
                }}>
                  {unreadCount}
                </div>
              )}
            </button>

            {/* Notifications Dropdown */}
            {showNotifications && (
              <>
                <div 
                  onClick={() => setShowNotifications(false)}
                  style={{ position: "fixed", inset: 0, zIndex: 100 }}
                />
                <div style={{
                  position: "absolute", top: 45, right: -10, width: 340, 
                  background: "white", borderRadius: 16, border: "1px solid #E2E8F0",
                  boxShadow: "0 10px 30px rgba(0,0,0,0.12)", zIndex: 101,
                  overflow: "hidden", animation: "fadeUp 0.2s ease"
                }}>
                  <div style={{ padding: "16px 20px", borderBottom: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: 800 }}>NOTIFICATIONS</span>
                    <button 
                      onClick={async () => {
                        await markAllAdminNotificationsAsRead();
                        fetchNotifications();
                      }}
                      style={{ background: "none", border: "none", color: "#B8860B", fontSize: 10, fontWeight: 700, cursor: "pointer" }}
                    >
                      MARK ALL AS READ
                    </button>
                  </div>
                  <div style={{ maxHeight: 380, overflowY: "auto" }}>
                    {notifications.length === 0 ? (
                      <div style={{ padding: 40, textAlign: "center", color: "#94A3B8", fontSize: 12 }}>No notifications yet</div>
                    ) : (
                      notifications.map(n => (
                        <div 
                          key={n._id}
                          onClick={async () => {
                            if (!n.isRead) {
                              await markAdminNotificationAsRead(n._id);
                              fetchNotifications();
                            }
                            if (n.type === "payment") router.push("/admin/payments");
                            if (n.type === "feedback") router.push("/admin/feedback");
                            setShowNotifications(false);
                          }}
                          style={{
                            padding: "14px 20px", borderBottom: "1px solid #F8FAFC",
                            background: n.isRead ? "transparent" : "#FFF7ED",
                            cursor: "pointer", transition: "background 0.2s",
                            display: "flex", gap: 12
                          }}
                        >
                          <div style={{ 
                            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                            background: n.type === "payment" ? "rgba(13,158,110,0.1)" : "rgba(59,130,246,0.1)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: n.type === "payment" ? "#0D9E6E" : "#3B82F6", fontSize: 16
                          }}>
                            {n.type === "payment" ? "💰" : "📝"}
                          </div>
                          <div style={{ textAlign: "left" }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#0F1923", marginBottom: 2 }}>{n.title}</div>
                            <div style={{ fontSize: 11, color: "#64748B", lineHeight: 1.4, marginBottom: 4 }}>{n.message}</div>
                            <div style={{ fontSize: 9, color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace" }}>
                              {new Date(n.createdAt).toLocaleString()}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div style={{ padding: 12, textAlign: "center", borderTop: "1px solid #F1F5F9", background: "#F8FAFC" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#64748B", letterSpacing: "0.05em" }}>END OF ACTIVITY</span>
                  </div>
                </div>
              </>
            )}
          </div>

          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "#FFF7ED", border: "1px solid #FDE68A",
            borderRadius: 20, padding: "5px 12px",
          }}>
            <div style={{
              width: 24, height: 24, borderRadius: "50%",
              background: "linear-gradient(135deg,#B8860B,#D4A843)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, fontWeight: 700, color: "#FFFFFF",
            }}>
              {adminName.charAt(0).toUpperCase()}
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#B8860B", fontFamily: "'JetBrains Mono',monospace" }}>
              {adminName}
            </span>
          </div>

          <button
            onClick={handleLogout}
            style={{
              background: "rgba(214,59,59,0.06)", border: "1px solid rgba(214,59,59,0.2)",
              borderRadius: 8, padding: "7px 14px",
              color: "#D63B3B", fontSize: 10, fontWeight: 600,
              fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.06em",
              cursor: "pointer", transition: "all 0.2s",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            LOGOUT
          </button>
        </div>
      </header>
      {/* Accent bar */}
      <div style={{ height: 3, background: "linear-gradient(90deg,#B8860B 0%,#0D9E6E 50%,#B8860B 100%)" }} />
      
      <style>{`
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
      `}</style>
    </>
  );
}
