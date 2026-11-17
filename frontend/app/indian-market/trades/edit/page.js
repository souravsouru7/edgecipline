"use client";

export const dynamic = "force-dynamic";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { getTrade, updateTrade } from "@/services/tradeApi";
import { MARKETS } from "@/context/MarketContext";
import PageHeader from "@/features/shared/components/PageHeader";
import { ArrowLeft } from "lucide-react";
import { Button, ErrorState, Placeholder } from "@/features/shared/components/ui";
import { useTheme } from "@/utils/theme";
import { useSystemBars } from "@/features/shared/hooks/useSystemBars";
import { useUserProfile } from "@/features/auth/hooks/useUserProfile";
import { invalidateTradeDependentQueries } from "@/utils/queryInvalidation";
import { useToast } from "@/features/shared/components/ui/Toast";
import { reportUserError } from "@/utils/userMessage";
import TradeEvidenceSection from "@/features/trade/components/TradeEvidenceSection";
import { getTodayInputValue, normalizeDateForInput } from "@/features/trade/lib/dateInput";
import {
  appendSetupRule,
  clearSetupRules as clearSetupRulesFollowed,
  normalizeSetupRules,
  setSetupRuleLabel,
  toggleSetupRule as toggleSetupRuleFollowed,
} from "@/features/trade/lib/setupRules";

const C = {
  bull: "var(--lg-green, #0D9E6E)",
  bear: "var(--lg-red, #D63B3B)",
  gold: "var(--lg-gold, #B8860B)",
  blue: "#2563EB",
  purple: "#7C3AED",
  bg: "var(--lg-soft, #F0EEE9)",
  card: "var(--lg-card, #FFFFFF)",
  border: "var(--lg-line, #E2E8F0)",
  muted: "var(--lg-muted, #94A3B8)",
  ink: "var(--lg-ink, #0F1923)",
  ink2: "var(--lg-sub, #334155)",
  mono: "var(--lg-mono, 'JetBrains Mono', monospace)",
  sans: "var(--lg-sans, 'Plus Jakarta Sans', sans-serif)",
};

// "STRIKE PRICE" → "Strike price" (labels were written for the old all-caps style).
const sentenceCase = (text) => {
  const t = String(text || "").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function InputField({ label, name, value, onChange, type = "text", options = null, placeholder = "", required = false, min, max }) {
  const id = `edit-${name}`;
  return (
    <div className="ec-field ec-edit__field">
      <label className="ec-field__label" htmlFor={id}>
        {sentenceCase(label)}{required && <span className="ec-edit__req" aria-hidden="true"> *</span>}
      </label>
      {options ? (
        <select id={id} name={name} value={value || ""} onChange={onChange} className="ec-input">
          {options.map((opt) => (
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
          placeholder={placeholder}
          min={min}
          max={max}
          required={required}
          inputMode={type === "number" ? "decimal" : undefined}
          className="ec-input ec-input--mono"
        />
      )}
    </div>
  );
}

function calculateSetupScore(rules = []) {
  const activeRules = rules.filter((rule) => String(rule.label || "").trim());
  if (!activeRules.length) return null;
  const followedCount = activeRules.filter((rule) => rule.followed).length;
  return Math.round((followedCount / activeRules.length) * 100);
}

function isEquityTrade(trade) {
  const instrumentType = String(trade?.instrumentType || "").toUpperCase();
  if (instrumentType === "EQUITY") return true;
  if (instrumentType === "OPTION") return false;
  return !!trade?.stockSymbol || trade?.sharesQty != null || String(trade?.segment || "").toUpperCase() === "EQUITY";
}

function toOptionalNumber(value) {
  if (value === "" || value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function hasNumber(value) {
  return toOptionalNumber(value) !== undefined;
}

function hasPositiveNumber(value) {
  const n = toOptionalNumber(value);
  return n !== undefined && n > 0;
}

function IndianEditTradeContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const searchParams = useSearchParams();
  const { accountCreatedDate } = useUserProfile();
  const id = searchParams.get("id");
  const [formData, setFormData] = useState(null);
  const evidenceRef = useRef(null);
  const [committingEvidence, setCommittingEvidence] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const { theme } = useTheme();
  useSystemBars(theme);
  const [saving, setSaving] = useState(false);
  const [dateError, setDateError] = useState("");
  const equityTrade = isEquityTrade(formData);

  const fetchTrade = useCallback(async () => {
    if (!id) { setLoadError({ status: 404 }); setLoading(false); return; }
    setLoadError(null);
    setLoading(true);
    try {
      const data = await getTrade(id, MARKETS.INDIAN_MARKET);
      setFormData({
        ...data,
        tradeDate: normalizeDateForInput(data.tradeDate || data.createdAt),
        expiryDate: normalizeDateForInput(data.expiryDate),
        emotionalTags: Array.isArray(data.emotionalTags) ? data.emotionalTags.join(", ") : "",
        setupRules: normalizeSetupRules(data.setupRules),
      });
    } catch (err) {
      setFormData(null);
      setLoadError(err);
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

  const updateSetupRules = (update) =>
    setFormData((prev) => ({ ...prev, setupRules: update(prev.setupRules || []) }));
  const toggleSetupRule = (ruleId) => updateSetupRules((rules) => toggleSetupRuleFollowed(rules, ruleId));
  const updateSetupRuleLabel = (ruleId, value) => updateSetupRules((rules) => setSetupRuleLabel(rules, ruleId, value));
  const addSetupRule = () => updateSetupRules((rules) => appendSetupRule(rules));
  const clearSetupRules = () => updateSetupRules((rules) => clearSetupRulesFollowed(rules));

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
    if (!hasPositiveNumber(formData.entryPrice)) {
      addToast("Entry price is required.", "error");
      return;
    }
    if (!hasPositiveNumber(formData.exitPrice)) {
      addToast("Exit price is required.", "error");
      return;
    }
    if (!hasNumber(formData.profit)) {
      addToast("P&L is required.", "error");
      return;
    }
    if (equityTrade) {
      if (!hasPositiveNumber(formData.sharesQty)) {
        addToast("Shares quantity is required.", "error");
        return;
      }
    } else {
      if (!hasPositiveNumber(formData.quantity)) {
        addToast("Quantity/lots is required.", "error");
        return;
      }
      if (!hasPositiveNumber(formData.lotSize)) {
        addToast("Lot size is required.", "error");
        return;
      }
    }
    if (!formData.riskRewardRatio) {
      addToast("Select a risk : reward ratio.", "error");
      return;
    }
    if (!formData.mood) {
      addToast("Select your mood.", "error");
      return;
    }
    if (!formData.confidence) {
      addToast("Select your confidence level.", "error");
      return;
    }
    const _emotionalTagsArr = String(formData.emotionalTags || "").split(",").map(t => t.trim()).filter(Boolean);
    if (_emotionalTagsArr.length === 0) {
      addToast("Add at least one emotional tag.", "error");
      return;
    }
    if (!formData.tradeQuality) {
      addToast("Select trade quality.", "error");
      return;
    }

    setSaving(true);
    try {
      // Upload pending evidence images first
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

      const activeSetupRules = (formData.setupRules || [])
        .map((rule) => ({
          label: String(rule.label || "").trim(),
          followed: Boolean(rule.followed),
        }))
        .filter((rule) => rule.label);
      const isEquity = isEquityTrade(formData);
      const stockSymbol = String(formData.stockSymbol || formData.pair || "").trim().toUpperCase();
      const derivedPair = isEquity
        ? stockSymbol
        : formData.underlying && formData.strikePrice && formData.optionType
        ? `${String(formData.underlying).trim()} ${String(formData.strikePrice).trim()} ${String(formData.optionType).trim()}`
        : formData.pair;

      await updateTrade(
        id,
        {
          ...formData,
          tradeImages,
          pair: derivedPair,
          stockSymbol: isEquity ? stockSymbol : formData.stockSymbol,
          exchange: isEquity ? (formData.exchange || "NSE") : formData.exchange,
          sharesQty: isEquity ? toOptionalNumber(formData.sharesQty) : toOptionalNumber(formData.sharesQty),
          instrumentType: isEquity ? "EQUITY" : "OPTION",
          segment: isEquity ? "EQUITY" : "F&O",
          quantity: isEquity ? undefined : toOptionalNumber(formData.quantity),
          lotSize: isEquity ? undefined : toOptionalNumber(formData.lotSize),
          strikePrice: isEquity ? undefined : toOptionalNumber(formData.strikePrice),
          optionType: isEquity ? undefined : formData.optionType,
          expiryDate: isEquity ? undefined : formData.expiryDate,
          entryPrice: toOptionalNumber(formData.entryPrice),
          exitPrice: toOptionalNumber(formData.exitPrice),
          stopLoss: toOptionalNumber(formData.stopLoss),
          takeProfit: toOptionalNumber(formData.takeProfit),
          profit: toOptionalNumber(formData.profit),
          brokerage: toOptionalNumber(formData.brokerage),
          sttTaxes: toOptionalNumber(formData.sttTaxes),
          mood: toOptionalNumber(formData.mood),
          emotionalTags: String(formData.emotionalTags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
          tradeQuality: formData.tradeQuality || "",
          setupRules: activeSetupRules,
          setupScore: calculateSetupScore(activeSetupRules),
        },
        MARKETS.INDIAN_MARKET
      );
      invalidateTradeDependentQueries(queryClient);
      router.push(`/indian-market/trades/view?id=${id}`);
    } catch (err) {
      addToast(
        reportUserError("trade_update_failed", err, "We couldn't save your changes. Please try again."),
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  const backHref = id ? `/indian-market/trades/view?id=${id}` : "/indian-market/trades";
  const frame = (content) => (
    <div className="ec-app ec-home">
      <PageHeader themed showMarketSwitcher={false} title="Edit trade" />
      <main className="ec-page ec-edit">
        <Link href={backHref} className="ec-psy__back ec-focusable">
          <ArrowLeft size={16} aria-hidden="true" /> Back to trade
        </Link>
        {content}
      </main>
    </div>
  );

  if (loading) {
    return frame(
      <div style={{ display: "grid", gap: 12 }} aria-busy="true">
        <Placeholder height={40} width={220} radius={8} />
        <Placeholder height={520} radius={16} />
      </div>
    );
  }

  if (!formData) {
    const missing = loadError?.status === 404;
    return frame(
      <ErrorState
        title={missing ? "Trade not found" : "Couldn't load this trade"}
        body={missing ? "It may have been deleted." : "Check your connection and try again."}
        onRetry={missing ? undefined : fetchTrade}
      />
    );
  }

  return frame(
    <>
        <div className="ec-edit__head">
          <h1 className="ec-edit__title">Edit {equityTrade ? "stock trade" : "options trade"}</h1>
          <p className="ec-edit__sub">{formData.pair || formData.stockSymbol || "Indian market"} · changes update your journal and analytics</p>
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 12px rgba(15,25,35,0.06)" }}>
          <div style={{ height: 3, background: `linear-gradient(90deg, ${C.bull}, ${C.gold})` }} />

          <form onSubmit={handleSubmit} style={{ padding: "24px 20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
              {equityTrade ? (
                <InputField label="STOCK SYMBOL" name="stockSymbol" value={formData.stockSymbol || formData.pair} onChange={handleChange} required />
              ) : (
                <InputField label="UNDERLYING / SYMBOL" name="underlying" value={formData.underlying} onChange={handleChange} />
              )}
              <div>
                <InputField label="TRADE DATE" name="tradeDate" type="date" value={formData.tradeDate} onChange={handleChange} required min={accountCreatedDate || undefined} max={getTodayInputValue()} />
                {dateError ? (
                  <div style={{ fontSize: 11, color: "var(--lg-red, #D63B3B)", marginTop: -10, marginBottom: 8, fontFamily: C.mono }}>
                    {dateError}
                  </div>
                ) : accountCreatedDate ? (
                  <div style={{ fontSize: "var(--fs-2xs)", color: C.muted, marginTop: -10, marginBottom: 8, fontFamily: C.mono }}>
                    Earliest: {accountCreatedDate}
                  </div>
                ) : null}
              </div>
            </div>

            {equityTrade ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
                  <InputField label="TYPE" name="type" value={formData.type} onChange={handleChange} options={[{ value: "BUY", label: "BUY" }, { value: "SELL", label: "SELL" }]} />
                  <InputField label="EXCHANGE" name="exchange" value={formData.exchange || "NSE"} onChange={handleChange} options={[{ value: "NSE", label: "NSE" }, { value: "BSE", label: "BSE" }]} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
                  <InputField label="SHARES QTY" name="sharesQty" type="number" value={formData.sharesQty} onChange={handleChange} />
                  <InputField label="PROFIT / LOSS" name="profit" type="number" value={formData.profit} onChange={handleChange} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
                  <InputField label="AVG BUY PRICE" name="entryPrice" type="number" value={formData.entryPrice} onChange={handleChange} />
                  <InputField label="AVG SELL PRICE" name="exitPrice" type="number" value={formData.exitPrice} onChange={handleChange} />
                </div>

                <InputField label="SECTOR" name="sector" value={formData.sector} onChange={handleChange} />
              </>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
                  <InputField label="TYPE" name="type" value={formData.type} onChange={handleChange} options={[{ value: "BUY", label: "BUY" }, { value: "SELL", label: "SELL" }]} />
                  <InputField label="OPTION TYPE" name="optionType" value={formData.optionType} onChange={handleChange} options={[{ value: "CE", label: "CE" }, { value: "PE", label: "PE" }]} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
                  <InputField label="STRIKE PRICE" name="strikePrice" type="number" value={formData.strikePrice} onChange={handleChange} />
                  <InputField label="LOT SIZE" name="lotSize" type="number" value={formData.lotSize} onChange={handleChange} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
                  <InputField label="QUANTITY (LOTS)" name="quantity" type="number" value={formData.quantity} onChange={handleChange} />
                  <InputField label="PROFIT / LOSS" name="profit" type="number" value={formData.profit} onChange={handleChange} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
                  <InputField label="ENTRY PRICE (PREMIUM)" name="entryPrice" type="number" value={formData.entryPrice} onChange={handleChange} />
                  <InputField label="EXIT PRICE (PREMIUM)" name="exitPrice" type="number" value={formData.exitPrice} onChange={handleChange} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
                  <InputField label="STOP LOSS" name="stopLoss" type="number" value={formData.stopLoss} onChange={handleChange} />
                  <InputField label="TAKE PROFIT" name="takeProfit" type="number" value={formData.takeProfit} onChange={handleChange} />
                </div>
              </>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
              <InputField label="TRADE TYPE" name="tradeType" value={formData.tradeType} onChange={handleChange} options={[{ value: "INTRADAY", label: "INTRADAY" }, { value: "DELIVERY", label: "DELIVERY" }, { value: "SWING", label: "SWING" }]} />
              <InputField label="ENTRY BASIS" name="entryBasis" value={formData.entryBasis} onChange={handleChange} options={[{ value: "Plan", label: "Plan" }, { value: "Emotion", label: "Emotion" }, { value: "Impulsive", label: "Impulsive" }, { value: "Custom", label: "Custom" }, { value: "", label: "None" }]} />
            </div>

            {!equityTrade && (
              <InputField label="EXPIRY DATE" name="expiryDate" type="date" value={formData.expiryDate} onChange={handleChange} />
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
              <InputField label="ENTRY BASIS CUSTOM" name="entryBasisCustom" value={formData.entryBasisCustom} onChange={handleChange} />
              <InputField label="TRADING SETUP" name="strategy" value={formData.strategy} onChange={handleChange} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
              <InputField label="RISK : REWARD" name="riskRewardRatio" value={formData.riskRewardRatio} onChange={handleChange} options={[{ value: "", label: "Select…" }, { value: "1:1", label: "1:1" }, { value: "1:2", label: "1:2" }, { value: "1:3", label: "1:3" }, { value: "1:4", label: "1:4" }, { value: "1:5", label: "1:5" }, { value: "custom", label: "Custom" }]} required />
              <InputField label="CUSTOM R:R" name="riskRewardCustom" value={formData.riskRewardCustom} onChange={handleChange} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
              <InputField label="BROKERAGE" name="brokerage" type="number" value={formData.brokerage} onChange={handleChange} />
              <InputField label="STT / TAXES" name="sttTaxes" type="number" value={formData.sttTaxes} onChange={handleChange} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
              <InputField label="SETUP NAME" name="setup" value={formData.setup} onChange={handleChange} />
              <InputField label="MISTAKE TAG" name="mistakeTag" value={formData.mistakeTag} onChange={handleChange} />
            </div>

            {/* ── Psychology Section ── */}
            <div style={{ marginBottom: 18, border: `1px solid color-mix(in srgb, ${C.purple} 19%, transparent)`, borderRadius: 12, overflow: "hidden", background: `color-mix(in srgb, ${C.purple} 2%, transparent)` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: `1px solid color-mix(in srgb, ${C.purple} 13%, transparent)`, background: `color-mix(in srgb, ${C.purple} 3%, transparent)` }}>
                <span style={{ fontSize: 15 }}>🧠</span>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: C.purple, fontFamily: C.mono }}>PSYCHOLOGY</span>
                <span style={{ fontSize: "var(--fs-2xs)", color: "var(--lg-red, #D63B3B)", fontWeight: 700, fontFamily: C.mono, letterSpacing: "0.08em", background: "#FFF0F0", padding: "2px 6px", borderRadius: 4 }}>REQUIRED</span>
              </div>

              <div style={{ padding: "16px" }}>
                {/* Mood */}
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: "var(--fs-2xs)", letterSpacing: "0.14em", color: "var(--lg-sub, #4A5568)", marginBottom: 10, fontFamily: C.mono, fontWeight: 600 }}>
                    MOOD <span style={{ color: "var(--lg-red, #D63B3B)" }}>*</span>
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
                              background: current === i ? `color-mix(in srgb, ${moodColors[i]} 7%, transparent)` : "var(--lg-card, #FFF)",
                              flex: 1, minWidth: 56, transition: "all 0.15s",
                            }}
                          >
                            <div style={{ display: "flex", gap: 2 }}>
                              {[1, 2, 3, 4, 5].map(bar => (
                                <div key={bar} style={{ width: 4, height: bar <= i ? 14 : 6, borderRadius: 2, background: bar <= i ? moodColors[i] : C.border, transition: "all 0.15s" }} />
                              ))}
                            </div>
                            <span style={{ fontSize: "var(--fs-2xs)", fontWeight: 700, color: current === i ? moodColors[i] : C.muted, fontFamily: C.mono }}>{i}</span>
                            <span style={{ fontSize: "var(--fs-2xs)", color: current === i ? moodColors[i] : C.muted, textAlign: "center", lineHeight: 1.2 }}>{moodLabels[i]}</span>
                          </button>
                        ))}
                        {current > 0 && (
                          <button
                            type="button"
                            onClick={() => setFormData(p => ({ ...p, mood: "" }))}
                            style={{ padding: "10px 10px", borderRadius: 10, cursor: "pointer", border: `1px solid ${C.border}`, background: "var(--lg-card, #FFF)", color: C.muted, fontSize: 11, alignSelf: "stretch" }}
                          >✕</button>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Confidence */}
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: "var(--fs-2xs)", letterSpacing: "0.14em", color: "var(--lg-sub, #4A5568)", marginBottom: 10, fontFamily: C.mono, fontWeight: 600 }}>CONFIDENCE <span style={{ color: "var(--lg-red, #D63B3B)" }}>*</span></div>
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
                            background: active ? `color-mix(in srgb, ${color} 7%, transparent)` : "var(--lg-card, #FFF)",
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
                  <div style={{ fontSize: "var(--fs-2xs)", letterSpacing: "0.14em", color: "var(--lg-sub, #4A5568)", marginBottom: 10, fontFamily: C.mono, fontWeight: 600 }}>WOULD RETAKE?</div>
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
                            background: active ? `color-mix(in srgb, ${color} 7%, transparent)` : "var(--lg-card, #FFF)",
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

                {/* Trade Quality */}
                <div>
                  <div style={{ fontSize: "var(--fs-2xs)", letterSpacing: "0.14em", color: "var(--lg-sub, #4A5568)", marginBottom: 8, fontFamily: C.mono, fontWeight: 600 }}>TRADE QUALITY (EXECUTION)</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8 }}>
                    {[
                      { val: "Great", color: C.bull },
                      { val: "Average", color: "var(--lg-gold, #F59E0B)" },
                      { val: "Poor", color: C.bear },
                    ].map(q => (
                      <button key={q.val} type="button"
                        onClick={() => setFormData(p => ({ ...p, tradeQuality: p.tradeQuality === q.val ? "" : q.val }))}
                        style={{
                          padding: "10px 4px", borderRadius: 8, cursor: "pointer", textAlign: "center",
                          border: formData.tradeQuality === q.val ? `1.5px solid ${q.color}` : `1px solid ${C.border}`,
                          background: formData.tradeQuality === q.val ? `color-mix(in srgb, ${q.color} 8%, transparent)` : "var(--lg-card, #FFF)",
                          transition: "all 0.15s",
                        }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: formData.tradeQuality === q.val ? q.color : C.ink, fontFamily: C.mono }}>{q.val}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Emotional Tags */}
                <div>
                  <div style={{ fontSize: "var(--fs-2xs)", letterSpacing: "0.14em", color: "var(--lg-sub, #4A5568)", marginBottom: 10, fontFamily: C.mono, fontWeight: 600 }}>EMOTIONAL TAGS <span style={{ color: "var(--lg-red, #D63B3B)" }}>*</span></div>
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
                            background: active ? `color-mix(in srgb, ${color} 7%, transparent)` : "var(--lg-card, #FFF)",
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
                    style={{ width: "100%", boxSizing: "border-box", background: "var(--lg-card, #FFF)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", color: C.ink, fontSize: 12, fontFamily: C.sans, outline: "none" }}
                  />
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 18, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, background: "var(--lg-soft, #FCFBF8)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: "var(--fs-2xs)", letterSpacing: "0.14em", color: "var(--lg-sub, #4A5568)", fontFamily: C.mono, fontWeight: 600 }}>
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
                  <button type="button" onClick={clearSetupRules} style={{ border: `1px solid ${C.border}`, background: "var(--lg-card, #FFF)", color: C.ink2, borderRadius: 8, padding: "8px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    Clear Checks
                  </button>
                  <button type="button" onClick={addSetupRule} style={{ border: "none", background: `color-mix(in srgb, ${C.bull} 8%, transparent)`, color: C.bull, borderRadius: 8, padding: "8px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
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
                      style={{ width: "100%", boxSizing: "border-box", background: "var(--lg-card, #FFF)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", color: C.ink, fontSize: 12, fontFamily: C.sans, outline: "none" }}
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
              <TradeEvidenceSection
                ref={evidenceRef}
                value={formData.tradeImages || []}
                onChange={imgs => setFormData(prev => ({ ...prev, tradeImages: imgs }))}
                disabled={saving || committingEvidence}
                accentColor="#0D9E6E"
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: "var(--fs-2xs)", letterSpacing: "0.14em", color: "var(--lg-sub, #4A5568)", marginBottom: 8, fontFamily: C.mono, fontWeight: 600 }}>
                NOTES
              </label>
              <textarea
                name="notes"
                value={formData.notes || ""}
                onChange={handleChange}
                rows={3}
                style={{ width: "100%", boxSizing: "border-box", background: "var(--lg-soft, #F8F6F2)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", color: C.ink, fontSize: 13, fontFamily: C.sans, outline: "none", resize: "vertical" }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: "var(--fs-2xs)", letterSpacing: "0.14em", color: "var(--lg-sub, #4A5568)", marginBottom: 8, fontFamily: C.mono, fontWeight: 600 }}>
                LESSON LEARNED
              </label>
              <textarea
                name="lesson"
                value={formData.lesson || ""}
                onChange={handleChange}
                rows={3}
                style={{ width: "100%", boxSizing: "border-box", background: "var(--lg-soft, #F8F6F2)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", color: C.ink, fontSize: 13, fontFamily: C.sans, outline: "none", resize: "vertical" }}
              />
            </div>

            <div className="ec-edit__actions">
              <Button as={Link} href={backHref} variant="secondary">Cancel</Button>
              <Button type="submit" loading={saving}>{committingEvidence ? "Uploading images…" : saving ? "Saving…" : "Save changes"}</Button>
            </div>
          </form>
        </div>
    </>
  );
}

export default function IndianEditTradePage() {
  return (
    <Suspense fallback={null}>
      <IndianEditTradeContent />
    </Suspense>
  );
}
