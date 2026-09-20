"use client";

import { Suspense, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Camera, Save, ArrowLeft } from "lucide-react";
import TradeEvidenceSection from "@/features/trade/components/TradeEvidenceSection";
import TradeLimitDialog from "@/features/trade/components/TradeLimitDialog";
import LastFreeTradeSheet from "@/features/trade/components/LastFreeTradeSheet";
import TradeQuotaPill from "@/features/trade/components/TradeQuotaPill";
import TickerTape            from "@/features/shared/components/TickerTape";
import PageHeader            from "@/features/shared/components/PageHeader";
import { useClock }          from "@/features/shared/hooks/useClock";
import { useMarket }         from "@/context/MarketContext";
import SetupChecklist        from "@/features/trade/components/SetupChecklist";
import { useAddTrade, UNDERLYINGS } from "@/features/trade/hooks/useAddTrade";
import { blockInvalidNumberKeys } from "@/features/trade/lib/numericInput";
import { getTodayInputValue } from "@/features/trade/lib/dateInput";
import { useUserProfile }   from "@/features/auth/hooks/useUserProfile";
import { Spinner }           from "@/features/shared";

const MOODS = [
  { emoji: "😰", val: 1, label: "Stressed" },
  { emoji: "😟", val: 2, label: "Anxious" },
  { emoji: "😐", val: 3, label: "Neutral" },
  { emoji: "😊", val: 4, label: "Good" },
  { emoji: "🔥", val: 5, label: "Peak" },
];

const EMOTIONS = ["FOMO", "Revenge", "Fear", "Greed", "Calm", "Bored", "Focused", "Frustrated"];

// Same raw-input visual language as app/indian-market/add-trade/page.js so
// manual entry looks and behaves identically for both markets — only the
// fields inside each section differ where the instrument genuinely does
// (e.g. strike/CE-PE for Indian options vs pair/lot size for Forex).
const theme = {
  bull: "#0D9E6E",
  bear: "#D63B3B",
  primary: "#0D9E6E",
  secondary: "#0F1923",
  muted: "#94A3B8",
  border: "#E2E8F0",
  bg: "#F0EEE9",
  card: "#FFFFFF",
};

const monoStyle = { fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.06em" };
const fieldLabel = { display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 };
const fieldInput = { width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14, fontFamily: "'Plus Jakarta Sans',sans-serif" };

function Field({ label, required, children }) {
  return (
    <div>
      <label style={fieldLabel}>{label}{required && <span style={{ color: theme.bear }}> *</span>}</label>
      {children}
    </div>
  );
}

function AddTradeContent() {
  const { currentMarket, getCurrencySymbol, isIndianMarket } = useMarket();
  const clock = useClock();
  const searchParams = useSearchParams();
  const onboardingMode = searchParams?.get("onboarding") === "1";
  const fileInputRef = useRef(null);
  const evidenceRef = useRef(null);
  const [committingEvidence, setCommittingEvidence] = useState(false);

  const {
    trade, setTrade, handleChange, handleStrategyChange, handleScreenshotChange,
    setupRules, toggleSetupRule, updateSetupRuleLabel, addSetupRule, clearSetupRules,
    handleSubmit, screenshotPreview, uploading, isSaving, setupsLoading, strategies, mounted,
    limitBlock, dismissLimitBlock,
    lastFreeTradeSheet, closeLastFreeTradeSheet,
    tradeSubType, setTradeSubType, isEquity,
  } = useAddTrade(currentMarket, isIndianMarket);

  const { accountCreatedDate } = useUserProfile();
  const bull = parseFloat(trade.profit || 0) >= 0;
  const inProgress = uploading || isSaving || committingEvidence;

  // Wrap form submit: upload pending evidence images first, then submit
  // with the final tradeImages array passed as a direct override (bypasses
  // setState's async closure).
  const onFormSubmit = async (e) => {
    e.preventDefault();
    let tradeImages = trade.tradeImages || [];
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
    handleSubmit(e, { accountCreatedDate, tradeOverrides: { tradeImages } });
  };

  return (
    <div style={{ minHeight: "100vh", background: theme.bg, fontFamily: "'Plus Jakarta Sans',sans-serif", color: theme.secondary }}>
      <PageHeader showMarketSwitcher showClock clock={clock} />
      <TickerTape />

      <main style={{ maxWidth: 640, margin: "0 auto", padding: "28px 20px", opacity: mounted ? 1 : 0, transform: mounted ? "translateY(0)" : "translateY(16px)", transition: "all 0.5s cubic-bezier(0.4, 0, 0.2, 1)" }}>
        {onboardingMode && (
          <div style={{
            padding: "12px 14px", borderRadius: 10,
            background: "linear-gradient(135deg, rgba(34,199,142,0.08), rgba(13,158,110,0.04))",
            border: "1px solid rgba(34,199,142,0.25)",
            marginBottom: 18,
          }}>
            <div style={{ fontSize: "var(--fs-2xs)", fontWeight: 800, letterSpacing: "0.12em", color: theme.primary, ...monoStyle, marginBottom: 4 }}>
              STEP 2 OF 3 · LOG YOUR FIRST TRADE
            </div>
            <div style={{ fontSize: 13, color: theme.secondary, lineHeight: 1.55 }}>
              Pick the setup you just created, fill the basics (pair, entry, exit, P&amp;L), and hit <strong>Commit</strong>. You can attach a screenshot now or skip and add it later.
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 10 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 4, color: theme.secondary }}>
              Log New <span style={{ color: theme.primary }}>{isIndianMarket ? (isEquity ? "Stock Trade" : "Options Trade") : "Forex Trade"}</span>
            </h1>
            <p style={{ fontSize: 12, color: theme.muted, marginBottom: 0, ...monoStyle }}>
              {isIndianMarket ? (isEquity ? "NSE / BSE EQUITY INTRADAY" : "NSE / BSE F&O MARKET ENTRY") : "GLOBAL CURRENCY MARKET ENTRY"}
            </p>
            <TradeQuotaPill marketType={currentMarket} style={{ marginTop: 10 }} />
          </div>
          <Link href="/trades" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, color: "#4A5568", textDecoration: "none", padding: "10px 14px", minHeight: 44, background: theme.card, borderRadius: 8, border: `1px solid ${theme.border}`, whiteSpace: "nowrap" }}>
            <ArrowLeft size={14} /> TRADE LOG
          </Link>
        </div>

        <form onSubmit={onFormSubmit} style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* ── Instrument type toggle (Indian only) ── */}
          {isIndianMarket && (
            <div style={{ display: "flex", gap: 0, borderRadius: 8, overflow: "hidden", border: `1.5px solid ${theme.border}` }}>
              {[{ v: "OPTION", label: "Options" }, { v: "EQUITY", label: "Intraday Stocks" }].map(({ v, label }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setTradeSubType(v)}
                  style={{
                    flex: 1, padding: "11px 0", border: "none",
                    background: tradeSubType === v ? theme.primary : theme.card,
                    color: tradeSubType === v ? "#FFFFFF" : theme.muted,
                    fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "all 0.15s",
                    fontFamily: "'Plus Jakarta Sans',sans-serif", letterSpacing: "0.04em",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* ── Core Details ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {isIndianMarket ? (
              isEquity ? (
                <>
                  <Field label="Stock Symbol" required>
                    <input name="stockSymbol" placeholder="e.g. RELIANCE, TCS, HDFC" value={trade.stockSymbol} onChange={handleChange} style={{ ...fieldInput, textTransform: "uppercase" }} />
                  </Field>
                  <div className="form-2col" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
                    <Field label="Exchange">
                      <select name="exchange" value={trade.exchange} onChange={handleChange} style={fieldInput}>
                        <option value="NSE">NSE</option>
                        <option value="BSE">BSE</option>
                      </select>
                    </Field>
                    <Field label="Buy / Sell">
                      <select name="type" value={trade.type} onChange={handleChange} style={fieldInput}>
                        <option value="BUY">BUY</option>
                        <option value="SELL">SELL</option>
                      </select>
                    </Field>
                  </div>
                  <div className="form-2col" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
                    <Field label="Shares Qty" required>
                      <input name="sharesQty" type="number" min="1" placeholder="e.g. 100" value={trade.sharesQty} onChange={handleChange} onKeyDown={blockInvalidNumberKeys} style={fieldInput} />
                    </Field>
                    <Field label="Sector">
                      <select name="sector" value={trade.sector} onChange={handleChange} style={fieldInput}>
                        <option value="">Auto-detect</option>
                        <option value="IT">IT</option>
                        <option value="Banking">Banking</option>
                        <option value="Pharma">Pharma</option>
                        <option value="Auto">Auto</option>
                        <option value="FMCG">FMCG</option>
                        <option value="Metal">Metal</option>
                        <option value="Energy">Energy</option>
                        <option value="Infra">Infra</option>
                        <option value="Telecom">Telecom</option>
                        <option value="Realty">Realty</option>
                        <option value="Other">Other</option>
                      </select>
                    </Field>
                  </div>
                </>
              ) : (
                <>
                  <Field label="Underlying">
                    <select name="underlying" value={trade.underlying} onChange={handleChange} style={fieldInput}>
                      {UNDERLYINGS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </Field>
                  {trade.underlying === "Other" && (
                    <Field label="Symbol">
                      <input name="underlyingOther" placeholder="e.g. RELIANCE" value={trade.underlyingOther} onChange={handleChange} style={fieldInput} />
                    </Field>
                  )}
                  <Field label="Strike (₹)" required>
                    <input name="strikePrice" type="number" min="1" step="1" placeholder="e.g. 26100" value={trade.strikePrice} onChange={handleChange} onKeyDown={blockInvalidNumberKeys} style={fieldInput} />
                  </Field>
                  <div className="form-2col" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
                    <Field label="CE / PE">
                      <select name="optionType" value={trade.optionType} onChange={handleChange} style={fieldInput}>
                        <option value="CE">CE</option>
                        <option value="PE">PE</option>
                      </select>
                    </Field>
                    <Field label="Buy / Sell">
                      <select name="type" value={trade.type} onChange={handleChange} style={fieldInput}>
                        <option value="BUY">BUY</option>
                        <option value="SELL">SELL</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="Qty (lots)" required>
                    <input name="quantity" type="number" min="1" placeholder="e.g. 3" value={trade.quantity} onChange={handleChange} onKeyDown={blockInvalidNumberKeys} style={fieldInput} />
                  </Field>
                </>
              )
            ) : (
              <>
                <Field label="Pair" required>
                  <input name="pair" placeholder="XAUUSD" value={trade.pair} onChange={handleChange} style={{ ...fieldInput, textTransform: "uppercase" }} />
                </Field>
                <div className="form-2col" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
                  <Field label="Action">
                    <select name="type" value={trade.type} onChange={handleChange} style={fieldInput}>
                      <option value="BUY">BUY</option>
                      <option value="SELL">SELL</option>
                    </select>
                  </Field>
                  <Field label="Lot Size">
                    <input name="lotSize" type="number" step="any" placeholder="0.01" value={trade.lotSize} onChange={handleChange} style={fieldInput} />
                  </Field>
                </div>
              </>
            )}

            <div className="form-2col" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
              <Field label={isEquity ? "Avg buy price" : isIndianMarket ? "Entry premium (₹)" : "Entry Price"} required>
                <input name="entryPrice" type="number" step="any" placeholder={isEquity ? "e.g. 2450.50" : isIndianMarket ? "e.g. 85.50" : "0.00"} value={trade.entryPrice} onChange={handleChange} onKeyDown={blockInvalidNumberKeys} style={fieldInput} />
              </Field>
              <Field label={isEquity ? "Avg sell price" : isIndianMarket ? "Exit premium (₹)" : "Exit Price"} required>
                <input name="exitPrice" type="number" step="any" placeholder={isEquity ? "e.g. 2510" : isIndianMarket ? "e.g. 120" : "0.00"} value={trade.exitPrice} onChange={handleChange} onKeyDown={blockInvalidNumberKeys} style={fieldInput} />
              </Field>
            </div>

            <Field label={`Net Profit (${getCurrencySymbol()})`} required>
              <input
                name="profit" type="number" step="any" placeholder="e.g. 1500 or -500"
                value={trade.profit} onChange={handleChange} onKeyDown={blockInvalidNumberKeys}
                style={{ ...fieldInput, color: bull ? theme.bull : theme.bear, fontSize: 18, fontWeight: 800, background: bull ? "rgba(13,158,110,0.05)" : "rgba(214,59,59,0.05)" }}
              />
            </Field>
          </div>

          {/* ── Risk Management ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="form-2col" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
              <Field label="Stop Loss">
                <input name="stopLoss" type="number" step="any" value={trade.stopLoss} onChange={handleChange} onKeyDown={blockInvalidNumberKeys} style={fieldInput} />
              </Field>
              <Field label="Take Profit">
                <input name="takeProfit" type="number" step="any" value={trade.takeProfit} onChange={handleChange} onKeyDown={blockInvalidNumberKeys} style={fieldInput} />
              </Field>
            </div>
            {isIndianMarket && !isEquity && (
              <Field label="Trade type">
                <select name="tradeType" value={trade.tradeType} onChange={handleChange} style={fieldInput}>
                  <option value="INTRADAY">Intraday</option>
                  <option value="DELIVERY">Delivery</option>
                  <option value="SWING">Swing</option>
                </select>
              </Field>
            )}
            <Field label="Trade Date" required>
              <input name="tradeDate" type="date" value={trade.tradeDate} onChange={handleChange} min={accountCreatedDate || undefined} max={getTodayInputValue()} style={fieldInput} />
              {accountCreatedDate && (
                <div style={{ fontSize: "var(--fs-2xs)", color: theme.muted, marginTop: 5, ...monoStyle }}>
                  Earliest: {accountCreatedDate}
                </div>
              )}
            </Field>
            <div>
              <label style={fieldLabel}>Planned Risk : Reward <span style={{ color: theme.bear }}>*</span></label>
              <select name="riskRewardRatio" value={trade.riskRewardRatio} onChange={handleChange} style={fieldInput}>
                <option value="">Select...</option>
                <option value="1:1">1 : 1</option>
                {isIndianMarket && <option value="1:1.5">1 : 1.5</option>}
                <option value="1:2">1 : 2</option>
                <option value="1:3">1 : 3</option>
                <option value="1:4">1 : 4</option>
                <option value="1:5">1 : 5</option>
                <option value="custom">Custom</option>
              </select>
              {trade.riskRewardRatio === "custom" && (
                <input name="riskRewardCustom" placeholder="e.g. 1:2.5" value={trade.riskRewardCustom} onChange={handleChange} style={{ ...fieldInput, marginTop: 8 }} />
              )}
            </div>
          </div>

          {/* ── Strategy & Checklist ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={fieldLabel}>Setup{setupsLoading ? " (loading...)" : ""}</label>
              <select name="strategy" value={trade.strategy} onChange={handleStrategyChange} style={fieldInput}>
                <option value="">Select setup...</option>
                {strategies.filter(s => s.name?.trim()).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                <option value="Custom">Custom</option>
              </select>
              {trade.strategy === "Custom" && (
                <input name="strategyCustom" placeholder="Enter setup name" value={trade.strategyCustom} onChange={handleChange} style={{ ...fieldInput, marginTop: 8 }} />
              )}
            </div>
            <SetupChecklist rules={setupRules} onToggle={toggleSetupRule} onUpdateLabel={updateSetupRuleLabel} onAdd={addSetupRule} onClear={clearSetupRules} />
            <Field label="Setup / Pattern">
              <input name="setup" placeholder={isIndianMarket ? "e.g. Breakout above 26200" : "e.g. Breakout above 1.0950"} value={trade.setup} onChange={handleChange} style={fieldInput} />
            </Field>
            {isIndianMarket && !isEquity && (
              <Field label="Expiry date">
                <input name="expiryDate" type="date" value={trade.expiryDate} onChange={handleChange} style={fieldInput} />
              </Field>
            )}
          </div>

          {/* ── Journal ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={fieldLabel}>Entry Basis</label>
              <select name="entryBasis" value={trade.entryBasis} onChange={handleChange} style={fieldInput}>
                <option value="Plan">Rule Based / Plan</option>
                <option value="Emotion">Emotional</option>
                <option value="Impulsive">Impulsive</option>
                <option value="Custom">Custom Basis</option>
              </select>
              {trade.entryBasis === "Custom" && (
                <input name="entryBasisCustom" placeholder="e.g. News-driven scalp, FOMO, etc." value={trade.entryBasisCustom} onChange={handleChange} style={{ ...fieldInput, marginTop: 8 }} />
              )}
            </div>
            <Field label="Mistake (if any)">
              <select name="mistakeTag" value={trade.mistakeTag} onChange={handleChange} style={fieldInput}>
                <option value="">None</option>
                <option value="Overtraded">Overtraded</option>
                <option value="Held too long">Held too long</option>
                <option value="Exited early">Exited early</option>
                {isEquity ? <option value="Wrong stock">Wrong stock</option> : <option value="Wrong strike">Wrong strike</option>}
                <option value="Revenge trade">Revenge trade</option>
                <option value="No stop">No stop</option>
                <option value="Other">Other</option>
              </select>
            </Field>
            <Field label="Lesson (one line)">
              <input name="lesson" placeholder="e.g. Never add to a losing position" value={trade.lesson} onChange={handleChange} style={fieldInput} />
            </Field>
            <Field label="Notes">
              <textarea name="notes" placeholder="Setup, context, emotions..." value={trade.notes} onChange={handleChange} rows={3} maxLength={2000} style={{ ...fieldInput, resize: "vertical" }} />
              <div style={{ fontSize: "var(--fs-2xs)", color: theme.muted, textAlign: "right", marginTop: 4 }}>{(trade.notes || "").length}/2000</div>
            </Field>
          </div>

          {/* ── Visual Evidence ── */}
          <div>
            <label style={fieldLabel}>Screenshot</label>
            <input type="file" ref={fileInputRef} accept="image/*" onChange={e => handleScreenshotChange(e.target.files[0])} style={{ display: "none" }} />
            <div
              onClick={() => !inProgress && fileInputRef.current.click()}
              style={{ border: `2px dashed ${theme.border}`, borderRadius: 16, padding: 32, textAlign: "center", cursor: inProgress ? "not-allowed" : "pointer", background: "#fafafa", transition: "all 0.2s" }}
              onMouseEnter={e => !inProgress && (e.currentTarget.style.borderColor = theme.primary)}
              onMouseLeave={e => !inProgress && (e.currentTarget.style.borderColor = theme.border)}
            >
              {screenshotPreview ? (
                <div style={{ position: "relative" }}>
                  <img src={screenshotPreview} alt="Preview" style={{ maxHeight: 300, width: "100%", objectFit: "contain", margin: "0 auto", borderRadius: 12 }} />
                  {uploading && (
                    <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.7)", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12 }}>
                      <Spinner size="40px" color={theme.primary} />
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 56, height: 56, borderRadius: "50%", background: theme.bg, display: "flex", alignItems: "center", justifyContent: "center", color: theme.muted }}>
                    <Camera size={28} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: theme.secondary }}>Upload Screenshot</div>
                    <div style={{ fontSize: 11, color: theme.muted, marginTop: 4 }}>Drag & drop or click to browse</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Multi-image Trade Evidence ── */}
          <div>
            <label style={fieldLabel}>Trade Evidence</label>
            <TradeEvidenceSection
              ref={evidenceRef}
              value={trade.tradeImages || []}
              onChange={imgs => setTrade(prev => ({ ...prev, tradeImages: imgs }))}
              disabled={inProgress}
              accentColor={isIndianMarket ? "#22C78E" : theme.primary}
            />
          </div>

          {/* ── Costs ── */}
          <div className="form-2col" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            {isIndianMarket ? (
              <>
                <Field label="Brokerage (₹)">
                  <input name="brokerage" type="number" step="any" placeholder="0" value={trade.brokerage} onChange={handleChange} onKeyDown={blockInvalidNumberKeys} style={fieldInput} />
                </Field>
                <Field label="STT / Taxes (₹)">
                  <input name="sttTaxes" type="number" step="any" placeholder="0" value={trade.sttTaxes} onChange={handleChange} onKeyDown={blockInvalidNumberKeys} style={fieldInput} />
                </Field>
              </>
            ) : (
              <>
                <Field label="Commission">
                  <input name="commission" type="number" step="any" placeholder="0" value={trade.commission} onChange={handleChange} style={fieldInput} />
                </Field>
                <Field label="Swap">
                  <input name="swap" type="number" step="any" placeholder="0" value={trade.swap} onChange={handleChange} style={fieldInput} />
                </Field>
              </>
            )}
          </div>

          {/* ── Psychology ── */}
          <div style={{ background: theme.card, borderRadius: 12, padding: 20, border: `1px solid ${theme.border}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: theme.secondary, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              TRADE PSYCHOLOGY
              <span style={{ fontSize: "var(--fs-2xs)", color: theme.bear, fontWeight: 700, ...monoStyle, background: "#FFF0F0", padding: "2px 6px", borderRadius: 4 }}>REQUIRED</span>
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ ...fieldLabel, marginBottom: 8 }}>How are you feeling? <span style={{ color: theme.bear }}>*</span></label>
              <div className="mood-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
                {MOODS.map(m => (
                  <button key={m.val} type="button" onClick={() => setTrade(p => ({ ...p, mood: p.mood === m.val ? null : m.val }))}
                    style={{
                      padding: "10px 4px", borderRadius: 12, cursor: "pointer", minHeight: 72,
                      border: trade.mood === m.val ? `2px solid ${theme.primary}` : `1px solid ${theme.border}`,
                      background: trade.mood === m.val ? "rgba(13,158,110,0.08)" : theme.card,
                      transition: "all 0.2s", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center"
                    }}>
                    <div style={{ fontSize: 22, marginBottom: 4 }}>{m.emoji}</div>
                    <div style={{ fontSize: "var(--fs-2xs)", color: trade.mood === m.val ? theme.primary : theme.muted, fontWeight: 800, letterSpacing: "0.02em" }}>{m.label.toUpperCase()}</div>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={fieldLabel}>Confidence level <span style={{ color: theme.bear }}>*</span></label>
              <select name="confidence" value={trade.confidence} onChange={handleChange} style={fieldInput}>
                <option value="">Select confidence...</option>
                <option value="Low">Low - Unsure about this setup</option>
                <option value="Medium">Medium - Decent setup</option>
                <option value="High">High - Strong conviction</option>
                <option value="Overconfident">Overconfident - Cannot lose</option>
              </select>
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ ...fieldLabel, marginBottom: 8 }}>Emotional Tags <span style={{ color: theme.bear }}>*</span></label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {EMOTIONS.map(tag => {
                  const sel = trade.emotionalTags?.includes(tag);
                  return (
                    <button key={tag} type="button" onClick={() => setTrade(p => ({ ...p, emotionalTags: sel ? p.emotionalTags.filter(t=>t!==tag) : [...(p.emotionalTags||[]), tag] }))}
                      style={{
                        padding: "8px 18px", borderRadius: 99, fontSize: 12, fontWeight: 700,
                        cursor: "pointer", border: sel ? `2px solid ${theme.primary}` : `1.5px solid ${theme.border}`,
                        background: sel ? "rgba(13,158,110,0.1)" : theme.card,
                        color: sel ? theme.primary : theme.muted,
                        transition: "all 0.2s"
                      }}>
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ ...fieldLabel, marginBottom: 8 }}>Would you retake this trade?</label>
              <div style={{ display: "flex", gap: 10 }}>
                {["Yes", "No"].map(option => (
                  <button key={option} type="button" onClick={() => setTrade(p => ({ ...p, wouldRetake: p.wouldRetake === option ? "" : option }))}
                    style={{
                      flex: 1, padding: "10px", borderRadius: 10, cursor: "pointer", fontSize: 12, fontWeight: 700, transition: "all 0.2s",
                      border: trade.wouldRetake === option ? `1.5px solid ${option === "Yes" ? theme.bull : theme.bear}` : `1px solid ${theme.border}`,
                      background: trade.wouldRetake === option ? (option === "Yes" ? "rgba(13,158,110,0.06)" : "rgba(214,59,59,0.06)") : "#F8FAFC",
                      color: trade.wouldRetake === option ? (option === "Yes" ? theme.bull : theme.bear) : theme.muted
                    }}>
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ ...fieldLabel, marginBottom: 8 }}>Trade Quality (how well did you execute?)</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8 }}>
                {[
                  { val: "Great", color: theme.bull, desc: "Followed the plan" },
                  { val: "Average", color: "#F59E0B", desc: "Partial execution" },
                  { val: "Poor", color: theme.bear, desc: "Broke the rules" },
                ].map(q => (
                  <button key={q.val} type="button" onClick={() => setTrade(p => ({ ...p, tradeQuality: p.tradeQuality === q.val ? "" : q.val }))}
                    style={{
                      padding: "10px 4px", borderRadius: 12, cursor: "pointer", textAlign: "center",
                      border: trade.tradeQuality === q.val ? `2px solid ${q.color}` : `1.5px solid ${theme.border}`,
                      background: trade.tradeQuality === q.val ? `${q.color}14` : theme.card,
                      transition: "all 0.2s"
                    }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: trade.tradeQuality === q.val ? q.color : theme.secondary }}>{q.val}</div>
                    <div style={{ fontSize: "var(--fs-2xs)", color: theme.muted, marginTop: 2 }}>{q.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={inProgress}
            style={{
              width: "100%", padding: "20px", borderRadius: 16,
              background: `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`,
              color: "#FFF", fontSize: 14, fontWeight: 800,
              cursor: inProgress ? "not-allowed" : "pointer",
              marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
              boxShadow: "0 10px 20px rgba(13,158,110,0.15)", border: "none", transition: "all 0.2s"
            }}
            onMouseEnter={e => !inProgress && (e.currentTarget.style.transform = "translateY(-2px)")}
            onMouseLeave={e => !inProgress && (e.currentTarget.style.transform = "translateY(0)")}
          >
            {inProgress ? (
              <>
                <Spinner size="18px" color="#FFF" />
                {uploading ? "UPLOADING..." : "SYNCING DATA..."}
              </>
            ) : (
              <>
                <Save size={18} />
                COMMIT TRADE TO LOG
              </>
            )}
          </button>
        </form>
      </main>

      <TradeLimitDialog
        open={Boolean(limitBlock)}
        quota={limitBlock?.quota}
        requested={limitBlock?.requested}
        onClose={dismissLimitBlock}
      />

      <LastFreeTradeSheet
        open={Boolean(lastFreeTradeSheet)}
        quota={lastFreeTradeSheet?.quota}
        onClose={closeLastFreeTradeSheet}
      />

      <style jsx>{`
        @media (max-width: 640px) {
          main { padding: 16px !important; }
          .form-2col { grid-template-columns: 1fr !important; }
          .mood-grid  { grid-template-columns: repeat(5, 1fr) !important; gap: 6px !important; }
        }
        @media (max-width: 400px) {
          .mood-grid { grid-template-columns: repeat(3, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}

export default function AddTradePage() {
  return <Suspense><AddTradeContent /></Suspense>;
}
