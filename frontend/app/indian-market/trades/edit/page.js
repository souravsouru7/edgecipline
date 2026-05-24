"use client";

export const dynamic = "force-dynamic";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getTrade, updateTrade } from "@/services/tradeApi";
import { MARKETS } from "@/context/MarketContext";
import IndianMarketHeader from "@/components/IndianMarketHeader";
import { useUserProfile } from "@/features/auth/hooks/useUserProfile";

const C = {
  bull: "#0D9E6E",
  bear: "#D63B3B",
  gold: "#B8860B",
  blue: "#2563EB",
  purple: "#7C3AED",
  bg: "#F0EEE9",
  card: "#FFFFFF",
  border: "#E2E8F0",
  muted: "#94A3B8",
  ink: "#0F1923",
  ink2: "#334155",
  mono: "'JetBrains Mono',monospace",
  sans: "'Plus Jakarta Sans',sans-serif",
};

function InputField({ label, name, value, onChange, type = "text", options = null, placeholder = "", required = false, min, max }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 10, letterSpacing: "0.14em", color: "#4A5568", marginBottom: 8, fontFamily: C.mono, fontWeight: 600 }}>
        {label}{required && <span style={{ color: "#D63B3B", marginLeft: 2 }}>*</span>}
      </label>
      {options ? (
        <select
          name={name}
          value={value || ""}
          onChange={onChange}
          style={{ width: "100%", boxSizing: "border-box", background: "#F8F6F2", border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", color: C.ink, fontSize: 12, fontFamily: C.mono, outline: "none" }}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          name={name}
          value={value || ""}
          onChange={onChange}
          placeholder={placeholder}
          min={min}
          max={max}
          style={{ width: "100%", boxSizing: "border-box", background: "#F8F6F2", border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", color: C.ink, fontSize: 12, fontFamily: C.mono, outline: "none" }}
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

function normalizeSetupRules(rules = []) {
  if (!Array.isArray(rules)) return [];
  return rules.map((rule, index) => ({
    id: index + 1,
    label: rule?.label || "",
    followed: Boolean(rule?.followed),
  }));
}

function calculateSetupScore(rules = []) {
  const activeRules = rules.filter((rule) => String(rule.label || "").trim());
  if (!activeRules.length) return null;
  const followedCount = activeRules.filter((rule) => rule.followed).length;
  return Math.round((followedCount / activeRules.length) * 100);
}

function IndianEditTradeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accountCreatedDate } = useUserProfile();
  const id = searchParams.get("id");
  const [formData, setFormData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dateError, setDateError] = useState("");

  const fetchTrade = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getTrade(id, MARKETS.INDIAN_MARKET);
      setFormData({
        ...data,
        tradeDate: normalizeDateInput(data.tradeDate || data.createdAt),
        expiryDate: normalizeDateInput(data.expiryDate),
        emotionalTags: Array.isArray(data.emotionalTags) ? data.emotionalTags.join(", ") : "",
        setupRules: normalizeSetupRules(data.setupRules),
      });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchTrade();
  }, [fetchTrade]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "tradeDate") setDateError("");
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const toggleSetupRule = (ruleId) => {
    setFormData((prev) => ({
      ...prev,
      setupRules: (prev.setupRules || []).map((rule) =>
        rule.id === ruleId ? { ...rule, followed: !rule.followed } : rule
      ),
    }));
  };

  const updateSetupRuleLabel = (ruleId, value) => {
    setFormData((prev) => ({
      ...prev,
      setupRules: (prev.setupRules || []).map((rule) =>
        rule.id === ruleId ? { ...rule, label: value } : rule
      ),
    }));
  };

  const addSetupRule = () => {
    setFormData((prev) => ({
      ...prev,
      setupRules: [
        ...(prev.setupRules || []),
        { id: (prev.setupRules || []).length + 1, label: "", followed: false },
      ],
    }));
  };

  const clearSetupRules = () => {
    setFormData((prev) => ({
      ...prev,
      setupRules: (prev.setupRules || []).map((rule) => ({ ...rule, followed: false })),
    }));
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
    if (formData.tradeDate > getTodayInputValue()) {
      setDateError("Trade date cannot be in the future.");
      return;
    }
    setDateError("");
    if (!formData.riskRewardRatio) {
      alert("Select risk : reward ratio.");
      return;
    }
    if (!formData.mood) {
      alert("Select your mood.");
      return;
    }
    if (!formData.confidence) {
      alert("Select your confidence level.");
      return;
    }
    const _emotionalTagsArr = String(formData.emotionalTags || "").split(",").map(t => t.trim()).filter(Boolean);
    if (_emotionalTagsArr.length === 0) {
      alert("Add at least one emotional tag.");
      return;
    }

    setSaving(true);
    try {
      const activeSetupRules = (formData.setupRules || [])
        .map((rule) => ({
          label: String(rule.label || "").trim(),
          followed: Boolean(rule.followed),
        }))
        .filter((rule) => rule.label);
      const derivedPair = formData.underlying && formData.strikePrice && formData.optionType
        ? `${String(formData.underlying).trim()} ${String(formData.strikePrice).trim()} ${String(formData.optionType).trim()}`
        : formData.pair;

      await updateTrade(
        id,
        {
          ...formData,
          pair: derivedPair,
          quantity: formData.quantity === "" ? undefined : Number(formData.quantity),
          lotSize: formData.lotSize === "" ? undefined : Number(formData.lotSize),
          strikePrice: formData.strikePrice === "" ? undefined : Number(formData.strikePrice),
          entryPrice: formData.entryPrice === "" ? undefined : Number(formData.entryPrice),
          exitPrice: formData.exitPrice === "" ? undefined : Number(formData.exitPrice),
          stopLoss: formData.stopLoss === "" ? undefined : Number(formData.stopLoss),
          takeProfit: formData.takeProfit === "" ? undefined : Number(formData.takeProfit),
          profit: formData.profit === "" ? undefined : Number(formData.profit),
          brokerage: formData.brokerage === "" ? undefined : Number(formData.brokerage),
          sttTaxes: formData.sttTaxes === "" ? undefined : Number(formData.sttTaxes),
          mood: formData.mood === "" ? undefined : Number(formData.mood),
          emotionalTags: String(formData.emotionalTags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
          setupRules: activeSetupRules,
          setupScore: calculateSetupScore(activeSetupRules),
        },
        MARKETS.INDIAN_MARKET
      );
      router.push(`/indian-market/trades/view?id=${id}`);
    } catch (err) {
      alert(err?.message || "Failed to update trade.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: C.sans, color: C.muted }}>
        Loading trade...
      </div>
    );
  }


  if (!formData) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, padding: 24, fontFamily: C.sans }}>
        <p style={{ color: C.bear, marginBottom: 12 }}>Trade not found.</p>
        <Link href="/indian-market/trades" style={{ color: C.bull, fontWeight: 700, textDecoration: "none" }}>Back to Journal</Link>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: C.sans, color: C.ink }}>
      <IndianMarketHeader />

      <main style={{ maxWidth: 760, margin: "0 auto", padding: "28px 20px 48px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>
              Edit <span style={{ color: C.bull }}>Options Trade</span>
            </h1>
            <div style={{ fontSize: 11, color: C.muted, fontFamily: C.mono, letterSpacing: "0.08em", marginTop: 6 }}>
              UPDATE ALL JOURNAL DETAILS
            </div>
          </div>
          <Link href={`/indian-market/trades/view?id=${id}`} style={{ textDecoration: "none", color: C.ink2, border: `1px solid ${C.border}`, background: "#FFF", borderRadius: 8, padding: "10px 14px", fontSize: 12, fontWeight: 700 }}>
            Back to Trade
          </Link>
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 12px rgba(15,25,35,0.06)" }}>
          <div style={{ height: 3, background: `linear-gradient(90deg, ${C.bull}, ${C.gold})` }} />

          <form onSubmit={handleSubmit} style={{ padding: "24px 20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <InputField label="UNDERLYING / SYMBOL" name="underlying" value={formData.underlying} onChange={handleChange} />
              <div>
                <InputField label="TRADE DATE" name="tradeDate" type="date" value={formData.tradeDate} onChange={handleChange} required min={accountCreatedDate || undefined} max={getTodayInputValue()} />
                {dateError ? (
                  <div style={{ fontSize: 11, color: "#D63B3B", marginTop: -10, marginBottom: 8, fontFamily: C.mono }}>
                    {dateError}
                  </div>
                ) : accountCreatedDate ? (
                  <div style={{ fontSize: 10, color: C.muted, marginTop: -10, marginBottom: 8, fontFamily: C.mono }}>
                    Earliest: {accountCreatedDate}
                  </div>
                ) : null}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <InputField label="TYPE" name="type" value={formData.type} onChange={handleChange} options={[{ value: "BUY", label: "BUY" }, { value: "SELL", label: "SELL" }]} />
              <InputField label="OPTION TYPE" name="optionType" value={formData.optionType} onChange={handleChange} options={[{ value: "CE", label: "CE" }, { value: "PE", label: "PE" }]} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <InputField label="STRIKE PRICE" name="strikePrice" type="number" value={formData.strikePrice} onChange={handleChange} />
              <InputField label="LOT SIZE" name="lotSize" type="number" value={formData.lotSize} onChange={handleChange} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <InputField label="QUANTITY (LOTS)" name="quantity" type="number" value={formData.quantity} onChange={handleChange} />
              <InputField label="PROFIT / LOSS" name="profit" type="number" value={formData.profit} onChange={handleChange} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <InputField label="ENTRY PRICE (PREMIUM)" name="entryPrice" type="number" value={formData.entryPrice} onChange={handleChange} />
              <InputField label="EXIT PRICE (PREMIUM)" name="exitPrice" type="number" value={formData.exitPrice} onChange={handleChange} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <InputField label="STOP LOSS" name="stopLoss" type="number" value={formData.stopLoss} onChange={handleChange} />
              <InputField label="TAKE PROFIT" name="takeProfit" type="number" value={formData.takeProfit} onChange={handleChange} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <InputField label="TRADE TYPE" name="tradeType" value={formData.tradeType} onChange={handleChange} options={[{ value: "INTRADAY", label: "INTRADAY" }, { value: "DELIVERY", label: "DELIVERY" }, { value: "SWING", label: "SWING" }]} />
              <InputField label="ENTRY BASIS" name="entryBasis" value={formData.entryBasis} onChange={handleChange} options={[{ value: "Plan", label: "Plan" }, { value: "Emotion", label: "Emotion" }, { value: "Impulsive", label: "Impulsive" }, { value: "Custom", label: "Custom" }, { value: "", label: "None" }]} />
            </div>

            <InputField label="EXPIRY DATE" name="expiryDate" type="date" value={formData.expiryDate} onChange={handleChange} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <InputField label="ENTRY BASIS CUSTOM" name="entryBasisCustom" value={formData.entryBasisCustom} onChange={handleChange} />
              <InputField label="TRADING SETUP" name="strategy" value={formData.strategy} onChange={handleChange} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <InputField label="RISK : REWARD" name="riskRewardRatio" value={formData.riskRewardRatio} onChange={handleChange} options={[{ value: "", label: "Select…" }, { value: "1:1", label: "1:1" }, { value: "1:2", label: "1:2" }, { value: "1:3", label: "1:3" }, { value: "1:4", label: "1:4" }, { value: "1:5", label: "1:5" }, { value: "custom", label: "Custom" }]} required />
              <InputField label="CUSTOM R:R" name="riskRewardCustom" value={formData.riskRewardCustom} onChange={handleChange} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <InputField label="BROKERAGE" name="brokerage" type="number" value={formData.brokerage} onChange={handleChange} />
              <InputField label="STT / TAXES" name="sttTaxes" type="number" value={formData.sttTaxes} onChange={handleChange} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <InputField label="SETUP NAME" name="setup" value={formData.setup} onChange={handleChange} />
              <InputField label="MISTAKE TAG" name="mistakeTag" value={formData.mistakeTag} onChange={handleChange} />
            </div>

            {/* ── Psychology Section ── */}
            <div style={{ marginBottom: 18, border: `1px solid ${C.purple}30`, borderRadius: 12, overflow: "hidden", background: `${C.purple}05` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: `1px solid ${C.purple}20`, background: `${C.purple}08` }}>
                <span style={{ fontSize: 15 }}>🧠</span>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: C.purple, fontFamily: C.mono }}>PSYCHOLOGY</span>
                <span style={{ fontSize: 9, color: "#D63B3B", fontWeight: 700, fontFamily: C.mono, letterSpacing: "0.08em", background: "#FFF0F0", padding: "2px 6px", borderRadius: 4 }}>REQUIRED</span>
              </div>

              <div style={{ padding: "16px" }}>
                {/* Mood */}
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.14em", color: "#4A5568", marginBottom: 10, fontFamily: C.mono, fontWeight: 600 }}>
                    MOOD <span style={{ color: "#D63B3B" }}>*</span>
                  </div>
                  {(() => {
                    const moodLabels = ["", "Stressed", "Anxious", "Neutral", "Focused", "Peak Focus"];
                    const moodColors = ["", C.bear, "#F97316", C.gold, C.bull, C.blue];
                    const current = Number(formData.mood) || 0;
                    return (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {[1, 2, 3, 4, 5].map(i => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setFormData(p => ({ ...p, mood: i }))}
                            style={{
                              display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                              padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                              border: current === i ? `2px solid ${moodColors[i]}` : `1px solid ${C.border}`,
                              background: current === i ? `${moodColors[i]}12` : "#FFF",
                              flex: 1, minWidth: 56, transition: "all 0.15s",
                            }}
                          >
                            <div style={{ display: "flex", gap: 2 }}>
                              {[1, 2, 3, 4, 5].map(bar => (
                                <div key={bar} style={{ width: 4, height: bar <= i ? 14 : 6, borderRadius: 2, background: bar <= i ? moodColors[i] : C.border, transition: "all 0.15s" }} />
                              ))}
                            </div>
                            <span style={{ fontSize: 10, fontWeight: 700, color: current === i ? moodColors[i] : C.muted, fontFamily: C.mono }}>{i}</span>
                            <span style={{ fontSize: 9, color: current === i ? moodColors[i] : C.muted, textAlign: "center", lineHeight: 1.2 }}>{moodLabels[i]}</span>
                          </button>
                        ))}
                        {current > 0 && (
                          <button
                            type="button"
                            onClick={() => setFormData(p => ({ ...p, mood: "" }))}
                            style={{ padding: "10px 10px", borderRadius: 10, cursor: "pointer", border: `1px solid ${C.border}`, background: "#FFF", color: C.muted, fontSize: 11, alignSelf: "stretch" }}
                          >✕</button>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Confidence */}
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.14em", color: "#4A5568", marginBottom: 10, fontFamily: C.mono, fontWeight: 600 }}>CONFIDENCE <span style={{ color: "#D63B3B" }}>*</span></div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {[
                      { value: "Low",           color: C.bear   },
                      { value: "Medium",        color: C.gold   },
                      { value: "High",          color: C.bull   },
                      { value: "Overconfident", color: C.purple },
                    ].map(({ value, color }) => {
                      const active = formData.confidence === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setFormData(p => ({ ...p, confidence: active ? "" : value }))}
                          style={{
                            padding: "8px 14px", borderRadius: 8, cursor: "pointer",
                            border: active ? `2px solid ${color}` : `1px solid ${C.border}`,
                            background: active ? `${color}12` : "#FFF",
                            color: active ? color : C.muted,
                            fontSize: 12, fontWeight: 700, fontFamily: C.sans,
                            transition: "all 0.15s",
                          }}
                        >
                          {value}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Would Retake */}
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.14em", color: "#4A5568", marginBottom: 10, fontFamily: C.mono, fontWeight: 600 }}>WOULD RETAKE?</div>
                  <div style={{ display: "flex", gap: 10 }}>
                    {[
                      { value: "Yes", color: C.bull, icon: "✓" },
                      { value: "No",  color: C.bear, icon: "✕" },
                    ].map(({ value, color, icon }) => {
                      const active = formData.wouldRetake === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setFormData(p => ({ ...p, wouldRetake: active ? "" : value }))}
                          style={{
                            display: "flex", alignItems: "center", gap: 8,
                            padding: "10px 22px", borderRadius: 10, cursor: "pointer",
                            border: active ? `2px solid ${color}` : `1px solid ${C.border}`,
                            background: active ? `${color}12` : "#FFF",
                            color: active ? color : C.muted,
                            fontSize: 13, fontWeight: 700, fontFamily: C.sans,
                            transition: "all 0.15s",
                          }}
                        >
                          <span style={{ fontSize: 16, fontWeight: 900 }}>{icon}</span> {value}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Emotional Tags */}
                <div>
                  <div style={{ fontSize: 10, letterSpacing: "0.14em", color: "#4A5568", marginBottom: 10, fontFamily: C.mono, fontWeight: 600 }}>EMOTIONAL TAGS <span style={{ color: "#D63B3B" }}>*</span></div>
                  {/* Quick-tap common tags */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                    {["FOMO", "Revenge", "Fear", "Greed", "Calm", "Rushed", "Focused", "Frustrated", "Disciplined", "Impulsive"].map(tag => {
                      const currentTags = String(formData.emotionalTags || "").split(",").map(t => t.trim()).filter(Boolean);
                      const active = currentTags.includes(tag);
                      const dangerTags = ["FOMO", "Revenge", "Fear", "Greed", "Rushed", "Frustrated", "Impulsive"];
                      const color = active ? (dangerTags.includes(tag) ? C.bear : C.bull) : C.muted;
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => {
                            const tags = String(formData.emotionalTags || "").split(",").map(t => t.trim()).filter(Boolean);
                            const updated = active ? tags.filter(t => t !== tag) : [...tags, tag];
                            setFormData(p => ({ ...p, emotionalTags: updated.join(", ") }));
                          }}
                          style={{
                            padding: "5px 10px", borderRadius: 20, cursor: "pointer",
                            border: active ? `1.5px solid ${color}` : `1px solid ${C.border}`,
                            background: active ? `${color}12` : "#FFF",
                            color, fontSize: 11, fontWeight: 700,
                            fontFamily: C.sans, transition: "all 0.15s",
                          }}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    type="text"
                    name="emotionalTags"
                    value={formData.emotionalTags || ""}
                    onChange={handleChange}
                    placeholder="Or type custom tags, comma separated…"
                    style={{ width: "100%", boxSizing: "border-box", background: "#FFF", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", color: C.ink, fontSize: 12, fontFamily: C.sans, outline: "none" }}
                  />
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 18, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, background: "#FCFBF8" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 10, letterSpacing: "0.14em", color: "#4A5568", fontFamily: C.mono, fontWeight: 600 }}>
                    SETUP CHECKLIST
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
                    Score updates automatically from followed rules.
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: calculateSetupScore(formData.setupRules) >= 70 ? C.bull : calculateSetupScore(formData.setupRules) >= 40 ? C.gold : C.bear }}>
                    {calculateSetupScore(formData.setupRules) == null ? "No score yet" : `${calculateSetupScore(formData.setupRules)}%`}
                  </div>
                  <button type="button" onClick={clearSetupRules} style={{ border: `1px solid ${C.border}`, background: "#FFF", color: C.ink2, borderRadius: 8, padding: "8px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    Clear Checks
                  </button>
                  <button type="button" onClick={addSetupRule} style={{ border: "none", background: `${C.bull}15`, color: C.bull, borderRadius: 8, padding: "8px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    Add Rule
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {(formData.setupRules || []).map((rule) => (
                  <div key={rule.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "center" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: C.ink2, fontWeight: 700 }}>
                      <input type="checkbox" checked={!!rule.followed} onChange={() => toggleSetupRule(rule.id)} />
                      Followed
                    </label>
                    <input
                      type="text"
                      value={rule.label}
                      onChange={(e) => updateSetupRuleLabel(rule.id, e.target.value)}
                      placeholder="Enter checklist rule"
                      style={{ width: "100%", boxSizing: "border-box", background: "#FFF", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", color: C.ink, fontSize: 12, fontFamily: C.sans, outline: "none" }}
                    />
                  </div>
                ))}
                {!formData.setupRules?.length && (
                  <div style={{ fontSize: 12, color: C.muted }}>
                    No setup rules saved for this trade yet.
                  </div>
                )}
              </div>
            </div>

            <InputField label="SCREENSHOT URL" name="screenshot" value={formData.screenshot} onChange={handleChange} placeholder="https://..." />
            {formData.screenshot ? (
              <div style={{ marginBottom: 16 }}>
                <a href={formData.screenshot} target="_blank" rel="noopener noreferrer" style={{ color: C.blue, textDecoration: "none", fontSize: 12, fontWeight: 700 }}>
                  View current screenshot
                </a>
              </div>
            ) : null}

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 10, letterSpacing: "0.14em", color: "#4A5568", marginBottom: 8, fontFamily: C.mono, fontWeight: 600 }}>
                NOTES
              </label>
              <textarea
                name="notes"
                value={formData.notes || ""}
                onChange={handleChange}
                rows={3}
                style={{ width: "100%", boxSizing: "border-box", background: "#F8F6F2", border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", color: C.ink, fontSize: 13, fontFamily: C.sans, outline: "none", resize: "vertical" }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 10, letterSpacing: "0.14em", color: "#4A5568", marginBottom: 8, fontFamily: C.mono, fontWeight: 600 }}>
                LESSON LEARNED
              </label>
              <textarea
                name="lesson"
                value={formData.lesson || ""}
                onChange={handleChange}
                rows={3}
                style={{ width: "100%", boxSizing: "border-box", background: "#F8F6F2", border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", color: C.ink, fontSize: 13, fontFamily: C.sans, outline: "none", resize: "vertical" }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
              <Link href={`/indian-market/trades/view?id=${id}`} style={{ textDecoration: "none", padding: "12px 16px", borderRadius: 10, border: `1px solid ${C.border}`, background: "#FFF", color: C.ink2, fontSize: 12, fontWeight: 700 }}>
                Cancel
              </Link>
              <button
                type="submit"
                disabled={saving}
                style={{ padding: "12px 18px", borderRadius: 10, border: "none", background: saving ? C.muted : `linear-gradient(135deg, ${C.bull}, #22C78E)`, color: "#FFF", fontSize: 12, fontWeight: 800, fontFamily: C.mono, cursor: saving ? "not-allowed" : "pointer", letterSpacing: "0.08em" }}
              >
                {saving ? "SAVING..." : "SAVE CHANGES"}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}

export default function IndianEditTradePage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: C.sans, color: C.muted }}>
        Loading trade...
      </div>
    }>
      <IndianEditTradeContent />
    </Suspense>
  );
}
