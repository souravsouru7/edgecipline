"use client";

import { useState, useEffect, useRef, useMemo, useCallback, Suspense } from "react";
// useEffect + useRef used in UploadTradeContent for auto-scroll to psychology after extraction
import { useRouter, useSearchParams } from "next/navigation";
import ErrorBoundary from "@/components/ErrorBoundary";
import Link from "next/link";
import CandlestickBackground from "@/features/shared/components/CandlestickBackground";
import TradeLimitDialog from "@/features/trade/components/TradeLimitDialog";
import TickerTape            from "@/features/shared/components/TickerTape";
import PageHeader            from "@/features/shared/components/PageHeader";
import { useClock }          from "@/features/shared/hooks/useClock";
import FileUploadZone        from "@/features/trade/components/FileUploadZone";
import SetupChecklist        from "@/features/trade/components/SetupChecklist";
import TradeEvidenceSection  from "@/features/trade/components/TradeEvidenceSection";
import SectionCard           from "@/features/trade/components/SectionCard";
import { FormInput }         from "@/features/trade/components/FormInput";
import { FormSelect }        from "@/features/trade/components/FormSelect";
import { useUploadTrade }    from "@/features/trade/hooks/useUploadTrade";
import { useUserProfile }   from "@/features/auth/hooks/useUserProfile";
import OcrConfirmationBanner from "@/features/issues/OcrConfirmationBanner";
import PaywallGate           from "@/components/PaywallGate";
import { canShowPurchaseUI } from "@/config/payments";
import OnboardingMarketGuard from "@/features/onboarding/components/OnboardingMarketGuard";
import { getOnboardingUploadPath } from "@/features/onboarding/utils/onboardingMarketRouting.mjs";

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
  const [showPaywall, setShowPaywall] = useState(false);
  const confirmSubmitRef = useRef(false);
  const confirmImageUrl = useMemo(
    () => (showConfirmModal && file ? URL.createObjectURL(file) : ""),
    [showConfirmModal, file]
  );

  useEffect(() => {
    if (showConfirmModal) confirmSubmitRef.current = false;
  }, [showConfirmModal]);
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
  const manualEntryPath = isInd ? "/indian-market/add-trade" : "/add-trade";
  const screenshotTips = isInd
    ? [
        "Open your Indian broker app (Zerodha, Upstox, Groww, Angel One, Dhan, or Fyers)",
        "Open your orders, positions, or trade history",
        "Take a screenshot showing symbol, quantity, entry/exit price, and P&L",
        "Upload that screenshot here",
      ]
    : [
        "Open your Forex broker app (MT4, MT5, cTrader, or your broker platform)",
        "Open your trade history or positions",
        "Take a screenshot showing pair, lot size, entry/exit price, and P&L",
        "Upload that screenshot here",
      ];

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

      {/* ── Subscription upgrade card (never an error, always a value unlock) ── */}
      {isSubscriptionError && (
        <div
          style={{
            marginTop: 16,
            borderRadius: 14,
            overflow: "hidden",
            border: "1.5px solid rgba(184,134,11,0.35)",
            background: "#FFFFFF",
            boxShadow: "0 2px 12px rgba(15,25,35,0.06)",
            animation: "fadeSlideUp 0.35s cubic-bezier(0.22,1,0.36,1) both",
          }}
        >
          {/* Gold accent top bar — matches SectionCard pattern */}
          <div style={{ height: 3, background: "linear-gradient(90deg,#B8860B,#D4A917)" }} />

          <div style={{ padding: "16px 18px 18px" }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(184,134,11,0.1)", border: "1.5px solid rgba(184,134,11,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 17h18l-2-9-4.5 4L12 5l-2.5 7L5 8z" fill="#D4A917" stroke="#B8860B" strokeWidth="1.5" strokeLinejoin="round"/><path d="M3 17v2h18v-2" stroke="#B8860B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#0F1923", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>Continue with Edgecipline Pro</span>
                  <span style={{ fontSize: 9, fontWeight: 700, background: "linear-gradient(90deg,#B8860B,#D4A917)", color: "#fff", padding: "2px 7px", borderRadius: 20, letterSpacing: "0.08em", ...monoStyle }}>PRO</span>
                </div>
                <p style={{ margin: 0, fontSize: 11, color: "#64748B", lineHeight: 1.6 }}>
                  You&apos;ve used your free AI import. Unlock unlimited extractions and keep building better trading habits.
                </p>
              </div>
            </div>

            {/* Feature list */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 10px", marginBottom: 14 }}>
              {[
                { icon: "✨", label: "Unlimited AI Imports"  },
                { icon: "🧬", label: "Trading DNA"           },
                { icon: "🖼️", label: "Multi-image Upload"    },
                { icon: "📊", label: "Weekly AI Review"      },
                { icon: "🤖", label: "AI Trade Extraction"   },
                { icon: "🧠", label: "Psychology Analytics"  },
                { icon: "🔔", label: "Smart Notifications"   },
                { icon: "🏆", label: "Missions & Streaks"    },
              ].map(({ icon, label }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 4, background: "rgba(13,158,110,0.1)", border: "1px solid rgba(13,158,110,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#0D9E6E" strokeWidth="3.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <span style={{ fontSize: 11, color: "#475569", fontWeight: 500 }}>{icon} {label}</span>
                </div>
              ))}
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: "#E2E8F0", marginBottom: 14 }} />

            {/* CTAs */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {canShowPurchaseUI() && (
              <button
                type="button"
                onClick={() => setShowPaywall(true)}
                style={{
                  width: "100%", padding: "13px", borderRadius: 10, border: "none",
                  background: "linear-gradient(135deg,#B8860B,#D4A917)",
                  color: "#0F1923", fontSize: 12, fontWeight: 800,
                  letterSpacing: "0.1em", ...monoStyle,
                  cursor: "pointer",
                  boxShadow: "0 4px 16px rgba(184,134,11,0.35)",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  transition: "all 0.2s",
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(184,134,11,0.45)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 16px rgba(184,134,11,0.35)"; }}
              >
                ✨ UPGRADE TO EDGECIPLINE PRO
              </button>
              )}

              <Link
                href={manualEntryPath}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  padding: "10px", borderRadius: 10,
                  border: "1px solid #E2E8F0", background: "#F8FAFC",
                  color: "#64748B", fontSize: 11, fontWeight: 600,
                  ...monoStyle, letterSpacing: "0.08em", textDecoration: "none",
                  transition: "all 0.2s",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "#F1F5F9"; e.currentTarget.style.color = "#0F1923"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "#F8FAFC"; e.currentTarget.style.color = "#64748B"; }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                CONTINUE WITH MANUAL ENTRY
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* SmartPaywall modal — triggered by upgrade CTA */}
      {canShowPurchaseUI() && (
        <PaywallGate
          isOpen={showPaywall}
          variant="upgrade"
          onClose={() => setShowPaywall(false)}
          onSuccess={() => { setShowPaywall(false); setError(null); }}
        />
      )}

      {/* ── Non-subscription errors (wrong screenshot, upload failure, etc.) ── */}
      {error && !isSubscriptionError && (
        <div style={{ marginTop: 14, borderRadius: 10, border: "1px solid #FCA5A5", background: "#FEF2F2", overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", background: "#FEE2E2", borderBottom: "1px solid #FCA5A5", display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#D63B3B" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span style={{ fontSize: 12, fontWeight: 800, color: "#9B1C1C" }}>
              {isWrongScreenshotError ? "Wrong Image Uploaded" : "Upload Error"}
            </span>
          </div>
          <div style={{ padding: "10px 14px" }}>
            <p style={{ margin: 0, fontSize: 12, color: "#7F1D1D", lineHeight: 1.65 }}>{error}</p>
            {isWrongScreenshotError && (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                {screenshotTips.map((tip, i) => (
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

      {/* Extract / Unlock button
          Two states:
          1. loading  → shows spinner + status text
          2. normal   → opens confirmation modal → triggers extraction
          When isSubscriptionError is true, the upgrade card above already
          carries the "Upgrade" CTA — don't duplicate it here. */}
      {!isSubscriptionError && (
      <button
        onClick={() => {
          if (!file) { setError("Select file"); return; }
          if (isInd && broker === "AUTO") { setError("Select broker"); return; }
          setShowConfirmModal(true);
        }}
        disabled={loading || !file}
        style={{
          marginTop: 16,
          width: "100%",
          padding: "13px",
          fontSize: 12,
          ...monoStyle,
          fontWeight: 700,
          letterSpacing: "0.12em",
          border: "none",
          borderRadius: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          transition: "all 0.25s",
          cursor: loading ? "not-allowed" : "pointer",
          // colour shifts based on state
          color:      loading   ? "#94A3B8"
                    : !file    ? "#94A3B8"
                    : "#FFFFFF",
          background: loading   ? "#F1F5F9"
                    : !file    ? "#F1F5F9"
                    : "linear-gradient(135deg,#B8860B,#D4A917)",
          boxShadow:  !loading && file
                        ? "0 4px 16px rgba(184,134,11,0.32)"
                        : "none",
        }}
        onMouseEnter={e => { if (!loading && file) { e.currentTarget.style.transform = "translateY(-2px)"; } }}
        onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}
      >
        {loading ? (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2.5" style={{ animation: "spin 0.9s linear infinite" }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
            {processingStatus === "cancelling" ? "CANCELLING UPLOAD..."
             : processingStatus === "uploading" ? "UPLOADING SCREENSHOT..."
             : processingStatus === "pending"   ? "QUEUED FOR EXTRACTION..."
             : "EXTRACTING TRADE DATA..."}
          </>
        ) : (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            EXTRACT TRADE DATA
          </>
        )}
      </button>
      )}

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
                  disabled={loading}
                  onClick={() => {
                    if (confirmSubmitRef.current || loading) return;
                    confirmSubmitRef.current = true;
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
                    cursor: loading ? "not-allowed" : "pointer",
                    opacity: loading ? 0.6 : 1,
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

function AccuracyDisclaimer({ isInd, checked, onChange }) {
  const marketLabel = isInd ? "Indian Market" : "Forex";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "34px minmax(0, 1fr)",
        gap: 12,
        padding: "14px 16px",
        background: "#FFFBEB",
        border: "1.5px solid #FCD34D",
        borderRadius: 12,
        margin: "12px 0",
        boxShadow: "0 8px 22px rgba(180,83,9,0.07)",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          background: "#FEF3C7",
          color: "#B45309",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid #FCD34D",
          flexShrink: 0,
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: "#92400E", marginBottom: 4 }}>
          Accuracy disclaimer for {marketLabel} uploads
        </div>
        <div style={{ fontSize: 12, color: "#78350F", lineHeight: 1.55, marginBottom: 10 }}>
          Please correct every extracted field before saving: symbol, date, entry, exit, P&amp;L, size, setup, notes, mood, confidence, emotions, and trade quality. Your reports, coach, streaks, psychology patterns, and behavior analysis are only as accurate as the data you save.
        </div>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer", userSelect: "none" }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
            style={{ width: 16, height: 16, marginTop: 1, accentColor: "#0D9E6E", flexShrink: 0 }}
          />
          <span style={{ fontSize: 11, fontWeight: 800, color: "#0F1923", lineHeight: 1.45 }}>
            I reviewed and corrected the extracted trade and psychology data. Save this as my real trading record.
          </span>
        </label>
      </div>
    </div>
  );
}

function TradeFormCard({ state, tradeIdx = null, psychologyRef = null, accountCreatedDate = "", todayInputMax = "", accuracyAcknowledged = false, registerEvidenceRef = null }) {
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

  // Visual evidence — additional proof screenshots beyond the OCR'd one.
  // Uploads are deferred (like add-trade) so we commit any pending files
  // right before save and pass the result as an override, sidestepping the
  // setState async-closure issue (state.trade won't reflect the commit yet).
  const evidenceRef = useRef(null);
  const [committingEvidence, setCommittingEvidence] = useState(false);
  // Re-register whenever tradeIdx changes — a card can survive a REMOVE ENTRY
  // (same _rowId key) while its positional tradeIdx shifts, and the shared
  // evidenceRefsRef map is keyed by that index. Without this dependency the
  // map would keep pointing "Save All" at the row's stale pre-removal index.
  useEffect(() => {
    if (!registerEvidenceRef) return undefined;
    registerEvidenceRef(tradeIdx, evidenceRef);
    return () => registerEvidenceRef(tradeIdx, null);
  }, [tradeIdx, registerEvidenceRef]);

  const handleSave = async () => {
    // Demo mode never persists — skip the real evidence upload entirely so a
    // demo run doesn't spend a genuine Cloudinary upload for nothing.
    if (state.isDemo) { await state.saveTrade(); return; }
    let tradeImages = trade?.tradeImages || [];
    if (evidenceRef.current?.hasPending()) {
      setCommittingEvidence(true);
      try {
        tradeImages = await evidenceRef.current.commitPending();
      } catch {
        setCommittingEvidence(false);
        return;
      }
      setCommittingEvidence(false);
    }
    if (isMulti) await state.saveExtractedTrade(tradeIdx, { tradeImages });
    else         await state.saveTrade({ tradeImages });
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
              <FormInput label="LOT SIZE" name="lotSize" value={trade?.lotSize} onChange={onChange} placeholder="25" type="number" />
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

      {/* ── Visual Evidence — extra proof screenshots on top of the OCR'd one ── */}
      <SectionCard accentColor={isInd ? "#1B5E20" : "#B8860B"} title="Visual Evidence" subtitle="ATTACH ADDITIONAL PROOF SCREENSHOTS" delay={0.13}>
        <TradeEvidenceSection
          ref={evidenceRef}
          value={trade?.tradeImages || []}
          onChange={imgs => onChange({ target: { name: "tradeImages", value: imgs } })}
          disabled={saved || state.savingAll || committingEvidence}
          accentColor={isInd ? "#1B5E20" : "#B8860B"}
        />
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

      {/* Save button — in demo mode the sample can't be saved; the button
          becomes an inert "demo" affordance that surfaces the not-saved notice. */}
      {!saved && state.isDemo && (
        <button
          onClick={handleSave}
          style={{ width: "100%", padding: "15px", marginTop: 6, background: "linear-gradient(135deg,#0EA5E9,#38BDF8)", color: "#FFFFFF", border: "none", borderRadius: 12, fontSize: 13, ...monoStyle, fontWeight: 700, letterSpacing: "0.1em", cursor: "pointer", boxShadow: "0 4px 16px rgba(14,165,233,0.3)", transition: "all 0.25s", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          DEMO — NOT SAVED TO TRADE LOG
        </button>
      )}
      {!saved && !state.isDemo && (
        <button
          onClick={handleSave}
          disabled={state.savingAll || committingEvidence || !accuracyAcknowledged}
          style={{ width: "100%", padding: "15px", marginTop: 6, background: state.savingAll || committingEvidence || !accuracyAcknowledged ? "#94A3B8" : "linear-gradient(135deg,#0D9E6E,#22C78E)", color: "#FFFFFF", border: "none", borderRadius: 12, fontSize: 13, ...monoStyle, fontWeight: 700, letterSpacing: "0.1em", cursor: state.savingAll || committingEvidence || !accuracyAcknowledged ? "not-allowed" : "pointer", boxShadow: accuracyAcknowledged ? "0 4px 16px rgba(13,158,110,0.3)" : "none", transition: "all 0.25s", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}
          onMouseEnter={e => { if (!state.savingAll && !committingEvidence && accuracyAcknowledged) e.currentTarget.style.transform = "translateY(-2px)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}
        >
          {committingEvidence ? (
            <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin 0.8s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>UPLOADING EVIDENCE...</>
          ) : state.savingAll ? (
            <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin 0.8s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>SAVING...</>
          ) : !accuracyAcknowledged ? (
            "REVIEW DATA TO ENABLE SAVE"
          ) : (
            <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>{isMulti ? `SAVE TRADE #${tradeIdx + 1}` : "SAVE TO TRADE LOG"}</>
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
  const { isInd, isDemo, mounted, loading, processingStatus, trade, trades, savedTrades, savingAll, saveAllTrades, tradeCount, todayInputMax, isRedirecting } = state;
  const onboardingMarket = isInd ? "Indian_Market" : "Forex";
  const realUploadPath = getOnboardingUploadPath(onboardingMarket);
  const demoUploadPath = getOnboardingUploadPath(onboardingMarket, { demo: true });
  const manualEntryPath = isInd
    ? "/indian-market/add-trade?onboarding=1"
    : "/add-trade?onboarding=1";
  const visibleTradeCount = trades.length > 1 ? trades.length : tradeCount;
  const [accuracyAcknowledged, setAccuracyAcknowledged] = useState(false);
  const parseProfitValue = (value) => parseFloat(String(value || 0).replace(/,/g, "")) || 0;
  // Demo replays these stages locally — nothing leaves the browser — so it gets
  // its own copy rather than claiming to upload and queue work server-side.
  const extractionStepMap = isDemo ? {
    uploading: { label: "Loading sample screenshot", hint: "Reading the bundled demo image", progress: 25 },
    cancelling: { label: "Cancelling demo", hint: "Clearing the sample extraction", progress: 10 },
    pending: { label: "Preparing sample extraction", hint: "No upload — the demo runs on your device", progress: 45 },
    processing: { label: "Reading sample trade details", hint: "Filling the form from bundled sample data", progress: 75 },
    completed: { label: "Demo extraction completed", hint: "Nothing was uploaded or stored", progress: 100 },
  } : {
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

  // Multi-trade evidence refs — each TradeFormCard registers its own
  // TradeEvidenceSection ref here so "Save All" can commit any pending
  // uploads across every card before building the batch payload.
  const evidenceRefsRef = useRef({});
  const registerEvidenceRef = useCallback((idx, ref) => {
    if (ref) evidenceRefsRef.current[idx] = ref;
    else delete evidenceRefsRef.current[idx];
  }, []);
  const [committingAllEvidence, setCommittingAllEvidence] = useState(false);
  const handleSaveAll = async () => {
    if (isDemo) { await saveAllTrades(); return; }
    const overridesByIdx = {};
    setCommittingAllEvidence(true);
    try {
      for (const [idxStr, ref] of Object.entries(evidenceRefsRef.current)) {
        if (ref?.current?.hasPending?.()) {
          overridesByIdx[idxStr] = await ref.current.commitPending();
        }
      }
    } catch {
      setCommittingAllEvidence(false);
      return;
    }
    setCommittingAllEvidence(false);
    await saveAllTrades(overridesByIdx);
  };

  useEffect(() => {
    if (visibleTradeCount || !accuracyAcknowledged) return undefined;
    const resetId = setTimeout(() => setAccuracyAcknowledged(false), 0);
    return () => clearTimeout(resetId);
  }, [visibleTradeCount, accuracyAcknowledged]);

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
        <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}@keyframes fadeSlideUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}`}</style>
      </main>
    );
  }

  if (isRedirecting) {
    return (
      <div style={{ minHeight: "100vh", background: "#F0EEE9", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
        <div style={{ textAlign: "center", padding: 40 }}>
          {/* Animated checkmark circle */}
          <div style={{ width: 72, height: 72, borderRadius: "50%", background: "linear-gradient(135deg,#0D9E6E,#22C78E)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", boxShadow: "0 12px 32px rgba(13,158,110,0.35)", animation: "journalPop 0.5s cubic-bezier(0.22,1,0.36,1) both" }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.8">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#0F1923", marginBottom: 8, letterSpacing: "-0.01em" }}>
            Trade saved!
          </div>
          <div style={{ fontSize: 13, color: "#64748B", marginBottom: 28, fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.04em" }}>
            TAKING YOU TO YOUR TRADE LOG...
          </div>
          {/* Progress bar */}
          <div style={{ width: 200, height: 4, background: "#E2E8F0", borderRadius: 99, margin: "0 auto", overflow: "hidden" }}>
            <div style={{ height: "100%", background: "linear-gradient(90deg,#0D9E6E,#22C78E)", borderRadius: 99, animation: "journalProgress 1.1s ease-out forwards" }} />
          </div>
        </div>
        <style>{`
          @keyframes journalPop { from { opacity:0; transform:scale(0.6); } to { opacity:1; transform:scale(1); } }
          @keyframes journalProgress { from { width:0%; } to { width:100%; } }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F0EEE9", display: "flex", flexDirection: "column", fontFamily: "'Plus Jakarta Sans',sans-serif", color: "#0F1923", position: "relative" }}>
      <CandlestickBackground canvasId="upload-bg-canvas" />

      <TradeLimitDialog
        open={Boolean(state.limitBlock)}
        quota={state.limitBlock?.quota}
        requested={state.limitBlock?.requested}
        onClose={state.dismissLimitBlock}
      />

      <div style={{ position: "relative", zIndex: 10, display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <PageHeader showMarketSwitcher showClock clock={clock} />
        <TickerTape />

        <main style={{ flex: 1, maxWidth: 900, width: "100%", margin: "0 auto", padding: "28px 20px", boxSizing: "border-box", animation: "fadeUp 0.45s ease both" }}>
          {isDemo && (
            <div style={{
              padding: "14px 16px", borderRadius: 12,
              background: "linear-gradient(135deg, rgba(14,165,233,0.10), rgba(14,165,233,0.04))",
              border: "1px solid rgba(14,165,233,0.35)",
              marginBottom: 18,
            }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", color: "#0284C7", fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>
                DEMO MODE · SAMPLE SCREENSHOT
              </div>
              <div style={{ fontSize: 13, color: "#0F1923", lineHeight: 1.6 }}>
                We loaded a <strong>sample {isInd ? "Indian broker" : "MT5"} screenshot</strong> for you. Hit <strong>Extract Trade Data</strong> to watch the AI read it — exactly how it works with your own screenshots. <strong>Nothing here is saved</strong> to your trade log.
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "#64748B" }}>
                Ready with your own? <Link href={realUploadPath} style={{ color: "#0284C7", fontWeight: 700, textDecoration: "none" }}>Upload a real screenshot →</Link>
              </div>
            </div>
          )}
          {onboardingMode && !isDemo && (
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
                {isInd ? (
                  <>Upload a <strong>Zerodha, Upstox, Groww, Angel One, Dhan, or Fyers screenshot</strong>. Our AI reads it and fills in the symbol, quantity, entry, exit, and P&amp;L. Review the details, then save it to your Indian Market trade log.</>
                ) : (
                  <>Upload an <strong>MT4, MT5, cTrader, or Forex broker screenshot</strong>. Our AI reads it and fills in the pair, lot size, entry, exit, and P&amp;L. Review the details, then save it to your Forex trade log.</>
                )}
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "#64748B" }}>
                Prefer typing it in? <Link href={manualEntryPath} style={{ color: "#0D9E6E", fontWeight: 700, textDecoration: "none" }}>Manual entry →</Link>
              </div>
            </div>
          )}

          {/* No screenshot of your own? Prominent demo option — loads the bundled
              sample and blocks save so nothing is persisted. Shown in onboarding
              as the clear fallback to uploading a real screenshot. */}
          {onboardingMode && !isDemo && (
            <Link
              href={demoUploadPath}
              style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "18px 18px", borderRadius: 14, marginBottom: 18,
                background: "linear-gradient(135deg, rgba(14,165,233,0.14), rgba(14,165,233,0.05))",
                border: "1.5px solid rgba(14,165,233,0.5)",
                boxShadow: "0 4px 16px rgba(14,165,233,0.12)",
                textDecoration: "none",
              }}
            >
              <span aria-hidden style={{ width: 46, height: 46, borderRadius: 12, background: "#0EA5E9", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 4px 12px rgba(14,165,233,0.4)" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="#FFFFFF" stroke="none"/></svg>
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#0C4A6E", marginBottom: 3 }}>
                  Don&apos;t have a screenshot? Try a demo
                </div>
                <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.5 }}>
                  We&apos;ll load a sample {isInd ? "Indian" : "Forex"} screenshot and run real AI extraction — so you see exactly how it works. Nothing is saved to your trade log.
                </div>
              </div>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0284C7" strokeWidth="2.5" style={{ flexShrink: 0 }}><polyline points="9 18 15 12 9 6"/></svg>
            </Link>
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
                  Review the details below and save to your trade log
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
            <AccuracyDisclaimer
              isInd={isInd}
              checked={accuracyAcknowledged}
              onChange={setAccuracyAcknowledged}
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

              {/* Individual trade cards — collapse to a saved chip once saved.
                  Keyed on the row's stable _rowId (not the array index): each
                  card now owns real local state (pending evidence uploads), so
                  an index-based key would let React reuse a card's instance —
                  and its unsaved evidence — for a different trade after
                  REMOVE ENTRY shifts the array. */}
              {trades.map((t, i) => {
                const rowKey = t?._rowId ?? i;
                if (savedTrades[i]) {
                  const bull = parseFloat(String(t?.profit || 0).replace(/,/g, "")) >= 0;
                  return (
                    <div
                      key={rowKey}
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
                          {bull ? "+" : ""}{isInd ? "₹" : "$"}{Math.abs(parseFloat(String(t?.profit || 0).replace(/,/g, ""))).toFixed(2)} · Saved to trade log
                        </div>
                      </div>
                    </div>
                  );
                }
                return <TradeFormCard key={rowKey} state={state} tradeIdx={i} accountCreatedDate={accountCreatedDate} todayInputMax={todayInputMax} accuracyAcknowledged={accuracyAcknowledged} registerEvidenceRef={registerEvidenceRef} />;
              })}

              {/* Save all */}
              {savedTrades.some(s => !s) && isDemo && (
                <button
                  onClick={handleSaveAll}
                  style={{ width: "100%", padding: "16px", background: "linear-gradient(135deg,#0EA5E9,#38BDF8)", color: "#FFFFFF", border: "none", borderRadius: 12, fontSize: 13, ...monoStyle, fontWeight: 700, letterSpacing: "0.1em", cursor: "pointer", boxShadow: "0 4px 16px rgba(14,165,233,0.3)", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 8 }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  DEMO — NOT SAVED TO TRADE LOG
                </button>
              )}
              {savedTrades.some(s => !s) && !isDemo && (
                <button
                  onClick={handleSaveAll} disabled={savingAll || committingAllEvidence || !accuracyAcknowledged}
                  style={{ width: "100%", padding: "16px", background: savingAll || committingAllEvidence || !accuracyAcknowledged ? "#F1F5F9" : "linear-gradient(135deg,#0F1923,#1a2d3d)", color: savingAll || committingAllEvidence || !accuracyAcknowledged ? "#94A3B8" : "#22C78E", border: "1px solid rgba(34,199,142,0.3)", borderRadius: 12, fontSize: 13, ...monoStyle, fontWeight: 700, letterSpacing: "0.1em", cursor: savingAll || committingAllEvidence || !accuracyAcknowledged ? "not-allowed" : "pointer", boxShadow: accuracyAcknowledged ? "0 4px 16px rgba(15,25,35,0.2)" : "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 8 }}
                >
                  {committingAllEvidence ? (<><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin 0.8s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>UPLOADING EVIDENCE...</>) : savingAll ? (<><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin 0.8s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>SAVING...</>) : !accuracyAcknowledged ? "REVIEW DATA TO ENABLE SAVE ALL" : "SAVE ALL TRADES"}
                </button>
              )}
            </>
          )}

          {/* ── Single trade path ─────────────────────────────────────────── */}
          {trade && trades.length <= 1 && <TradeFormCard state={state} psychologyRef={psychologyRef} accountCreatedDate={accountCreatedDate} todayInputMax={todayInputMax} accuracyAcknowledged={accuracyAcknowledged} />}

          {/* No extraction yet */}
          {!loading && !trade && trades.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#94A3B8", fontSize: 13 }}>
              Upload a screenshot above to begin AI extraction.
            </div>
          )}
        </main>
      </div>

      <style>{`
        @keyframes blink        { 0%,100%{opacity:1} 50%{opacity:0.2} }
        @keyframes spin         { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes ticker       { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
        @keyframes fadeUp       { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimmer      { 0%{transform:translateX(-100%)} 100%{transform:translateX(200%)} }
        @keyframes fadeSlideUp  { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
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
            The upload form encountered an error. Your unsaved data may be lost, but your previously saved trades are safe in your trade log.
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
              MY TRADE LOG
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
        <OnboardingMarketGuard>
          <UploadTradeContent />
        </OnboardingMarketGuard>
      </Suspense>
    </ErrorBoundary>
  );
}
