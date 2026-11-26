"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import PageHeader from "@/features/shared/components/PageHeader";
import { Card, ErrorState, Placeholder, Switch, useToast } from "@/features/shared/components/ui";
import { getNotificationPreferences, updateNotificationPreferences } from "@/services/notificationApi";
import { useTheme } from "@/utils/theme";
import { useSystemBars } from "@/features/shared/hooks/useSystemBars";

// Every switch here maps 1:1 to a NotificationPreference flag the server's
// delivery gate reads (backend services/notificationService.js). Before this
// page there was no way to change any of them.
const GROUPS = [
  {
    title: "Reminders",
    items: [
      { key: "sessionReminders", label: "Market open reminders", hint: "15 minutes before London, New York or NSE opens, on trading days" },
      { key: "morningMentor", label: "Morning mentor", hint: "A short note on your previous trading day, at 7:00" },
      { key: "eveningReflection", label: "Evening reflection", hint: "A nudge to close the day, at 19:30" },
      { key: "streakProtection", label: "Streak reminders", hint: "When your discipline streak is about to break, and milestones" },
      { key: "mindProgress", label: "Mind Score", hint: "Level-ups, Mind Wins and your weekly focus. At most one a day, never for a bad day" },
      { key: "weeklyInsight", label: "Weekly review", hint: "When your weekly review is ready" },
    ],
  },
  {
    title: "Trade alerts",
    master: { key: "smartCoach", label: "Smart coach alerts", hint: "Alerts about the trades you log" },
    items: [
      { key: "revengeTrading", label: "Losing streak", hint: "Several losses in a row in a short time" },
      { key: "dailyLossWarning", label: "Daily loss limit", hint: "At 80% and 100% of the limit you set in Settings → Trading limits" },
      { key: "noStopLoss", label: "Missing stop loss", hint: "A trade logged without a stop loss" },
      { key: "overtrading", label: "Trade count", hint: "When you reach your max trades per day (or far above your usual if none is set)" },
      { key: "setupDiscipline", label: "Low checklist score", hint: "Entries below your checklist minimum" },
      { key: "moodRisk", label: "Mood and emotion", hint: "Trades logged under stress or low focus" },
      { key: "repeatedMistakes", label: "Repeated mistakes", hint: "The same mistake tag several times in a week" },
    ],
  },
  {
    title: "Account",
    items: [
      { key: "supportUpdates", label: "Support replies", hint: "Answers and updates on your support tickets" },
      { key: "promotions", label: "Offers and renewal reminders", hint: "Plan renewals and Premium offers, only between 9:00 and 21:00" },
    ],
  },
];

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  return `${h}:${i % 2 ? "30" : "00"}`;
});

export default function NotificationSettingsPage() {
  const { ready } = useRequireAuth();
  const { theme } = useTheme();
  useSystemBars(theme);
  const { addToast } = useToast();
  const [prefs, setPrefs] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      setPrefs(await getNotificationPreferences());
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  // Optimistic: flip immediately, roll back if the server refuses.
  const save = async (patch, optimistic) => {
    const previous = prefs;
    setPrefs((p) => ({ ...p, ...optimistic }));
    setSaving(Object.keys(patch)[0]);
    try {
      const updated = await updateNotificationPreferences(patch);
      if (updated && typeof updated === "object") setPrefs(updated);
    } catch {
      setPrefs(previous);
      addToast("Couldn't save that setting. Check your connection and try again.", "error");
    } finally {
      setSaving(null);
    }
  };

  const toggle = (key, value) => save({ [key]: value }, { [key]: value });
  const setQuietHours = (fields) =>
    save({ quietHours: fields }, { quietHours: { ...(prefs?.quietHours || {}), ...fields } });

  const pushOff = prefs ? prefs.pushEnabled === false : false;
  const qh = prefs?.quietHours || {};

  return (
    <div className="ec-app ec-home">
      <PageHeader themed title="Notifications" showMarketSwitcher={false} />
      <main className="ec-page" style={{ maxWidth: 760 }}>
        <h1 className="ec-guide__title" style={{ marginBottom: 6 }}>Notification settings</h1>
        <p className="ec-guide__lead" style={{ marginBottom: 24, fontSize: "var(--ec-fs-3)" }}>
          Choose what Edgecipline sends you. Reminders follow your phone&apos;s timezone and never arrive on weekends for closed markets.
        </p>

        {loadError ? (
          <Card><ErrorState title="Couldn't load your settings" onRetry={load} /></Card>
        ) : !prefs ? (
          <div style={{ display: "grid", gap: 12 }}>
            <Placeholder height={64} radius={16} />
            <Placeholder height={260} radius={16} />
            <Placeholder height={200} radius={16} />
          </div>
        ) : (
          <div style={{ display: "grid", gap: 20 }}>
            <Card padded={false}>
              <Switch
                checked={prefs.pushEnabled !== false}
                onChange={(v) => toggle("pushEnabled", v)}
                label="All notifications"
                hint={pushOff ? "Everything is off. Your inbox still keeps a copy." : "Turn off to pause every push"}
                disabled={saving === "pushEnabled"}
              />
            </Card>

            {GROUPS.map((group) => {
              const masterOff = group.master ? prefs[group.master.key] === false : false;
              return (
                <section key={group.title} aria-label={group.title}>
                  <h2 className="ec-dash__eyebrow" style={{ margin: "0 0 8px 4px" }}>{group.title}</h2>
                  <Card padded={false}>
                    {group.master && (
                      <Switch
                        checked={!masterOff}
                        onChange={(v) => toggle(group.master.key, v)}
                        label={group.master.label}
                        hint={group.master.hint}
                        disabled={pushOff || saving === group.master.key}
                      />
                    )}
                    {group.items.map((item) => (
                      <Switch
                        key={item.key}
                        checked={prefs[item.key] !== false}
                        onChange={(v) => toggle(item.key, v)}
                        label={item.label}
                        hint={item.hint}
                        disabled={pushOff || masterOff || saving === item.key}
                      />
                    ))}
                    {group.title === "Reminders" && (
                      // The on-device checklist reminder has its own page (setup, time, days).
                      <Link href="/settings/checklist-reminder" className="ec-switch-row ec-notif-link">
                        <span className="ec-switch-row__text">
                          <span className="ec-switch-row__label">Checklist reminder</span>
                          <span className="ec-switch-row__hint">Your setup&apos;s rules as a tickable notification, at a time you pick</span>
                        </span>
                        <ChevronRight size={18} aria-hidden="true" />
                      </Link>
                    )}
                  </Card>
                </section>
              );
            })}

            <section aria-label="Quiet hours">
              <h2 className="ec-dash__eyebrow" style={{ margin: "0 0 8px 4px" }}>Quiet hours</h2>
              <Card padded={false}>
                <Switch
                  checked={Boolean(qh.enabled)}
                  onChange={(v) => setQuietHours({ enabled: v })}
                  label="Quiet hours"
                  hint="No pushes in this window. Alerts still land in your inbox."
                  disabled={pushOff || saving === "quietHours"}
                />
                {qh.enabled && (
                  <div className="ec-switch-row" style={{ cursor: "default", flexWrap: "wrap" }}>
                    <label className="ec-field" style={{ flex: "1 1 140px" }}>
                      <span className="ec-field__label">From</span>
                      <select
                        className="ec-input"
                        value={qh.start || "22:00"}
                        onChange={(e) => setQuietHours({ start: e.target.value })}
                        disabled={pushOff}
                      >
                        {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                    <label className="ec-field" style={{ flex: "1 1 140px" }}>
                      <span className="ec-field__label">Until</span>
                      <select
                        className="ec-input"
                        value={qh.end || "07:00"}
                        onChange={(e) => setQuietHours({ end: e.target.value })}
                        disabled={pushOff}
                      >
                        {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </label>
                  </div>
                )}
              </Card>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
