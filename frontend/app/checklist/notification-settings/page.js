"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
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
import { buildNotificationItems } from "@/services/checklistNotificationSync";
import PageHeader from "@/features/shared/components/PageHeader";
import IndianMarketHeader from "@/components/IndianMarketHeader";
import { Bell, BellOff, Clock, RefreshCw, ChevronLeft, Save } from "lucide-react";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const isNative = () =>
  typeof window !== "undefined" && Capacitor.isNativePlatform();

export default function ChecklistNotificationSettingsPage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const { currentMarket } = useMarket();

  const [mounted, setMounted] = useState(false);
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // ── Form state ──────────────────────────────────────────────────────────
  const [enabled, setEnabled] = useState(false);
  const [selectedStrategyIdx, setSelectedStrategyIdx] = useState(0);
  const [notificationTime, setNotificationTime] = useState("09:00");
  const [repeatMode, setRepeatMode] = useState("weekdays");
  const [customDays, setCustomDays] = useState([1, 2, 3, 4, 5]);
  const [persistent, setPersistent] = useState(false);
  const [resetEnabled, setResetEnabled] = useState(true);
  const [resetTime, setResetTime] = useState("00:00");

  // ── Load data ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    setMounted(true);

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

  // ── Custom day toggle ───────────────────────────────────────────────────
  const toggleDay = (day) => {
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

      // 2. Configure native plugin (Android only)
      if (isNative()) {
        if (enabled) {
          // Request POST_NOTIFICATIONS permission first (Android 13+)
          const { granted } = await requestChecklistNotificationPermission();
          if (!granted) {
            setError("Notification permission denied. Please enable it in phone Settings → Apps → Edgecipline → Notifications.");
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
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }, [
    enabled, selectedStrategyIdx, strategies, notificationTime,
    repeatMode, customDays, persistent, resetEnabled, resetTime, currentMarket,
  ]);

  const isIndian = currentMarket === "Indian_Market";

  if (!mounted) return null;

  return (
    <div style={{
      minHeight: "100vh",
      background: "#F0EEE9",
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      color: "#0F1923",
    }}>
      {isIndian ? <IndianMarketHeader /> : <PageHeader />}

      <main style={{ maxWidth: 600, margin: "0 auto", padding: "24px 16px 48px" }}>

        {/* ── Back + title ───────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <button
            onClick={() => router.back()}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, borderRadius: 10,
              border: "1px solid #E2E8F0", background: "#FFFFFF",
              cursor: "pointer", flexShrink: 0,
            }}
          >
            <ChevronLeft size={18} color="#64748B" />
          </button>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>
              Checklist <span style={{ color: "#0D9E6E" }}>Notification</span>
            </h1>
            <p style={{ fontSize: 11, color: "#94A3B8", margin: "3px 0 0", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.06em" }}>
              SHOW YOUR CHECKLIST IN THE NOTIFICATION SHADE
            </p>
          </div>
        </div>

        {error && (
          <div style={{ marginBottom: 14, padding: "10px 12px", borderRadius: 10, background: "#FEF2F2", border: "1px solid #FCA5A5", fontSize: 12, color: "#B91C1C" }}>
            {error}
          </div>
        )}

        {!isNative() && (
          <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 10, background: "rgba(184,134,11,0.08)", border: "1px solid rgba(184,134,11,0.3)", fontSize: 12, color: "#B8860B" }}>
            Interactive notifications are available on the Android app only. Settings are saved and will apply when you use the app.
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "#94A3B8", fontSize: 13 }}>Loading…</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* ── Master toggle ──────────────────────────────────────── */}
            <Card>
              <Row>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <IconBox color={enabled ? "#0D9E6E" : "#64748B"} bg={enabled ? "rgba(13,158,110,0.1)" : "#F1F4F8"}>
                    {enabled ? <Bell size={18} strokeWidth={2} /> : <BellOff size={18} strokeWidth={2} />}
                  </IconBox>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>Show in Notification</div>
                    <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>
                      Display checklist in Android notification shade
                    </div>
                  </div>
                </div>
                <Toggle value={enabled} onChange={setEnabled} />
              </Row>
            </Card>

            {/* ── Strategy selector ──────────────────────────────────── */}
            <Card title="SELECT STRATEGY" dimmed={!enabled}>
              {strategies.length === 0 ? (
                <div style={{ fontSize: 12, color: "#94A3B8", padding: "8px 0" }}>
                  No strategies found. Create setups first.
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {strategies.map((s, idx) => {
                    const active = selectedStrategyIdx === idx;
                    return (
                      <button
                        key={s._id || idx}
                        onClick={() => enabled && setSelectedStrategyIdx(idx)}
                        style={{
                          padding: "8px 14px", borderRadius: 999,
                          border: active ? "1.5px solid #0D9E6E" : "1px solid #E2E8F0",
                          background: active ? "rgba(13,158,110,0.08)" : "#F8FAFC",
                          color: active ? "#0D9E6E" : "#64748B",
                          fontSize: 12, fontWeight: active ? 700 : 500,
                          cursor: enabled ? "pointer" : "default",
                          opacity: enabled ? 1 : 0.5,
                        }}
                      >
                        {s.name}
                        <span style={{ marginLeft: 6, fontSize: 10, color: "#94A3B8" }}>
                          {(s.rules || []).filter(r => r.label?.trim()).length}R
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Preview items */}
              {enabled && strategies[selectedStrategyIdx] && (
                <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 10, background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
                  <div style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "#94A3B8", letterSpacing: "0.1em", marginBottom: 10 }}>
                    NOTIFICATION PREVIEW
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#0F1923" }}>
                    {strategies[selectedStrategyIdx].name}
                  </div>
                  {(strategies[selectedStrategyIdx].rules || [])
                    .filter(r => r.label?.trim())
                    .slice(0, 8)
                    .map((r, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #F1F4F8" }}>
                        <div style={{ width: 16, height: 16, borderRadius: "50%", border: "1.5px solid #CBD5E1", flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: "#0F1923" }}>{r.label}</span>
                      </div>
                    ))}
                  {(strategies[selectedStrategyIdx].rules || []).filter(r => r.label?.trim()).length > 8 && (
                    <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 6, fontFamily: "'JetBrains Mono', monospace" }}>
                      + {(strategies[selectedStrategyIdx].rules || []).filter(r => r.label?.trim()).length - 8} more (not shown in notification)
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* ── Notification time ──────────────────────────────────── */}
            <Card title="NOTIFICATION TIME" dimmed={!enabled}>
              <Row>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconBox color="#3B82F6" bg="rgba(59,130,246,0.1)">
                    <Clock size={16} strokeWidth={2} />
                  </IconBox>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Show checklist at</div>
                </div>
                <input
                  type="time"
                  value={notificationTime}
                  onChange={(e) => enabled && setNotificationTime(e.target.value)}
                  disabled={!enabled}
                  style={{
                    fontSize: 15, fontWeight: 700,
                    fontFamily: "'JetBrains Mono', monospace",
                    border: "1px solid #E2E8F0", borderRadius: 8,
                    padding: "6px 10px", background: enabled ? "#FFFFFF" : "#F8FAFC",
                    color: enabled ? "#0F1923" : "#94A3B8",
                    cursor: enabled ? "pointer" : "default",
                    outline: "none",
                  }}
                />
              </Row>
            </Card>

            {/* ── Repeat ─────────────────────────────────────────────── */}
            <Card title="REPEAT" dimmed={!enabled}>
              <div style={{ display: "flex", gap: 8, marginBottom: repeatMode === "custom" ? 14 : 0 }}>
                {[
                  { value: "daily", label: "Every Day" },
                  { value: "weekdays", label: "Weekdays" },
                  { value: "custom", label: "Custom" },
                ].map((opt) => {
                  const active = repeatMode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => enabled && setRepeatMode(opt.value)}
                      style={{
                        flex: 1, padding: "9px 6px", borderRadius: 10,
                        border: active ? "1.5px solid #0D9E6E" : "1px solid #E2E8F0",
                        background: active ? "rgba(13,158,110,0.08)" : "#F8FAFC",
                        color: active ? "#0D9E6E" : "#64748B",
                        fontSize: 12, fontWeight: active ? 700 : 500,
                        cursor: enabled ? "pointer" : "default",
                        opacity: enabled ? 1 : 0.5,
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              {repeatMode === "custom" && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {DAY_LABELS.map((label, i) => {
                    const day = i + 1;
                    const active = customDays.includes(day);
                    return (
                      <button
                        key={day}
                        onClick={() => enabled && toggleDay(day)}
                        style={{
                          width: 40, height: 40, borderRadius: 10,
                          border: active ? "1.5px solid #0D9E6E" : "1px solid #E2E8F0",
                          background: active ? "rgba(13,158,110,0.1)" : "#F8FAFC",
                          color: active ? "#0D9E6E" : "#64748B",
                          fontSize: 11, fontWeight: 700,
                          cursor: enabled ? "pointer" : "default",
                          opacity: enabled ? 1 : 0.5,
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* ── Daily reset ────────────────────────────────────────── */}
            <Card title="DAILY RESET" dimmed={!enabled}>
              <Row>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconBox color="#8B5CF6" bg="rgba(139,92,246,0.1)">
                    <RefreshCw size={16} strokeWidth={2} />
                  </IconBox>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Auto-reset at midnight</div>
                    <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>
                      Uncheck all items at the reset time
                    </div>
                  </div>
                </div>
                <Toggle
                  value={resetEnabled}
                  onChange={(v) => enabled && setResetEnabled(v)}
                  disabled={!enabled}
                />
              </Row>

              {resetEnabled && (
                <Row style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #F1F4F8" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Reset time</div>
                  <input
                    type="time"
                    value={resetTime}
                    onChange={(e) => enabled && setResetTime(e.target.value)}
                    disabled={!enabled}
                    style={{
                      fontSize: 14, fontWeight: 700,
                      fontFamily: "'JetBrains Mono', monospace",
                      border: "1px solid #E2E8F0", borderRadius: 8,
                      padding: "5px 10px", background: enabled ? "#FFFFFF" : "#F8FAFC",
                      color: enabled ? "#0F1923" : "#94A3B8",
                      outline: "none",
                    }}
                  />
                </Row>
              )}
            </Card>

            {/* ── Persistent notification ────────────────────────────── */}
            <Card dimmed={!enabled}>
              <Row>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>Persistent Notification</div>
                  <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>
                    Cannot be swiped away (stays until all items checked)
                  </div>
                </div>
                <Toggle
                  value={persistent}
                  onChange={(v) => enabled && setPersistent(v)}
                  disabled={!enabled}
                />
              </Row>
            </Card>

            {/* ── Save button ────────────────────────────────────────── */}
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                width: "100%", padding: "16px", borderRadius: 14, border: "none",
                background: saved
                  ? "linear-gradient(135deg, #0D9E6E, #22C78E)"
                  : "linear-gradient(135deg, #0D9E6E, #22C78E)",
                color: "#FFFFFF", fontSize: 13, fontWeight: 800,
                fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.06em",
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.7 : 1,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                boxShadow: "0 4px 20px rgba(13,158,110,0.3)",
              }}
            >
              <Save size={16} strokeWidth={2.5} />
              {saving ? "SAVING..." : saved ? "SAVED ✓" : "SAVE SETTINGS"}
            </button>

          </div>
        )}
      </main>
    </div>
  );
}

// ── Shared sub-components ──────────────────────────────────────────────────

function Card({ children, title, dimmed = false }) {
  return (
    <div style={{
      background: "#FFFFFF", borderRadius: 14,
      border: "1px solid #E2E8F0",
      padding: "16px 18px",
      boxShadow: "0 2px 10px rgba(15,25,35,0.04)",
      opacity: dimmed ? 0.5 : 1,
      transition: "opacity 0.2s",
    }}>
      {title && (
        <div style={{
          fontSize: 10, fontFamily: "'JetBrains Mono', monospace",
          letterSpacing: "0.12em", color: "#94A3B8", fontWeight: 700,
          marginBottom: 12,
        }}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function Row({ children, style }) {
  return (
    <div style={{
      display: "flex", alignItems: "center",
      justifyContent: "space-between", gap: 12,
      ...style,
    }}>
      {children}
    </div>
  );
}

function IconBox({ children, color, bg }) {
  return (
    <div style={{
      width: 36, height: 36, borderRadius: 10,
      background: bg, color: color,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    }}>
      {children}
    </div>
  );
}

function Toggle({ value, onChange, disabled = false }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!value)}
      style={{
        width: 48, height: 28, borderRadius: 14, border: "none",
        background: value ? "#0D9E6E" : "#CBD5E1",
        cursor: disabled ? "default" : "pointer",
        position: "relative", flexShrink: 0,
        transition: "background 0.2s",
        padding: 0,
      }}
      aria-checked={value}
      role="switch"
    >
      <div style={{
        position: "absolute", top: 3,
        left: value ? 23 : 3,
        width: 22, height: 22, borderRadius: "50%",
        background: "#FFFFFF",
        boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
        transition: "left 0.2s",
      }} />
    </button>
  );
}
