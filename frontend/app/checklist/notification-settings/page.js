"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { Skeleton } from "@/features/shared";
import PageHeader from "@/features/shared/components/PageHeader";
import IndianMarketHeader from "@/components/IndianMarketHeader";
import { Bell, BellOff, Check, ChevronDown, ChevronLeft, Loader2, Save } from "lucide-react";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOW_IT_WORKS_KEY = "ec.checklistReminder.howItWorksOpen";

// The reminder is native on both apps (ChecklistNotificationPlugin.java and
// ChecklistNotificationPlugin.swift). Web saves the settings to the backend and
// shows the notice below explaining the reminder appears in the mobile app.
const supportsLiveNotification = isNativeApp;

// Capacitor bridge failures read like "ChecklistNotification plugin is not
// implemented on ios" or "… not implemented". Those are implementation details,
// never something to put in front of a user.
const NATIVE_ERROR_PATTERN = /not implemented|plugin|bridge|capacitor/i;

/**
 * A message safe to show in the error banner.
 *
 * Prefers what the backend said — those strings are already written for users —
 * and otherwise falls back to a generic line. Anything that smells like a native
 * plugin error is replaced rather than displayed.
 */
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
  // Mon, Tue, Wed, Thu → "Mon–Thu"
  const consecutive = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (consecutive && days.length >= 3) return `${DAY_LABELS[days[0] - 1]}–${DAY_LABELS[days[days.length - 1] - 1]}`;
  return days.map(d => DAY_LABELS[d - 1]).join(", ");
}

const filledRules = (strategy) => (strategy?.rules || []).filter(r => r.label?.trim());

export default function ChecklistNotificationSettingsPage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const { currentMarket } = useMarket();

  const [mounted, setMounted] = useState(false);
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [howOpen, setHowOpen] = useState(true);

  // ── Form state ──────────────────────────────────────────────────────────
  const [enabled, setEnabled] = useState(false);
  const [selectedStrategyIdx, setSelectedStrategyIdx] = useState(0);
  const [notificationTime, setNotificationTime] = useState("09:00");
  const [repeatMode, setRepeatMode] = useState("weekdays");
  const [customDays, setCustomDays] = useState([1, 2, 3, 4, 5]);
  const [persistent, setPersistent] = useState(false);
  const [resetEnabled, setResetEnabled] = useState(true);
  const [resetTime, setResetTime] = useState("00:00");

  // Every form edit goes through here so the save bar knows there's work.
  const change = (setter) => (value) => {
    setDirty(true);
    setSaved(false);
    setter(value);
  };

  // ── Load data ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    setMounted(true);
    try {
      if (window.localStorage.getItem(HOW_IT_WORKS_KEY) === "0") setHowOpen(false);
    } catch { /* storage blocked — keep it open */ }

    const load = async () => {
      try {
        const [setupsData, settings] = await Promise.all([
          fetchSetups(currentMarket),
          getChecklistNotificationSettings(currentMarket),
        ]);

        if (Array.isArray(setupsData)) setStrategies(setupsData);

        if (settings) {
          setEnabled(settings.enabled ?? false);
          setNotificationTime(settings.notificationTime ?? "09:00");
          setRepeatMode(settings.repeatMode ?? "weekdays");
          setCustomDays(settings.customDays ?? [1, 2, 3, 4, 5]);
          setPersistent(settings.persistent ?? false);
          setResetEnabled(settings.resetEnabled ?? true);
          setResetTime(settings.resetTime ?? "00:00");

          // Match saved strategyId to loaded strategies
          if (settings.strategyId && Array.isArray(setupsData)) {
            const idx = setupsData.findIndex(
              (s) => s._id === settings.strategyId
            );
            if (idx >= 0) setSelectedStrategyIdx(idx);
          }
        }
      } catch (e) {
        setError(e.message || "Failed to load settings");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [ready, currentMarket]);

  const toggleHowItWorks = () => {
    setHowOpen(open => {
      try { window.localStorage.setItem(HOW_IT_WORKS_KEY, open ? "0" : "1"); } catch { /* ignore */ }
      return !open;
    });
  };

  // ── Custom day toggle ───────────────────────────────────────────────────
  const toggleDay = (day) => {
    setDirty(true);
    setSaved(false);
    setCustomDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  // ── Save ────────────────────────────────────────────────────────────────
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

    try {
      // 1. Persist to backend
      await saveChecklistNotificationSettings(payload);

      // 2. Configure the native reminder (Android and iOS)
      if (supportsLiveNotification()) {
        if (enabled) {
          // Notification permission first (Android 13+ / iOS)
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
          // This will show the notification immediately AND schedule daily
          await configureChecklistNotification({
            ...payload,
            items,
          });
        } else {
          await cancelChecklistNotification(currentMarket);
        }
      }

      setSaved(true);
      setDirty(false);
    } catch (e) {
      // Never render a raw native/bridge message: strings like "… plugin is not
      // implemented on ios" mean nothing to a user and read as a broken app.
      // The technical detail goes to the console; the banner stays human.
      console.warn("[ChecklistNotification] save failed", e?.message || e);
      setError(getSaveErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }, [
    enabled, selectedStrategyIdx, strategies, notificationTime,
    repeatMode, customDays, persistent, resetEnabled, resetTime, currentMarket,
  ]);

  const isIndian = currentMarket === "Indian_Market";

  if (!mounted) return null;

  const selected = strategies[selectedStrategyIdx] || null;
  const previewRules = filledRules(selected);
  const schedule = `${formatTime(notificationTime)}, ${describeDays(repeatMode, customDays)}`;

  const saveLabel = saving
    ? "Saving…"
    : enabled && supportsLiveNotification() ? "Save & show now" : "Save";

  let status;
  if (error) status = <span className="cn-status cn-status--error">{error}</span>;
  else if (saving) status = <span className="cn-status">Saving…</span>;
  else if (dirty) status = <span className="cn-status cn-status--dirty"><span className="cn-dot" />Unsaved changes</span>;
  else if (saved) status = <span className="cn-status cn-status--ok"><Check size={14} strokeWidth={2.8} />Saved</span>;
  else status = <span className="cn-status">{enabled ? `On · ${schedule}` : "Reminder is off"}</span>;

  return (
    <div className="cn-root">
      <style>{`
        .cn-root { --cn-ink: #0F1923; --cn-muted: #64748B; --cn-faint: #94A3B8; --cn-line: #E2E8F0; --cn-green: #0D9E6E; --cn-green-soft: #EEF9F4; --cn-nav-h: 0px;
          min-height: 100vh; background: #F4F6F9; color: var(--cn-ink); font-family: 'Inter', sans-serif; display: flex; flex-direction: column; }
        .cn-root *, .cn-root *::before, .cn-root *::after { box-sizing: border-box; }
        .cn-main { flex: 1; width: 100%; max-width: 640px; margin: 0 auto; padding: 24px 24px 32px; }

        .cn-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 18px; }
        .cn-back { width: 44px; height: 44px; min-width: 44px; min-height: 44px; flex-shrink: 0; border-radius: 12px; border: 1px solid var(--cn-line); background: #FFFFFF; color: var(--cn-muted); display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .cn-title { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.25; }
        .cn-sub { margin: 4px 0 0; font-size: 14px; color: var(--cn-muted); line-height: 1.45; }

        .cn-banner { margin-bottom: 14px; padding: 12px 14px; border-radius: 12px; font-size: 13px; line-height: 1.5; }
        .cn-banner--error { background: #FEF2F2; border: 1px solid #FECACA; color: #B91C1C; }
        .cn-banner--info { background: #FFFBEB; border: 1px solid #FDE68A; color: #92400E; }

        .cn-card { background: #FFFFFF; border: 1px solid var(--cn-line); border-radius: 16px; box-shadow: 0 1px 3px rgba(15,25,35,0.04); }
        .cn-section { margin-top: 24px; }
        .cn-section-title { margin: 0 0 8px 4px; font-size: 13px; font-weight: 700; color: var(--cn-muted); }

        .cn-how-toggle { width: 100%; min-height: 56px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; border: none; background: transparent; font-family: inherit; font-size: 15px; font-weight: 700; color: var(--cn-ink); cursor: pointer; text-align: left; }
        .cn-how-chev { color: var(--cn-faint); flex-shrink: 0; transition: transform 0.15s; }
        .cn-how-chev.is-open { transform: rotate(180deg); }
        .cn-how-body { padding: 0 18px 18px; }
        .cn-steps { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 14px; }
        .cn-step { display: flex; gap: 12px; }
        .cn-step-num { width: 26px; height: 26px; flex-shrink: 0; border-radius: 50%; background: var(--cn-green-soft); color: var(--cn-green); font-size: 13px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
        .cn-step-title { font-size: 14px; font-weight: 700; }
        .cn-step-text { margin-top: 2px; font-size: 13px; color: var(--cn-muted); line-height: 1.5; }
        .cn-tip { margin-top: 14px; padding: 10px 12px; border-radius: 10px; background: #F8FAFB; font-size: 13px; color: var(--cn-muted); line-height: 1.5; }
        .cn-tip b { color: var(--cn-ink); }

        .cn-master { margin-top: 14px; display: flex; align-items: center; gap: 14px; padding: 16px 18px; }
        .cn-icon { width: 40px; height: 40px; flex-shrink: 0; border-radius: 12px; display: flex; align-items: center; justify-content: center; background: #F1F4F8; color: var(--cn-muted); }
        .cn-icon.is-on { background: var(--cn-green-soft); color: var(--cn-green); }
        .cn-grow { flex: 1; min-width: 0; }
        .cn-label { font-size: 15px; font-weight: 700; }
        .cn-hint { margin-top: 2px; font-size: 13px; color: var(--cn-muted); line-height: 1.45; }
        .cn-off-note { margin: 12px 4px 0; font-size: 13px; color: var(--cn-muted); }

        .cn-switch { position: relative; width: 52px; height: 32px; min-width: 52px; min-height: 32px; flex-shrink: 0; padding: 0; border: none; border-radius: 999px; background: #CBD5E1; cursor: pointer; transition: background 0.2s; }
        .cn-switch.is-on { background: var(--cn-green); }
        .cn-switch-knob { position: absolute; top: 3px; left: 3px; width: 26px; height: 26px; border-radius: 50%; background: #FFFFFF; box-shadow: 0 1px 4px rgba(0,0,0,0.2); transition: left 0.2s; }
        .cn-switch.is-on .cn-switch-knob { left: 23px; }
        .cn-switch:active { transform: none; }

        .cn-option { width: 100%; min-height: 60px; display: flex; align-items: center; gap: 12px; padding: 10px 18px; border: none; border-top: 1px solid #F1F4F8; background: transparent; font-family: inherit; text-align: left; color: inherit; cursor: pointer; }
        .cn-option:first-child { border-top: none; }
        .cn-option:hover { background: #F8FAFB; }
        .cn-radio { width: 22px; height: 22px; flex-shrink: 0; border-radius: 50%; border: 2px solid #CBD5E1; display: flex; align-items: center; justify-content: center; color: #FFFFFF; }
        .cn-option.is-active .cn-radio { border-color: var(--cn-green); background: var(--cn-green); }
        .cn-option-name { font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cn-option-meta { font-size: 13px; color: var(--cn-muted); flex-shrink: 0; }

        .cn-empty { padding: 20px 18px; }
        .cn-btn-link { margin-top: 12px; height: 44px; padding: 0 16px; border-radius: 10px; background: var(--cn-green); color: #FFFFFF; font-size: 14px; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; }

        .cn-preview-label { margin: 14px 4px 8px; font-size: 12px; font-weight: 600; color: var(--cn-faint); }
        .cn-notif { padding: 14px 16px; border-radius: 18px; background: #FFFFFF; border: 1px solid var(--cn-line); box-shadow: 0 6px 20px rgba(15,25,35,0.08); }
        .cn-notif-app { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--cn-muted); }
        .cn-notif-logo { width: 18px; height: 18px; border-radius: 50%; background: var(--cn-green); color: #FFFFFF; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 800; }
        .cn-notif-title { margin: 8px 0 6px; font-size: 14px; font-weight: 700; }
        .cn-notif-item { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 14px; }
        .cn-notif-box { width: 18px; height: 18px; flex-shrink: 0; border-radius: 5px; border: 2px solid #CBD5E1; }
        .cn-notif-more { margin-top: 4px; font-size: 12px; color: var(--cn-faint); }

        .cn-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 60px; padding: 10px 18px; border-top: 1px solid #F1F4F8; }
        .cn-row:first-child { border-top: none; }
        .cn-time { height: 44px; min-height: 44px; padding: 0 12px; border: 1px solid var(--cn-line); border-radius: 10px; background: #FFFFFF; font-family: 'Inter', sans-serif; font-size: 15px; font-weight: 600; color: var(--cn-ink); outline: none; }
        .cn-time:focus { border-color: var(--cn-green); box-shadow: 0 0 0 3px rgba(13,158,110,0.12); }
        .cn-block { padding: 14px 18px; border-top: 1px solid #F1F4F8; }
        .cn-seg { margin-top: 10px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; padding: 4px; border-radius: 12px; background: #F1F4F8; }
        .cn-seg button { height: 40px; min-height: 40px; min-width: 0; border: none; border-radius: 9px; background: transparent; font-family: inherit; font-size: 14px; font-weight: 600; color: var(--cn-muted); cursor: pointer; }
        .cn-seg button.is-active { background: #FFFFFF; color: var(--cn-ink); box-shadow: 0 1px 3px rgba(15,25,35,0.12); }
        .cn-days { margin-top: 10px; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
        .cn-days button { height: 44px; min-height: 44px; min-width: 0; border-radius: 10px; border: 1px solid var(--cn-line); background: #FFFFFF; font-family: inherit; font-size: 13px; font-weight: 600; color: var(--cn-muted); cursor: pointer; }
        .cn-days button.is-active { border-color: var(--cn-green); background: var(--cn-green-soft); color: var(--cn-green); }
        .cn-summary { padding: 12px 18px 14px; border-top: 1px solid #F1F4F8; font-size: 13px; color: var(--cn-muted); }
        .cn-summary b { color: var(--cn-ink); }
        .cn-summary.is-warn { color: #B45309; }

        .cn-savebar { position: sticky; bottom: var(--cn-nav-h); z-index: 40; background: rgba(255,255,255,0.97); border-top: 1px solid var(--cn-line); box-shadow: 0 -4px 16px rgba(15,25,35,0.06); }
        .cn-savebar-inner { max-width: 640px; margin: 0 auto; padding: 10px 24px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .cn-status { min-width: 0; font-size: 13px; color: var(--cn-muted); display: inline-flex; align-items: center; gap: 6px; }
        .cn-status--dirty { color: #B45309; font-weight: 600; }
        .cn-status--ok { color: #16A34A; font-weight: 600; }
        .cn-status--error { color: #DC2626; font-weight: 600; }
        .cn-dot { width: 8px; height: 8px; border-radius: 50%; background: #F59E0B; flex-shrink: 0; }
        .cn-save { height: 46px; min-height: 46px; min-width: 150px; padding: 0 22px; flex-shrink: 0; border: none; border-radius: 12px; background: linear-gradient(135deg, #0D9E6E, #0BB866); color: #FFFFFF; font-family: inherit; font-size: 15px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 12px rgba(13,158,110,0.25); }
        .cn-save:disabled { opacity: 0.6; cursor: default; box-shadow: none; }
        .cn-spin { animation: cn-spin 1s linear infinite; }
        @keyframes cn-spin { to { transform: rotate(360deg); } }

        /* Keep the button clear of the bottom-right Help bubble (SupportWidget). */
        @media (max-width: 1100px) { .cn-savebar-inner { padding-right: 96px; } }
        @media (max-width: 768px) {
          /* Sit above the fixed MobileBottomNav (68px + safe area). */
          .cn-root { --cn-nav-h: calc(68px + env(safe-area-inset-bottom, 0px)); }
          html[data-keyboard-open] .cn-root { --cn-nav-h: 0px; }
        }
        @media (max-width: 600px) {
          .cn-main { padding: 16px 16px 24px; }
          .cn-title { font-size: 20px; }
          .cn-savebar-inner { padding: 10px 80px 10px 16px; flex-direction: column; align-items: stretch; gap: 6px; }
          .cn-status { justify-content: center; font-size: 12px; }
          .cn-save { width: 100%; }
          .cn-days button { font-size: 12px; }
        }
      `}</style>

      {isIndian ? <IndianMarketHeader /> : <PageHeader />}

      <main className="cn-main">
        <div className="cn-head">
          <button type="button" className="cn-back" onClick={() => router.back()} aria-label="Back">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="cn-title">Checklist reminder</h1>
            <p className="cn-sub">Get your setup&apos;s rules as a tickable notification before you trade.</p>
          </div>
        </div>

        {error && <div className="cn-banner cn-banner--error" role="alert">{error}</div>}
        {!supportsLiveNotification() && (
          <div className="cn-banner cn-banner--info">
            This reminder appears in the Edgecipline mobile app. Your settings are saved here and apply there.
          </div>
        )}

        {/* How it works */}
        <div className="cn-card">
          <button type="button" className="cn-how-toggle" onClick={toggleHowItWorks} aria-expanded={howOpen}>
            How it works
            <ChevronDown size={18} className={`cn-how-chev${howOpen ? " is-open" : ""}`} />
          </button>
          {howOpen && (
            <div className="cn-how-body">
              <ol className="cn-steps">
                <li className="cn-step">
                  <span className="cn-step-num">1</span>
                  <div>
                    <div className="cn-step-title">Pick a setup</div>
                    <div className="cn-step-text">Its rules become your checklist, up to {MAX_NOTIFICATION_ITEMS} rules.</div>
                  </div>
                </li>
                <li className="cn-step">
                  <span className="cn-step-num">2</span>
                  <div>
                    <div className="cn-step-title">Choose when</div>
                    <div className="cn-step-text">The notification appears at your time on the days you pick, for example before the market opens.</div>
                  </div>
                </li>
                <li className="cn-step">
                  <span className="cn-step-num">3</span>
                  <div>
                    <div className="cn-step-title">Tick before you trade</div>
                    <div className="cn-step-text">Pull down your notification shade and tap each rule as you confirm it. Ticks clear at your reset time so each day starts fresh.</div>
                  </div>
                </li>
              </ol>
              <div className="cn-tip">
                Tip: turn on <b>Keep until done</b> so the reminder can&apos;t be swiped away until every rule is ticked.
              </div>
            </div>
          )}
        </div>

        {/* Master switch */}
        <div className="cn-card cn-master">
          <div className={`cn-icon${enabled ? " is-on" : ""}`}>
            {enabled ? <Bell size={20} strokeWidth={2} /> : <BellOff size={20} strokeWidth={2} />}
          </div>
          <div className="cn-grow">
            <div className="cn-label" id="cn-master-label">Checklist reminder</div>
            <div className="cn-hint">{loading ? "Loading…" : enabled ? `On · ${schedule}` : "Off"}</div>
          </div>
          <Switch value={enabled} onChange={change(setEnabled)} labelledBy="cn-master-label" disabled={loading} />
        </div>

        {loading ? (
          <div className="cn-card" style={{ marginTop: 24, padding: 18 }}>
            <Skeleton width="40%" height="16px" style={{ marginBottom: 12 }} />
            <Skeleton width="100%" height="44px" style={{ borderRadius: 10, marginBottom: 8 }} />
            <Skeleton width="100%" height="44px" style={{ borderRadius: 10 }} />
          </div>
        ) : !enabled ? (
          <p className="cn-off-note">Turn it on to choose a setup and a time.</p>
        ) : (
          <>
            {/* Setup */}
            <section className="cn-section">
              <h2 className="cn-section-title">Setup</h2>
              {strategies.length === 0 ? (
                <div className="cn-card cn-empty">
                  <div className="cn-label">You don&apos;t have any setups yet</div>
                  <div className="cn-hint">Create a setup with the rules you check before entering, then come back here.</div>
                  <Link href={isIndian ? "/indian-market/setups" : "/setups"} className="cn-btn-link">Create a setup</Link>
                </div>
              ) : (
                <>
                  <div className="cn-card" role="radiogroup" aria-label="Setup">
                    {strategies.map((s, idx) => {
                      const active = selectedStrategyIdx === idx;
                      const count = filledRules(s).length;
                      return (
                        <button
                          key={s._id || idx}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          className={`cn-option${active ? " is-active" : ""}`}
                          onClick={() => change(setSelectedStrategyIdx)(idx)}
                        >
                          <span className="cn-radio">{active && <Check size={13} strokeWidth={3.2} />}</span>
                          <span className="cn-grow cn-option-name">{s.name}</span>
                          <span className="cn-option-meta">{count} {count === 1 ? "rule" : "rules"}</span>
                        </button>
                      );
                    })}
                  </div>

                  {selected && (
                    <>
                      <div className="cn-preview-label">Preview</div>
                      <div className="cn-notif" aria-label="Notification preview">
                        <div className="cn-notif-app"><span className="cn-notif-logo">E</span>Edgecipline · now</div>
                        <div className="cn-notif-title">{selected.name}</div>
                        {previewRules.length === 0 ? (
                          <div className="cn-hint">This setup has no rules yet.</div>
                        ) : (
                          previewRules.slice(0, MAX_NOTIFICATION_ITEMS).map((r, i) => (
                            <div key={i} className="cn-notif-item"><span className="cn-notif-box" />{r.label}</div>
                          ))
                        )}
                        {previewRules.length > MAX_NOTIFICATION_ITEMS && (
                          <div className="cn-notif-more">+{previewRules.length - MAX_NOTIFICATION_ITEMS} more won&apos;t fit in the notification</div>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </section>

            {/* Schedule */}
            <section className="cn-section">
              <h2 className="cn-section-title">Schedule</h2>
              <div className="cn-card">
                <div className="cn-row">
                  <label className="cn-label" htmlFor="cn-time">Time</label>
                  <input
                    id="cn-time"
                    type="time"
                    className="cn-time"
                    value={notificationTime}
                    onChange={(e) => change(setNotificationTime)(e.target.value)}
                  />
                </div>
                <div className="cn-block">
                  <div className="cn-label">Repeat</div>
                  <div className="cn-seg" role="radiogroup" aria-label="Repeat">
                    {[
                      { value: "daily", label: "Every day" },
                      { value: "weekdays", label: "Weekdays" },
                      { value: "custom", label: "Custom" },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={repeatMode === opt.value}
                        className={repeatMode === opt.value ? "is-active" : ""}
                        onClick={() => change(setRepeatMode)(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {repeatMode === "custom" && (
                    <div className="cn-days">
                      {DAY_LABELS.map((label, i) => {
                        const day = i + 1;
                        const active = customDays.includes(day);
                        return (
                          <button
                            key={day}
                            type="button"
                            aria-pressed={active}
                            className={active ? "is-active" : ""}
                            onClick={() => toggleDay(day)}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className={`cn-summary${repeatMode === "custom" && !customDays.length ? " is-warn" : ""}`}>
                  {repeatMode === "custom" && !customDays.length
                    ? "Pick at least one day, or the reminder will never show."
                    : <>You&apos;ll get it at <b>{formatTime(notificationTime)}</b>, {describeDays(repeatMode, customDays)}.</>}
                </div>
              </div>
            </section>

            {/* Options */}
            <section className="cn-section">
              <h2 className="cn-section-title">Options</h2>
              <div className="cn-card">
                <div className="cn-row">
                  <div className="cn-grow">
                    <div className="cn-label" id="cn-reset-label">Reset ticks daily</div>
                    <div className="cn-hint">Clears every tick at {formatTime(resetTime)} so each day starts fresh.</div>
                  </div>
                  <Switch value={resetEnabled} onChange={change(setResetEnabled)} labelledBy="cn-reset-label" />
                </div>
                {resetEnabled && (
                  <div className="cn-row">
                    <label className="cn-hint" htmlFor="cn-reset-time" style={{ marginTop: 0 }}>Reset time</label>
                    <input
                      id="cn-reset-time"
                      type="time"
                      className="cn-time"
                      value={resetTime}
                      onChange={(e) => change(setResetTime)(e.target.value)}
                    />
                  </div>
                )}
                <div className="cn-row">
                  <div className="cn-grow">
                    <div className="cn-label" id="cn-persist-label">Keep until done</div>
                    <div className="cn-hint">Can&apos;t be swiped away until every rule is ticked.</div>
                  </div>
                  <Switch value={persistent} onChange={change(setPersistent)} labelledBy="cn-persist-label" />
                </div>
              </div>
            </section>
          </>
        )}
      </main>

      {!loading && (
        <div className="cn-savebar">
          <div className="cn-savebar-inner">
            {status}
            <button type="button" className="cn-save" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 size={16} strokeWidth={2.4} className="cn-spin" /> : <Save size={16} strokeWidth={2.4} />}
              {saveLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Switch({ value, onChange, labelledBy, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-labelledby={labelledBy}
      disabled={disabled}
      className={`cn-switch${value ? " is-on" : ""}`}
      onClick={() => onChange(!value)}
    >
      <span className="cn-switch-knob" />
    </button>
  );
}
