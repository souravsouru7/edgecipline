"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { getTrade, updateTrade } from "@/services/tradeApi";
import { uploadTradeImage } from "@/services/uploadApi";
import { useRouter, useSearchParams } from "next/navigation";
import PageHeader from "@/features/shared/components/PageHeader";
import { useUserProfile } from "@/features/auth/hooks/useUserProfile";

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

/* ─────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────── */
function EditTradePageContent() {
  const searchParams = useSearchParams();
  const resolvedParams = useMemo(() => ({ id: searchParams.get('id') }), [searchParams]);
  const router = useRouter();
  const { accountCreatedDate } = useUserProfile();
  const [trade, setTrade] = useState(null);
  const [formData, setFormData] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [dateError, setDateError] = useState("");

  const fetchTrade = useCallback(async () => {
    if (resolvedParams?.id) {
      const data = await getTrade(resolvedParams.id);
      setTrade(data);
      setFormData({
        ...data,
        tradeDate: normalizeDateInput(data.tradeDate || data.createdAt),
      });
      setLoading(false);
    }
  }, [resolvedParams]);

  useEffect(() => {
    fetchTrade();
    setMounted(true);
  }, [fetchTrade]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "tradeDate") setDateError("");
    setFormData({ ...formData, [name]: value });
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
      const result = await updateTrade(resolvedParams.id, formData);
      if (result) {
        router.push(`/trades/view?id=${resolvedParams.id}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const typeOptions = [
    { value: "LONG", label: "LONG" },
    { value: "SHORT", label: "SHORT" },
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
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet"/>

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
                  UPDATE YOUR JOURNAL ENTRY
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

                <InputField
                  label="STRATEGY"
                  name="strategy"
                  value={formData.strategy}
                  onChange={handleChange}
                />

                <InputField
                  label="SESSION"
                  name="session"
                  value={formData.session}
                  onChange={handleChange}
                />

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

                      // Create preview
                      const reader = new FileReader();
                      reader.onloadend = () => {
                        setFormData(prev => ({ ...prev, screenshotPreview: reader.result }));
                      };
                      reader.readAsDataURL(file);

                      // Upload to server
                      try {
                        const data = await uploadTradeImage({ file, marketType: "Forex" });
                        setFormData(prev => ({ ...prev, screenshot: data.screenshotUrl || data.url }));
                      } catch (err) {
                        console.error("Upload error:", err);
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
                    disabled={saving}
                    style={{
                      flex: 1,
                      padding: "14px",
                      background: saving ? "#F8F6F2" : "linear-gradient(135deg, #0F1923 0%, #1a2d3d 100%)",
                      border: "none",
                      borderRadius: 10,
                      color: saving ? "#94A3B8" : "#22C78E",
                      fontSize: 11,
                      fontFamily: "'JetBrains Mono',monospace",
                      fontWeight: 700,
                      letterSpacing: "0.12em",
                      cursor: saving ? "not-allowed" : "pointer",
                      boxShadow: saving ? "none" : "0 4px 16px rgba(15,25,35,0.2)",
                    }}
                  >
                    {saving ? "SAVING..." : "SAVE CHANGES"}
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
