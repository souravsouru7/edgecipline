"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMarket, MARKETS } from "@/context/MarketContext";
import { uploadTradeImage } from "@/services/uploadApi";
import { createTrade, getTradeStatus, updateTrade, deleteTrade } from "@/services/tradeApi";
import { useSetups } from "./useSetups";
import { useToast } from "@/features/shared/components/ui/Toast";

const DEFAULT_SETUP_RULES = [];
const getTodayInputValue = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split("T")[0];
};

const normalizeDateForInput = (value) => {
  if (!value) return "";

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getTime() - value.getTimezoneOffset() * 60000)
      .toISOString()
      .split("T")[0];
  }

  const raw = String(value).trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";

  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .split("T")[0];
};



// ─── helpers ──────────────────────────────────────────────────────────────────

function buildIndianTradeTemplate(imageUrl, t = {}) {
  const sym = (t.symbol || "").toUpperCase();
  const strike = t.strike ? String(t.strike) : "";
  const ot = (t.optionType || "CE").toUpperCase();
  const pairBuilt = sym && strike ? `${sym} ${strike} ${ot}` : sym;
  return {
    pair: pairBuilt || t.pair || "",
    action: "buy",
    quantity: t.quantity != null ? String(t.quantity) : "",
    profit: t.pnl != null ? String(t.pnl) : (t.profit != null ? String(t.profit) : ""),
    entryPrice: t.entryPrice != null ? String(t.entryPrice) : "",
    exitPrice: t.exitPrice != null ? String(t.exitPrice) : "",
    optionType: ot,
    screenshot: imageUrl,
    segment: "F&O",
    instrumentType: "OPTION",
    strikePrice: strike,
    tradeType: "INTRADAY",
    strategy: "", strategyCustom: "",
    tradeDate: normalizeDateForInput(t.tradeDate) || getTodayInputValue(),
    expiryDate: t.expiryDate || "",
    riskRewardRatio: "", riskRewardCustom: "",
    entryBasis: "Plan", entryBasisCustom: "",
    notes: "", setup: "", mistakeTag: "", lesson: "",
    brokerage: "", sttTaxes: "",
    mood: null, confidence: "", emotionalTags: [], wouldRetake: "",
    setupRules: [],
  };
}

// Detect trading session from current upload time (UTC hour)
function detectSessionFromNow() {
  const utcHour = new Date().getUTCHours();
  if (utcHour >= 22 || utcHour < 8)  return "Asia";
  if (utcHour >= 8  && utcHour < 12) return "London";
  if (utcHour >= 12 && utcHour < 17) return "London-NY Overlap";
  return "New York";
}

const toNum = (value) => {
  const n = Number.parseFloat(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
};
const parseOptionalNumber = (value) => {
  if (value == null) return undefined;
  const n = Number.parseFloat(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : undefined;
};

const normalizeText = (value) => String(value ?? "").trim().toUpperCase();

const makeTradeDedupKey = (trade = {}) => {
  const pair = normalizeText(trade.pair || trade.symbol);
  const action = normalizeText(trade.action || trade.type);
  const entry = toNum(trade.entryPrice);
  const exit = toNum(trade.exitPrice);
  const pnl = toNum(trade.pnl ?? trade.profit);
  const quantity = toNum(trade.quantity ?? trade.lotSize);
  const strike = toNum(trade.strikePrice ?? trade.strike);
  const optionType = normalizeText(trade.optionType);
  const tradeDate = normalizeDateForInput(trade.tradeDate);

  return JSON.stringify({
    pair,
    action,
    entry,
    exit,
    pnl,
    quantity,
    strike,
    optionType,
    tradeDate,
  });
};

const dedupeParsedTrades = (rawTrades) => {
  if (!Array.isArray(rawTrades) || rawTrades.length <= 1) return rawTrades || [];
  const seen = new Set();
  const unique = [];
  for (const t of rawTrades) {
    const key = makeTradeDedupKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(t);
  }
  return unique;
};

const inferIndianTradeSubTypeFromPayload = (payload) => {
  const rows = [
    payload?.parsedData?.parsedTrade || payload?.parsedTrade || null,
    ...(payload?.parsedData?.parsedTrades || payload?.parsedTrades || []),
  ].filter(Boolean);

  if (rows.length === 0) return null;

  const hasOptionSignals = rows.some((row) => {
    const pair = String(row?.pair || "").toUpperCase();
    const optionType = String(row?.optionType || "").toUpperCase();
    return (
      optionType === "CE" ||
      optionType === "PE" ||
      row?.strikePrice != null ||
      /\b(CE|PE|CALL|PUT|FUT)\b/.test(pair)
    );
  });
  if (hasOptionSignals) return "OPTION";

  const hasEquitySignals = rows.some((row) => {
    const instrumentType = String(row?.instrumentType || "").toUpperCase();
    return (
      instrumentType === "EQUITY" ||
      !!row?.stockSymbol ||
      row?.sharesQty != null ||
      row?.exchange === "NSE" ||
      row?.exchange === "BSE"
    );
  });
  if (hasEquitySignals) return "EQUITY";

  return null;
};

function buildEquityTradeTemplate(imageUrl, t = {}) {
  return {
    pair: t.stockSymbol || t.pair || "",
    stockSymbol: t.stockSymbol || "",
    exchange: t.exchange || "NSE",
    sharesQty: t.sharesQty != null ? String(t.sharesQty) : "",
    action: (t.type || t.action || "buy").toLowerCase(),
    entryPrice: t.entryPrice != null ? String(t.entryPrice) : "",
    exitPrice: t.exitPrice != null ? String(t.exitPrice) : "",
    profit: t.profit != null ? String(t.profit) : "",
    sector: t.sector || "",
    screenshot: imageUrl,
    instrumentType: "EQUITY",
    segment: "EQUITY",
    tradeType: "INTRADAY",
    strategy: "", strategyCustom: "",
    tradeDate: normalizeDateForInput(t.tradeDate) || getTodayInputValue(),
    brokerage: "", sttTaxes: "",
    entryBasis: "Plan", entryBasisCustom: "",
    setup: "", mistakeTag: "", lesson: "", notes: "",
    mood: null, confidence: "", emotionalTags: [], wouldRetake: "",
    setupRules: [],
  };
}

function buildForexTradeTemplate(imageUrl, t = {}) {
  return {
    pair: t.pair || t.symbol || "",
    action: (t.action || t.type || "buy").toString().toLowerCase(),
    lotSize: t.lotSize != null ? String(t.lotSize) : "",
    entryPrice: t.entryPrice != null ? String(t.entryPrice) : "",
    exitPrice: t.exitPrice != null ? String(t.exitPrice) : "",
    stopLoss: t.stopLoss != null ? String(t.stopLoss) : "",
    takeProfit: t.takeProfit != null ? String(t.takeProfit) : "",
    profit: t.profit != null ? String(t.profit) : (t.pnl != null ? String(t.pnl) : ""),
    commission: t.commission != null ? String(t.commission) : "",
    swap: t.swap != null ? String(t.swap) : "",
    balance: t.balance != null ? String(t.balance) : "",
    session: t.session || detectSessionFromNow(),
    strategy: "", strategyCustom: "",
    tradeDate: normalizeDateForInput(t.tradeDate) || getTodayInputValue(),
    notes: "", screenshot: imageUrl,
    segment: t.segment || "Major FX",
    instrumentType: t.instrumentType || "Spot",
    quantity: t.quantity != null ? String(t.quantity) : "",
    strikePrice: t.strikePrice != null ? String(t.strikePrice) : "",
    expiryDate: t.expiryDate || "",
    brokerage: "", sttTaxes: "",
    entryBasis: "Plan", entryBasisCustom: "",
    mood: null, confidence: "", emotionalTags: [], wouldRetake: "",
    setupRules: [],
  };
}

function buildTradePayload(trade, isInd, setupRules) {
  const activeRules = setupRules.filter(r => r.label && r.label.trim().length > 0);
  const followedCount = activeRules.filter(r => r.followed).length;
  const setupScore = activeRules.length > 0 ? Math.round((followedCount / activeRules.length) * 100) : null;

  const base = {
    pair: trade.pair,
    type: trade.action.toUpperCase(),
    entryPrice: trade.entryPrice ? parseFloat(trade.entryPrice) : undefined,
    exitPrice: trade.exitPrice ? parseFloat(trade.exitPrice) : undefined,
    profit: trade.profit ? parseFloat(trade.profit) : undefined,
    strategy: trade.strategy === "Custom" ? (trade.strategyCustom?.trim() || "Custom") : (trade.strategy || undefined),
    tradeDate: trade.tradeDate,
    entryBasis: trade.entryBasis || "Plan",
    entryBasisCustom: trade.entryBasis === "Custom" ? trade.entryBasisCustom : undefined,
    notes: trade.notes || undefined,
    screenshot: trade.screenshot || undefined,
    mood: trade.mood ?? undefined,
    confidence: trade.confidence || undefined,
    emotionalTags: Array.isArray(trade.emotionalTags) ? trade.emotionalTags : undefined,
    wouldRetake: trade.wouldRetake || undefined,
    riskRewardRatio: trade.riskRewardRatio || undefined,
    riskRewardCustom: trade.riskRewardCustom || undefined,
    setupRules: activeRules.map(({ label, followed }) => ({ label: String(label).trim(), followed })),
    setupScore,
  };

  if (isInd && trade.instrumentType === "EQUITY") {
    Object.assign(base, {
      instrumentType: "EQUITY",
      segment: "EQUITY",
      tradeType: "INTRADAY",
      stockSymbol: (trade.stockSymbol || trade.pair || "").toUpperCase(),
      exchange: trade.exchange || "NSE",
      sharesQty: parseOptionalNumber(trade.sharesQty),
      sector: trade.sector || undefined,
      setup: trade.setup || undefined,
      mistakeTag: trade.mistakeTag || undefined,
      lesson: trade.lesson || undefined,
      brokerage: trade.brokerage ? parseFloat(trade.brokerage) : undefined,
      sttTaxes: trade.sttTaxes ? parseFloat(trade.sttTaxes) : undefined,
    });
  } else if (isInd) {
    Object.assign(base, {
      optionType: (trade.optionType || "CE").toUpperCase(),
      quantity: trade.quantity ? parseFloat(trade.quantity) : undefined,
      strikePrice: trade.strikePrice ? parseFloat(trade.strikePrice) : undefined,
      underlying: trade.pair ? trade.pair.replace(/\s+\d+\s*(CE|PE)$/i, "").trim() : undefined,
      tradeType: trade.tradeType || undefined,
      expiryDate: trade.expiryDate || undefined,
      setup: trade.setup || undefined,
      mistakeTag: trade.mistakeTag || undefined,
      lesson: trade.lesson || undefined,
      brokerage: trade.brokerage ? parseFloat(trade.brokerage) : undefined,
      sttTaxes: trade.sttTaxes ? parseFloat(trade.sttTaxes) : undefined,
    });
  } else {
    Object.assign(base, {
      stopLoss: trade.stopLoss ? parseFloat(trade.stopLoss) : undefined,
      takeProfit: trade.takeProfit ? parseFloat(trade.takeProfit) : undefined,
      balance: trade.balance ? parseFloat(trade.balance) : undefined,
      session: trade.session || undefined,
      lotSize: trade.lotSize ? parseFloat(trade.lotSize) : undefined,
      commission: trade.commission ? parseFloat(trade.commission) : undefined,
      swap: trade.swap ? parseFloat(trade.swap) : undefined,
    });
  }

  return base;
}

function getFriendlyUploadError(err) {
  const status = err?.status;
  const message = String(err?.message || "").trim();
  const detail = String(err?.data?.detail || "").trim();

  if (status === 403 && /subscription required/i.test(message)) {
    return detail || "You have used your free upload. Please subscribe to continue uploading trade screenshots.";
  }

  return message || "Upload failed. Please try again.";
}

// ─── hook ─────────────────────────────────────────────────────────────────────

/**
 * useUploadTrade
 * Refactored to use TanStack Query for orchestration and useToast for feedback.
 */
export function useUploadTrade() {
  const router        = useRouter();
  const searchParams  = useSearchParams();
  const pathname      = usePathname();
  const queryClient   = useQueryClient();
  const { currentMarket } = useMarket();
  const { addToast, removeToast } = useToast();

  // 1. Determine local context
  const marketType = pathname?.startsWith("/indian-market")
    ? MARKETS.INDIAN_MARKET
    : (searchParams.get("market") || searchParams.get("marketType") || currentMarket);
  const isInd = marketType === MARKETS.INDIAN_MARKET;

  // 2. Local UI/Form state
  const [mounted, setMounted]                 = useState(false);
  const [file, setFile]                       = useState(null);
  const [error, setError]                     = useState(null);
  const [jobId, setJobId]                     = useState("");
  const [uploadedTradeId, setUploadedTradeId] = useState(null); // original ghost trade ID from upload
  const [broker, setBroker]                   = useState("AUTO");
  const [tradeSubType, setTradeSubType]       = useState(
    searchParams?.get("type") === "EQUITY" ? "EQUITY" : "OPTION"
  );
  const [trade, setTrade]                     = useState(null);
  const [trades, setTrades]                   = useState([]);
  const [savedTrades, setSavedTrades]         = useState([]);
  const [saved, setSaved]                     = useState(false);
  const [showCustomRR, setShowCustomRR]       = useState(false);
  const [setupRules, setSetupRules]           = useState(DEFAULT_SETUP_RULES);
  const [extractedText, setExtractedText]     = useState("");
  const [activeToastId, setActiveToastId]     = useState(null);

  // 3. Authenticity check
  useEffect(() => {
    const token = typeof window !== "undefined" && localStorage.getItem("token");
    if (!token) { router.push("/login"); return; }
    setMounted(true);
  }, [router]);

  // 4. Setups Query
  const { strategies, setupsLoading } = useSetups(marketType);

  // 5. Initial Image Upload Mutation
  const uploadJobMutation = useMutation({
    mutationFn: (fileObj) => uploadTradeImage({ file: fileObj, marketType, broker: isInd ? broker : "", tradeSubType: isInd ? tradeSubType : undefined }),
    onSuccess: (res) => {
      const tradeId = String(res.jobId || "");
      setJobId(tradeId);
      setUploadedTradeId(tradeId);
      setError(null);
      const tid = addToast(
        `Correct ${isInd ? "Indian" : "Forex"} image uploaded. AI processing started...`,
        "loading",
        Infinity
      );
      setActiveToastId(tid);
    },
    onError: (err) => {
      const friendlyMessage = getFriendlyUploadError(err);
      setError(friendlyMessage);
      addToast(friendlyMessage, "error");
    }
  });

  // ─ apply default setup (first saved strategy) ─
  const applyDefaultSetup = (tradeObj, savedStrategies) => {
    if (!savedStrategies?.length) return tradeObj;
    const first = savedStrategies[0];
    const rules = first.rules?.length
      ? first.rules.map((r, i) => ({ id: r.id ?? i + 1, label: r.label, followed: false }))
      : [];
    return { ...tradeObj, strategy: first.name, setupRules: rules };
  };

  // ─ apply parsed data helper ─
  const applyProcessedTradeData = (payload) => {
    const p = payload?.parsedData?.parsedTrade || payload?.parsedTrade || {};
    const parsedTradesPayload = dedupeParsedTrades(
      payload?.parsedData?.parsedTrades || payload?.parsedTrades || []
    );
    const imageUrl = payload?.imageUrl || payload?.screenshot || "";
    setExtractedText(payload?.extractedText || "");

    if (isInd) {
      const backendSubType = String(payload?.tradeSubType || "").toUpperCase();
      const inferredSubType = inferIndianTradeSubTypeFromPayload(payload);
      const resolvedSubType =
        backendSubType === "EQUITY" || backendSubType === "OPTION"
          ? backendSubType
          : inferredSubType || tradeSubType;

      if (resolvedSubType !== tradeSubType) {
        setTradeSubType(resolvedSubType);
      }

      const isEquity = resolvedSubType === "EQUITY";
      const templateFn = isEquity ? buildEquityTradeTemplate : buildIndianTradeTemplate;
      const multiTrades = parsedTradesPayload || [];
      if (multiTrades.length > 1) {
        const tradeArr = multiTrades.map(t => applyDefaultSetup(templateFn(imageUrl, t), strategies));
        setTrades(tradeArr);
        setSavedTrades(new Array(tradeArr.length).fill(false));
        setTrade(tradeArr[0]);
        if (strategies?.[0]?.rules?.length) {
          setSetupRules(strategies[0].rules.map((r, i) => ({ id: r.id ?? i + 1, label: r.label, followed: false })));
        }
      } else {
        setTrades([]);
        setSavedTrades([]);
        const row = multiTrades[0] || {};
        // Merge row-level data (entryPrice from "Avg") with top-level parsedTrade
        // (profit from "+₹1,618.50"). The row wins for per-position fields;
        // parsedTrade fills in anything the row missed — except exitPrice which
        // on open-position screens is the market/LTP price, not an actual exit.
        const single = {
          ...p,
          ...row,
          profit: row.pnl ?? row.profit ?? p.profit ?? null,
          entryPrice: row.entryPrice ?? p.entryPrice ?? null,
        };
        if (isEquity) {
          const base = buildEquityTradeTemplate(imageUrl, single);
          setTrade(applyDefaultSetup(base, strategies));
        } else {
          const pairStr = (single.pair || "").trim().toUpperCase();
          const ot = pairStr.endsWith(" PE") ? "PE" : pairStr.endsWith(" CE") ? "CE" : (single.optionType || "CE");
          const base = { ...buildIndianTradeTemplate(imageUrl, single), optionType: ot.toUpperCase() };
          setTrade(applyDefaultSetup(base, strategies));
        }
        if (strategies?.[0]?.rules?.length) {
          setSetupRules(strategies[0].rules.map((r, i) => ({ id: r.id ?? i + 1, label: r.label, followed: false })));
        }
      }
    } else {
      const multiTrades = parsedTradesPayload || [];
      if (multiTrades.length > 1) {
        const tradeArr = multiTrades.map(t => applyDefaultSetup(buildForexTradeTemplate(imageUrl, t), strategies));
        setTrades(tradeArr);
        setSavedTrades(new Array(tradeArr.length).fill(false));
        setTrade(tradeArr[0]);
        if (strategies?.[0]?.rules?.length) {
          setSetupRules(strategies[0].rules.map((r, i) => ({ id: r.id ?? i + 1, label: r.label, followed: false })));
        }
      } else {
        setTrades([]);
        setSavedTrades([]);
        const base = buildForexTradeTemplate(imageUrl, p);
        setTrade(applyDefaultSetup(base, strategies));
        if (strategies?.[0]?.rules?.length) {
          setSetupRules(strategies[0].rules.map((r, i) => ({ id: r.id ?? i + 1, label: r.label, followed: false })));
        }
      }
    }
  };

  // 6. Polling Query for status
  const jobStatusQuery = useQuery({
    queryKey: ["uploadStatus", jobId],
    queryFn: () => getTradeStatus(jobId),
    enabled: !!jobId,
    retry: false, // don't retry failed status polls — stop immediately on error
    refetchInterval: (query) => {
      // Stop polling on completed, failed, or any error (404 = trade not found)
      if (query.state.error) return false;
      const status = query.state.data?.status;
      if (status === "completed" || status === "failed") return false;
      return 4000;
    },
  });

  // Effect to process data when polling finishes
  useEffect(() => {
    if (jobStatusQuery.data?.status === "completed" && jobStatusQuery.data?.data) {
      applyProcessedTradeData(jobStatusQuery.data.data);
      setJobId("");
      if (activeToastId) {
        removeToast(activeToastId);
        setActiveToastId(null);
      }
      addToast("Trade details extracted successfully!", "success");
    } else if (jobStatusQuery.data?.status === "failed") {
      const rawError = jobStatusQuery.data.error || "Processing failed.";
      const normalizedRawError = String(rawError || "Processing failed.");
      const isNotTradeImage =
        normalizedRawError.toLowerCase().includes("not appear to be a trade") ||
        normalizedRawError.toLowerCase().includes("could not extract any trade") ||
        normalizedRawError.toLowerCase().includes("not a trade");

      const userMessage = isNotTradeImage
        ? "This doesn't look like a trade screenshot. Please upload a screenshot directly from your broker platform (MT5, Zerodha Kite, etc.) showing the trade details."
        : normalizedRawError;

      setError(userMessage);
      setJobId("");
      // Clear the file so the upload zone resets and the user can pick a new one
      if (isNotTradeImage) setFile(null);
      if (activeToastId) {
        removeToast(activeToastId);
        setActiveToastId(null);
      }
      addToast(
        isNotTradeImage
          ? "Not a valid trade screenshot — please upload from your broker app"
          : normalizedRawError,
        "error"
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobStatusQuery.data?.status]);

  // Stop polling and surface error when status request itself fails (e.g. 404)
  useEffect(() => {
    if (jobStatusQuery.error) {
      const msg = jobStatusQuery.error?.message || "Failed to check processing status.";
      setError(msg);
      setJobId("");
      if (activeToastId) {
        removeToast(activeToastId);
        setActiveToastId(null);
      }
      addToast(msg, "error");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobStatusQuery.error]);

  const loading = uploadJobMutation.isPending || !!jobId;
  const processingStatus = uploadJobMutation.isPending
    ? "uploading"
    : (jobStatusQuery.data?.status || (jobId ? "processing" : ""));

  // 7. Save Mutation
  const saveTradeMutation = useMutation({
    mutationFn: async ({ idx = null, forceCreate = false }) => {
      const t = idx !== null ? trades[idx] : trade;
      const rules = idx !== null ? (t.setupRules || []) : setupRules;
      const tradeData = buildTradePayload(t, isInd, rules);

      // >1 means genuinely multi-trade; ==1 means user deleted down to a single trade
      // and the ghost should be updated in-place rather than a new doc created.
      const isMultiTrade = trades.length > 1;

      if (!forceCreate && !isMultiTrade && idx === null && uploadedTradeId) {
        return updateTrade(uploadedTradeId, tradeData, marketType);
      }

      return createTrade(tradeData, marketType);
    },
    onSuccess: (res, variables) => {
      const { idx } = variables;
      queryClient.invalidateQueries({ queryKey: ["trades"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });

      addToast("Trade saved to your journal!", "success");

      if (idx !== null) {
        setSavedTrades(prev => {
          const updated = [...prev];
          updated[idx] = true;
          if (updated.every(Boolean)) {
             setTimeout(() => router.push(isInd ? "/indian-market/trades" : "/trades"), 1200);
          }
          return updated;
        });
      } else {
        setSaved(true);
        setTimeout(() => router.push(isInd ? "/indian-market/trades" : "/trades"), 1200);
      }
    },
    onError: (err) => {
      addToast(err.message || "Failed to save trade", "error");
    }
  });

  // 8. Actions
  const handleUpload = () => {
    if (!file) return setError("Select file");
    if (isInd && broker === "AUTO") return setError("Select broker");
    uploadJobMutation.mutate(file);
  };

  const handleChange = (e) => setTrade(prev => ({ ...prev, [e.target.name]: e.target.value }));
  const handleStrategyChange = (e) => {
    const value = e.target.value;
    setTrade(p => ({ ...p, strategy: value }));
    const select = strategies.find(s => s.name === value);
    setSetupRules(select?.rules?.length ? select.rules.map((r, i) => ({ id: r.id ?? i + 1, label: r.label, followed: false })) : []);
  };

  const handleTradeChange = (idx, e) => {
    setTrades(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [e.target.name]: e.target.value };
      return copy;
    });
  };

  const handleMultiTradeStrategyChange = (idx, e) => {
    const value = e.target.value;
    const select = strategies.find(s => s.name === value);
    const rules = select?.rules?.length ? select.rules.map((r, i) => ({ id: r.id ?? i + 1, label: r.label, followed: false })) : [];
    setTrades(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], strategy: value, setupRules: rules };
      return copy;
    });
  };

  const tradeCount = trades.length > 1 ? trades.length : trade ? 1 : 0;

  const canSaveTrade = (tradeToSave) => {
    if (!tradeToSave?.pair || !String(tradeToSave.pair).trim()) {
      addToast(`Please enter a ${isInd ? "Symbol" : "Pair"} before saving`, "info");
      return false;
    }
    if (!tradeToSave?.tradeDate) {
      addToast("Trade date is required before saving", "info");
      return false;
    }
    if (isInd && tradeToSave?.instrumentType === "EQUITY") {
      const sharesQty = parseOptionalNumber(tradeToSave?.sharesQty);
      if (sharesQty == null || sharesQty <= 0) {
        addToast("Shares quantity is required for equity trades", "info");
        return false;
      }
    }
    return true;
  };

  return {
    file, setFile, trade, setTrade, trades, savedTrades, loading, error, setError,
    extractedText, strategies, setupsLoading, jobId, processingStatus, mounted, saved,
    showCustomRR, setShowCustomRR, broker, setBroker, setupRules, isInd, marketType,
    tradeCount, tradeSubType, setTradeSubType,
    savingAll: saveTradeMutation.isPending,
    handleUpload,
    handleChange,
    handleStrategyChange,
    handleTradeChange,
    handleMultiTradeStrategyChange,
    saveTrade: () => {
      if (saveTradeMutation.isPending || saved) return;
      if (!canSaveTrade(trade)) return;
      saveTradeMutation.mutate({ idx: null });
    },
    saveIndianTrade: (idx) => {
      if (saveTradeMutation.isPending || savedTrades[idx]) return;
      if (!canSaveTrade(trades[idx])) return;
      saveTradeMutation.mutate({ idx });
    },
    saveAllTrades: async () => {
      // Delete the ghost trade first so it never appears in the journal,
      // regardless of which individual trades the user chose to keep.
      if (uploadedTradeId) {
        try {
          await deleteTrade(uploadedTradeId, marketType);
        } catch (_) {
          // Ghost may already be gone — not a blocking error
        }
      }
      for (let i = 0; i < trades.length; i++) {
        if (!savedTrades[i] && canSaveTrade(trades[i])) {
          try {
            await saveTradeMutation.mutateAsync({ idx: i });
          } catch (err) {
            addToast(`Trade ${i + 1} failed to save: ${err?.message || "Unknown error"}`, "error");
          }
        }
      }
    },
    toggleSetupRule: id => setSetupRules(p => p.map(r => r.id === id ? { ...r, followed: !r.followed } : r)),
    updateSetupRuleLabel: (id, val) => setSetupRules(p => p.map(r => r.id === id ? { ...r, label: val } : r)),
    addSetupRule: () => setSetupRules(p => [...p, { id: Date.now(), label: "", followed: false }]),
    clearSetupRules: () => setSetupRules(p => p.map(r => ({ ...r, followed: false }))),
    toggleSetupRuleMulti: (tIdx, rId) => setTrades(p => p.map((t, i) => i !== tIdx ? t : { ...t, setupRules: t.setupRules.map(r => r.id === rId ? { ...r, followed: !r.followed } : r) })),
    updateSetupRuleLabelMulti: (tIdx, rId, v) => setTrades(p => p.map((t, i) => i !== tIdx ? t : { ...t, setupRules: t.setupRules.map(r => r.id === rId ? { ...r, label: v } : r) })),
    addSetupRuleMulti: (tIdx) => setTrades(p => p.map((t, i) => i !== tIdx ? t : { ...t, setupRules: [...(t.setupRules || []), { id: Date.now(), label: "", followed: false }] })),
    clearSetupRulesMulti: (tIdx) => setTrades(p => p.map((t, i) => i !== tIdx ? t : { ...t, setupRules: t.setupRules.map(r => ({ ...r, followed: false })) })),
    deleteTrade: (idx) => {
      setTrades(prevTrades => {
        const nextTrades = prevTrades.filter((_, i) => i !== idx);
        setSavedTrades(prev => prev.filter((_, i) => i !== idx));

        // When multi-entry drops to a single remaining trade, hydrate single-trade mode
        // from that remaining row so calculations/UI stay aligned.
        if (nextTrades.length <= 1) {
          const remainingTrade = nextTrades[0] || null;
          setTrade(remainingTrade);
          setSaved(false);
          setSetupRules(remainingTrade?.setupRules || DEFAULT_SETUP_RULES);
        }

        return nextTrades;
      });
    },
  };
}
