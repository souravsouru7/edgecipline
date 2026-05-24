"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell, CheckCheck, Loader2,
  Sunrise, AlertTriangle, TrendingUp,
  Brain, Clock, Shield, BookOpen, Target,
} from "lucide-react";
import {
  getNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "@/services/notificationApi";

// ─── Type → visual metadata ───────────────────────────────────────────────────

const TYPE_META = {
  morning_mentor: {
    label: "Morning Mentor", Icon: Sunrise,
    color: "#F59E0B", accent: "#FCD34D",
    bg: "rgba(245,158,11,0.07)", border: "rgba(245,158,11,0.35)",
    unreadBg: "#120D00",
  },
  revenge_trading: {
    label: "Risk Alert", Icon: AlertTriangle,
    color: "#E53935", accent: "#FF5252",
    bg: "rgba(229,57,53,0.07)", border: "rgba(229,57,53,0.3)",
    unreadBg: "#110000",
  },
  overtrading: {
    label: "Risk Alert", Icon: AlertTriangle,
    color: "#E53935", accent: "#FF5252",
    bg: "rgba(229,57,53,0.07)", border: "rgba(229,57,53,0.3)",
    unreadBg: "#110000",
  },
  daily_loss_warning: {
    label: "Risk Alert", Icon: Shield,
    color: "#E53935", accent: "#FF5252",
    bg: "rgba(229,57,53,0.07)", border: "rgba(229,57,53,0.3)",
    unreadBg: "#110000",
  },
  no_stop_loss: {
    label: "Risk Alert", Icon: Shield,
    color: "#E53935", accent: "#FF5252",
    bg: "rgba(229,57,53,0.07)", border: "rgba(229,57,53,0.3)",
    unreadBg: "#110000",
  },
  setup_discipline: {
    label: "Discipline", Icon: Target,
    color: "#F59E0B", accent: "#FCD34D",
    bg: "rgba(245,158,11,0.07)", border: "rgba(245,158,11,0.25)",
    unreadBg: "#110D00",
  },
  mood_risk: {
    label: "Discipline", Icon: Brain,
    color: "#F59E0B", accent: "#FCD34D",
    bg: "rgba(245,158,11,0.07)", border: "rgba(245,158,11,0.25)",
    unreadBg: "#110D00",
  },
  repeated_mistake: {
    label: "Insight", Icon: TrendingUp,
    color: "#0D9E6E", accent: "#34D399",
    bg: "rgba(13,158,110,0.07)", border: "rgba(13,158,110,0.25)",
    unreadBg: "#001209",
  },
  weekly_ai_insight: {
    label: "Weekly Insight", Icon: TrendingUp,
    color: "#0D9E6E", accent: "#34D399",
    bg: "rgba(13,158,110,0.07)", border: "rgba(13,158,110,0.25)",
    unreadBg: "#001209",
  },
  weekly_report_reminder: {
    label: "Weekly Report", Icon: BookOpen,
    color: "#0D9E6E", accent: "#34D399",
    bg: "rgba(13,158,110,0.07)", border: "rgba(13,158,110,0.25)",
    unreadBg: "#001209",
  },
  confidence_reminder: {
    label: "Coaching", Icon: Brain,
    color: "#3B82F6", accent: "#60A5FA",
    bg: "rgba(59,130,246,0.07)", border: "rgba(59,130,246,0.25)",
    unreadBg: "#000D1A",
  },
  session_reminder: {
    label: "Session", Icon: Clock,
    color: "#8B5CF6", accent: "#A78BFA",
    bg: "rgba(139,92,246,0.07)", border: "rgba(139,92,246,0.25)",
    unreadBg: "#0A0014",
  },
};

const DEFAULT_META = {
  label: "System", Icon: Bell,
  color: "#38BDF8", accent: "#7DD3FC",
  bg: "rgba(56,189,248,0.07)", border: "rgba(56,189,248,0.2)",
  unreadBg: "#00101A",
};

function getMeta(type) {
  return TYPE_META[type] || DEFAULT_META;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SCENARIO_COLOR = {
  revenge: "#E53935", no_stop_loss: "#E53935",
  overtrading: "#F59E0B", emotional: "#F59E0B", low_setup: "#F59E0B",
  loss_day: "#64748B", reset: "#64748B",
  disciplined_win: "#0D9E6E", profitable: "#0D9E6E",
  weekend: "#8B5CF6", no_trade: "#38BDF8",
};

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr);
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "Just now";
  if (h < 24) return `${h}h ago`;
  if (h < 48) return "Yesterday";
  return new Date(dateStr).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// ─── Morning Mentor card — premium treatment ───────────────────────────────────

function MorningMentorCard({ n, onRead }) {
  const isRead = n.isRead;
  const scenario = n.data?.scenario || "";
  const scenarioColor = SCENARIO_COLOR[scenario] || "#F59E0B";

  return (
    <button
      type="button"
      onClick={onRead}
      style={{
        width: "100%", textAlign: "left", cursor: "pointer",
        background: isRead ? "#0D0D0D" : "#120D00",
        border: `1px solid ${isRead ? "#1C1600" : "rgba(245,158,11,0.4)"}`,
        borderRadius: 14,
        padding: 0,
        overflow: "hidden",
        position: "relative",
        boxShadow: isRead ? "none" : "0 4px 24px rgba(245,158,11,0.1)",
        transition: "box-shadow 0.2s",
      }}
    >
      {/* Animated gold top bar — only on unread */}
      {!isRead && (
        <div style={{
          height: 3,
          background: "linear-gradient(90deg, transparent, #F59E0B, #FCD34D, #F59E0B, transparent)",
        }} />
      )}

      <div style={{ padding: "16px 18px", paddingTop: !isRead ? 14 : 16 }}>
        {/* Row 1 – badge + timestamp */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8, flexShrink: 0,
              background: "rgba(245,158,11,0.12)",
              border: "1px solid rgba(245,158,11,0.25)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Sunrise size={17} color="#F59E0B" />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{
                fontSize: 10, fontWeight: 800, letterSpacing: "0.1em",
                color: "#F59E0B", textTransform: "uppercase",
              }}>
                Morning Mentor
              </span>
              {!isRead && (
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: "#F59E0B", display: "inline-block",
                  boxShadow: "0 0 6px #F59E0B",
                }} />
              )}
            </div>
          </div>
          <span style={{ fontSize: 11, color: "#475569" }}>{timeAgo(n.createdAt)}</span>
        </div>

        {/* Title */}
        <p style={{
          margin: "0 0 6px",
          fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em",
          color: isRead ? "#64748B" : "#F1F5F9",
          lineHeight: 1.3,
        }}>
          {n.title}
        </p>

        {/* Body */}
        <p style={{
          margin: 0, fontSize: 14, lineHeight: 1.65,
          color: isRead ? "#374151" : "#94A3B8",
        }}>
          {n.body}
        </p>

        {/* Scenario pill */}
        {scenario && !isRead && (
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: scenarioColor }} />
            <span style={{
              fontSize: 10, color: "#475569",
              letterSpacing: "0.06em", textTransform: "capitalize",
            }}>
              {scenario.replace(/_/g, " ")}
            </span>
          </div>
        )}
      </div>
    </button>
  );
}

// ─── Standard notification card ───────────────────────────────────────────────

function NotificationCard({ n, onRead }) {
  const meta = getMeta(n.type);
  const isRead = n.isRead;
  const { Icon } = meta;

  return (
    <button
      type="button"
      onClick={onRead}
      style={{
        width: "100%", textAlign: "left",
        cursor: n.deepLink ? "pointer" : "default",
        background: isRead ? "#0A0A0A" : meta.unreadBg,
        border: `1px solid ${isRead ? "#161616" : meta.border}`,
        borderRadius: 10,
        padding: "13px 16px",
        display: "flex", gap: 12, alignItems: "flex-start",
        transition: "background 0.15s",
      }}
    >
      {/* Icon */}
      <div style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: isRead ? "rgba(255,255,255,0.03)" : meta.bg,
        border: `1px solid ${isRead ? "#1E1E1E" : meta.border}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        marginTop: 1,
      }}>
        <Icon size={15} color={isRead ? "#374151" : meta.color} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 3 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
              color: isRead ? "#2D3748" : meta.color, textTransform: "uppercase",
            }}>
              {meta.label}
            </span>
            {!isRead && (
              <span style={{
                width: 5, height: 5, borderRadius: "50%",
                background: meta.accent, display: "inline-block",
              }} />
            )}
          </div>
          <span style={{ fontSize: 11, color: "#2D3748", whiteSpace: "nowrap" }}>
            {timeAgo(n.createdAt)}
          </span>
        </div>

        <p style={{
          margin: "0 0 3px", fontSize: 14, fontWeight: 600,
          color: isRead ? "#374151" : "#E2E8F0", lineHeight: 1.4,
        }}>
          {n.title}
        </p>
        <p style={{
          margin: 0, fontSize: 13, lineHeight: 1.55,
          color: isRead ? "#1E293B" : "#4B5563",
        }}>
          {n.body}
        </p>
      </div>
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getNotifications({ limit: 75 });
      setNotifications(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRead = async (n) => {
    if (!n.isRead) {
      await markNotificationAsRead(n._id);
      setNotifications((prev) =>
        prev.map((item) => (item._id === n._id ? { ...item, isRead: true } : item))
      );
    }
    if (n.deepLink) router.push(n.deepLink);
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <main style={{
      minHeight: "100vh",
      background: "#080808",
      color: "#E5E7EB",
      padding: "24px 16px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif",
    }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: "rgba(56,189,248,0.08)",
                border: "1px solid rgba(56,189,248,0.15)",
                display: "flex", alignItems: "center", justifyContent: "center",
                position: "relative",
              }}>
                <Bell size={18} color="#38BDF8" />
                {unreadCount > 0 && (
                  <span style={{
                    position: "absolute", top: -4, right: -4,
                    background: "#F59E0B", color: "#000",
                    borderRadius: 10, fontSize: 10, fontWeight: 800,
                    padding: "1px 5px", lineHeight: 1.4,
                  }}>
                    {unreadCount}
                  </span>
                )}
              </div>
              <div>
                <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em" }}>
                  Notifications
                </h1>
                <p style={{ margin: 0, fontSize: 12, color: unreadCount > 0 ? "#F59E0B" : "#2D3748" }}>
                  {unreadCount > 0 ? `${unreadCount} unread message${unreadCount > 1 ? "s" : ""}` : "All caught up"}
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={!unreadCount}
              onClick={async () => { await markAllNotificationsAsRead(); await load(); }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                border: `1px solid ${unreadCount ? "#1E293B" : "#0F0F0F"}`,
                background: "transparent",
                color: unreadCount ? "#4B5563" : "#1A1A1A",
                borderRadius: 8, padding: "7px 11px",
                cursor: unreadCount ? "pointer" : "not-allowed",
                fontSize: 12, fontWeight: 500,
              }}
            >
              <CheckCheck size={13} />
              Mark all read
            </button>
          </div>

          <div style={{ height: 1, background: "linear-gradient(90deg, #1E293B 0%, transparent 100%)", marginTop: 20 }} />
        </header>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#2D3748", padding: "48px 0" }}>
            <Loader2 size={16} className="animate-spin" />
            <span style={{ fontSize: 14 }}>Loading…</span>
          </div>

        ) : notifications.length === 0 ? (
          <div style={{
            border: "1px solid #111",
            borderRadius: 14, padding: "52px 24px",
            textAlign: "center",
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid #1E293B",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
            }}>
              <Bell size={22} color="#1E293B" />
            </div>
            <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 600, color: "#374151" }}>
              No notifications yet
            </p>
            <p style={{ margin: 0, fontSize: 13, color: "#1E293B" }}>
              Smart alerts from your trading activity will appear here.
            </p>
          </div>

        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {notifications.map((n) =>
              n.type === "morning_mentor" ? (
                <MorningMentorCard key={n._id} n={n} onRead={() => handleRead(n)} />
              ) : (
                <NotificationCard key={n._id} n={n} onRead={() => handleRead(n)} />
              )
            )}
          </div>
        )}
      </div>
    </main>
  );
}
