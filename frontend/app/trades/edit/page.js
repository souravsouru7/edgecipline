"use client";

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getTrade, updateTrade } from "@/services/tradeApi";
import { uploadTradeScreenshot } from "@/services/uploadApi";
import { fetchSetups } from "@/services/setupApi";
import { useRouter, useSearchParams } from "next/navigation";
import PageHeader from "@/features/shared/components/PageHeader";
import { useUserProfile } from "@/features/auth/hooks/useUserProfile";
import SetupChecklist from "@/features/trade/components/SetupChecklist";
import { invalidateTradeDependentQueries } from "@/utils/queryInvalidation";
import TradeEvidenceSection from "@/features/trade/components/TradeEvidenceSection";

/* ─────────────────────────────────────────
   DESIGN TOKENS — Light Trading Theme
   Base: warm white #F5F3EE
   Cards: #FFFFFF
   Bull: #0D9E6E (deep green)
   Bear: #D63B3B (deep red)
   Gold: #B8860B
   Text primary: #0F1923
   Text secondary: #4A5568
   Text muted: #94A3B8
   Border: #E2E8F0
───────────────────────────────────────── */

/* ─────────────────────────────────────────
   CANDLESTICK BACKGROUND (subtle, light)
───────────────────────────────────────── */
function CandlestickBackground() {
  useEffect(() => {
    const canvas = document.getElementById("edit-bg-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const draw = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const count = Math.floor(W / 32);
      const candles = [];
      let price = 200;
      for (let i = 0; i < count; i++) {
        const open = price + (Math.random() - 0.5) * 20;
        const close = open + (Math.random() - 0.5) * 28;
        const high = Math.max(open, close) + Math.random() * 12;
        const low = Math.min(open, close) - Math.random() * 12;
        price = close;
        candles.push({ open, close, high, low });
      }
      const all = candles.flatMap(c => [c.high, c.low]);
      const mx = Math.max(...all), mn = Math.min(...all), rng = mx - mn || 1;
      const toY = p => H * 0.1 + (H * 0.8 * (mx - p)) / rng;

      ctx.strokeStyle = "rgba(0,0,0,0.04)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 7; i++) {
        ctx.beginPath(); ctx.moveTo(0,(H/7)*i); ctx.lineTo(W,(H/7)*i); ctx.stroke();
      }

      candles.forEach((c, i) => {
        const x = i * 32 + 16, bull = c.close >= c.open;
        const col = bull ? "rgba(13,158,110,0.18)" : "rgba(214,59,59,0.15)";
        const bTop = toY(Math.max(c.open, c.close)), bBot = toY(Math.min(c.open, c.close));
        ctx.strokeStyle = bull ? "rgba(13,158,110,0.25)" : "rgba(214,59,59,0.22)";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, toY(c.high)); ctx.lineTo(x, toY(c.low)); ctx.stroke();
        ctx.fillStyle = col;
        ctx.fillRect(x - 8, bTop, 16, Math.max(bBot - bTop, 1));
      });

      const ma = candles.map((_, i) => {
        const sl = candles.slice(Math.max(0,i-5),i+1);
        return sl.reduce((a,c) => a+c.close,0)/sl.length;
      });
      ctx.strokeStyle = "rgba(184,134,11,0.3)";
      ctx.lineWidth = 2; ctx.setLineDash([5,5]);
      ctx.beginPath();
      ma.forEach((p,i) => { const x=i*32+16,y=toY(p); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
      ctx.stroke(); ctx.setLineDash([]);
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, []);
  return <canvas id="edit-bg-canvas" style={{ position:"fixed", inset:0, width:"100%", height:"100%", opacity:1, zIndex:0, pointerEvents:"none" }}/>;
}

/* ─────────────────────────────────────────
   TICKER TAPE — dark strip on light bg
───────────────────────────────────────── */
const tickers = [
  {sym:"BTC",val:"+2.34%",bull:true},{sym:"ETH",val:"-1.12%",bull:false},
  {sym:"AAPL",val:"+0.87%",bull:true},{sym:"TSLA",val:"+4.20%",bull:true},
  {sym:"NVDA",val:"-0.55%",bull:false},{sym:"GOLD",val:"+0.62%",bull:true},
  {sym:"SPY",val:"+0.31%",bull:true},{sym:"OIL",val:"-2.18%",bull:false},
  {sym:"AMZN",val:"+1.05%",bull:true},{sym:"USD/JPY",val:"-0.33%",bull:false},
];
function TickerTape() {
  const items = [...tickers, ...tickers];
  return (
    <div style={{
      overflow:"hidden", background:"#0F1923",
      borderBottom:"3px solid #0D9E6E",
      padding:"7px 0", whiteSpace:"nowrap", position:"relative", zIndex:10,
    }}>
      <div style={{ display:"inline-flex", gap:"48px", animation:"ticker 32s linear infinite" }}>
        {items.map((t,i) => (
          <span key={i} style={{ fontSize:"11px", fontFamily:"'JetBrains Mono',monospace", letterSpacing:"0.04em" }}>
            <span style={{ color:"#94A3B8", marginRight:6 }}>{t.sym}</span>
            <span style={{ color: t.bull ? "#22C78E" : "#F87171" }}>
              {t.bull?"▲":"▼"} {t.val}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
   INPUT FIELD
───────────────────────────────────────── */
function InputField({ label, name, value, onChange, type = "text", options = null, required = false, min, max }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{
        display: "block",
        fontSize: 10,
        letterSpacing: "0.14em",
        color: "#4A5568",
        marginBottom: 8,
        fontFamily: "'JetBrains Mono',monospace",
        fontWeight: 500,
      }}>
        {label}{required && <span style={{ color: "#D63B3B", marginLeft: 2 }}>*</span>}
      </label>
      {options ? (
        <select
          name={name}
          value={value || ""}
          onChange={onChange}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#F8F6F2",
            border: "1px solid #E2E8F0",
            borderRadius: 8,
            padding: "12px 14px",
            color: "#0F1923",
            fontSize: 12,
            fontFamily: "'JetBrains Mono',monospace",
            outline: "none",
          }}
        >
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          name={name}
          value={value || ""}
          onChange={onChange}
          min={min}
          max={max}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#F8F6F2",
            border: "1px solid #E2E8F0",
            borderRadius: 8,
            padding: "12px 14px",
            color: "#0F1923",
            fontSize: 12,
            fontFamily: "'JetBrains Mono',monospace",
            outline: "none",
          }}
        />
      )}
    </div>
  );
}

function normalizeDateInput(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000).toISOString().split("T")[0];
}

function getTodayInputValue() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split("T")[0];
}

const MAX_SCREENSHOT_SIZE_BYTES = 2 * 1024 * 1024;
const formatFileSizeMb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
const MOOD_OPTIONS = [
  { value: 1, label: "Stressed" },
  { value: 2, label: "Anxious" },
  { value: 3, label: "Neutral" },
  { value: 4, label: "Confident" },
  { value: 5, label: "Peak" },
];
const EMOTIONAL_TAGS = ["FOMO", "Revenge", "Fear", "Greed", "Calm", "Bored", "Focused", "Frustrated", "Disciplined", "Rushed"];

function normalizeSetupRules(rules = []) {
  return Array.isArray(rules)
    ? rules.map((rule, index) => ({
        id: rule.id ?? index + 1,
        label: rule.label || "",
        followed: Boolean(rule.followed),
      }))
    : [];
}

/* ─────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────── */
function EditTradePageContent() {
  const searchParams = useSearchParams();
  const resolvedParams = useMemo(() => ({ id: searchParams.get('id') }), [searchParams]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accountCreatedDate } = useUserProfile();
  const [trade, setTrade] = useState(null);
  const [formData, setFormData] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [dateError, setDateError] = useState("");
  const [screenshotError, setScreenshotError] = useState("");
  const [screenshotUploading, setScreenshotUploading] = useState(false);
  const [strategies, setStrategies] = useState([]);
  const [setupsLoading, setSetupsLoading] = useState(false);
  const [setupRules, setSetupRules] = useState([]);
  const evidenceRef = useRef(null);
  const [committingEvidence, setCommittingEvidence] = useState(false);

  const fetchTrade = useCallback(async () => {
    if (resolvedParams?.id) {
      const data = await getTrade(resolvedParams.id);
      setTrade(data);
      setFormData({
        ...data,
        tradeDate: normalizeDateInput(data.tradeDate || data.createdAt),
        strategyCustom: "",
      });
      setSetupRules(normalizeSetupRules(data.setupRules));
      setLoading(false);
    }
  }, [resolvedParams]);

  useEffect(() => {
    fetchTrade();
    setMounted(true);
  }, [fetchTrade]);

  useEffect(() => {
    let cancelled = false;
    const loadSetups = async () => {
      setSetupsLoading(true);
      try {
        const serverStrategies = await fetchSetups("Forex");
        if (cancelled) return;
        setStrategies(
          Array.isArray(serverStrategies)
            ? serverStrategies.map((strategy, index) => ({
                id: strategy.id ?? index + 1,
                name: strategy.name || "",
                rules: normalizeSetupRules(strategy.rules),
              }))
            : []
        );
      } catch {
        if (!cancelled) setStrategies([]);
      } finally {
        if (!cancelled) setSetupsLoading(false);
      }
    };
    loadSetups();
    return () => { cancelled = true; };
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "tradeDate") setDateError("");
    setFormData({ ...formData, [name]: value });
  };

  const handleStrategyChange = (e) => {
    const value = e.target.value;
    const selected = strategies.find((strategy) => strategy.name === value);
    setFormData((prev) => ({
      ...prev,
      strategy: value,
      strategyCustom: value === "Custom" ? prev.strategyCustom || "" : "",
    }));
    if (selected?.rules?.length) {
      setSetupRules(selected.rules.map((rule, index) => ({ ...rule, id: rule.id ?? index + 1, followed: false })));
    } else if (value && value !== "Custom") {
      setSetupRules([]);
    }
  };

  const toggleSetupRule = (id) => {
    setSetupRules((prev) => prev.map((rule) => rule.id === id ? { ...rule, followed: !rule.followed } : rule));
  };

  const updateSetupRuleLabel = (id, value) => {
    setSetupRules((prev) => prev.map((rule) => rule.id === id ? { ...rule, label: value } : rule));
  };

  const addSetupRule = () => {
    setSetupRules((prev) => [...prev, { id: Date.now(), label: "", followed: false }]);
  };

  const clearSetupRules = () => {
    setSetupRules((prev) => prev.map((rule) => ({ ...rule, followed: false })));
  };

  const toggleEmotionalTag = (tag) => {
    setFormData((prev) => {
      const current = Array.isArray(prev.emotionalTags) ? prev.emotionalTags : [];
      const next = current.includes(tag)
        ? current.filter((item) => item !== tag)
        : [...current, tag].slice(0, 10);
      return { ...prev, emotionalTags: next };
    });
  };

  const parseNumericField = (val) => {
    const n = parseFloat(val);
    return Number.isFinite(n) ? n : undefined;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData?.tradeDate) {
      setDateError("Trade date is required.");
      return;
    }
    if (accountCreatedDate && formData.tradeDate < accountCreatedDate) {
      setDateError(`Date cannot be before your account creation date (${accountCreatedDate}).`);
      return;
    }
    const today = getTodayInputValue();
    if (formData.tradeDate > today) {
      setDateError("Trade date cannot be in the future.");
      return;
    }
    setDateError("");
    setSaving(true);
    try {
      // Upload pending evidence images first so their URLs can be saved in
      // the same update call. Without this, abandoning the save would leak
      // uploaded blobs in Cloudinary.
      let tradeImages = formData.tradeImages || [];
      if (evidenceRef.current?.hasPending()) {
        setCommittingEvidence(true);
        try {
          tradeImages = await evidenceRef.current.commitPending();
        } catch {
          setCommittingEvidence(false);
          setSaving(false);
          return;
        }
        setCommittingEvidence(false);
      }

      // Send only editable fields — strip MongoDB internals (_id, __v, user,
      // createdAt, updatedAt) and the local screenshotPreview blob which can
      // be several MB and has no meaning on the server.
      const payload = {
        pair:              formData.pair,
        type:              formData.type,
        tradeDate:         formData.tradeDate,
        lotSize:           parseNumericField(formData.lotSize),
        entryPrice:        parseNumericField(formData.entryPrice),
        exitPrice:         parseNumericField(formData.exitPrice),
        stopLoss:          parseNumericField(formData.stopLoss),
        takeProfit:        parseNumericField(formData.takeProfit),
        profit:            parseNumericField(formData.profit),
        strategy:          formData.strategy === "Custom" ? (formData.strategyCustom?.trim() || "Custom") : formData.strategy,
        session:           formData.session,
        notes:             formData.notes,
        riskRewardRatio:   formData.riskRewardRatio,
        riskRewardCustom:  formData.riskRewardCustom,
        screenshot:        formData.screenshot,
        imageUrl:          formData.imageUrl,
        tradeImages,
        entryBasis:        formData.entryBasis,
        entryBasisCustom:  formData.entryBasisCustom,
        mood:              formData.mood,
        confidence:        formData.confidence,
        emotionalTags:     formData.emotionalTags,
        wouldRetake:       formData.wouldRetake,
        mistakeTag:        formData.mistakeTag,
        lesson:            formData.lesson,
        tradeQuality:      formData.tradeQuality || "",
      };
      const activeRules = setupRules.filter((rule) => rule.label && String(rule.label).trim());
      payload.setupRules = activeRules.map((rule) => ({ label: String(rule.label).trim(), followed: Boolean(rule.followed) }));
      payload.setupScore = activeRules.length
        ? Math.round((activeRules.filter((rule) => rule.followed).length / activeRules.length) * 100)
        : null;
      const result = await updateTrade(resolvedParams.id, payload);
      if (result) {
        invalidateTradeDependentQueries(queryClient);
        router.push(`/trades/view?id=${resolvedParams.id}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const typeOptions = [
    { value: "BUY",  label: "LONG (BUY)"  },
    { value: "SELL", label: "SHORT (SELL)" },
  ];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#F0EEE9",
      fontFamily: "'Plus Jakarta Sans',sans-serif",
      color: "#0F1923",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Fonts */}

      {/* Background */}
      <CandlestickBackground/>
      <div style={{ position: "fixed", inset: 0, zIndex: 1, pointerEvents: "none", background: "linear-gradient(135deg, rgba(240,238,233,0.82) 0%, rgba(240,238,233,0.75) 100%)" }}/>

      <PageHeader />

      <TickerTape/>

      {/* Main */}
      <main style={{
        position: "relative",
        zIndex: 5,
        padding: "28px 20px",
        maxWidth: 600,
        margin: "0 auto",
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateY(0)" : "translateY(16px)",
        transition: "all 0.5s cubic-bezier(0.22,1,0.36,1)",
      }}>
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0D9E6E" strokeWidth="2" style={{ animation: "spin 0.8s linear infinite", marginBottom: 14 }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
            <div style={{ fontSize: 11, color: "#94A3B8", letterSpacing: "0.14em", fontFamily: "'JetBrains Mono',monospace" }}>
              LOADING TRADE DATA...
            </div>
          </div>
        ) : (
          <>
            {/* Page title */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 28, fontWeight: 800, letterSpacing: "0.04em", color: "#0F1923", lineHeight: 1.1 }}>
                  Edit <span style={{ color: "#0D9E6E" }}>Trade</span>
                </div>
                <div style={{ fontSize: 12, color: "#94A3B8", letterSpacing: "0.06em", marginTop: 5, fontFamily: "'JetBrains Mono',monospace" }}>
                  UPDATE YOUR TRADE LOG ENTRY
                </div>
              </div>
            </div>

            {/* Form card */}
            <div style={{
              background: "#FFFFFF",
              border: "1px solid #E2E8F0",
              borderRadius: 14,
              overflow: "hidden",
              boxShadow: "0 2px 12px rgba(15,25,35,0.06)",
            }}>
              {/* Top accent */}
              <div style={{ height: 3, background: "linear-gradient(90deg,#0D9E6E 0%,transparent 45%,transparent 55%,#D63B3B 100%)" }}/>

              <form onSubmit={handleSubmit} style={{ padding: "24px 20px" }}>
                <InputField
                  label="PAIR"
                  name="pair"
                  value={formData.pair}
                  onChange={handleChange}
                />

                <InputField
                  label="TYPE"
                  name="type"
                  value={formData.type}
                  onChange={handleChange}
                  options={typeOptions}
                />

                <InputField
                  label="TRADE DATE"
                  name="tradeDate"
                  type="date"
                  value={formData.tradeDate}
                  onChange={handleChange}
                  required
                  min={accountCreatedDate || undefined}
                  max={getTodayInputValue()}
                />
                {dateError && (
                  <div style={{ fontSize: 11, color: "#D63B3B", marginTop: -10, marginBottom: 16, fontFamily: "'JetBrains Mono',monospace" }}>
                    {dateError}
                  </div>
                )}
                {!dateError && accountCreatedDate && (
                  <div style={{ fontSize: 10, color: "#94A3B8", marginTop: -10, marginBottom: 16, fontFamily: "'JetBrains Mono',monospace" }}>
                    Earliest allowed: {accountCreatedDate}
                  </div>
                )}

                <InputField
                  label="LOT SIZE"
                  name="lotSize"
                  value={formData.lotSize}
                  onChange={handleChange}
                />

                <InputField
                  label="ENTRY PRICE"
                  name="entryPrice"
                  value={formData.entryPrice}
                  onChange={handleChange}
                />

                <InputField
                  label="EXIT PRICE"
                  name="exitPrice"
                  value={formData.exitPrice}
                  onChange={handleChange}
                />

                <InputField
                  label="STOP LOSS"
                  name="stopLoss"
                  value={formData.stopLoss}
                  onChange={handleChange}
                />

                <InputField
                  label="TAKE PROFIT"
                  name="takeProfit"
                  value={formData.takeProfit}
                  onChange={handleChange}
                />

                <InputField
                  label="PROFIT"
                  name="profit"
                  value={formData.profit}
                  onChange={handleChange}
                />

                <div style={{ marginBottom: 18, border: "1px solid rgba(13,158,110,0.22)", borderRadius: 10, overflow: "hidden", background: "rgba(13,158,110,0.04)" }}>
                  <div style={{ padding: "11px 14px", borderBottom: "1px solid rgba(13,158,110,0.14)", color: "#0D9E6E", fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", fontFamily: "'JetBrains Mono',monospace" }}>
                    SETUP {setupsLoading ? "(LOADING...)" : ""}
                  </div>
                  <div style={{ padding: 14 }}>
                    <InputField
                      label="SETUP"
                      name="strategy"
                      value={formData.strategy}
                      onChange={handleStrategyChange}
                      options={[
                        { value: "", label: "Select..." },
                        ...(formData.strategy && formData.strategy !== "Custom" && !strategies.some((strategy) => strategy.name === formData.strategy)
                          ? [{ value: formData.strategy, label: formData.strategy }]
                          : []),
                        ...strategies.map((strategy) => ({ value: strategy.name, label: strategy.name })),
                        { value: "Custom", label: "Custom" },
                      ]}
                    />
                    {formData.strategy === "Custom" && (
                      <InputField
                        label="CUSTOM SETUP"
                        name="strategyCustom"
                        value={formData.strategyCustom}
                        onChange={handleChange}
                      />
                    )}
                    <SetupChecklist
                      rules={setupRules}
                      onToggle={toggleSetupRule}
                      onUpdateLabel={updateSetupRuleLabel}
                      onAdd={addSetupRule}
                      onClear={clearSetupRules}
                    />
                  </div>
                </div>

                <InputField
                  label="SESSION"
                  name="session"
                  value={formData.session}
                  onChange={handleChange}
                />

                <div style={{ marginBottom: 18, border: "1px solid rgba(124,58,237,0.22)", borderRadius: 10, overflow: "hidden", background: "rgba(124,58,237,0.04)" }}>
                  <div style={{ padding: "11px 14px", borderBottom: "1px solid rgba(124,58,237,0.14)", color: "#7C3AED", fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", fontFamily: "'JetBrains Mono',monospace" }}>
                    PSYCHOLOGY
                  </div>
                  <div style={{ padding: 14 }}>
                    <InputField
                      label="ENTRY BASIS"
                      name="entryBasis"
                      value={formData.entryBasis}
                      onChange={handleChange}
                      options={[
                        { value: "", label: "Select..." },
                        { value: "Plan", label: "Plan" },
                        { value: "Emotion", label: "Emotion" },
                        { value: "Impulsive", label: "Impulsive" },
                        { value: "Custom", label: "Custom" },
                      ]}
                    />
                    {formData.entryBasis === "Custom" && (
                      <InputField
                        label="ENTRY BASIS CUSTOM"
                        name="entryBasisCustom"
                        value={formData.entryBasisCustom}
                        onChange={handleChange}
                      />
                    )}

                    <div style={{ marginBottom: 16 }}>
                      <label style={{ display: "block", fontSize: 10, letterSpacing: "0.14em", color: "#4A5568", marginBottom: 8, fontFamily: "'JetBrains Mono',monospace", fontWeight: 500 }}>
                        MOOD
                      </label>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8 }}>
                        {MOOD_OPTIONS.map((mood) => {
                          const active = Number(formData.mood) === mood.value;
                          return (
                            <button
                              key={mood.value}
                              type="button"
                              onClick={() => setFormData((prev) => ({ ...prev, mood: active ? null : mood.value }))}
                              style={{ minHeight: 62, padding: "8px 4px", borderRadius: 8, border: active ? "2px solid #7C3AED" : "1px solid #E2E8F0", background: active ? "rgba(124,58,237,0.1)" : "#FFFFFF", color: active ? "#7C3AED" : "#64748B", cursor: "pointer", fontSize: 10, fontWeight: 800 }}
                            >
                              <div style={{ fontSize: 13, marginBottom: 4 }}>{mood.value}</div>
                              <div>{mood.label}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <InputField
                      label="CONFIDENCE"
                      name="confidence"
                      value={formData.confidence}
                      onChange={handleChange}
                      options={[
                        { value: "", label: "Select..." },
                        { value: "Low", label: "Low" },
                        { value: "Medium", label: "Medium" },
                        { value: "High", label: "High" },
                        { value: "Overconfident", label: "Overconfident" },
                      ]}
                    />

                    <div style={{ marginBottom: 16 }}>
                      <label style={{ display: "block", fontSize: 10, letterSpacing: "0.14em", color: "#4A5568", marginBottom: 8, fontFamily: "'JetBrains Mono',monospace", fontWeight: 500 }}>
                        EMOTIONAL TAGS
                      </label>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {EMOTIONAL_TAGS.map((tag) => {
                          const selected = Array.isArray(formData.emotionalTags) && formData.emotionalTags.includes(tag);
                          return (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => toggleEmotionalTag(tag)}
                              style={{ padding: "7px 12px", borderRadius: 999, border: selected ? "2px solid #7C3AED" : "1px solid #E2E8F0", background: selected ? "rgba(124,58,237,0.1)" : "#FFFFFF", color: selected ? "#7C3AED" : "#64748B", cursor: "pointer", fontSize: 11, fontWeight: 800 }}
                            >
                              {tag}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <InputField
                      label="WOULD RETAKE?"
                      name="wouldRetake"
                      value={formData.wouldRetake}
                      onChange={handleChange}
                      options={[
                        { value: "", label: "Select..." },
                        { value: "Yes", label: "Yes" },
                        { value: "No", label: "No" },
                      ]}
                    />

                    <div style={{ marginTop: 16 }}>
                      <label style={{ display: "block", fontSize: 10, letterSpacing: "0.14em", color: "#4A5568", marginBottom: 8, fontFamily: "'JetBrains Mono',monospace", fontWeight: 500 }}>
                        TRADE QUALITY (EXECUTION)
                      </label>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                        {[
                          { val: "Great", color: "#0D9E6E", desc: "Followed plan" },
                          { val: "Average", color: "#F59E0B", desc: "Partial exec." },
                          { val: "Poor", color: "#D63B3B", desc: "Broke rules" },
                        ].map(q => (
                          <button key={q.val} type="button"
                            onClick={() => setFormData(prev => ({ ...prev, tradeQuality: prev.tradeQuality === q.val ? "" : q.val }))}
                            style={{
                              padding: "10px 4px", borderRadius: 8, cursor: "pointer", textAlign: "center",
                              border: formData.tradeQuality === q.val ? `2px solid ${q.color}` : "1px solid #E2E8F0",
                              background: formData.tradeQuality === q.val ? `${q.color}14` : "#F8F6F2",
                              transition: "all 0.2s",
                            }}>
                            <div style={{ fontSize: 11, fontWeight: 800, color: formData.tradeQuality === q.val ? q.color : "#0F1923", fontFamily: "'JetBrains Mono',monospace" }}>{q.val}</div>
                            <div style={{ fontSize: 9, color: "#94A3B8", marginTop: 2 }}>{q.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Risk-Reward Ratio */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{
                    display: "block",
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    color: "#4A5568",
                    marginBottom: 8,
                    fontFamily: "'JetBrains Mono',monospace",
                    fontWeight: 500,
                  }}>
                    RISK : REWARD RATIO
                  </label>
                  <select
                    name="riskRewardRatio"
                    value={formData.riskRewardRatio || ""}
                    onChange={(e) => {
                      setFormData({ ...formData, riskRewardRatio: e.target.value });
                    }}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      background: "#F8F6F2",
                      border: "1px solid #E2E8F0",
                      borderRadius: 8,
                      padding: "12px 14px",
                      color: "#0F1923",
                      fontSize: 12,
                      fontFamily: "'JetBrains Mono',monospace",
                      outline: "none",
                    }}
                  >
                    <option value="">Select RR Ratio</option>
                    <option value="1:1">1:1</option>
                    <option value="1:2">1:2</option>
                    <option value="1:3">1:3</option>
                    <option value="1:4">1:4</option>
                    <option value="1:5">1:5</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>

                {/* Custom Risk-Reward Input */}
                {formData.riskRewardRatio === "custom" && (
                  <InputField
                    label="CUSTOM RR (e.g., 1:2.5)"
                    name="riskRewardCustom"
                    value={formData.riskRewardCustom}
                    onChange={handleChange}
                  />
                )}

                {/* Screenshot Upload */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{
                    display: "block",
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    color: "#4A5568",
                    marginBottom: 8,
                    fontFamily: "'JetBrains Mono',monospace",
                    fontWeight: 500,
                  }}>
                    TRADE SCREENSHOT
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      const file = e.target.files[0];
                      if (!file) return;
                      setScreenshotError("");

                      if (!file.type?.startsWith("image/")) {
                        setScreenshotError("Please choose a JPEG, PNG, or WEBP image.");
                        e.target.value = "";
                        return;
                      }

                      if (file.size > MAX_SCREENSHOT_SIZE_BYTES) {
                        setScreenshotError(`This image is ${formatFileSizeMb(file.size)} MB. Maximum allowed size is 2 MB. Please upload a smaller image.`);
                        e.target.value = "";
                        return;
                      }

                      // Create preview
                      const reader = new FileReader();
                      reader.onloadend = () => {
                        setFormData(prev => ({ ...prev, screenshotPreview: reader.result }));
                      };
                      reader.readAsDataURL(file);

                      // Upload to server
                      setScreenshotUploading(true);
                      try {
                        const data = await uploadTradeScreenshot(file);
                        const imageUrl = data.screenshotUrl || data.imageUrl || data.url;
                        if (!imageUrl) {
                          throw new Error("Screenshot upload finished without an image URL. Please try another image.");
                        }
                        setFormData(prev => ({
                          ...prev,
                          screenshot: imageUrl,
                          imageUrl,
                        }));
                      } catch (err) {
                        setScreenshotError(err?.message || "Screenshot upload failed. Please choose another image and try again.");
                      } finally {
                        setScreenshotUploading(false);
                      }
                    }}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      background: "#F8F6F2",
                      border: "1px solid #E2E8F0",
                      borderRadius: 8,
                      padding: "12px 14px",
                      color: "#0F1923",
                      fontSize: 12,
                      fontFamily: "'JetBrains Mono',monospace",
                      outline: "none",
                    }}
                  />
                  {screenshotUploading && (
                    <div style={{ fontSize: 11, color: "#4A5568", marginTop: 8, fontFamily: "'JetBrains Mono',monospace" }}>
                      Uploading screenshot...
                    </div>
                  )}
                  {screenshotError && (
                    <div style={{ fontSize: 11, color: "#D63B3B", marginTop: 8, lineHeight: 1.5, fontFamily: "'JetBrains Mono',monospace" }}>
                      {screenshotError}
                    </div>
                  )}
                  {(formData.screenshot || formData.screenshotPreview) && (
                    <div style={{ marginTop: 10 }}>
                      {formData.screenshotPreview ? (
                        <img 
                          src={formData.screenshotPreview} 
                          alt="Screenshot preview" 
                          style={{ maxHeight: 150, borderRadius: 8, border: "1px solid #E2E8F0" }}
                        />
                      ) : formData.screenshot ? (
                        <img 
                          src={formData.screenshot}
                          alt="Current screenshot"
                          style={{ maxHeight: 150, borderRadius: 8, border: "1px solid #E2E8F0" }}
                        />
                      ) : null}
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: 16 }}>
                  <TradeEvidenceSection
                    ref={evidenceRef}
                    value={formData.tradeImages || []}
                    onChange={imgs => setFormData(prev => ({ ...prev, tradeImages: imgs }))}
                    disabled={saving || committingEvidence}
                    accentColor="#0D9E6E"
                  />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{
                    display: "block",
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    color: "#4A5568",
                    marginBottom: 8,
                    fontFamily: "'JetBrains Mono',monospace",
                    fontWeight: 500,
                  }}>
                    NOTES
                  </label>
                  <textarea
                    name="notes"
                    value={formData.notes || ""}
                    onChange={handleChange}
                    rows={4}
                    maxLength={2000}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      background: "#F8F6F2",
                      border: "1px solid #E2E8F0",
                      borderRadius: 8,
                      padding: "12px 14px",
                      color: "#0F1923",
                      fontSize: 12,
                      fontFamily: "'JetBrains Mono',monospace",
                      outline: "none",
                      resize: "vertical",
                    }}
                  />
                  <div style={{ fontSize: 10, color: "#94A3B8", textAlign: "right", marginTop: 4, fontFamily: "'JetBrains Mono',monospace" }}>
                    {(formData.notes || "").length}/2000
                  </div>
                </div>

                {/* Buttons */}
                <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
                  <button
                    type="button"
                    onClick={() => router.push(`/trades/view?id=${resolvedParams.id}`)}
                    style={{
                      flex: 1,
                      padding: "14px",
                      background: "#FFFFFF",
                      border: "1px solid #E2E8F0",
                      borderRadius: 10,
                      color: "#4A5568",
                      fontSize: 11,
                      fontFamily: "'JetBrains Mono',monospace",
                      fontWeight: 600,
                      letterSpacing: "0.12em",
                      cursor: "pointer",
                      boxShadow: "0 2px 8px rgba(15,25,35,0.05)",
                    }}
                  >
                    CANCEL
                  </button>
                  <button
                    type="submit"
                    disabled={saving || screenshotUploading}
                    style={{
                      flex: 1,
                      padding: "14px",
                      background: (saving || screenshotUploading) ? "#F8F6F2" : "linear-gradient(135deg, #0F1923 0%, #1a2d3d 100%)",
                      border: "none",
                      borderRadius: 10,
                      color: (saving || screenshotUploading) ? "#94A3B8" : "#22C78E",
                      fontSize: 11,
                      fontFamily: "'JetBrains Mono',monospace",
                      fontWeight: 700,
                      letterSpacing: "0.12em",
                      cursor: (saving || screenshotUploading) ? "not-allowed" : "pointer",
                      boxShadow: (saving || screenshotUploading) ? "none" : "0 4px 16px rgba(15,25,35,0.2)",
                    }}
                  >
                    {saving ? "SAVING..." : screenshotUploading ? "UPLOADING..." : "SAVE CHANGES"}
                  </button>
                </div>
              </form>
            </div>
          </>
        )}
      </main>

      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes ticker { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
        * { box-sizing: border-box; margin: 0; padding: 0; }
      `}</style>
    </div>
  );
}

export default function EditTradePage() {
  return (
    <React.Suspense fallback={<div>Loading...</div>}>
      <EditTradePageContent />
    </React.Suspense>
  );
}
