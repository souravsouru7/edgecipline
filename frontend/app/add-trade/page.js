"use client";

import { Suspense, useRef } from "react";
import Link from "next/link";
import { Camera, Save, ArrowLeft } from "lucide-react";
import CandlestickBackground from "@/features/shared/components/CandlestickBackground";
import TickerTape            from "@/features/shared/components/TickerTape";
import PageHeader            from "@/features/shared/components/PageHeader";
import { useClock }          from "@/features/shared/hooks/useClock";
import { useMarket }         from "@/context/MarketContext";
import SectionCard           from "@/features/trade/components/SectionCard";
import { FormInput }         from "@/features/trade/components/FormInput";
import { FormSelect }        from "@/features/trade/components/FormSelect";
import SetupChecklist        from "@/features/trade/components/SetupChecklist";
import { useAddTrade }       from "@/features/trade/hooks/useAddTrade";
import { useUserProfile }   from "@/features/auth/hooks/useUserProfile";
import { Spinner }           from "@/features/shared";

const getTodayInputValue = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split("T")[0];
};

const MOODS = [
  { emoji: "😰", val: 1, label: "Stressed" },
  { emoji: "😟", val: 2, label: "Anxious" },
  { emoji: "😐", val: 3, label: "Neutral" },
  { emoji: "😊", val: 4, label: "Good" },
  { emoji: "🔥", val: 5, label: "Peak" },
];

const EMOTIONS = ["FOMO", "Revenge", "Fear", "Greed", "Calm", "Bored", "Focused", "Frustrated"];

const monoStyle = { fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.06em" };
const labelSt   = { display: "block", fontSize: 11, fontWeight: 700, color: "#94A3B8", marginBottom: 8 };

function AddTradeContent() {
  const { currentMarket, getCurrencySymbol, isIndianMarket } = useMarket();
  const clock = useClock();
  const fileInputRef = useRef(null);

  const {
    trade, setTrade, handleChange, handleStrategyChange, handleScreenshotChange,
    setupRules, toggleSetupRule, updateSetupRuleLabel, addSetupRule, clearSetupRules,
    handleSubmit, screenshotPreview, uploading, isSaving, setupsLoading, strategies, mounted
  } = useAddTrade(currentMarket, isIndianMarket);

  const { accountCreatedDate } = useUserProfile();
  const bull = parseFloat(trade.profit || 0) >= 0;
  const inProgress = uploading || isSaving;

  return (
    <div style={{ minHeight: "100vh", background: "#F0EEE9", fontFamily: "'Plus Jakarta Sans',sans-serif", color: "#0F1923" }}>
      <PageHeader showMarketSwitcher showClock clock={clock} />
      <TickerTape />

      <main style={{ maxWidth: 720, margin: "0 auto", padding: "28px 20px", opacity: mounted ? 1 : 0, transform: mounted ? "translateY(0)" : "translateY(16px)", transition: "all 0.5s cubic-bezier(0.4, 0, 0.2, 1)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 10 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 6 }}>
              Log New <span style={{ color: "#0D9E6E" }}>{isIndianMarket ? "Indian Trade" : "Forex Trade"}</span>
            </h1>
            <p style={{ fontSize: 11, color: "#94A3B8", fontWeight: 700, ...monoStyle }}>
              {isIndianMarket ? "NSE / BSE / F&O MARKET ENTRY" : "GLOBAL CURRENCY MARKET ENTRY"}
            </p>
          </div>
          <Link href="/trades" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, color: "#4A5568", textDecoration: "none", padding: "10px 14px", minHeight: 44, background: "#FFF", borderRadius: 8, border: "1px solid #E2E8F0", whiteSpace: "nowrap" }}>
            <ArrowLeft size={14} /> JOURNAL
          </Link>
        </div>

        <form onSubmit={(e) => handleSubmit(e, { accountCreatedDate })} style={{ display: "grid", gap: 24 }}>
          {/* ── Market Specific ── */}
          {isIndianMarket && (
            <SectionCard title="Market Segment" accentColor="#10B981">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 20 }}>
                <FormSelect label="SEGMENT" name="segment" value={trade.segment} onChange={handleChange} options={[{v:"Equity",l:"Equity"},{v:"F&O",l:"F&O"},{v:"Commodity",l:"Commodity"}].map(o=>({value:o.v,label:o.l}))} />
                <FormSelect label="TRADE TYPE" name="tradeType" value={trade.tradeType} onChange={handleChange} options={[{v:"INTRADAY",l:"Intraday"},{v:"DELIVERY",l:"Delivery"}].map(o=>({value:o.v,label:o.l}))} />
                <FormSelect label="INSTRUMENT" name="instrumentType" value={trade.instrumentType} onChange={handleChange} options={[{v:"EQUITY",l:"Equity"},{v:"FUTURE",l:"Future"},{v:"OPTION",l:"Option"}].map(o=>({value:o.v,label:o.l}))} />
              </div>
            </SectionCard>
          )}

          {/* ── Core Details ── */}
          <SectionCard title="Core Details" accentColor="#0D9E6E">
            <div style={{ display: "grid", gap: 20 }}>
              <FormInput label={isIndianMarket ? "SYMBOL" : "PAIR"} name="pair" value={trade.pair} onChange={handleChange} placeholder={isIndianMarket ? "RELIANCE" : "XAUUSD"} />
              <div className="form-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <FormSelect label="ACTION" name="type" value={trade.type} onChange={handleChange} options={[{v:"BUY",l:"BUY"},{v:"SELL",l:"SELL"}].map(o=>({value:o.v,label:o.l}))} />
                <div>
                  <FormInput label="TRADE DATE" name="tradeDate" value={trade.tradeDate} onChange={handleChange} type="date" required min={accountCreatedDate || undefined} max={getTodayInputValue()} />
                  {accountCreatedDate && <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 4, fontFamily: "'JetBrains Mono',monospace" }}>Earliest: {accountCreatedDate}</div>}
                </div>
              </div>
              <div style={{ maxWidth: 352 }}>
                <FormInput label={isIndianMarket ? "QUANTITY" : "LOT SIZE"} name={isIndianMarket ? "quantity" : "lotSize"} value={isIndianMarket ? trade.quantity : trade.lotSize} onChange={handleChange} placeholder={isIndianMarket ? "100" : "0.01"} />
              </div>
              <div className="form-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <FormInput label="ENTRY PRICE" name="entryPrice" value={trade.entryPrice} onChange={handleChange} type="number" step="any" />
                <FormInput label="EXIT PRICE" name="exitPrice" value={trade.exitPrice} onChange={handleChange} type="number" step="any" />
              </div>
              <FormInput 
                label={`NET PROFIT (${getCurrencySymbol()})`} 
                name="profit" 
                value={trade.profit} 
                onChange={handleChange} 
                type="number" 
                step="any"
                style={{ 
                  color: bull ? "#0D9E6E" : "#D63B3B", 
                  fontSize: 18,
                  fontWeight: 800,
                  background: bull ? "rgba(13,158,110,0.05)" : "rgba(214,59,59,0.05)"
                }} 
              />
            </div>
          </SectionCard>

          {/* ── Risk Management ── */}
          <SectionCard title="Risk Management" accentColor="#B8860B">
            <div style={{ display: "grid", gap: 16 }}>
              <div className="form-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <FormInput label="STOP LOSS" name="stopLoss" value={trade.stopLoss} onChange={handleChange} type="number" step="any" />
                <FormInput label="TAKE PROFIT" name="takeProfit" value={trade.takeProfit} onChange={handleChange} type="number" step="any" />
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                <FormSelect
                  label="PLANNED RISK : REWARD"
                  name="riskRewardRatio"
                  value={trade.riskRewardRatio}
                  onChange={handleChange}
                  options={[
                    { value: "1:1", label: "1 : 1" },
                    { value: "1:2", label: "1 : 2" },
                    { value: "1:3", label: "1 : 3" },
                    { value: "1:4", label: "1 : 4" },
                    { value: "1:5", label: "1 : 5" },
                    { value: "custom", label: "Custom" },
                  ]}
                />
                {trade.riskRewardRatio === "custom" && (
                  <FormInput
                    label="CUSTOM R:R"
                    name="riskRewardCustom"
                    value={trade.riskRewardCustom}
                    onChange={handleChange}
                    placeholder="e.g. 1:2.5"
                  />
                )}
              </div>
            </div>
          </SectionCard>

          {/* ── Strategy & Checklist ── */}
          <SectionCard title="Strategy" accentColor="#0D9E6E">
            <div style={{ marginBottom: 20 }}>
              <FormSelect 
                label={`SETUP ${setupsLoading ? "(...)" : ""}`} 
                name="strategy" 
                value={trade.strategy} 
                onChange={handleStrategyChange} 
                options={[{value:"",label:"Select..."}, ...strategies.map(s=>({value:s.name,label:s.name})), {value:"Custom",label:"Custom"}]} 
              />
              {trade.strategy === "Custom" && (
                <div style={{ marginTop: 12 }}>
                  <FormInput label="CUSTOM NAME" name="strategyCustom" value={trade.strategyCustom} onChange={handleChange} />
                </div>
              )}
            </div>
            <SetupChecklist rules={setupRules} onToggle={toggleSetupRule} onUpdateLabel={updateSetupRuleLabel} onAdd={addSetupRule} onClear={clearSetupRules} />
          </SectionCard>

          {/* ── Psychology ── */}
          <SectionCard title="Psychology" accentColor="#8B5CF6">
            <div style={{ marginBottom: 24 }}>
              <label style={labelSt}>EMOTIONAL STATE</label>
              <div className="mood-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
                {MOODS.map(m => (
                  <button key={m.val} type="button" onClick={() => setTrade(p => ({ ...p, mood: p.mood === m.val ? null : m.val }))}
                    style={{
                      padding: "10px 4px", borderRadius: 12, cursor: "pointer", minHeight: 72,
                      border: trade.mood === m.val ? "2px solid #0D9E6E" : "1px solid #E2E8F0",
                      background: trade.mood === m.val ? "rgba(13,158,110,0.08)" : "#FFF",
                      transition: "all 0.2s", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center"
                    }}>
                    <div style={{ fontSize: 22, marginBottom: 4 }}>{m.emoji}</div>
                    <div style={{ fontSize: 9, color: trade.mood === m.val ? "#0D9E6E" : "#94A3B8", fontWeight: 800, letterSpacing: "0.02em" }}>{m.label.toUpperCase()}</div>
                  </button>
                ))}
              </div>
            </div>
            
            <FormSelect label="TRADE CONFIDENCE" name="confidence" value={trade.confidence} onChange={handleChange} options={["Low", "Medium", "High", "Overconfident"].map(v=>({value:v,label:v}))} />
            
            <div style={{ marginTop: 24 }}>
              <label style={labelSt}>EMOTIONAL TAGS</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {EMOTIONS.map(tag => {
                  const sel = trade.emotionalTags?.includes(tag);
                  return (
                    <button key={tag} type="button" onClick={() => setTrade(p => ({ ...p, emotionalTags: sel ? p.emotionalTags.filter(t=>t!==tag) : [...(p.emotionalTags||[]), tag] }))}
                      style={{ 
                        padding: "8px 18px", borderRadius: 99, fontSize: 12, fontWeight: 700, 
                        cursor: "pointer", border: sel ? "2px solid #0D9E6E" : "1.5px solid #E2E8F0", 
                        background: sel ? "rgba(13,158,110,0.1)" : "#FFF", 
                        color: sel ? "#0D9E6E" : "#94A3B8",
                        transition: "all 0.2s"
                      }}>
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>
          </SectionCard>

          {/* ── Visual Evidence ── */}
          <SectionCard title="Visual Evidence" accentColor="#94A3B8">
            <input type="file" ref={fileInputRef} accept="image/*" onChange={e => handleScreenshotChange(e.target.files[0])} style={{ display: "none" }} />
            <div 
              onClick={() => !inProgress && fileInputRef.current.click()} 
              style={{ 
                border: "2px dashed #E2E8F0", borderRadius: 16, padding: 32, textAlign: "center", 
                cursor: inProgress ? "not-allowed" : "pointer", 
                background: "#fafafa",
                transition: "all 0.2s"
              }}
              onMouseEnter={e => !inProgress && (e.currentTarget.style.borderColor = "#0D9E6E")}
              onMouseLeave={e => !inProgress && (e.currentTarget.style.borderColor = "#E2E8F0")}
            >
              {screenshotPreview ? (
                <div style={{ position: "relative" }}>
                  <img src={screenshotPreview} alt="Preview" style={{ maxHeight: 300, width: "100%", objectFit: "contain", margin: "0 auto", borderRadius: 12 }} />
                  {uploading && (
                    <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.7)", display: "flex", alignItems: "center", justifyCenter: "center", borderRadius: 12 }}>
                      <Spinner size="40px" color="#0D9E6E" />
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#F0EEE9", display: "flex", alignItems: "center", justifyContent: "center", color: "#94A3B8" }}>
                    <Camera size={28} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#0F1923" }}>Upload Screenshots</div>
                    <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>Drag & drop or click to browse</div>
                  </div>
                </div>
              )}
            </div>
          </SectionCard>

          <button 
            type="submit" 
            disabled={inProgress} 
            style={{ 
              width: "100%", padding: "20px", borderRadius: 16, 
              background: "linear-gradient(135deg, #0D9E6E, #0F1923)", 
              color: "#FFF", fontSize: 14, fontWeight: 800, 
              cursor: inProgress ? "not-allowed" : "pointer", 
              marginTop: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              boxShadow: "0 10px 20px rgba(13,158,110,0.15)",
              border: "none",
              transition: "all 0.2s"
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
                COMMIT TRADE TO JOURNAL
              </>
            )}
          </button>
        </form>
      </main>

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
