"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, Bell, BookOpen, Brain, Camera, CheckCheck, ChevronRight, Clock,
  Compass, Flame, LifeBuoy, Moon, Settings, Shield, Sunrise, Target, TrendingUp,
} from "lucide-react";
import ErrorBoundary from "@/components/ErrorBoundary";
import PageHeader from "@/features/shared/components/PageHeader";
import {
  Button, EmptyState, ErrorState, Placeholder, SegmentedControl, useToast,
} from "@/features/shared/components/ui";
import {
  getNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "@/services/notificationApi";
import { markOnboardingStep } from "@/services/api";
import { getNotificationTarget } from "@/services/notificationRoutes";

// deepLink wins; otherwise a `screen` in the payload resolves through the same
// map push taps use. Mind Score notifications deliberately carry no deepLink
// (older app builds have no /progress page), only screen: "mind-progress".
function targetOf(n) {
  if (n.deepLink) return n.deepLink;
  return n.data?.screen ? getNotificationTarget(n.data) : null;
}

// type → label, icon and tone. Tones map to theme colours in design-system.css
// so the inbox reads the same in light and dark.
const TYPE_META = {
  morning_mentor: { label: "Morning mentor", Icon: Sunrise, tone: "warn" },
  revenge_trading: { label: "Risk alert", Icon: AlertTriangle, tone: "bad" },
  overtrading: { label: "Risk alert", Icon: AlertTriangle, tone: "bad" },
  daily_loss_warning: { label: "Risk alert", Icon: Shield, tone: "bad" },
  no_stop_loss: { label: "Risk alert", Icon: Shield, tone: "bad" },
  setup_discipline: { label: "Discipline", Icon: Target, tone: "warn" },
  mood_risk: { label: "Discipline", Icon: Brain, tone: "warn" },
  repeated_mistake: { label: "Insight", Icon: TrendingUp, tone: "good" },
  weekly_ai_insight: { label: "Weekly insight", Icon: TrendingUp, tone: "good" },
  weekly_report_reminder: { label: "Weekly report", Icon: BookOpen, tone: "good" },
  confidence_reminder: { label: "Coaching", Icon: Brain, tone: "info" },
  session_reminder: { label: "Session", Icon: Clock, tone: "info" },
  streak_milestone: { label: "Streak", Icon: Flame, tone: "info" },
  streak_at_risk: { label: "Streak", Icon: Flame, tone: "warn" },
  streak_broken: { label: "Streak", Icon: Flame, tone: "info" },
  evening_reflection: { label: "Reflection", Icon: Moon, tone: "info" },
  mission_update: { label: "Mission", Icon: Compass, tone: "info" },
  mind_report_ready: { label: "Mind Score", Icon: Brain, tone: "good" },
  mind_level_up: { label: "Mind Score", Icon: Brain, tone: "good" },
  mind_win: { label: "Mind Win", Icon: Brain, tone: "good" },
  mind_target: { label: "Weekly focus", Icon: Target, tone: "info" },
  ocr_completed: { label: "Screenshot", Icon: Camera, tone: "good" },
  ocr_failed: { label: "Screenshot", Icon: Camera, tone: "bad" },
  support_agent_reply: { label: "Support", Icon: LifeBuoy, tone: "info" },
};

const DEFAULT_META = { label: "Update", Icon: Bell, tone: "muted" };

const FILTERS = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
];

function getMeta(type) {
  return TYPE_META[type] || DEFAULT_META;
}

function toDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function timeLabel(value, now) {
  const d = toDate(value);
  if (!d) return "";
  const mins = Math.floor((now - d.getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (startOfDay(d) === startOfDay(new Date(now))) return `${Math.floor(mins / 60)}h ago`;
  // Older rows sit under a day heading, so the time of day is enough.
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// Day buckets in the viewer's own timezone.
function groupLabel(value, now) {
  const d = toDate(value);
  if (!d) return "Earlier";
  const today = startOfDay(new Date(now));
  const day = startOfDay(d);
  const diffDays = Math.round((today - day) / 86400000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: d.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}

function NotificationRow({ n, now, onOpen }) {
  const meta = getMeta(n.type);
  const { Icon } = meta;
  const unread = !n.isRead;
  const featured = n.type === "morning_mentor";
  const scenario = featured && n.data?.scenario ? String(n.data.scenario).replace(/_/g, " ") : null;

  return (
    <li>
      <button
        type="button"
        className={`ec-notif${unread ? " ec-notif--unread" : ""}${featured ? " ec-notif--featured" : ""}`}
        onClick={() => onOpen(n)}
        aria-label={`${unread ? "Unread. " : ""}${meta.label}: ${n.title || ""}`}
      >
        <span className={`ec-notif__icon ec-notif__icon--${meta.tone}`} aria-hidden="true">
          <Icon size={17} />
        </span>
        <span className="ec-notif__main">
          <span className="ec-notif__top">
            <span className={`ec-notif__label ec-tone--${meta.tone}`}>{meta.label}</span>
            <span className="ec-notif__time">{timeLabel(n.createdAt, now)}</span>
          </span>
          {n.title ? <span className="ec-notif__title">{n.title}</span> : null}
          {n.body ? <span className="ec-notif__body">{n.body}</span> : null}
          {scenario ? <span className="ec-notif__chip">{scenario}</span> : null}
        </span>
        <span className="ec-notif__end" aria-hidden="true">
          {unread ? <span className="ec-notif__dot" /> : null}
          {targetOf(n) ? <ChevronRight size={16} className="ec-notif__chev" /> : null}
        </span>
      </button>
    </li>
  );
}

function LoadingList() {
  return (
    <ul className="ec-notif__list" aria-busy="true" aria-label="Loading notifications">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="ec-notif ec-notif--skeleton">
          <Placeholder width={36} height={36} radius={10} />
          <span className="ec-notif__main">
            <Placeholder width="30%" height={10} />
            <Placeholder width="70%" height={14} style={{ marginTop: 8 }} />
            <Placeholder width="90%" height={12} style={{ marginTop: 6 }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function NotificationsContent() {
  const router = useRouter();
  const { addToast } = useToast();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState("all");
  const [markingAll, setMarkingAll] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    markOnboardingStep("notificationsSeen", true).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await getNotifications({ limit: 75 });
      setNotifications(Array.isArray(data) ? data : []);
      setNow(Date.now());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // This page loads by hand rather than through React Query, so it reloads
  // itself when the global pull-to-refresh fires.
  useEffect(() => {
    const onPull = () => { load(); };
    window.addEventListener("ec:pull-refresh", onPull);
    return () => window.removeEventListener("ec:pull-refresh", onPull);
  }, [load]);

  // Keep "5m ago" labels honest while the page stays open.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const handleOpen = (n) => {
    if (!n.isRead) {
      // Optimistic and never blocking: a failed read receipt must not stop
      // the link from opening.
      setNotifications((prev) => prev.map((item) => (item._id === n._id ? { ...item, isRead: true } : item)));
      markNotificationAsRead(n._id).catch(() => {});
    }
    const target = targetOf(n);
    if (target) router.push(target);
  };

  const handleMarkAll = async () => {
    if (markingAll) return;
    const before = notifications;
    setMarkingAll(true);
    setNotifications((prev) => prev.map((item) => (item.isRead ? item : { ...item, isRead: true })));
    try {
      await markAllNotificationsAsRead();
    } catch {
      setNotifications(before);
      addToast("Couldn't mark them as read. Please try again.", "error");
    } finally {
      setMarkingAll(false);
    }
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const visible = filter === "unread" ? notifications.filter((n) => !n.isRead) : notifications;

  const groups = useMemo(() => {
    const out = [];
    for (const n of visible) {
      const label = groupLabel(n.createdAt, now);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(n);
      else out.push({ label, items: [n] });
    }
    return out;
  }, [visible, now]);

  let body;
  if (loading && !notifications.length) {
    body = <LoadingList />;
  } else if (loadError) {
    body = <ErrorState title="Couldn't load your notifications" onRetry={load} />;
  } else if (!notifications.length) {
    body = (
      <div className="ec-card">
        <EmptyState
          icon={<Bell size={22} />}
          title="No notifications yet"
          body="Risk alerts, coaching nudges and your weekly report will show up here as you trade."
          action={<Button as={Link} href="/settings/notifications" variant="secondary" icon={<Settings size={16} aria-hidden="true" />}>Choose what you get</Button>}
        />
      </div>
    );
  } else if (!visible.length) {
    body = (
      <div className="ec-card">
        <EmptyState
          icon={<CheckCheck size={22} />}
          title="You're all caught up"
          body="Nothing unread. Switch to All to see past notifications."
          action={<Button variant="secondary" onClick={() => setFilter("all")}>Show all</Button>}
        />
      </div>
    );
  } else {
    body = (
      <div className="ec-notif__groups">
        {groups.map((g) => (
          <section key={g.label} aria-label={g.label}>
            <h2 className="ec-notif__group">{g.label}</h2>
            <ul className="ec-notif__list">
              {g.items.map((n) => (
                <NotificationRow key={n._id} n={n} now={now} onOpen={handleOpen} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="ec-app ec-home">
      <PageHeader themed title="Notifications" />
      <main className="ec-page ec-disc ec-disc--narrow">
        <div className="ec-log__head">
          <div style={{ minWidth: 0 }}>
            <h1 className="ec-log__title">Notifications</h1>
            <p className="ec-log__sub" aria-live="polite">
              {loading && !notifications.length
                ? "Loading…"
                : unreadCount > 0
                  ? `${unreadCount} unread`
                  : "You're all caught up"}
            </p>
          </div>
          <Button
            as={Link}
            href="/settings/notifications"
            variant="ghost"
            size="sm"
            icon={<Settings size={15} aria-hidden="true" />}
          >
            Settings
          </Button>
        </div>

        {notifications.length > 0 && !loadError ? (
          <div className="ec-disc__filters">
            <SegmentedControl label="Show" value={filter} onChange={setFilter} options={FILTERS} />
            <Button
              variant="secondary"
              size="sm"
              onClick={handleMarkAll}
              disabled={!unreadCount}
              loading={markingAll}
              icon={<CheckCheck size={15} aria-hidden="true" />}
            >
              Mark all read
            </Button>
          </div>
        ) : null}

        {body}
      </main>
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <ErrorBoundary fallback={<div style={{ padding: "2rem", textAlign: "center" }}>Notifications failed to load. Please refresh.</div>}>
      <NotificationsContent />
    </ErrorBoundary>
  );
}
