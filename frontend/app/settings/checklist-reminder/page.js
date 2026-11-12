"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Info, Save } from "lucide-react";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import { useMarket } from "@/context/MarketContext";
import { fetchSetups } from "@/services/setupApi";
import {
  getChecklistNotificationSettings,
  saveChecklistNotificationSettings,
} from "@/services/checklistNotificationApi";
import {
  requestChecklistNotificationPermission,
  configureChecklistNotification,
  cancelChecklistNotification,
} from "@/plugins/ChecklistNotificationPlugin";
import { buildNotificationItems, MAX_NOTIFICATION_ITEMS } from "@/services/checklistNotificationSync";
import { isNativeApp, isIOSNative } from "@/utils/platform";
import PageHeader from "@/features/shared/components/PageHeader";
import { Button, Card, Placeholder, SegmentedControl, Switch } from "@/features/shared/components/ui";
import { marketRoutes } from "@/features/shared/navigation";
import { useTheme } from "@/utils/theme";
import { useSystemBars } from "@/features/shared/hooks/useSystemBars";

// Moved here from /checklist/notification-settings (which now redirects).
// Behaviour is unchanged: permission first, then save, then schedule on the
// device, rolling the saved setting back if the device can't schedule it.

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOW_IT_WORKS_KEY = "ec.checklistReminder.howItWorksOpen";
const REPEAT_OPTIONS = [
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "custom", label: "Custom" },
];

// The reminder is native on both apps. Web saves the settings and explains
// that the reminder appears in the mobile app.
const supportsLiveNotification = isNativeApp;

// Bridge failures ("… plugin is not implemented on ios") are never shown.
const NATIVE_ERROR_PATTERN = /not implemented|plugin|bridge|capacitor/i;

function getSaveErrorMessage(error) {
  const serverMessage = error?.data?.message || error?.response?.data?.message;
  if (serverMessage && !NATIVE_ERROR_PATTERN.test(serverMessage)) return serverMessage;
  const message = error?.message;
  if (message && !NATIVE_ERROR_PATTERN.test(message)) return message;
  return "Could not save your notification settings. Please try again.";
}

// "13:30" → "1:30 pm"
function formatTime(hhmm) {
  const [h, m] = String(hhmm || "00:00").split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  return `${h % 12 || 12}:${String(m || 0).padStart(2, "0")} ${suffix}`;
}

function describeDays(repeatMode, customDays) {
  if (repeatMode === "daily") return "every day";
  if (repeatMode === "weekdays") return "Mon–Fri";
  if (!customDays.length) return "no days selected";
  if (customDays.length === 7) return "every day";
  const days = [...customDays].sort((a, b) => a - b);
  const consecutive = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (consecutive && days.length >= 3) return `${DAY_LABELS[days[0] - 1]}–${DAY_LABELS[days[days.length - 1] - 1]}`;
  return days.map((d) => DAY_LABELS[d - 1]).join(", ");
}

const filledRules = (strategy) => (strategy?.rules || []).filter((r) => r.label?.trim());

export default function ChecklistReminderPage() {
  const { ready } = useRequireAuth();
  const { currentMarket, getMarketLabel } = useMarket();
  const { theme } = useTheme();
  useSystemBars(theme);

  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [howOpen, setHowOpen] = useState(true);

  const [enabled, setEnabled] = useState(false);
  const [selectedStrategyIdx, setSelectedStrategyIdx] = useState(0);
  const [notificationTime, setNotificationTime] = useState("09:00");
  const [repeatMode, setRepeatMode] = useState("weekdays");
  const [customDays, setCustomDays] = useState([1, 2, 3, 4, 5]);
  const [persistent, setPersistent] = useState(false);
  const [resetEnabled, setResetEnabled] = useState(true);
  const [resetTime, setResetTime] = useState("00:00");

  // Every edit goes through here so the save bar knows there's work.
  const change = (setter) => (value) => {
    setDirty(true);
    setSaved(false);
    setter(value);
  };

  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    try {
      if (window.localStorage.getItem(HOW_IT_WORKS_KEY) === "0") setHowOpen(false);
    } catch { /* storage blocked — keep it open */ }

    setLoading(true);
    setError("");
    setDirty(false);
    setSaved(false);
    (async () => {
      try {
        const [setupsData, settings] = await Promise.all([
          fetchSetups(currentMarket),
          getChecklistNotificationSettings(currentMarket),
        ]);
        if (cancelled) return;
        setStrategies(Array.isArray(setupsData) ? setupsData : []);
        setSelectedStrategyIdx(0);
        if (settings) {
          setEnabled(settings.enabled ?? false);
          setNotificationTime(settings.notificationTime ?? "09:00");
          setRepeatMode(settings.repeatMode ?? "weekdays");
          setCustomDays(settings.customDays ?? [1, 2, 3, 4, 5]);
          setPersistent(settings.persistent ?? false);
          setResetEnabled(settings.resetEnabled ?? true);
          setResetTime(settings.resetTime ?? "00:00");
          if (settings.strategyId && Array.isArray(setupsData)) {
            const idx = setupsData.findIndex((s) => s._id === settings.strategyId);
            if (idx >= 0) setSelectedStrategyIdx(idx);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load settings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, currentMarket]);

  const toggleHowItWorks = () => {
    setHowOpen((open) => {
      try { window.localStorage.setItem(HOW_IT_WORKS_KEY, open ? "0" : "1"); } catch { /* ignore */ }
      return !open;
    });
  };

  const toggleDay = (day) => {
    setDirty(true);
    setSaved(false);
    setCustomDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)));
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError("");
    setSaved(false);

    const strategy = strategies[selectedStrategyIdx] || null;
    const items = strategy ? buildNotificationItems(strategy.rules) : [];
    const payload = {
      enabled,
      strategyId: strategy?._id || null,
      strategyName: strategy?.name || "",
      market: currentMarket,
      notificationTime,
      repeatMode,
      customDays,
      persistent,
      resetEnabled,
      resetTime,
    };

    let savedEnabled = false;
    try {
      // 1. Permission BEFORE saving, so the account never says "on" while
      //    nothing is scheduled.
      if (supportsLiveNotification() && enabled) {
        const { granted } = await requestChecklistNotificationPermission();
        if (!granted) {
          setError(
            isIOSNative()
              ? "Notifications are turned off. Please enable them in iPhone Settings → Notifications → Edgecipline."
              : "Notification permission denied. Please enable it in phone Settings → Apps → Edgecipline → Notifications."
          );
          setSaving(false);
          return;
        }
      }
      // 2. Persist
      await saveChecklistNotificationSettings(payload);
      savedEnabled = Boolean(enabled);
      // 3. Configure the native reminder
      if (supportsLiveNotification()) {
        if (enabled) await configureChecklistNotification({ ...payload, items });
        else await cancelChecklistNotification(currentMarket);
      }
      setSaved(true);
      setDirty(false);
    } catch (e) {
      console.warn("[ChecklistNotification] save failed", e?.message || e);
      // Saved as on, but the device couldn't schedule it: switch it back off.
      if (savedEnabled && supportsLiveNotification()) {
        saveChecklistNotificationSettings({ ...payload, enabled: false }).catch(() => {});
      }
      setError(getSaveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }, [
    enabled, selectedStrategyIdx, strategies, notificationTime,
    repeatMode, customDays, persistent, resetEnabled, resetTime, currentMarket,
  ]);

  const selected = strategies[selectedStrategyIdx] || null;
  const previewRules = filledRules(selected);
  const schedule = `${formatTime(notificationTime)}, ${describeDays(repeatMode, customDays)}`;
  const noDays = repeatMode === "custom" && !customDays.length;
  const saveLabel = saving ? "Saving…" : enabled && supportsLiveNotification() ? "Save & show now" : "Save";

  let status;
  if (error) status = <span className="ec-remind__status is-error" role="alert">{error}</span>;
  else if (saving) status = <span className="ec-remind__status">Saving…</span>;
  else if (dirty) status = <span className="ec-remind__status is-dirty"><span className="ec-remind__dot" />Unsaved changes</span>;
  else if (saved) status = <span className="ec-remind__status is-ok"><Check size={14} strokeWidth={2.8} />Saved</span>;
  else status = <span className="ec-remind__status">{enabled ? `On · ${schedule}` : "Reminder is off"}</span>;

  return (
    <div className="ec-app ec-home">
      <PageHeader themed title="Checklist reminder" showMarketSwitcher />
      <main className="ec-page ec-remind">
        <h1 className="ec-guide__title" style={{ marginBottom: 6 }}>Checklist reminder</h1>
        <p className="ec-guide__lead" style={{ marginBottom: 20, fontSize: "var(--ec-fs-3)" }}>
          Get your setup&apos;s rules as a tickable notification before you trade. Set separately for each market; this is {getMarketLabel()}.
        </p>

        {!supportsLiveNotification() && (
          <div className="ec-remind__note" role="note">
            <Info size={16} aria-hidden="true" />
            <span>This reminder lives on your phone. Your choices are saved to your account; open this page in the Edgecipline app to switch it on there.</span>
          </div>
        )}

        <Card padded={false} className="ec-remind__how">
          <button type="button" className="ec-remind__how-toggle ec-focusable" onClick={toggleHowItWorks} aria-expanded={howOpen}>
            How it works
            <ChevronDown size={18} className={`ec-remind__chev${howOpen ? " is-open" : ""}`} aria-hidden="true" />
          </button>
          {howOpen && (
            <ol className="ec-remind__steps">
              <li><span>1</span><div><strong>Pick a setup</strong><p>Its rules become your checklist, up to {MAX_NOTIFICATION_ITEMS} rules.</p></div></li>
              <li><span>2</span><div><strong>Choose when</strong><p>It appears at your time on the days you pick, for example before the market opens.</p></div></li>
              <li><span>3</span><div><strong>Tick before you trade</strong><p>Pull down the notification shade and tap each rule as you confirm it. Ticks clear at your reset time.</p></div></li>
            </ol>
          )}
        </Card>

        <Card padded={false} style={{ marginTop: 16 }}>
          <Switch
            checked={enabled}
            onChange={change(setEnabled)}
            label="Checklist reminder"
            hint={loading ? "Loading…" : enabled ? `On · ${schedule}` : "Off"}
            disabled={loading}
          />
        </Card>

        {loading ? (
          <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
            <Placeholder height={140} radius={16} />
            <Placeholder height={180} radius={16} />
          </div>
        ) : !enabled ? (
          <p className="ec-remind__off">Turn it on to choose a setup and a time.</p>
        ) : (
          <>
            <section className="ec-remind__section" aria-label="Setup">
              <h2 className="ec-dash__eyebrow">Setup</h2>
              {strategies.length === 0 ? (
                <Card>
                  <strong className="ec-remind__label">You don&apos;t have any setups yet</strong>
                  <p className="ec-remind__hint">Create a setup with the rules you check before entering, then come back here.</p>
                  <Button as={Link} href={marketRoutes(currentMarket).setups} size="sm" style={{ marginTop: 12 }}>Create a setup</Button>
                </Card>
              ) : (
                <>
                  <Card padded={false} role="radiogroup" aria-label="Setup">
                    {strategies.map((s, idx) => {
                      const active = selectedStrategyIdx === idx;
                      const count = filledRules(s).length;
                      return (
                        <button
                          key={s._id || idx}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          className={`ec-remind__option ec-focusable${active ? " is-active" : ""}`}
                          onClick={() => change(setSelectedStrategyIdx)(idx)}
                        >
                          <span className="ec-remind__radio" aria-hidden="true">{active && <Check size={13} strokeWidth={3.2} />}</span>
                          <span className="ec-remind__option-name">{s.name}</span>
                          <span className="ec-remind__option-meta">{count} {count === 1 ? "rule" : "rules"}</span>
                        </button>
                      );
                    })}
                  </Card>
                  {selected && (
                    <>
                      <p className="ec-remind__preview-label">Preview</p>
                      <div className="ec-remind__notif" aria-label="Notification preview">
                        <div className="ec-remind__notif-app"><span className="ec-remind__notif-logo">E</span>Edgecipline · now</div>
                        <div className="ec-remind__notif-title">{selected.name}</div>
                        {previewRules.length === 0 ? (
                          <p className="ec-remind__hint">This setup has no rules yet.</p>
                        ) : (
                          previewRules.slice(0, MAX_NOTIFICATION_ITEMS).map((r, i) => (
                            <div key={i} className="ec-remind__notif-item"><span className="ec-remind__notif-box" />{r.label}</div>
                          ))
                        )}
                        {previewRules.length > MAX_NOTIFICATION_ITEMS && (
                          <p className="ec-remind__hint">+{previewRules.length - MAX_NOTIFICATION_ITEMS} more won&apos;t fit in the notification</p>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </section>

            <section className="ec-remind__section" aria-label="Schedule">
              <h2 className="ec-dash__eyebrow">Schedule</h2>
              <Card padded={false}>
                <div className="ec-remind__row">
                  <label className="ec-remind__label" htmlFor="rm-time">Time</label>
                  <input id="rm-time" type="time" className="ec-input ec-remind__time" value={notificationTime} onChange={(e) => change(setNotificationTime)(e.target.value)} />
                </div>
                <div className="ec-remind__block">
                  <span className="ec-remind__label">Repeat</span>
                  <SegmentedControl label="Repeat" options={REPEAT_OPTIONS} value={repeatMode} onChange={change(setRepeatMode)} block />
                  {repeatMode === "custom" && (
                    <div className="ec-remind__days">
                      {DAY_LABELS.map((label, i) => {
                        const day = i + 1;
                        const active = customDays.includes(day);
                        return (
                          <button key={day} type="button" aria-pressed={active} className={`ec-remind__day ec-focusable${active ? " is-active" : ""}`} onClick={() => toggleDay(day)}>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className={`ec-remind__summary${noDays ? " is-warn" : ""}`}>
                  {noDays
                    ? "Pick at least one day, or the reminder will never show."
                    : <>You&apos;ll get it at <b>{formatTime(notificationTime)}</b>, {describeDays(repeatMode, customDays)}.</>}
                </div>
              </Card>
            </section>

            <section className="ec-remind__section" aria-label="Options">
              <h2 className="ec-dash__eyebrow">Options</h2>
              <Card padded={false}>
                <Switch
                  checked={resetEnabled}
                  onChange={change(setResetEnabled)}
                  label="Reset ticks daily"
                  hint={`Clears every tick at ${formatTime(resetTime)} so each day starts fresh.`}
                />
                {resetEnabled && (
                  <div className="ec-remind__row">
                    <label className="ec-remind__hint" htmlFor="rm-reset-time">Reset time</label>
                    <input id="rm-reset-time" type="time" className="ec-input ec-remind__time" value={resetTime} onChange={(e) => change(setResetTime)(e.target.value)} />
                  </div>
                )}
                <Switch
                  checked={persistent}
                  onChange={change(setPersistent)}
                  label="Keep until done"
                  hint="Can't be swiped away until every rule is ticked."
                />
              </Card>
            </section>
          </>
        )}
      </main>

      {!loading && (
        <div className="ec-remind__savebar">
          <div className="ec-remind__savebar-inner">
            {status}
            <Button icon={<Save size={16} />} onClick={handleSave} loading={saving}>{saveLabel}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
