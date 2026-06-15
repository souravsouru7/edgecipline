"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { createTrade } from "@/services/tradeApi";
import { MARKETS } from "@/context/MarketContext";
import IndianMarketHeader from "@/components/IndianMarketHeader";
import { fetchSetups } from "@/services/setupApi";
import { useUserProfile } from "@/features/auth/hooks/useUserProfile";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import { useToast } from "@/features/shared/components/ui/Toast";
import { invalidateTradeDependentQueries } from "@/utils/queryInvalidation";
import TradeEvidenceSection from "@/features/trade/components/TradeEvidenceSection";

const getTodayInputValue = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split("T")[0];
};

const INTEGER_NUMBER_FIELDS = new Set(["strikePrice", "quantity", "sharesQty"]);
const DECIMAL_NUMBER_FIELDS = new Set(["profit", "entryPrice", "exitPrice", "brokerage", "sttTaxes"]);

const blockInvalidNumberKeys = (e) => {
  const fieldName = e.currentTarget?.name;
  const isIntegerField = INTEGER_NUMBER_FIELDS.has(fieldName);
  const allowsNegative = fieldName === "profit";
  if (["e", "E", "+"].includes(e.key)) e.preventDefault();
  if (!allowsNegative && e.key === "-") e.preventDefault();
  if (isIntegerField && e.key === ".") e.preventDefault();
};

const sanitizeNumericInput = (value, { allowNegative = false, integer = false } = {}) => {
  const raw = String(value ?? "");
  let cleaned = raw.replace(/[^\d.-]/g, "");

  if (!allowNegative) {
    cleaned = cleaned.replace(/-/g, "");
  } else {
    const isNegative = cleaned.startsWith("-");
    cleaned = cleaned.replace(/-/g, "");
    if (isNegative) cleaned = `-${cleaned}`;
  }

  if (integer) {
    return cleaned.replace(/\./g, "");
  }

  const sign = cleaned.startsWith("-") ? "-" : "";
  const unsigned = sign ? cleaned.slice(1) : cleaned;
  const [firstPart, ...rest] = unsigned.split(".");
  return `${sign}${firstPart}${rest.length ? `.${rest.join("")}` : ""}`;
};

const theme = {
  bull: "#0D9E6E",
  bear: "#D63B3B",
  primary: "#0D9E6E",
  secondary: "#0F1923",
  muted: "#94A3B8",
  border: "#E2E8F0",
  bg: "#F0EEE9",
  card: "#FFFFFF"
};

const UNDERLYINGS = ["NIFTY", "BANK NIFTY", "FIN NIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX", "Other"];
const LOT_SIZES = { "NIFTY": 25, "BANK NIFTY": 15, "FIN NIFTY": 25, "MIDCPNIFTY": 50, "SENSEX": 10, "BANKEX": 15, "Other": 1 };

function IndianOptionsAddTradeContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  useRequireAuth();
  const { addToast } = useToast();
  const searchParams = useSearchParams();
  const submitLockRef = useRef(false);
  const { accountCreatedDate } = useUserProfile();
  const [tradeSubType, setTradeSubType] = useState(
    searchParams?.get("type") === "EQUITY" ? "EQUITY" : "OPTION"
  );
  const [trade, setTrade] = useState({
    underlying: "NIFTY",
    underlyingOther: "",
    strikePrice: "",
    optionType: "CE",
    type: "BUY",
    quantity: "",
    profit: "",
    entryPrice: "",
    exitPrice: "",
    tradeType: "INTRADAY",
    strategy: "",
    strategyCustom: "",
    tradeDate: getTodayInputValue(),
    expiryDate: "",
    riskRewardRatio: "",
    riskRewardCustom: "",
    entryBasis: "Plan",
    entryBasisCustom: "",
    notes: "",
    setup: "",
    mistakeTag: "",
    lesson: "",
    brokerage: "",
    sttTaxes: "",
    mood: null,
    confidence: "",
    emotionalTags: [],
    wouldRetake: "",
    tradeQuality: "",
    tradeImages: [],
    stockSymbol: "",
    exchange: "NSE",
    sharesQty: "",
    sector: ""
  });
  const [loading, setLoading] = useState(false);
  const evidenceRef = useRef(null);
  const [committingEvidence, setCommittingEvidence] = useState(false);
  const isEquity = tradeSubType === "EQUITY";
  const [strategies, setStrategies] = useState([]);
  const [setupsLoading, setSetupsLoading] = useState(false);
  const [setupRules, setSetupRules] = useState([]);


  // Load saved trading setups for Indian market
  useEffect(() => {
    let cancelled = false;
    const loadSetups = async () => {
      try {
        setSetupsLoading(true);
        const serverStrategies = await fetchSetups(MARKETS.INDIAN_MARKET);
        if (cancelled) return;
        if (Array.isArray(serverStrategies) && serverStrategies.length) {
          const mapped = serverStrategies.map((s, sIdx) => ({
            id: sIdx + 1,
            name: s.name || "",
            rules: Array.isArray(s.rules)
              ? s.rules.map((r, rIdx) => ({
                  id: rIdx + 1,
                  label: r.label || "",
                  followed: false,
                }))
              : [],
          }));
          setStrategies(mapped);
        } else {
          setStrategies([]);
        }
      } catch (e) {
        console.error("Failed to load setups", e);
        setStrategies([]);
      } finally {
        if (!cancelled) setSetupsLoading(false);
      }
    };
    loadSetups();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    let nextValue = value;
    if (INTEGER_NUMBER_FIELDS.has(name)) {
      nextValue = sanitizeNumericInput(value, { integer: true });
    } else if (DECIMAL_NUMBER_FIELDS.has(name)) {
      nextValue = sanitizeNumericInput(value, { allowNegative: name === "profit" });
    }
    setTrade((prev) => ({ ...prev, [name]: nextValue }));
  };

  const handleStrategyChange = (e) => {
    const value = e.target.value;
    setTrade(prev => ({ ...prev, strategy: value }));
    const selected = strategies.find(s => s.name === value);
    if (selected && Array.isArray(selected.rules) && selected.rules.length) {
      setSetupRules(selected.rules.map((r, idx) => ({ id: r.id ?? idx + 1, label: r.label || "", followed: false })));
    } else {
      setSetupRules([]);
    }
  };

  const toggleSetupRule = (id) => {
    setSetupRules(prev => prev.map(r => (r.id === id ? { ...r, followed: !r.followed } : r)));
  };
  const updateSetupRuleLabel = (id, value) => {
    setSetupRules(prev => prev.map(r => (r.id === id ? { ...r, label: value } : r)));
  };
  const addSetupRule = () => {
    setSetupRules(prev => [...prev, { id: (prev[prev.length - 1]?.id || 0) + 1, label: "", followed: false }]);
  };
  const clearSetupRules = () => {
    setSetupRules(prev => prev.map(r => ({ ...r, followed: false })));
  };

  const getUnderlyingLabel = () => trade.underlying === "Other" ? trade.underlyingOther : trade.underlying;
  const getLotSize = () => LOT_SIZES[trade.underlying] || 1;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitLockRef.current || loading) {
      return;
    }
    const showValidation = (message) => {
      addToast(message, "info");
    };

    if (isEquity) {
      if (!trade.stockSymbol?.trim()) {
        showValidation("Enter stock symbol (e.g. RELIANCE).");
        return;
      }
      const sq = String(trade.sharesQty).trim();
      if (!sq || isNaN(parseFloat(sq)) || parseFloat(sq) <= 0) {
        showValidation("Enter shares quantity.");
        return;
      }
    } else {
      const underlyingLabel = getUnderlyingLabel();
      if (!underlyingLabel?.trim()) {
        showValidation("Select or enter underlying (e.g. NIFTY).");
        return;
      }
      const strike = trade.strikePrice?.trim();
      if (!strike || isNaN(parseFloat(strike))) {
        showValidation("Enter strike price.");
        return;
      }
      const qty = trade.quantity?.trim();
      if (!qty || isNaN(parseFloat(qty)) || parseFloat(qty) <= 0) {
        showValidation("Enter quantity (lots).");
        return;
      }
    }

    const pnl = String(trade.profit).trim();
    if (pnl === "" || isNaN(parseFloat(pnl))) {
      showValidation("Enter profit or loss.");
      return;
    }
    const ep = String(trade.entryPrice).trim();
    if (!ep || isNaN(parseFloat(ep)) || parseFloat(ep) <= 0) {
      showValidation(isEquity ? "Enter avg buy price." : "Enter entry premium.");
      return;
    }
    const xp = String(trade.exitPrice).trim();
    if (!xp || isNaN(parseFloat(xp)) || parseFloat(xp) <= 0) {
      showValidation(isEquity ? "Enter avg sell price." : "Enter exit premium.");
      return;
    }
    if (!trade.tradeDate) {
      showValidation("Select trade date.");
      return;
    }
    if (accountCreatedDate && trade.tradeDate < accountCreatedDate) {
      showValidation(`Trade date cannot be before your account creation date (${accountCreatedDate}).`);
      return;
    }
    if (trade.tradeDate > getTodayInputValue()) {
      showValidation("Trade date cannot be in the future.");
      return;
    }
    if (!trade.riskRewardRatio) {
      showValidation("Select planned risk : reward ratio.");
      return;
    }
    if (trade.riskRewardRatio === "custom" && !trade.riskRewardCustom?.trim()) {
      showValidation("Enter your custom risk : reward ratio.");
      return;
    }
    if (!trade.mood) {
      showValidation("Select how you're feeling.");
      return;
    }
    if (!trade.confidence) {
      showValidation("Select your confidence level.");
      return;
    }
    if (!trade.emotionalTags || trade.emotionalTags.length === 0) {
      showValidation("Select at least one emotional tag.");
      return;
    }

    const sharedFields = {
      type: trade.type,
      profit: parseFloat(pnl),
      entryPrice: trade.entryPrice ? parseFloat(trade.entryPrice) : undefined,
      exitPrice: trade.exitPrice ? parseFloat(trade.exitPrice) : undefined,
      tradeType: trade.tradeType || "INTRADAY",
      strategy: trade.strategy === "Custom" ? (trade.strategyCustom?.trim() || "Custom") : (trade.strategy || undefined),
      tradeDate: trade.tradeDate,
      riskRewardRatio: trade.riskRewardCustom?.trim() ? "custom" : (trade.riskRewardRatio || ""),
      riskRewardCustom: trade.riskRewardCustom?.trim() || "",
      entryBasis: trade.entryBasis || "Plan",
      entryBasisCustom: trade.entryBasis === "Custom" ? trade.entryBasisCustom : "",
      notes: trade.notes || undefined,
      setup: trade.setup || undefined,
      mistakeTag: trade.mistakeTag || undefined,
      lesson: trade.lesson || undefined,
      brokerage: trade.brokerage ? parseFloat(trade.brokerage) : undefined,
      sttTaxes: trade.sttTaxes ? parseFloat(trade.sttTaxes) : undefined,
      mood: trade.mood ?? undefined,
      confidence: trade.confidence || undefined,
      emotionalTags: Array.isArray(trade.emotionalTags) ? trade.emotionalTags : undefined,
      wouldRetake: trade.wouldRetake || undefined,
      tradeQuality: trade.tradeQuality || undefined,
    };

    let tradeData;
    if (isEquity) {
      const symbol = trade.stockSymbol.trim().toUpperCase();
      tradeData = {
        ...sharedFields,
        pair: symbol,
        stockSymbol: symbol,
        exchange: trade.exchange || "NSE",
        sharesQty: parseFloat(trade.sharesQty),
        sector: trade.sector || undefined,
        instrumentType: "EQUITY",
        segment: "EQUITY",
        tradeType: "INTRADAY"
      };
    } else {
      const underlyingLabel = getUnderlyingLabel();
      const strike = trade.strikePrice.trim();
      const qty = trade.quantity.trim();
      const pair = `${underlyingLabel.trim()} ${strike} ${trade.optionType}`;
      tradeData = {
        ...sharedFields,
        pair,
        underlying: underlyingLabel.trim(),
        strikePrice: parseFloat(strike),
        optionType: trade.optionType,
        segment: "F&O",
        instrumentType: "OPTION",
        quantity: parseFloat(qty),
        lotSize: getLotSize(),
        expiryDate: trade.expiryDate || undefined
      };
    }

    const activeRules = setupRules.filter(r => r.label && r.label.trim().length > 0);
    const followedCount = activeRules.filter(r => r.followed).length;
    const setupScore = activeRules.length > 0 ? Math.round((followedCount / activeRules.length) * 100) : null;
    tradeData.setupRules = activeRules.map(({ label, followed }) => ({ label: label.trim(), followed }));
    tradeData.setupScore = setupScore;

    // Upload pending evidence images (compresses each, then batches). The
    // returned array overrides trade.tradeImages in the create payload to
    // bypass setState's async closure timing.
    let finalImages = trade.tradeImages || [];
    if (evidenceRef.current?.hasPending()) {
      setCommittingEvidence(true);
      try {
        finalImages = await evidenceRef.current.commitPending();
      } catch {
        setCommittingEvidence(false);
        return;
      }
      setCommittingEvidence(false);
    }
    tradeData.tradeImages = finalImages;

    submitLockRef.current = true;
    setLoading(true);
    try {
      const result = await createTrade(tradeData, MARKETS.INDIAN_MARKET);
      if (result?._id) {
        invalidateTradeDependentQueries(queryClient);
        addToast("Trade saved to your journal!", "success");
        router.push("/indian-market/dashboard");
      } else {
        throw new Error(result?.message || "Failed to save");
      }
    } catch (err) {
      addToast(err.message || "Failed to save trade.", "error");
    } finally {
      submitLockRef.current = false;
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: theme.bg, fontFamily: "'Plus Jakarta Sans',sans-serif", color: theme.secondary }}>
      <IndianMarketHeader />

      <main style={{ maxWidth: 640, margin: "0 auto", padding: "40px 24px" }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4, color: theme.secondary }}>
          Log New <span style={{ color: '#1B5E20' }}>{isEquity ? "Stock Trade" : "Options Trade"}</span>
        </h1>
        <p style={{ fontSize: 12, color: theme.muted, marginBottom: 32, fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.06em" }}>
          {isEquity ? "NSE / BSE EQUITY INTRADAY" : "NSE / BSE F&O MARKET ENTRY"}
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 24 }}>

          {/* Instrument type toggle */}
          <div style={{ display: "flex", gap: 0, borderRadius: 8, overflow: "hidden", border: "1.5px solid #E2E8F0" }}>
            {[{ v: "OPTION", label: "Options" }, { v: "EQUITY", label: "Intraday Stocks" }].map(({ v, label }) => (
              <button
                key={v}
                type="button"
                onClick={() => setTradeSubType(v)}
                style={{
                  flex: 1,
                  padding: "11px 0",
                  border: "none",
                  background: tradeSubType === v ? theme.primary : "#FFFFFF",
                  color: tradeSubType === v ? "#FFFFFF" : theme.muted,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  transition: "all 0.15s",
                  fontFamily: "'Plus Jakarta Sans',sans-serif",
                  letterSpacing: "0.04em"
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {isEquity ? (
              <>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>Stock Symbol</label>
                  <input name="stockSymbol" placeholder="e.g. RELIANCE, TCS, HDFC" value={trade.stockSymbol} onChange={handleChange} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14, textTransform: "uppercase" }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>Exchange</label>
                    <select name="exchange" value={trade.exchange} onChange={handleChange} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }}>
                      <option value="NSE">NSE</option>
                      <option value="BSE">BSE</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>BUY / SELL</label>
                    <select name="type" value={trade.type} onChange={handleChange} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }}>
                      <option value="BUY">BUY</option>
                      <option value="SELL">SELL</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>Shares Qty</label>
                    <input name="sharesQty" type="number" min="1" placeholder="e.g. 100" value={trade.sharesQty} onChange={handleChange} onKeyDown={blockInvalidNumberKeys} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>Sector</label>
                    <select name="sector" value={trade.sector} onChange={handleChange} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }}>
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
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>Underlying</label>
                  <select name="underlying" value={trade.underlying} onChange={handleChange} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }}>
                    {UNDERLYINGS.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
                {trade.underlying === "Other" && (
                  <div>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>Symbol</label>
                    <input name="underlyingOther" placeholder="e.g. RELIANCE" value={trade.underlyingOther} onChange={handleChange} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }} />
                  </div>
                )}
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>Strike (₹)</label>
                  <input name="strikePrice" type="number" min="1" step="1" placeholder="e.g. 26100" value={trade.strikePrice} onChange={handleChange} onKeyDown={blockInvalidNumberKeys} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>CE / PE</label>
                    <select name="optionType" value={trade.optionType} onChange={handleChange} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }}>
                      <option value="CE">CE</option>
                      <option value="PE">PE</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>BUY / SELL</label>
                    <select name="type" value={trade.type} onChange={handleChange} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }}>
                      <option value="BUY">BUY</option>
                      <option value="SELL">SELL</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>Qty (lots)</label>
                  <input name="quantity" type="number" min="1" placeholder="e.g. 3" value={trade.quantity} onChange={handleChange} onKeyDown={blockInvalidNumberKeys} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }} />
                </div>
              </>
            )}

            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>Profit / Loss (₹)</label>
              <input name="profit" type="number" placeholder="e.g. 1500 or -500" value={trade.profit} onChange={handleChange} onKeyDown={blockInvalidNumberKeys} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14, fontWeight: 600 }} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>{isEquity ? "Avg buy price (₹)" : "Entry premium (₹)"}</label>
                <input name="entryPrice" type="number" step="0.01" placeholder={isEquity ? "e.g. 2450.50" : "e.g. 85.50"} value={trade.entryPrice} onChange={handleChange} onKeyDown={blockInvalidNumberKeys} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>{isEquity ? "Avg sell price (₹)" : "Exit premium (₹)"}</label>
                <input name="exitPrice" type="number" step="0.01" placeholder={isEquity ? "e.g. 2510" : "e.g. 120"} value={trade.exitPrice} onChange={handleChange} onKeyDown={blockInvalidNumberKeys} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }} />
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>Trade type</label>
              <select name="tradeType" value={trade.tradeType} onChange={handleChange} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }}>
                <option value="INTRADAY">Intraday</option>
                <option value="DELIVERY">Delivery</option>
                <option value="SWING">Swing</option>
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>Trade Date <span style={{ color: "#D63B3B" }}>*</span></label>
              <input name="tradeDate" type="date" value={trade.tradeDate} onChange={handleChange} required min={accountCreatedDate || undefined} max={getTodayInputValue()} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }} />
              {accountCreatedDate && (
                <div style={{ fontSize: 10, color: theme.muted, marginTop: 5, fontFamily: "'JetBrains Mono',monospace" }}>
                  Earliest allowed: {accountCreatedDate} (account creation date)
                </div>
              )}
            </div>

            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>
                Trading Setup{setupsLoading ? " (loading...)" : ""}
              </label>
              <select
                name="strategy"
                value={trade.strategy}
                onChange={handleStrategyChange}
                style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }}
              >
                <option value="">Select setup...</option>
                {strategies
                  .filter(s => s.name && s.name.trim().length > 0)
                  .map(s => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                <option value="Custom">Custom</option>
              </select>
              {trade.strategy === "Custom" && (
                <input
                  name="strategyCustom"
                  placeholder="Enter trading setup name"
                  value={trade.strategyCustom}
                  onChange={handleChange}
                  style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14, marginTop: 8 }}
                />
              )}
            </div>

            {/* Setup checklist */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, gap: 10 }}>
                <div>
                  <div style={{ fontSize: 10, letterSpacing: "0.12em", color: theme.muted, fontFamily: "'JetBrains Mono',monospace", fontWeight: 800 }}>
                    SETUP CHECKLIST
                  </div>
                  <div style={{ fontSize: 12, color: theme.muted, marginTop: 4 }}>
                    Tick the rules you followed for this setup.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearSetupRules}
                  style={{ padding: "8px 10px", borderRadius: 999, border: `1px solid ${theme.border}`, background: "#F8FAFC", cursor: "pointer", fontSize: 11, fontWeight: 700, color: theme.muted }}
                >
                  CLEAR
                </button>
              </div>

              {setupRules.length === 0 ? (
                <div style={{ fontSize: 12, color: theme.muted }}>
                  Select a setup above to load its checklist, or add your own rules.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {setupRules.map(rule => (
                    <div key={rule.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, border: `1px solid ${theme.border}`, background: theme.card }}>
                      <button
                        type="button"
                        onClick={() => toggleSetupRule(rule.id)}
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 6,
                          border: rule.followed ? `1.5px solid ${theme.bull}` : "1.5px solid #CBD5E1",
                          background: rule.followed ? `linear-gradient(135deg, ${theme.bull}, #22C78E)` : "#FFFFFF",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                        aria-label="Toggle rule followed"
                      >
                        {rule.followed && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.8">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                      <input
                        value={rule.label}
                        onChange={e => updateSetupRuleLabel(rule.id, e.target.value)}
                        placeholder="Add setup rule..."
                        style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 14 }}
                      />
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={addSetupRule}
                style={{ marginTop: 10, background: "transparent", border: "none", color: theme.bull, fontWeight: 800, cursor: "pointer" }}
              >
                + ADD RULE
              </button>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>Setup / Pattern</label>
              <input name="setup" placeholder="e.g. Breakout above 26200" value={trade.setup} onChange={handleChange} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }} />
            </div>

            {!isEquity && (
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>Expiry date</label>
                <input name="expiryDate" type="date" value={trade.expiryDate} onChange={handleChange} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }} />
              </div>
            )}

            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>Planned Risk : Reward <span style={{ color: "#D63B3B" }}>*</span></label>
              <select
                name="riskRewardRatio"
                value={trade.riskRewardRatio}
                onChange={handleChange}
                style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }}
              >
                <option value="">Select...</option>
                <option value="1:1">1 : 1</option>
                <option value="1:1.5">1 : 1.5</option>
                <option value="1:2">1 : 2</option>
                <option value="1:3">1 : 3</option>
                <option value="1:4">1 : 4</option>
                <option value="1:5">1 : 5</option>
                <option value="custom">Custom</option>
              </select>
              {trade.riskRewardRatio === "custom" && (
                <input
                  name="riskRewardCustom"
                  placeholder="e.g. 1:2.5"
                  value={trade.riskRewardCustom}
                  onChange={handleChange}
                  style={{ marginTop: 8, width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 13 }}
                />
              )}
            </div>

            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>Entry Basis</label>
              <select
                name="entryBasis"
                value={trade.entryBasis}
                onChange={handleChange}
                style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }}
              >
                <option value="Plan">Rule Based / Plan</option>
                <option value="Emotion">Emotional</option>
                <option value="Impulsive">Impulsive</option>
                <option value="Custom">Custom Basis</option>
              </select>
              {trade.entryBasis === "Custom" && (
                <input
                  name="entryBasisCustom"
                  placeholder="e.g. News-driven scalp, FOMO, etc."
                  value={trade.entryBasisCustom}
                  onChange={handleChange}
                  style={{ marginTop: 8, width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 13 }}
                />
              )}
            </div>

            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>Mistake (if any)</label>
              <select name="mistakeTag" value={trade.mistakeTag} onChange={handleChange} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }}>
                <option value="">None</option>
                <option value="Overtraded">Overtraded</option>
                <option value="Held too long">Held too long</option>
                <option value="Exited early">Exited early</option>
                {isEquity ? (
                  <option value="Wrong stock">Wrong stock</option>
                ) : (
                  <option value="Wrong strike">Wrong strike</option>
                )}
                <option value="Revenge trade">Revenge trade</option>
                <option value="No stop">No stop</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>Lesson (one line)</label>
              <input name="lesson" placeholder="e.g. Never add to a losing position" value={trade.lesson} onChange={handleChange} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }} />
            </div>

            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>Notes</label>
              <textarea name="notes" placeholder="Setup, context, emotions..." value={trade.notes} onChange={handleChange} rows={3} maxLength={2000} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14, resize: "vertical" }} />
              <div style={{ fontSize: 10, color: theme.muted, textAlign: "right", marginTop: 4 }}>{(trade.notes || "").length}/2000</div>
            </div>

            <TradeEvidenceSection
              ref={evidenceRef}
              value={trade.tradeImages || []}
              onChange={imgs => setTrade(prev => ({ ...prev, tradeImages: imgs }))}
              disabled={loading || committingEvidence}
              accentColor="#0D9E6E"
            />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>Brokerage (₹)</label>
                <input name="brokerage" type="number" step="0.01" placeholder="0" value={trade.brokerage} onChange={handleChange} onKeyDown={blockInvalidNumberKeys} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: theme.muted, marginBottom: 6 }}>STT / Taxes (₹)</label>
                <input name="sttTaxes" type="number" step="0.01" placeholder="0" value={trade.sttTaxes} onChange={handleChange} onKeyDown={blockInvalidNumberKeys} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }} />
              </div>
            </div>

            {/* Psychology Section */}
            <div style={{ background: "#FFFFFF", borderRadius: 12, padding: 20, border: "1px solid #E2E8F0" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#0F1923", marginBottom: 16, display: "flex", alignItems: "center", gap: 8, fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
                <span>PSY</span> TRADE PSYCHOLOGY
                <span style={{ fontSize: 9, color: "#D63B3B", fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.08em", background: "#FFF0F0", padding: "2px 6px", borderRadius: 4 }}>REQUIRED</span>
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: theme.muted, marginBottom: 8, fontFamily: "'Plus Jakarta Sans',sans-serif", letterSpacing: "0.05em" }}>HOW ARE YOU FEELING? <span style={{ color: "#D63B3B" }}>*</span></label>
                <div style={{ display: "flex", gap: 8 }}>
                  {[
                    { score: "1", val: 1, label: "Stressed" },
                    { score: "2", val: 2, label: "Anxious" },
                    { score: "3", val: 3, label: "Neutral" },
                    { score: "4", val: 4, label: "Good" },
                    { score: "5", val: 5, label: "Peak" }
                  ].map(m => (
                    <button
                      key={m.val}
                      type="button"
                      onClick={() => setTrade(prev => ({ ...prev, mood: prev.mood === m.val ? null : m.val }))}
                      style={{
                        flex: 1,
                        padding: "10px 4px",
                        borderRadius: 10,
                        cursor: "pointer",
                        textAlign: "center",
                        transition: "all 0.2s",
                        border: trade.mood === m.val ? "1.5px solid #0D9E6E" : "1px solid #E2E8F0",
                        background: trade.mood === m.val ? "rgba(13,158,110,0.06)" : "#F8FAFC",
                        transform: trade.mood === m.val ? "scale(1.04)" : "scale(1)"
                      }}
                    >
                      <div style={{ fontSize: 20, fontWeight: 800 }}>{m.score}</div>
                      <div style={{ fontSize: 10, color: trade.mood === m.val ? "#0D9E6E" : "#64748B", fontWeight: 700, marginTop: 4, fontFamily: "'Plus Jakarta Sans',sans-serif" }}>{m.label}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: theme.muted, marginBottom: 6, fontFamily: "'Plus Jakarta Sans',sans-serif", letterSpacing: "0.05em" }}>CONFIDENCE LEVEL <span style={{ color: "#D63B3B" }}>*</span></label>
                <select
                  name="confidence"
                  value={trade.confidence}
                  onChange={handleChange}
                  style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, fontSize: 14 }}
                >
                  <option value="">Select confidence...</option>
                  <option value="Low">Low - Unsure about this setup</option>
                  <option value="Medium">Medium - Decent setup</option>
                  <option value="High">High - Strong conviction</option>
                  <option value="Overconfident">Overconfident - Cannot lose</option>
                </select>
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: theme.muted, marginBottom: 8, fontFamily: "'Plus Jakarta Sans',sans-serif", letterSpacing: "0.05em" }}>EMOTIONAL TAGS <span style={{ color: "#D63B3B" }}>*</span></label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {["FOMO", "Revenge", "Fear", "Greed", "Calm", "Bored", "Focused", "Frustrated"].map(tag => {
                    const selected = (trade.emotionalTags || []).includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setTrade(prev => ({
                          ...prev,
                          emotionalTags: selected
                            ? (prev.emotionalTags || []).filter(x => x !== tag)
                            : [...(prev.emotionalTags || []), tag]
                        }))}
                        style={{
                          padding: "6px 14px",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                          transition: "all 0.15s",
                          fontFamily: "'Plus Jakarta Sans',sans-serif",
                          border: selected ? "1px solid #0D9E6E" : "1px solid #E2E8F0",
                          background: selected ? "rgba(13,158,110,0.08)" : "#FFFFFF",
                          color: selected ? "#0D9E6E" : "#64748B"
                        }}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: theme.muted, marginBottom: 8, fontFamily: "'Plus Jakarta Sans',sans-serif", letterSpacing: "0.05em" }}>WOULD YOU RETAKE THIS TRADE?</label>
                <div style={{ display: "flex", gap: 10 }}>
                  {["Yes", "No"].map(option => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setTrade(prev => ({ ...prev, wouldRetake: prev.wouldRetake === option ? "" : option }))}
                      style={{
                        flex: 1,
                        padding: "10px",
                        borderRadius: 10,
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 700,
                        transition: "all 0.2s",
                        fontFamily: "'Plus Jakarta Sans',sans-serif",
                        border: trade.wouldRetake === option ? `1.5px solid ${option === "Yes" ? "#0D9E6E" : "#D63B3B"}` : "1px solid #E2E8F0",
                        background: trade.wouldRetake === option ? (option === "Yes" ? "rgba(13,158,110,0.06)" : "rgba(214,59,59,0.06)") : "#F8FAFC",
                        color: trade.wouldRetake === option ? (option === "Yes" ? "#0D9E6E" : "#D63B3B") : "#64748B"
                      }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 18 }}>
                <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: theme.muted, marginBottom: 8, fontFamily: "'Plus Jakarta Sans',sans-serif", letterSpacing: "0.05em" }}>TRADE QUALITY (EXECUTION)</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  {[
                    { val: "Great", color: "#0D9E6E", desc: "Followed the plan" },
                    { val: "Average", color: "#F59E0B", desc: "Partial execution" },
                    { val: "Poor", color: "#D63B3B", desc: "Broke the rules" },
                  ].map(q => (
                    <button
                      key={q.val}
                      type="button"
                      onClick={() => setTrade(prev => ({ ...prev, tradeQuality: prev.tradeQuality === q.val ? "" : q.val }))}
                      style={{
                        padding: "10px 4px",
                        borderRadius: 10,
                        cursor: "pointer",
                        textAlign: "center",
                        border: trade.tradeQuality === q.val ? `1.5px solid ${q.color}` : "1px solid #E2E8F0",
                        background: trade.tradeQuality === q.val ? `${q.color}14` : "#F8FAFC",
                        transition: "all 0.2s",
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 800, color: trade.tradeQuality === q.val ? q.color : "#0F1923", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>{q.val}</div>
                      <div style={{ fontSize: 9, color: "#94A3B8", marginTop: 2, fontFamily: "'Plus Jakarta Sans',sans-serif" }}>{q.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <button type="submit" disabled={loading} style={{
            padding: "14px 24px",
            borderRadius: 12,
            border: "none",
            background: `linear-gradient(135deg, ${theme.primary} 0%, ${theme.secondary} 100%)`,
            color: "#fff",
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.8 : 1
          }}>
            {loading ? "Saving..." : "Save"}
          </button>
        </form>
      </main>
    </div>
  );
}

export default function IndianOptionsAddTradePage() {
  return (
    <Suspense>
      <IndianOptionsAddTradeContent />
    </Suspense>
  );
}
