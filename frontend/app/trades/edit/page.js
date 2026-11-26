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
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button, ErrorState, Placeholder, useToast } from "@/features/shared/components/ui";
import { reportUserError } from "@/utils/userMessage";
import { useTheme } from "@/utils/theme";
import { useSystemBars } from "@/features/shared/hooks/useSystemBars";
import { getTodayInputValue, normalizeDateForInput } from "@/features/trade/lib/dateInput";
import { parseNumericField, sanitizeNumericField } from "@/features/trade/lib/numericInput";
import { focusTradeField, riskRewardPayload, validateTradeRules } from "@/features/trade/lib/tradeValidation";
import {
  appendSetupRule,
  clearSetupRules as clearSetupRulesFollowed,
  normalizeSetupRules,
  setSetupRuleLabel,
  toggleSetupRule as toggleSetupRuleFollowed,
} from "@/features/trade/lib/setupRules";

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
   INPUT FIELD
───────────────────────────────────────── */
// "LOT SIZE" → "Lot size" (labels were written for the old all-caps style).
const sentenceCase = (text) => {
  const t = String(text || "").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function InputField({ label, name, value, onChange, type = "text", options = null, required = false, min, max }) {
  const id = `edit-${name}`;
  return (
    <div className="ec-field ec-edit__field">
      <label className="ec-field__label" htmlFor={id}>
        {sentenceCase(label)}{required && <span className="ec-edit__req" aria-hidden="true"> *</span>}
      </label>
      {options ? (
        <select id={id} name={name} value={value || ""} onChange={onChange} className="ec-input">
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={type}
          name={name}
          value={value ?? ""}
          onChange={onChange}
          min={min}
          max={max}
          required={required}
          inputMode={["lotSize", "entryPrice", "exitPrice", "stopLoss", "takeProfit", "profit"].includes(name) ? "decimal" : undefined}
          className="ec-input ec-input--mono"
        />
      )}
    </div>
  );
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
  // A failed load used to leave the spinner up forever.
  const [loadError, setLoadError] = useState(null);
  const { addToast } = useToast();
  const { theme } = useTheme();
  useSystemBars(theme);
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
    if (!resolvedParams?.id) { setLoadError({ status: 404 }); setLoading(false); return; }
    setLoadError(null);
    setLoading(true);
    try {
      const data = await getTrade(resolvedParams.id);
      setTrade(data);
      setFormData({
        ...data,
        tradeDate: normalizeDateForInput(data.tradeDate || data.createdAt),
        strategyCustom: "",
      });
      setSetupRules(normalizeSetupRules(data.setupRules));
    } catch (err) {
      setLoadError(err);
    } finally {
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
    // Number boxes drop letters as they're typed or pasted.
    setFormData({ ...formData, [name]: sanitizeNumericField(name, value) });
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

  const toggleSetupRule = (id) => setSetupRules((prev) => toggleSetupRuleFollowed(prev, id));
  const updateSetupRuleLabel = (id, value) => setSetupRules((prev) => setSetupRuleLabel(prev, id, value));
  const addSetupRule = () => setSetupRules((prev) => appendSetupRule(prev));
  const clearSetupRules = () => setSetupRules((prev) => clearSetupRulesFollowed(prev));

  const toggleEmotionalTag = (tag) => {
    setFormData((prev) => {
      const current = Array.isArray(prev.emotionalTags) ? prev.emotionalTags : [];
      const next = current.includes(tag)
        ? current.filter((item) => item !== tag)
        : [...current, tag].slice(0, 10);
      return { ...prev, emotionalTags: next };
    });
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
    if (!String(formData.pair || "").trim()) {
      addToast("Please enter a pair.", "info");
      focusTradeField("pair");
      return;
    }
    // Rules shared by every trade form (R:R format, take-profit side, custom
    // entry basis, number sanity). The stored P&L is kept for instruments the
    // server can't price, so that check doesn't apply on edit.
    const ruleProblem = validateTradeRules(formData, { market: "Forex", hasTrustedPnl: true });
    if (ruleProblem) {
      addToast(ruleProblem.message, "info");
      focusTradeField(ruleProblem.field);
      return;
    }
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
        // Legacy trades store riskRewardRatio as null; send "" instead, and
        // custom text only when "custom" is the selected ratio.
        ...riskRewardPayload(formData.riskRewardRatio || "", formData.riskRewardCustom),
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
    } catch (err) {
      addToast(reportUserError("trade_update_failed", err, "We couldn't save your changes. Please try again."), "error");
    } finally {
      setSaving(false);
    }
  };

  const typeOptions = [
    { value: "BUY",  label: "LONG (BUY)"  },
    { value: "SELL", label: "SHORT (SELL)" },
  ];

  return (
    <div className="ec-app ec-home">
      <PageHeader themed showMarketSwitcher={false} title="Edit trade" />
      <main className="ec-page ec-edit">
        <Link href={resolvedParams?.id ? `/trades/view?id=${resolvedParams.id}` : "/trades"} className="ec-psy__back ec-focusable">
          <ArrowLeft size={16} aria-hidden="true" /> Back to trade
        </Link>
        {loadError ? (
          <ErrorState
            title={loadError.status === 404 ? "Trade not found" : "Couldn't load this trade"}
            body={loadError.status === 404 ? "It may have been deleted." : "Check your connection and try again."}
            onRetry={loadError.status === 404 ? undefined : fetchTrade}
          />
        ) : loading ? (
          <div style={{ display: "grid", gap: 12 }} aria-busy="true">
            <Placeholder height={40} width={220} radius={8} />
            <Placeholder height={520} radius={16} />
          </div>        ) : (
          <>
            <div className="ec-edit__head">
              <h1 className="ec-edit__title">Edit trade</h1>
              <p className="ec-edit__sub">{formData.pair || "Forex"} · changes update your journal and analytics</p>
            </div>

            {/* Form card */}
            <div style={{
              background: "var(--lg-card, #FFFFFF)",
              border: "1px solid var(--lg-line, #E2E8F0)",
              borderRadius: 14,
              overflow: "hidden",
              boxShadow: "0 2px 12px rgba(15,25,35,0.06)",
            }}>
              {/* Top accent */}
              <div style={{ height: 3, background: "linear-gradient(90deg,var(--lg-green, #0D9E6E) 0%,transparent 45%,transparent 55%,var(--lg-red, #D63B3B) 100%)" }}/>

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
                  <div style={{ fontSize: 11, color: "var(--lg-red, #D63B3B)", marginTop: -10, marginBottom: 16, fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)" }}>
                    {dateError}
                  </div>
                )}
                {!dateError && accountCreatedDate && (
                  <div style={{ fontSize: "var(--fs-2xs)", color: "var(--lg-muted, #94A3B8)", marginTop: -10, marginBottom: 16, fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)" }}>
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
                  <div style={{ padding: "11px 14px", borderBottom: "1px solid rgba(13,158,110,0.14)", color: "var(--lg-green, #0D9E6E)", fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)" }}>
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
                  <div style={{ padding: "11px 14px", borderBottom: "1px solid rgba(124,58,237,0.14)", color: "#7C3AED", fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)" }}>
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
                      <label style={{ display: "block", fontSize: "var(--fs-2xs)", letterSpacing: "0.14em", color: "var(--lg-sub, #4A5568)", marginBottom: 8, fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)", fontWeight: 500 }}>
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
                              style={{ minHeight: 62, padding: "8px 4px", borderRadius: 8, border: active ? "2px solid #7C3AED" : "1px solid var(--lg-line, #E2E8F0)", background: active ? "rgba(124,58,237,0.1)" : "var(--lg-card, #FFFFFF)", color: active ? "#7C3AED" : "var(--lg-sub, #64748B)", cursor: "pointer", fontSize: "var(--fs-2xs)", fontWeight: 800 }}
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
                      <label style={{ display: "block", fontSize: "var(--fs-2xs)", letterSpacing: "0.14em", color: "var(--lg-sub, #4A5568)", marginBottom: 8, fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)", fontWeight: 500 }}>
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
                              style={{ padding: "7px 12px", borderRadius: 999, border: selected ? "2px solid #7C3AED" : "1px solid var(--lg-line, #E2E8F0)", background: selected ? "rgba(124,58,237,0.1)" : "var(--lg-card, #FFFFFF)", color: selected ? "#7C3AED" : "var(--lg-sub, #64748B)", cursor: "pointer", fontSize: 11, fontWeight: 800 }}
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
                      <label style={{ display: "block", fontSize: "var(--fs-2xs)", letterSpacing: "0.14em", color: "var(--lg-sub, #4A5568)", marginBottom: 8, fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)", fontWeight: 500 }}>
                        TRADE QUALITY (EXECUTION)
                      </label>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8 }}>
                        {[
                          { val: "Great", color: "var(--lg-green, #0D9E6E)", desc: "Followed plan" },
                          { val: "Average", color: "var(--lg-gold, #F59E0B)", desc: "Partial exec." },
                          { val: "Poor", color: "var(--lg-red, #D63B3B)", desc: "Broke rules" },
                        ].map(q => (
                          <button key={q.val} type="button"
                            onClick={() => setFormData(prev => ({ ...prev, tradeQuality: prev.tradeQuality === q.val ? "" : q.val }))}
                            style={{
                              padding: "10px 4px", borderRadius: 8, cursor: "pointer", textAlign: "center",
                              border: formData.tradeQuality === q.val ? `2px solid ${q.color}` : "1px solid var(--lg-line, #E2E8F0)",
                              background: formData.tradeQuality === q.val ? `color-mix(in srgb, ${q.color} 8%, transparent)` : "var(--lg-soft, #F8F6F2)",
                              transition: "all 0.2s",
                            }}>
                            <div style={{ fontSize: 11, fontWeight: 800, color: formData.tradeQuality === q.val ? q.color : "var(--lg-ink, #0F1923)", fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)" }}>{q.val}</div>
                            <div style={{ fontSize: "var(--fs-2xs)", color: "var(--lg-muted, #94A3B8)", marginTop: 2 }}>{q.desc}</div>
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
                    fontSize: "var(--fs-2xs)",
                    letterSpacing: "0.14em",
                    color: "var(--lg-sub, #4A5568)",
                    marginBottom: 8,
                    fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)",
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
                      background: "var(--lg-soft, #F8F6F2)",
                      border: "1px solid var(--lg-line, #E2E8F0)",
                      borderRadius: 8,
                      padding: "12px 14px",
                      color: "var(--lg-ink, #0F1923)",
                      fontSize: 12,
                      fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)",
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
                    fontSize: "var(--fs-2xs)",
                    letterSpacing: "0.14em",
                    color: "var(--lg-sub, #4A5568)",
                    marginBottom: 8,
                    fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)",
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
                      background: "var(--lg-soft, #F8F6F2)",
                      border: "1px solid var(--lg-line, #E2E8F0)",
                      borderRadius: 8,
                      padding: "12px 14px",
                      color: "var(--lg-ink, #0F1923)",
                      fontSize: 12,
                      fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)",
                      outline: "none",
                    }}
                  />
                  {screenshotUploading && (
                    <div style={{ fontSize: 11, color: "var(--lg-sub, #4A5568)", marginTop: 8, fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)" }}>
                      Uploading screenshot...
                    </div>
                  )}
                  {screenshotError && (
                    <div style={{ fontSize: 11, color: "var(--lg-red, #D63B3B)", marginTop: 8, lineHeight: 1.5, fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)" }}>
                      {screenshotError}
                    </div>
                  )}
                  {(formData.screenshot || formData.screenshotPreview) && (
                    <div style={{ marginTop: 10 }}>
                      {formData.screenshotPreview ? (
                        <img 
                          src={formData.screenshotPreview} 
                          alt="Screenshot preview" 
                          style={{ maxHeight: 150, borderRadius: 8, border: "1px solid var(--lg-line, #E2E8F0)" }}
                        />
                      ) : formData.screenshot ? (
                        <img 
                          src={formData.screenshot}
                          alt="Current screenshot"
                          style={{ maxHeight: 150, borderRadius: 8, border: "1px solid var(--lg-line, #E2E8F0)" }}
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
                    fontSize: "var(--fs-2xs)",
                    letterSpacing: "0.14em",
                    color: "var(--lg-sub, #4A5568)",
                    marginBottom: 8,
                    fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)",
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
                      background: "var(--lg-soft, #F8F6F2)",
                      border: "1px solid var(--lg-line, #E2E8F0)",
                      borderRadius: 8,
                      padding: "12px 14px",
                      color: "var(--lg-ink, #0F1923)",
                      fontSize: 12,
                      fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)",
                      outline: "none",
                      resize: "vertical",
                    }}
                  />
                  <div style={{ fontSize: "var(--fs-2xs)", color: "var(--lg-muted, #94A3B8)", textAlign: "right", marginTop: 4, fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)" }}>
                    {(formData.notes || "").length}/2000
                  </div>
                </div>

                {/* Buttons */}
                <div className="ec-edit__actions">
                  <Button variant="secondary" onClick={() => router.push(`/trades/view?id=${resolvedParams.id}`)} disabled={saving}>
                    Cancel
                  </Button>
                  <Button type="submit" loading={saving} disabled={screenshotUploading}>
                    {committingEvidence ? "Uploading images…" : saving ? "Saving…" : screenshotUploading ? "Uploading…" : "Save changes"}
                  </Button>
                </div>
              </form>
            </div>
          </>
        )}
      </main>

      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>
    </div>
  );
}

export default function EditTradePage() {
  return (
    <React.Suspense fallback={null}>
      <EditTradePageContent />
    </React.Suspense>
  );
}
