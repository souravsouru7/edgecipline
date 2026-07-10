"use client";

import { useState, useEffect, useRef, useMemo, Suspense } from "react";
// useEffect + useRef used in UploadTradeContent for auto-scroll to psychology after extraction
import { useRouter, useSearchParams } from "next/navigation";
import ErrorBoundary from "@/components/ErrorBoundary";
import Link from "next/link";
import CandlestickBackground from "@/features/shared/components/CandlestickBackground";
import TickerTape            from "@/features/shared/components/TickerTape";
import PageHeader            from "@/features/shared/components/PageHeader";
import { useClock }          from "@/features/shared/hooks/useClock";
import FileUploadZone        from "@/features/trade/components/FileUploadZone";
import SetupChecklist        from "@/features/trade/components/SetupChecklist";
import SectionCard           from "@/features/trade/components/SectionCard";
import { FormInput }         from "@/features/trade/components/FormInput";
import { FormSelect }        from "@/features/trade/components/FormSelect";
import { useUploadTrade }    from "@/features/trade/hooks/useUploadTrade";
import { useUserProfile }   from "@/features/auth/hooks/useUserProfile";
import OcrConfirmationBanner from "@/features/issues/OcrConfirmationBanner";

// ── shared form constants ─────────────────────────────────────────────────────
const ENTRY_BASIS  = ["Plan", "Impulsive", "Emotion", "Custom"];
const MOODS        = [
  { v: 1, e: "😤", label: "Stressed"   },
  { v: 2, e: "😟", label: "Anxious"    },
  { v: 3, e: "😐", label: "Neutral"    },
  { v: 4, e: "🙂", label: "Confident"  },
  { v: 5, e: "😄", label: "Peak"       },
];
const EMOTIONS = [
  { tag: "FOMO",         emoji: "😱" },
  { tag: "Revenge",      emoji: "😤" },
  { tag: "Fear",         emoji: "😨" },
  { tag: "Greed",        emoji: "🤑" },
  { tag: "Calm",         emoji: "😌" },
  { tag: "Bored",        emoji: "😑" },
  { tag: "Focused",      emoji: "🎯" },
  { tag: "Frustrated",   emoji: "😠" },
  { tag: "Disciplined",  emoji: "💪" },
  { tag: "Rushed",       emoji: "⚡" },
];
const MISTAKE_TAGS = ["Early Entry", "Late Entry", "No SL", "Sized Too Big", "Chased Price", "Broke Rules", "Overleveraged", "News Trade"];
const CONFIDENCE_OPTS = ["Low", "Medium", "High", "Overconfident"].map(v => ({ value: v, label: v }));
const BROKER_OPTIONS   = [
  { value: "AUTO", label: "Select broker..." },
  { value: "Zerodha",     label: "Zerodha (Kite)"   },
  { value: "Upstox",      label: "Upstox"            },
  { value: "Angel One",   label: "Angel One"         },
  { value: "Groww",       label: "Groww"             },
  { value: "Dhan",        label: "Dhan"              },
  { value: "Fyers",       label: "Fyers"             },
  { value: "5paisa",      label: "5paisa"            },
  { value: "ICICI Direct",label: "ICICI Direct"      },
  { value: "Kotak",       label: "Kotak Securities"  },
  { value: "Paytm Money", label: "Paytm Money"       },
];

const monoStyle = { fontFamily: "'JetBrains Mono',monospace" };
const labelSt   = { display: "block", fontSize: 10, fontWeight: 600, color: "#4A5568", letterSpacing: "0.1em", marginBottom: 7, ...monoStyle };
// grid2 inline style — pair with className="form-2col" for mobile collapse
const grid2     = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 };

// ── upload / status card ─────────────────────────────────────────────────────

function UploadCard({ state, accountCreatedDate, todayInputMax }) {
  const { file, setFile, setError, loading, processingStatus, error, isInd, broker, setBroker, handleUpload, trade, tradeSubType, setTradeSubType, preExtractDate, handlePreExtractDateChange } = state;
  const isEquityMode = isInd && tradeSubType === "EQUITY";
  const [showSample, setShowSample] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const confirmImageUrl = useMemo(
    () => (showConfirmModal && file ? URL.createObjectURL(file) : ""),
    [showConfirmModal, file]
  );
  const normalizedError = String(error || "").toLowerCase();
  const isSubscriptionError =
    normalizedError.includes("subscription required") ||
    normalizedError.includes("used your free upload") ||
    normalizedError.includes("please subscribe");
  const isWrongScreenshotError =
    normalizedError.includes("doesn't look like a trade screenshot") ||
    normalizedError.includes("does not appear to be a trade screenshot") ||
    normalizedError.includes("not a valid trade screenshot") ||
    normalizedError.includes("could not extract any trade") ||
    normalizedError.includes("upload a screenshot from your broker");

  useEffect(() => {
    if (!confirmImageUrl) return;
    return () => {
      URL.revokeObjectURL(confirmImageUrl);
    };
  }, [confirmImageUrl]);

  const steps = [
    { label: "Upload",  done: !!file   },
    { label: "Extract", done: !!trade  },
    { label: "Save",    done: state.saved },
  ];

  return (
    <SectionCard
      accentColor={isInd ? "#1B5E20" : "#B8860B"}
      title="Upload Screenshot"
      subtitle={isEquityMode ? "DROP YOUR STOCK TRADE SCREENSHOT" : isInd ? "DROP YOUR OPTIONS TRADE SCREENSHOT" : "AI-POWERED SCREENSHOT EXTRACTION"}
      delay={0.05}
    >
      {/* Step indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 18 }}>
        {steps.map((s, i) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {i > 0 && <div style={{ width: 22, height: 2, background: steps[i].done ? "#0D9E6E" : "#E2E8F0", borderRadius: 2 }} />}
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: s.done ? "#0D9E6E" : "#FFFFFF", border: `1.5px solid ${s.done ? "#0D9E6E" : "#E2E8F0"}`, transition: "all 0.3s" }}>
                {s.done ? (<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>)
                  : <span style={{ fontSize: 9, color: "#94A3B8", ...monoStyle, fontWeight: 700 }}>{i + 1}</span>}
              </div>
              <span style={{ fontSize: 10, fontWeight: 600, color: s.done ? "#0D9E6E" : "#94A3B8" }}>{s.label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Options / Stocks toggle — Indian market only */}
      {isInd && (
        <div style={{ display: "flex", gap: 0, marginBottom: 14, borderRadius: 8, overflow: "hidden", border: "1.5px solid #E2E8F0" }}>
          {[{ v: "OPTION", label: "Options" }, { v: "EQUITY", label: "Intraday Stocks" }].map(({ v, label }) => {
            const active = tradeSubType === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => { setTradeSubType(v); setFile(null); setError(null); }}
                style={{ flex: 1, padding: "9px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer", border: "none", background: active ? "#1B5E20" : "#FFFFFF", color: active ? "#FFFFFF" : "#64748B", transition: "all 0.2s", fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.06em" }}
              >
                {label.toUpperCase()}
              </button>
            );
          })}
        </div>
      )}

      <FileUploadZone selectedFile={file} onFileSelect={f => { setFile(f); setError(null); }} onClear={() => { setFile(null); setError(null); }} />

      {/* Upload confirmation */}
      {file && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            background: "#ECFDF5",
            border: "1px solid #A7F3D0",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0D9E6E" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span style={{ fontSize: 11, color: "#065F46", fontWeight: 700 }}>
            You uploaded the correct {isEquityMode ? "intraday stock" : isInd ? "Indian options" : "Forex"} image.
          </span>
        </div>
      )}

      {/* Broker picker (Indian only) */}
      {isInd && (
        <div style={{ marginTop: 14 }}>
          <FormSelect label="BROKER (REQUIRED)" name="broker" value={broker} onChange={e => setBroker(e.target.value)} options={BROKER_OPTIONS} />
          <div style={{ marginTop: 6, fontSize: 11, color: "#64748B" }}>Select your exact broker for best AI extraction accuracy.</div>
        </div>
      )}

      {/* Sample hint (Forex only) */}
      {!isInd && !file && (
        <div style={{ marginTop: 16, borderRadius: 10, border: "1px solid #E2E8F0", overflow: "hidden", background: "#F8FAFC" }}>
          <div style={{ padding: "10px 14px", background: "linear-gradient(90deg,rgba(184,134,11,0.07),transparent)", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#B8860B", ...monoStyle, letterSpacing: "0.1em" }}>SAMPLE — UPLOAD A SCREENSHOT LIKE THIS</span>
          </div>
          <div style={{ padding: "10px 14px", display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div onClick={() => setShowSample(true)} style={{ borderRadius: 6, overflow: "hidden", border: "1.5px solid #B8860B", flexShrink: 0, width: 120, height: 80, cursor: "zoom-in" }}>
              <img src="/sample.png" alt="Sample trade screenshot" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            </div>
            <p style={{ fontSize: 11, color: "#64748B", lineHeight: 1.5, margin: 0 }}>Upload your <strong>MT5 trade history screenshot</strong>. Make sure pair, lot size, entry/exit prices &amp; profit are visible.</p>
          </div>
          {showSample && (
            <div onClick={() => setShowSample(false)} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,25,35,0.85)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, cursor: "zoom-out" }}>
              <img src="/sample.png" alt="Sample" onClick={e => e.stopPropagation()} style={{ maxWidth: "90vw", maxHeight: "80vh", objectFit: "contain", borderRadius: 14, border: "1.5px solid rgba(255,255,255,0.12)" }} />
            </div>
          )}
        </div>
      )}

      {/* Trade Date */}
      <div style={{ marginTop: 14 }}>
        <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "#4A5568", letterSpacing: "0.1em", marginBottom: 7, fontFamily: "'JetBrains Mono',monospace" }}>
          TRADE DATE
        </label>
        <input
          type="date"
          value={preExtractDate}
          onChange={e => handlePreExtractDateChange(e.target.value)}
          min={accountCreatedDate && accountCreatedDate <= todayInputMax ? accountCreatedDate : undefined}
          max={todayInputMax}
          style={{ width: "100%", padding: "11px 14px", fontSize: 13, background: "#F8FAFC", border: "1.5px solid #E2E8F0", borderRadius: 8, color: "#0F1923", outline: "none", boxSizing: "border-box", fontFamily: "'JetBrains Mono',monospace" }}
        />
        {accountCreatedDate && (
          <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 4, fontFamily: "'JetBrains Mono',monospace" }}>
            Earliest: {accountCreatedDate}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ marginTop: 14, borderRadius: 10, border: "1px solid #FCA5A5", background: "#FEF2F2", overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", background: "#FEE2E2", borderBottom: "1px solid #FCA5A5", display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#D63B3B" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span style={{ fontSize: 12, fontWeight: 800, color: "#9B1C1C" }}>
              {isSubscriptionError ? "Subscription Required" : isWrongScreenshotError ? "Wrong Image Uploaded" : "Upload Error"}
            </span>
          </div>
          <div style={{ padding: "10px 14px" }}>
            <p style={{ margin: 0, fontSize: 12, color: "#7F1D1D", lineHeight: 1.65 }}>{error}</p>
            {isSubscriptionError && (
              <div style={{ marginTop: 10, fontSize: 11, color: "#7F1D1D", lineHeight: 1.6 }}>
                Subscribe to continue using screenshot uploads. Manual trade entry will still work without uploading.
              </div>
            )}
            {isWrongScreenshotError && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                {["Open your broker app (MT5, Zerodha Kite, Upstox, etc.)", "Go to your trade history or positions", "Take a screenshot showing pair, entry/exit price, and P&L", "Upload that screenshot here"].map((tip, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#FCA5A5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#9B1C1C", flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                    <span style={{ fontSize: 11, color: "#7F1D1D", lineHeight: 1.5 }}>{tip}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Extract button */}
      <button
        onClick={() => {
          if (!file) {
            setError("Select file");
            return;
          }
          if (isInd && broker === "AUTO") {
            setError("Select broker");
            return;
          }
          setShowConfirmModal(true);
        }}
        disabled={loading || !file}
        style={{ marginTop: 16, width: "100%", padding: "13px", fontSize: 12, ...monoStyle, fontWeight: 700, letterSpacing: "0.12em", color: (loading || !file) ? "#94A3B8" : "#FFFFFF", background: (loading || !file) ? "#F1F5F9" : "linear-gradient(135deg,#B8860B,#D4A917)", border: "none", borderRadius: 10, cursor: (loading || !file) ? "not-allowed" : "pointer", boxShadow: (loading || !file) ? "none" : "0 4px 16px rgba(184,134,11,0.32)", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, transition: "all 0.25s" }}
        onMouseEnter={e => { if (!loading && file) { e.currentTarget.style.transform = "translateY(-2px)"; } }}
        onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}
      >
        {loading ? (
          <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2.5" style={{ animation: "spin 0.9s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            {processingStatus === "cancelling" ? "CANCELLING UPLOAD..." : processingStatus === "uploading" ? "UPLOADING SCREENSHOT..." : processingStatus === "pending" ? "QUEUED FOR EXTRACTION..." : "EXTRACTING TRADE DATA..."}</>
        ) : (
          <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>EXTRACT TRADE DATA</>
        )}
      </button>

      {/* Confirmation modal */}
      {showConfirmModal && (
        <div
          onClick={() => setShowConfirmModal(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: "rgba(15,25,35,0.72)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 560,
              background: "#FFFFFF",
              borderRadius: 14,
              border: "1px solid #E2E8F0",
              boxShadow: "0 20px 40px rgba(15,25,35,0.25)",
              overflow: "hidden",
            }}
          >
            <div style={{ height: 3, background: `linear-gradient(90deg, ${isInd ? "#1B5E20" : "#B8860B"}, transparent)` }} />
            <div style={{ padding: "18px 18px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#0F1923", letterSpacing: "0.06em", marginBottom: 6 }}>
                CONFIRM SCREENSHOT
              </div>
              <div style={{ fontSize: 12, color: "#64748B", marginBottom: 14 }}>
                Please verify this is the correct {isInd ? "Indian" : "Forex"} trade image before extraction.
              </div>

              {confirmImageUrl && (
                <div style={{ borderRadius: 10, border: "1px solid #E2E8F0", overflow: "hidden", background: "#F8FAFC", marginBottom: 14 }}>
                  <img
                    src={confirmImageUrl}
                    alt="Upload confirmation preview"
                    style={{ display: "block", width: "100%", maxHeight: 320, objectFit: "contain", background: "#F8FAFC" }}
                  />
                </div>
              )}

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(false)}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 9,
                    border: "1px solid #E2E8F0",
                    background: "#FFFFFF",
                    color: "#64748B",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowConfirmModal(false);
                    handleUpload();
                  }}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 9,
                    border: "none",
                    background: isInd ? "linear-gradient(135deg,#1B5E20,#2E7D32)" : "linear-gradient(135deg,#B8860B,#D4A917)",
                    color: "#FFFFFF",
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: "0.06em",
                    cursor: "pointer",
                  }}
                >
                  Yes, Upload
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ── single trade form ─────────────────────────────────────────────────────────

function TradeFormCard({ state, tradeIdx = null, psychologyRef = null, accountCreatedDate = "", todayInputMax = "" }) {
  const isMulti = tradeIdx !== null;
  const trade   = isMulti ? state.trades[tradeIdx] : state.trade;
  const onChange = isMulti
    ? e => state.handleTradeChange(tradeIdx, e)
    : state.handleChange;
  const onStrategyChange = isMulti
    ? e => state.handleMultiTradeStrategyChange(tradeIdx, e)
    : state.handleStrategyChange;
  const setupRules = isMulti ? (trade?.setupRules || []) : state.setupRules;
  const { isInd, tradeSubType } = state;
  const isEquityMode = isInd && tradeSubType === "EQUITY";
  const bull     = parseFloat(trade?.profit || 0) >= 0;
  const saved    = isMulti ? state.savedTrades[tradeIdx] : state.saved;
  const currency = isInd ? "₹" : "$";

  // Only user's saved strategies — no hardcoded defaults
  const strategyOpts = [
    { value: "", label: state.strategies?.length ? "Select a setup..." : "No setups saved — go to Setups page" },
    ...(state.strategies || []).map(s => ({ value: s.name, label: s.name })),
    { value: "Custom", label: "Custom" },
  ];

  const onToggle      = isMulti ? (id) => state.toggleSetupRuleMulti(tradeIdx, id)            : state.toggleSetupRule;
  const onUpdateLabel = isMulti ? (id, v) => state.updateSetupRuleLabelMulti(tradeIdx, id, v) : state.updateSetupRuleLabel;
  const onAdd         = isMulti ? () => state.addSetupRuleMulti(tradeIdx)                      : state.addSetupRule;
  const onClear       = isMulti ? () => state.clearSetupRulesMulti(tradeIdx)                   : state.clearSetupRules;

  const toggleEmotion = (tag) => {
    const current = trade?.emotionalTags || [];
    const updated  = current.includes(tag) ? current.filter(t => t !== tag) : [...current, tag];
    onChange({ target: { name: "emotionalTags", value: updated } });
  };

  const handleSave = async () => {
    if (isMulti) await state.saveExtractedTrade(tradeIdx);
    else         await state.saveTrade();
  };

  return (
    <div style={{ marginBottom: isMulti ? 20 : 0 }}>
      {/* Remove entry button — multi-trade only, unsaved only */}
      {isMulti && !saved && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
          <button
            type="button"
            onClick={() => state.deleteTrade(tradeIdx)}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#D63B3B", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.06em" }}
            onMouseEnter={e => { e.currentTarget.style.background = "#FEE2E2"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "#FEF2F2"; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            REMOVE ENTRY
          </button>
        </div>
      )}

      {/* Screenshot preview — only show on single trade */}
      {!isMulti && trade?.screenshot && (
        <SectionCard accentColor="#94A3B8" title="Extracted Screenshot" delay={0.08}>
          <img src={trade.screenshot} alt="Trade screenshot" style={{ width: "100%", maxWidth: 280, height: "auto", borderRadius: 8, border: "1px solid #E2E8F0" }} />
        </SectionCard>
      )}

      {/* ── Trade Details ── */}
      <SectionCard
        accentColor={isInd ? "#1B5E20" : "#B8860B"}
        title={isMulti ? `Trade #${tradeIdx + 1} — ${trade?.pair || ""}` : `${isEquityMode ? "Intraday Stock" : isInd ? "Indian Options" : "Forex"} Trade Details`}
        subtitle={isMulti ? `P&L: ${bull ? "+" : ""}${currency}${Math.abs(parseFloat(trade?.profit || 0)).toFixed(2)}` : "REVIEW & CORRECT EXTRACTED FIELDS"}
        delay={0.1}
        style={isMulti && saved ? { opacity: 0.6 } : {}}
      >
        {saved && (
          <div style={{ padding: "8px 12px", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 6, marginBottom: 14, fontSize: 11, color: "#065F46" }}>
            ✓ Trade saved successfully
          </div>
        )}

        <div className="form-2col" style={{ ...grid2, marginBottom: 14 }}>
          <FormInput label={isInd ? "SYMBOL" : "PAIR"} name="pair" value={trade?.pair} onChange={onChange} placeholder={isInd ? "NIFTY 26100 CE" : "EUR/USD"} />
          <FormSelect label="ACTION" name="action" value={trade?.action} onChange={onChange} options={[{ value: "buy", label: "Buy / Long" }, { value: "sell", label: "Sell / Short" }]} />
        </div>
        <div className="form-2col" style={{ ...grid2, marginBottom: 14 }}>
          <div>
            <FormInput label="TRADE DATE" name="tradeDate" value={trade?.tradeDate} onChange={onChange} type="date" required min={accountCreatedDate || undefined} max={todayInputMax || undefined} />
            {trade?._dateAutoFilled && (
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, padding: "4px 8px", background: "#FFFBEB", border: "1px solid #FCD34D", borderRadius: 6 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#B45309" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <span style={{ fontSize: 10, color: "#B45309", fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>
                  DATE NOT EXTRACTED — set to today. Please verify.
                </span>
              </div>
            )}
            {accountCreatedDate && !trade?._dateAutoFilled && <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 4, fontFamily: "'JetBrains Mono',monospace" }}>Earliest: {accountCreatedDate}</div>}
          </div>
          <div />
        </div>

        {isEquityMode ? (
          <>
            <div className="form-2col" style={{ ...grid2, marginBottom: 14 }}>
              <FormInput label="STOCK SYMBOL" name="stockSymbol" value={trade?.stockSymbol} onChange={onChange} placeholder="RELIANCE" />
              <FormInput label="SHARES QTY" name="sharesQty" value={trade?.sharesQty} onChange={onChange} placeholder="10" type="number" />
            </div>
            <div className="form-2col" style={{ ...grid2, marginBottom: 14 }}>
              <FormInput label="ENTRY PRICE (₹)" name="entryPrice" value={trade?.entryPrice} onChange={onChange} placeholder="0.00" type="number" />
              <FormInput label="EXIT PRICE (₹)"  name="exitPrice"  value={trade?.exitPrice}  onChange={onChange} placeholder="0.00" type="number" />
            </div>
            <div className="form-2col" style={{ ...grid2, marginBottom: 14 }}>
              <FormInput label="P&L (₹)" name="profit" value={trade?.profit} onChange={onChange} placeholder="0.00" type="number" />
              <FormSelect label="EXCHANGE" name="exchange" value={trade?.exchange || "NSE"} onChange={onChange} options={[{ value: "NSE", label: "NSE" }, { value: "BSE", label: "BSE" }]} />
            </div>
          </>
        ) : isInd ? (
          <>
            <div className="form-2col" style={{ ...grid2, marginBottom: 14 }}>
              <FormInput label="QUANTITY" name="quantity" value={trade?.quantity} onChange={onChange} placeholder="50" type="number" />
              <FormSelect label="OPTION TYPE" name="optionType" value={trade?.optionType} onChange={onChange} options={[{ value: "CE", label: "CE — Call" }, { value: "PE", label: "PE — Put" }]} />
            </div>
            <div className="form-2col" style={{ ...grid2, marginBottom: 14 }}>
              <FormInput label="ENTRY PRICE (₹)" name="entryPrice" value={trade?.entryPrice} onChange={onChange} placeholder="0.00" type="number" />
              <FormInput label="EXIT PRICE (₹)"  name="exitPrice"  value={trade?.exitPrice}  onChange={onChange} placeholder="0.00" type="number" />
            </div>
            <div className="form-2col" style={{ ...grid2, marginBottom: 14 }}>
              <FormInput label="P&L (₹)" name="profit" value={trade?.profit} onChange={onChange} placeholder="0.00" type="number" />
              <FormInput label="EXPIRY"  name="expiryDate" value={trade?.expiryDate} onChange={onChange} placeholder="2025-12-26" type="date" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <FormSelect
                label="PLANNED R:R"
                name="riskRewardRatio"
                value={trade?.riskRewardRatio || ""}
                onChange={onChange}
                options={[
                  { value: "1:1", label: "1 : 1" },
                  { value: "1:2", label: "1 : 2" },
                  { value: "1:3", label: "1 : 3" },
                  { value: "1:4", label: "1 : 4" },
                  { value: "1:5", label: "1 : 5" },
                  { value: "custom", label: "Custom" },
                ]}
              />
              {trade?.riskRewardRatio === "custom" && (
                <div style={{ marginTop: 12 }}>
                  <FormInput label="CUSTOM R:R" name="riskRewardCustom" value={trade?.riskRewardCustom || ""} onChange={onChange} placeholder="e.g. 1:2.5" />
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="form-2col" style={{ ...grid2, marginBottom: 14 }}>
              <FormInput label="ENTRY PRICE" name="entryPrice" value={trade?.entryPrice} onChange={onChange} placeholder="1.08500" type="number" />
              <FormInput label="EXIT PRICE"  name="exitPrice"  value={trade?.exitPrice}  onChange={onChange} placeholder="1.09200" type="number" />
            </div>
            <div className="form-2col" style={{ ...grid2, marginBottom: 14 }}>
              <FormInput label="LOT SIZE" name="lotSize" value={trade?.lotSize} onChange={onChange} placeholder="0.10" type="number" />
              <FormInput label="P&L ($)"  name="profit"  value={trade?.profit}  onChange={onChange} placeholder="0.00" type="number" />
            </div>
            <div className="form-2col" style={{ ...grid2, marginBottom: 14 }}>
              <FormInput label="STOP LOSS"   name="stopLoss"   value={trade?.stopLoss}   onChange={onChange} placeholder="1.08000" type="number" />
              <FormInput label="TAKE PROFIT" name="takeProfit" value={trade?.takeProfit} onChange={onChange} placeholder="1.09500" type="number" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <FormSelect
                label="PLANNED R:R"
                name="riskRewardRatio"
                value={trade?.riskRewardRatio || ""}
                onChange={onChange}
                options={[
                  { value: "1:1", label: "1 : 1" },
                  { value: "1:2", label: "1 : 2" },
                  { value: "1:3", label: "1 : 3" },
                  { value: "1:4", label: "1 : 4" },
                  { value: "1:5", label: "1 : 5" },
                  { value: "custom", label: "Custom" },
                ]}
              />
              {trade?.riskRewardRatio === "custom" && (
                <div style={{ marginTop: 12 }}>
                  <FormInput label="CUSTOM R:R" name="riskRewardCustom" value={trade?.riskRewardCustom || ""} onChange={onChange} placeholder="e.g. 1:2.5" />
                </div>
              )}
            </div>
          </>
        )}

        {/* Entry basis */}
        <div style={{ marginBottom: 16 }}>
          <FormSelect label="ENTRY BASIS" name="entryBasis" value={trade?.entryBasis} onChange={onChange} options={ENTRY_BASIS.map(v => ({ value: v, label: v }))} />
        </div>

        {/* Session (Forex only) */}
        {!isInd && (
          <div style={{ marginBottom: 16 }}>
            <FormSelect label="SESSION" name="session" value={trade?.session} onChange={onChange} options={[
              { value: "Asia", label: "Asia" }, { value: "London", label: "London" },
              { value: "New York", label: "New York" }, { value: "London-NY Overlap", label: "London-NY Overlap" },
            ]} />
          </div>
        )}

        {/* Notes */}
        <div>
          <label style={labelSt}>NOTES</label>
          <textarea name="notes" value={trade?.notes || ""} onChange={onChange} placeholder="What went well? What to improve?" rows={3}
            style={{ width: "100%", padding: "11px 14px", fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif", color: "#0F1923", background: "#F8FAFC", border: "1.5px solid #E2E8F0", borderRadius: 8, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
        </div>
      </SectionCard>

      {/* ── Setup / Strategy ── */}
      <SectionCard accentColor="#B8860B" title="Setup & Strategy" subtitle="WHICH SETUP DID YOU TRADE?" delay={0.12}>
        <div style={{ marginBottom: 16 }}>
          <FormSelect label="STRATEGY / SETUP" name="strategy" value={trade?.strategy} onChange={onStrategyChange} options={strategyOpts} />
          {!state.strategies?.length && (
            <div style={{ marginTop: 8, fontSize: 11, color: "#B8860B" }}>
              <Link href="/setups" style={{ color: "#B8860B", fontWeight: 700 }}>+ Go to Setups</Link> to create your strategies and rules.
            </div>
          )}
          {trade?.strategy === "Custom" && (
            <div style={{ marginTop: 8 }}>
              <FormInput label="CUSTOM SETUP NAME" name="strategyCustom" value={trade?.strategyCustom} onChange={onChange} placeholder="e.g. MACD Fakeout" />
            </div>
          )}
        </div>

        <SetupChecklist rules={setupRules} onToggle={onToggle} onUpdateLabel={onUpdateLabel} onAdd={onAdd} onClear={onClear} />
      </SectionCard>

      {/* ── Psychology ── */}
      <SectionCard accentColor="#8B5CF6" title="Psychology" subtitle="HOW WERE YOU FEELING?" delay={0.14} cardRef={!isMulti ? psychologyRef : null}>

        {/* Mood */}
        <div style={{ marginBottom: 24 }}>
          <label style={labelSt}>EMOTIONAL STATE</label>
          <div className="mood-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8 }}>
            {MOODS.map(m => (
              <button key={m.v} type="button"
                onClick={() => onChange({ target: { name: "mood", value: trade?.mood === m.v ? null : m.v } })}
                style={{ padding: "10px 4px", borderRadius: 12, cursor: "pointer", minHeight: 70, border: trade?.mood === m.v ? "2px solid #8B5CF6" : "1px solid #E2E8F0", background: trade?.mood === m.v ? "rgba(139,92,246,0.08)" : "#FFF", transition: "all 0.2s", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>{m.e}</div>
                <div style={{ fontSize: 9, color: trade?.mood === m.v ? "#8B5CF6" : "#94A3B8", fontWeight: 800, letterSpacing: "0.02em" }}>{m.label.toUpperCase()}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Confidence */}
        <div style={{ marginBottom: 20 }}>
          <FormSelect label="TRADE CONFIDENCE" name="confidence" value={trade?.confidence || ""} onChange={onChange} options={[{ value: "", label: "Select..." }, ...CONFIDENCE_OPTS]} />
        </div>

        {/* Emotional tags */}
        <div style={{ marginBottom: 20 }}>
          <label style={labelSt}>EMOTIONAL TAGS</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {EMOTIONS.map(({ tag, emoji }) => {
              const sel = trade?.emotionalTags?.includes(tag);
              return (
                <button key={tag} type="button" onClick={() => toggleEmotion(tag)}
                  style={{ padding: "7px 14px", borderRadius: 99, fontSize: 12, fontWeight: 700, cursor: "pointer", border: sel ? "2px solid #8B5CF6" : "1.5px solid #E2E8F0", background: sel ? "rgba(139,92,246,0.1)" : "#FFF", color: sel ? "#8B5CF6" : "#64748B", transition: "all 0.2s", display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ fontSize: 15 }}>{emoji}</span>{tag}
                </button>
              );
            })}
          </div>
        </div>

        {/* Would retake */}
        <div style={{ marginBottom: 20 }}>
          <label style={labelSt}>WOULD YOU RETAKE THIS TRADE?</label>
          <div style={{ display: "flex", gap: 10 }}>
            {["Yes", "No"].map(v => (
              <button key={v} type="button"
                onClick={() => onChange({ target: { name: "wouldRetake", value: trade?.wouldRetake === v ? "" : v } })}
                style={{ flex: 1, padding: "10px", borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer", border: trade?.wouldRetake === v ? "2px solid #8B5CF6" : "1.5px solid #E2E8F0", background: trade?.wouldRetake === v ? "rgba(139,92,246,0.1)" : "#FFF", color: trade?.wouldRetake === v ? "#8B5CF6" : "#94A3B8", transition: "all 0.2s" }}>
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Trade Quality */}
        <div style={{ marginBottom: isInd ? 20 : 0 }}>
          <label style={labelSt}>TRADE QUALITY</label>
          <div style={{ display: "flex", gap: 10 }}>
            {[
              { val: "Great", color: "#0D9E6E", bg: "rgba(13,158,110,0.1)", desc: "Followed the plan" },
              { val: "Average", color: "#F59E0B", bg: "rgba(245,158,11,0.1)", desc: "Partial execution" },
              { val: "Poor", color: "#D63B3B", bg: "rgba(214,59,59,0.1)", desc: "Broke the rules" },
            ].map(q => {
              const sel = trade?.tradeQuality === q.val;
              return (
                <button key={q.val} type="button"
                  onClick={() => onChange({ target: { name: "tradeQuality", value: sel ? "" : q.val } })}
                  style={{ flex: 1, padding: "10px 6px", borderRadius: 10, fontSize: 11, fontWeight: 700, cursor: "pointer", border: sel ? `2px solid ${q.color}` : "1.5px solid #E2E8F0", background: sel ? q.bg : "#FFF", color: sel ? q.color : "#94A3B8", transition: "all 0.2s", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                  <span>{q.val}</span>
                  <span style={{ fontSize: 9, fontWeight: 500, opacity: 0.8 }}>{q.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Indian-only: Mistake tag + Lesson */}
        {isInd && (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={labelSt}>MISTAKE TAG</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {MISTAKE_TAGS.map(tag => {
                  const sel = trade?.mistakeTag === tag;
                  return (
                    <button key={tag} type="button"
                      onClick={() => onChange({ target: { name: "mistakeTag", value: sel ? "" : tag } })}
                      style={{ padding: "7px 14px", borderRadius: 99, fontSize: 11, fontWeight: 700, cursor: "pointer", border: sel ? "2px solid #D63B3B" : "1.5px solid #E2E8F0", background: sel ? "rgba(214,59,59,0.08)" : "#FFF", color: sel ? "#D63B3B" : "#94A3B8", transition: "all 0.2s" }}>
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label style={labelSt}>LESSON LEARNED</label>
              <textarea name="lesson" value={trade?.lesson || ""} onChange={onChange} placeholder="What will you do differently next time?" rows={2}
                style={{ width: "100%", padding: "11px 14px", fontSize: 13, fontFamily: "'Plus Jakarta Sans',sans-serif", color: "#0F1923", background: "#F8FAFC", border: "1.5px solid #E2E8F0", borderRadius: 8, outline: "none", resize: "vertical", boxSizing: "border-box" }} />
            </div>
          </>
        )}
      </SectionCard>

      {/* Save button */}
      {!saved && (
        <button
          onClick={handleSave}
          disabled={state.savingAll}
          style={{ width: "100%", padding: "15px", marginTop: 6, background: state.savingAll ? "#94A3B8" : "linear-gradient(135deg,#0D9E6E,#22C78E)", color: "#FFFFFF", border: "none", borderRadius: 12, fontSize: 13, ...monoStyle, fontWeight: 700, letterSpacing: "0.1em", cursor: state.savingAll ? "not-allowed" : "pointer", boxShadow: "0 4px 16px rgba(13,158,110,0.3)", transition: "all 0.25s", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}
          onMouseEnter={e => { if (!state.savingAll) e.currentTarget.style.transform = "translateY(-2px)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}
        >
          {state.savingAll ? (
            <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin 0.8s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>SAVING...</>
          ) : (
            <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>{isMulti ? `SAVE TRADE #${tradeIdx + 1}` : "SAVE TO JOURNAL"}</>
          )}
        </button>
      )}
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

function UploadTradeContent() {
  const { accountCreatedDate } = useUserProfile();
  const state   = useUploadTrade({ accountCreatedDate });
  const clock   = useClock();
  const router  = useRouter();
  const searchParams = useSearchParams();
  const onboardingMode = searchParams?.get("onboarding") === "1";
  const { isInd, mounted, loading, processingStatus, trade, trades, savedTrades, savingAll, saveAllTrades, tradeCount, todayInputMax } = state;
  const visibleTradeCount = trades.length > 1 ? trades.length : tradeCount;
  const parseProfitValue = (value) => parseFloat(String(value || 0).replace(/,/g, "")) || 0;
  const extractionStepMap = {
    uploading: { label: "Uploading screenshot", hint: "Securely sending image to server", progress: 25 },
    cancelling: { label: "Cancelling upload", hint: "Stopping OCR and cleaning up resources", progress: 10 },
    pending: { label: "Queued for extraction", hint: "Preparing OCR and AI pipeline", progress: 45 },
    processing: { label: "Extracting trade details", hint: "Reading image, parsing fields, validating output", progress: 75 },
    completed: { label: "Extraction completed", hint: "Finalizing extracted data", progress: 100 },
  };
  const extractionStep = extractionStepMap[processingStatus] || extractionStepMap.processing;

  // Auto-scroll to psychology section when extraction completes
  const psychologyRef = useRef(null);
  const prevTrade     = useRef(null);
  useEffect(() => {
    if (trade && !prevTrade.current && psychologyRef.current) {
      setTimeout(() => psychologyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 400);
    }
    prevTrade.current = trade;
  }, [trade]);

  const totalPnl = trades.length > 0
    ? trades.reduce((s, t) => s + parseProfitValue(t?.profit), 0)
    : parseProfitValue(trade?.profit);

  if (!mounted) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F0EEE9", fontFamily: "'Plus Jakarta Sans',sans-serif", color: "#0F1923" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 32, height: 32, margin: "0 auto 12px", border: "2.5px solid #E2E8F0", borderTopColor: "#B8860B", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.08em" }}>LOADING AI EXTRACTOR...</div>
        </div>
        <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      </main>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F0EEE9", display: "flex", flexDirection: "column", fontFamily: "'Plus Jakarta Sans',sans-serif", color: "#0F1923", position: "relative" }}>
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <CandlestickBackground canvasId="upload-bg-canvas" />

      <div style={{ position: "relative", zIndex: 10, display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <PageHeader showMarketSwitcher showClock clock={clock} />
        <TickerTape />

        <main style={{ flex: 1, maxWidth: 900, width: "100%", margin: "0 auto", padding: "28px 20px", boxSizing: "border-box", animation: "fadeUp 0.45s ease both" }}>
          {onboardingMode && (
            <div style={{
              padding: "14px 16px", borderRadius: 12,
              background: "linear-gradient(135deg, rgba(34,199,142,0.08), rgba(13,158,110,0.04))",
              border: "1px solid rgba(34,199,142,0.3)",
              marginBottom: 18,
            }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", color: "#0D9E6E", fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>
                STEP 2 OF 3 · LOG YOUR FIRST TRADE
              </div>
              <div style={{ fontSize: 13, color: "#0F1923", lineHeight: 1.6 }}>
                Upload a <strong>broker screenshot</strong> (MT4/MT5, Zerodha, Upstox, etc.) — our AI reads it and fills in pair, entry, exit, and P&L for you. Review, hit <strong>Save</strong>, and we&apos;ll take you to your journal.
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "#64748B" }}>
                Prefer typing it in? <Link href="/add-trade?onboarding=1" style={{ color: "#0D9E6E", fontWeight: 700, textDecoration: "none" }}>Manual entry →</Link>
              </div>
            </div>
          )}

          {/* Page heading */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <button onClick={() => router.back()} style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid #E2E8F0", background: "#FFFFFF", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0F1923" strokeWidth="2.2"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <h1 style={{ fontFamily: "'Plus Jakarta Sans',sans-serif", fontSize: 28, fontWeight: 800, color: "#0F1923", margin: 0, letterSpacing: "-0.02em" }}>
                Upload <span style={{ color: "#B8860B" }}>{isInd ? "Indian Trade" : "Forex Trade"}</span>
              </h1>
            </div>
            <p style={{ fontSize: 11, color: "#94A3B8", marginLeft: 42, ...monoStyle, letterSpacing: "0.06em" }}>AI-POWERED SCREENSHOT EXTRACTION</p>
          </div>

          {/* Upload zone */}
          <UploadCard state={state} accountCreatedDate={accountCreatedDate} todayInputMax={todayInputMax} />

          {/* Processing spinner */}
          {loading && (
            <SectionCard accentColor="#B8860B" title="Extraction In Progress" subtitle="AI is analyzing your screenshot" delay={0.1}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "8px 0 4px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", border: "2px solid rgba(184,134,11,0.25)", borderTopColor: "#B8860B", animation: "spin 1s linear infinite" }} />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#0F1923" }}>{extractionStep.label}</div>
                      <div style={{ fontSize: 11, color: "#94A3B8" }}>{extractionStep.hint}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#B8860B", ...monoStyle }}>
                    {extractionStep.progress}%
                  </div>
                </div>

                <div style={{ height: 8, borderRadius: 999, background: "#F1F5F9", overflow: "hidden", border: "1px solid #E2E8F0" }}>
                  <div
                    style={{
                      width: `${extractionStep.progress}%`,
                      height: "100%",
                      borderRadius: 999,
                      background: "linear-gradient(90deg,#B8860B,#D4A917)",
                      transition: "width 400ms ease",
                    }}
                  />
                </div>

                <div style={{ fontSize: 10, color: "#94A3B8", ...monoStyle, letterSpacing: "0.06em" }}>
                  PLEASE KEEP THIS SCREEN OPEN UNTIL EXTRACTION FINISHES
                </div>
                <button
                  type="button"
                  onClick={state.clearOcrSession}
                  disabled={processingStatus === "cancelling"}
                  style={{ alignSelf: "flex-start", padding: "9px 12px", borderRadius: 8, border: "1px solid #E2E8F0", background: processingStatus === "cancelling" ? "#F1F5F9" : "#FFFFFF", color: processingStatus === "cancelling" ? "#94A3B8" : "#D63B3B", fontSize: 11, fontWeight: 800, cursor: processingStatus === "cancelling" ? "not-allowed" : "pointer", fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.06em" }}
                >
                  {processingStatus === "cancelling" ? "CANCELLING..." : "CANCEL UPLOAD"}
                </button>
              </div>
            </SectionCard>
          )}

          {/* Trade count banner — shown after extraction */}
          {!loading && visibleTradeCount > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", background: "#ECFDF5", border: "1.5px solid #A7F3D0", borderRadius: 10, marginBottom: 4, flexWrap: "wrap" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#0D9E6E", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: "#fff", ...monoStyle }}>{visibleTradeCount}</span>
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#065F46" }}>
                  {visibleTradeCount === 1 ? "1 trade extracted" : `${visibleTradeCount} trades extracted`}
                </div>
                <div style={{ fontSize: 11, color: "#6EE7B7", ...monoStyle }}>
                  Review the details below and save to your journal
                </div>
              </div>
              <button
                type="button"
                onClick={state.clearOcrSession}
                style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #A7F3D0", background: "#FFFFFF", color: "#047857", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.06em" }}
              >
                CLEAR FORM
              </button>
            </div>
          )}

          {!loading && visibleTradeCount > 0 && (
            <OcrConfirmationBanner
              ocrData={trades.length > 1 ? null : (trade || trades[0])}
              insights={state.extractionInsights}
              marketType={isInd ? "Indian_Market" : "Forex"}
              module={isInd ? "upload-trade-indian" : "upload-trade-forex"}
            />
          )}

          {!loading && visibleTradeCount > 0 && (
            <SectionCard
              accentColor={totalPnl >= 0 ? "#0D9E6E" : "#D63B3B"}
              title="Overall P&L"
              subtitle={`${totalPnl >= 0 ? "+" : ""}${isInd ? "₹" : "$"}${Math.abs(totalPnl).toFixed(2)} on ${visibleTradeCount} position${visibleTradeCount > 1 ? "s" : ""}`}
              delay={0.08}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                <span style={{ fontSize: 22, fontWeight: 800, ...monoStyle, color: totalPnl >= 0 ? "#0D9E6E" : "#D63B3B" }}>
                  {totalPnl >= 0 ? "+" : ""}{isInd ? "₹" : "$"}{Math.abs(totalPnl).toFixed(2)}
                </span>
                <span style={{ fontSize: 12, color: "#64748B" }}>Auto-updates after each remove/edit</span>
              </div>
            </SectionCard>
          )}

          {/* ── Multi-trade path ──────────────────────────────────────────── */}
          {trades.length > 1 && (
            <>
              {/* Screenshot shown once at the top for multi-trade */}
              {trades[0]?.screenshot && (
                <SectionCard accentColor="#94A3B8" title="Extracted Screenshot" delay={0.07}>
                  <img src={trades[0].screenshot} alt="Trade screenshot" style={{ width: "100%", maxWidth: 280, height: "auto", borderRadius: 8, border: "1px solid #E2E8F0" }} />
                </SectionCard>
              )}

              {/* Individual trade cards — collapse to a saved chip once saved */}
              {trades.map((t, i) => {
                if (savedTrades[i]) {
                  const bull = parseFloat(String(t?.profit || 0).replace(/,/g, "")) >= 0;
                  return (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "12px 18px",
                        background: "#ECFDF5",
                        border: "1.5px solid #A7F3D0",
                        borderRadius: 12,
                        marginBottom: 8,
                      }}
                    >
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#0D9E6E", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "#065F46" }}>
                          Trade #{i + 1} — {t?.pair || "Saved"}
                        </div>
                        <div style={{ fontSize: 11, color: "#6EE7B7", fontFamily: "'JetBrains Mono',monospace" }}>
                          {bull ? "+" : ""}{isInd ? "₹" : "$"}{Math.abs(parseFloat(String(t?.profit || 0).replace(/,/g, ""))).toFixed(2)} · Saved to journal
                        </div>
                      </div>
                    </div>
                  );
                }
                return <TradeFormCard key={i} state={state} tradeIdx={i} accountCreatedDate={accountCreatedDate} todayInputMax={todayInputMax} />;
              })}

              {/* Save all */}
              {savedTrades.some(s => !s) && (
                <button
                  onClick={saveAllTrades} disabled={savingAll}
                  style={{ width: "100%", padding: "16px", background: savingAll ? "#F1F5F9" : "linear-gradient(135deg,#0F1923,#1a2d3d)", color: savingAll ? "#94A3B8" : "#22C78E", border: "1px solid rgba(34,199,142,0.3)", borderRadius: 12, fontSize: 13, ...monoStyle, fontWeight: 700, letterSpacing: "0.1em", cursor: savingAll ? "not-allowed" : "pointer", boxShadow: "0 4px 16px rgba(15,25,35,0.2)", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 8 }}
                >
                  {savingAll ? (<><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin 0.8s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>SAVING...</>) : "SAVE ALL TRADES →"}
                </button>
              )}
            </>
          )}

          {/* ── Single trade path ─────────────────────────────────────────── */}
          {trade && trades.length <= 1 && <TradeFormCard state={state} psychologyRef={psychologyRef} accountCreatedDate={accountCreatedDate} todayInputMax={todayInputMax} />}

          {/* No extraction yet */}
          {!loading && !trade && trades.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#94A3B8", fontSize: 13 }}>
              Upload a screenshot above to begin AI extraction.
            </div>
          )}
        </main>
      </div>

      <style>{`
        @keyframes blink   { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes spin    { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes ticker  { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
        @keyframes fadeUp  { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimmer { 0%{transform:translateX(-100%)} 100%{transform:translateX(200%)} }
        * { box-sizing:border-box; margin:0; padding:0; }
        textarea { resize:vertical; }
        input::placeholder, textarea::placeholder { color:#CBD5E1; font-size:12px; }
        @media (max-width:640px) {
          main { padding:14px 12px !important; }
          .form-2col  { grid-template-columns: 1fr !important; }
          .mood-grid  { grid-template-columns: repeat(5,1fr) !important; gap: 6px !important; }
        }
        @media (max-width:400px) {
          .mood-grid  { grid-template-columns: repeat(3,1fr) !important; }
        }
      `}</style>
    </div>
  );
}

function UploadErrorFallback({ error, resetError }) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F0EEE9", fontFamily: "'Plus Jakarta Sans',sans-serif", padding: 24 }}>
      <div style={{ maxWidth: 420, width: "100%", background: "#FFFFFF", borderRadius: 14, border: "1px solid #FCA5A5", overflow: "hidden", boxShadow: "0 4px 24px rgba(15,25,35,0.08)" }}>
        <div style={{ height: 3, background: "linear-gradient(90deg,#D63B3B,#FCA5A5)" }} />
        <div style={{ padding: "24px 24px 20px" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#9B1C1C", marginBottom: 8 }}>Something went wrong</div>
          <p style={{ fontSize: 12, color: "#7F1D1D", lineHeight: 1.6, margin: "0 0 16px" }}>
            The upload form encountered an error. Your unsaved data may be lost, but your previously saved trades are safe in your journal.
          </p>
          {error?.message && (
            <pre style={{ fontSize: 10, color: "#94A3B8", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 6, padding: "8px 10px", overflowX: "auto", marginBottom: 16 }}>
              {error.message}
            </pre>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={resetError}
              style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: "#B8860B", color: "#FFF", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.06em" }}
            >
              TRY AGAIN
            </button>
            <a
              href="/trades"
              style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#FFF", color: "#4A5568", fontSize: 12, fontWeight: 700, cursor: "pointer", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.06em" }}
            >
              MY JOURNAL
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function UploadTradePage() {
  return (
    <ErrorBoundary fallback={(error, reset) => <UploadErrorFallback error={error} resetError={reset} />}>
      <Suspense>
        <UploadTradeContent />
      </Suspense>
    </ErrorBoundary>
  );
}
