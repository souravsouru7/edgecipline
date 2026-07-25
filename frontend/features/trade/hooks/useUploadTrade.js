"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMarket, MARKETS } from "@/context/MarketContext";
import { cancelUploadJob, getUploadJobStatus, uploadTradeImage } from "@/services/uploadApi";
import { compressImage } from "@/utils/imageCompression";
import { createTrade, createTradesBatch } from "@/services/tradeApi";
import { useSetups } from "./useSetups";
import { useToast } from "@/features/shared/components/ui/Toast";
import { getValidToken } from "@/utils/auth";
import { isAuthRefreshTransientError, silentRefresh } from "@/services/apiClient";
import { invalidateTradeDependentQueries } from "@/utils/queryInvalidation";
import { markOnboardingStep } from "@/services/api";

const DEFAULT_SETUP_RULES = [];
const OCR_STORAGE_KEY_PATTERN = /(ocr|upload.*trade|trade.*upload|extracted|draft)/i;
const INDIAN_LOT_SIZES = {
  NIFTY: 25,
  BANKNIFTY: 15,
  "BANK NIFTY": 15,
  FINNIFTY: 25,
  "FIN NIFTY": 25,
  MIDCPNIFTY: 50,
  SENSEX: 10,
  BANKEX: 15,
};

function clearOcrBrowserStorage() {
  if (typeof window === "undefined") return;
  [window.localStorage, window.sessionStorage].forEach((storage) => {
    try {
      for (let i = storage.length - 1; i >= 0; i -= 1) {
        const key = storage.key(i);
        if (key && OCR_STORAGE_KEY_PATTERN.test(key)) {
          storage.removeItem(key);
        }
      }
    } catch {
      // Storage can be unavailable in restricted webviews.
    }
  });
}
const getTodayInputValue = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split("T")[0];
};

// Stable per-row id for multi-trade extraction results. React must key the
// trades.map on this — not the array index — because each row now owns real
// local component state (pending evidence files in TradeEvidenceSection).
// Keying by index lets React reuse a card's instance for a different row
// after REMOVE ENTRY shifts everything down, silently carrying that row's
// unsaved evidence/upload state onto the wrong trade.
let rowIdCounter = 0;
const genRowId = () => `row_${Date.now()}_${rowIdCounter++}`;

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
  const resolvedDate   = normalizeDateForInput(t.tradeDate);
  const dateAutoFilled = !resolvedDate;
  const pair = pairBuilt || t.pair || "";
  const lotSize = inferIndianLotSize({ ...t, pair });
  return {
    pair,
    _dateAutoFilled: dateAutoFilled,
    action: "buy",
    quantity: t.quantity != null ? String(t.quantity) : "",
    lotSize: lotSize != null ? String(lotSize) : "",
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
    tradeDate: resolvedDate || getTodayInputValue(),
    expiryDate: t.expiryDate || "",
    riskRewardRatio: "", riskRewardCustom: "",
    entryBasis: "Plan", entryBasisCustom: "",
    notes: "", setup: "", mistakeTag: "", lesson: "",
    brokerage: "", sttTaxes: "",
    mood: null, confidence: "", emotionalTags: [], wouldRetake: "", tradeQuality: "",
    setupRules: [], tradeImages: [],
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

const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== "";
const hasNumericValue = (value) => {
  if (!hasValue(value)) return false;
  const n = Number.parseFloat(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n);
};

const normalizeText = (value) => String(value ?? "").trim().toUpperCase();

function inferIndianUnderlying(trade = {}) {
  const explicit = normalizeText(trade.underlying || trade.symbol || trade.stockSymbol);
  if (explicit) return explicit.replace(/\s+/g, " ");
  const pair = normalizeText(trade.pair);
  if (!pair) return "";
  if (pair.startsWith("BANK NIFTY") || pair.startsWith("BANKNIFTY")) return "BANKNIFTY";
  if (pair.startsWith("FIN NIFTY") || pair.startsWith("FINNIFTY")) return "FINNIFTY";
  if (pair.startsWith("MIDCPNIFTY")) return "MIDCPNIFTY";
  if (pair.startsWith("SENSEX")) return "SENSEX";
  if (pair.startsWith("BANKEX")) return "BANKEX";
  if (pair.startsWith("NIFTY")) return "NIFTY";
  return pair.split(/\s+/)[0] || "";
}

function inferIndianLotSize(trade = {}) {
  const explicit = parseOptionalNumber(trade.lotSize);
  if (explicit != null && explicit > 0) return explicit;
  return INDIAN_LOT_SIZES[inferIndianUnderlying(trade)] || undefined;
}

function hasPositiveNumber(value) {
  const n = parseOptionalNumber(value);
  return n != null && n > 0;
}

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
    tradeType: t.tradeType || "INTRADAY",
    strategy: "", strategyCustom: "",
    tradeDate: normalizeDateForInput(t.tradeDate) || getTodayInputValue(),
    brokerage: "", sttTaxes: "",
    entryBasis: "Plan", entryBasisCustom: "",
    setup: "", mistakeTag: "", lesson: "", notes: "",
    mood: null, confidence: "", emotionalTags: [], wouldRetake: "", tradeQuality: "",
    setupRules: [], tradeImages: [],
  };
}

function buildForexTradeTemplate(imageUrl, t = {}) {
  const resolvedDate  = normalizeDateForInput(t.tradeDate);
  const dateAutoFilled = !resolvedDate; // true when AI gave no usable date
  return {
    pair: t.pair || t.symbol || "",
    _dateAutoFilled: dateAutoFilled,
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
    tradeDate: resolvedDate || getTodayInputValue(),
    notes: "", screenshot: imageUrl,
    segment: t.segment || "Major FX",
    instrumentType: t.instrumentType || "Spot",
    quantity: t.quantity != null ? String(t.quantity) : "",
    strikePrice: t.strikePrice != null ? String(t.strikePrice) : "",
    expiryDate: t.expiryDate || "",
    brokerage: "", sttTaxes: "",
    entryBasis: "Plan", entryBasisCustom: "",
    mood: null, confidence: "", emotionalTags: [], wouldRetake: "", tradeQuality: "",
    setupRules: [], tradeImages: [],
  };
}

function buildTradePayload(trade, isInd, setupRules, tradeDateOverride) {
  const tradeDate =
    normalizeDateForInput(tradeDateOverride ?? trade?.tradeDate) || undefined;
  const activeRules = setupRules.filter(r => r.label && r.label.trim().length > 0);
  const followedCount = activeRules.filter(r => r.followed).length;
  const setupScore = activeRules.length > 0 ? Math.round((followedCount / activeRules.length) * 100) : null;

  const base = {
    pair: trade.pair,
    type: String(trade.action || trade.type || "BUY").toUpperCase(),
    entryPrice: parseOptionalNumber(trade.entryPrice),
    exitPrice: parseOptionalNumber(trade.exitPrice),
    profit: parseOptionalNumber(trade.profit),
    strategy: trade.strategy === "Custom" ? (trade.strategyCustom?.trim() || "Custom") : (trade.strategy || undefined),
    tradeDate,
    entryBasis: trade.entryBasis || "Plan",
    entryBasisCustom: trade.entryBasis === "Custom" ? trade.entryBasisCustom : undefined,
    notes: trade.notes || undefined,
    screenshot: trade.screenshot || undefined,
    tradeImages: Array.isArray(trade.tradeImages) ? trade.tradeImages : undefined,
    mood: trade.mood ?? undefined,
    confidence: trade.confidence || undefined,
    emotionalTags: Array.isArray(trade.emotionalTags) ? trade.emotionalTags : undefined,
    wouldRetake: trade.wouldRetake || undefined,
    tradeQuality: trade.tradeQuality || undefined,
    riskRewardRatio: trade.riskRewardRatio || undefined,
    riskRewardCustom: trade.riskRewardCustom || undefined,
    setupRules: activeRules.map(({ label, followed }) => ({ label: String(label).trim(), followed })),
    setupScore,
  };

  if (isInd && trade.instrumentType === "EQUITY") {
    Object.assign(base, {
      instrumentType: "EQUITY",
      segment: "EQUITY",
      tradeType: trade.tradeType || "INTRADAY",
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
      quantity: parseOptionalNumber(trade.quantity),
      lotSize: inferIndianLotSize(trade),
      strikePrice: parseOptionalNumber(trade.strikePrice),
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

function isTransientPollingError(error) {
  if (!error) return false;
  const status = error?.status;
  const message = String(error?.message || "").toLowerCase();
  return (
    !status ||
    status === 408 ||
    status === 429 ||
    status >= 500 ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("network")
  );
}

// ─── hook ─────────────────────────────────────────────────────────────────────

/**
 * useUploadTrade
 * Refactored to use TanStack Query for orchestration and useToast for feedback.
 */
const OCR_STAGE_ORDER = {
  "": 0,
  uploading: 1,
  cancelling: 1,
  pending: 2,
  processing: 3,
  completed: 4,
};

function normalizeOcrStage(status, { isUploading = false, hasJob = false, isCancelling = false } = {}) {
  if (isCancelling) return "cancelling";
  if (isUploading) return "uploading";

  const normalized = String(status || "").toLowerCase();
  if (normalized === "completed" || normalized === "confirmed") return "completed";
  if (normalized === "processing") return "processing";
  if (normalized === "pending") return "pending";
  if (hasJob) return "pending";
  return "";
}

function keepProgressMovingForward(currentStage, nextStage) {
  if (!nextStage) return "";
  if (nextStage === "cancelling") return "cancelling";
  if (!currentStage || currentStage === "cancelling") return nextStage;

  const currentOrder = OCR_STAGE_ORDER[currentStage] || 0;
  const nextOrder = OCR_STAGE_ORDER[nextStage] || 0;
  return nextOrder >= currentOrder ? nextStage : currentStage;
}

export function useUploadTrade({ accountCreatedDate = "" } = {}) {
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

  // Demo mode: entered from onboarding for users without their own broker
  // screenshot. We pre-load the bundled sample and run real extraction, but
  // every save path is blocked so a demo trade never reaches the journal.
  const isDemo = searchParams?.get("demo") === "1";

  // 2. Local UI/Form state
  const [mounted, setMounted]                 = useState(false);
  const [file, setFile]                       = useState(null);
  const [error, setError]                     = useState(null);
  const [jobId, setJobId]                     = useState("");
  const [uploadedJobId, setUploadedJobId]     = useState(null);
  const [broker, setBroker]                   = useState("AUTO");
  const [tradeSubType, setTradeSubType]       = useState(
    searchParams?.get("type") === "EQUITY" ? "EQUITY" : "OPTION"
  );
  const [trade, setTrade]                     = useState(null);
  const [trades, setTrades]                   = useState([]);
  const [savedTrades, setSavedTrades]         = useState([]);
  const [saved, setSaved]                     = useState(false);
  const [isBatchSaving, setIsBatchSaving]     = useState(false);
  const [isRedirecting, setIsRedirecting]     = useState(false);
  const [showCustomRR, setShowCustomRR]       = useState(false);
  const [setupRules, setSetupRules]           = useState(DEFAULT_SETUP_RULES);
  const [extractedText, setExtractedText]     = useState("");
  const [extractionInsights, setExtractionInsights] = useState(null);
  const [activeToastId, setActiveToastId]     = useState(null);
  const [visibleOcrStage, setVisibleOcrStage] = useState("");
  const [preExtractDate, setPreExtractDate]   = useState(getTodayInputValue());
  const [isCancellingUpload, setIsCancellingUpload] = useState(false);
  const processedTradeIdRef                   = useRef(null);
  const saveAllLockRef                        = useRef(false);
  const uploadedJobIdRef                      = useRef(null);
  const savedRef                              = useRef(false);
  const uploadSessionRef                      = useRef(0);
  const pendingUploadCancelRef                = useRef(null);
  // Used to compute OCR_DURATION — set when the upload returns a jobId
  // (server-side OCR starts now), read when the polling reaches COMPLETED.
  const ocrStartedAtRef                       = useRef(null);

  // Clamp preExtractDate to [accountCreatedDate, today] whenever accountCreatedDate
  // arrives late (profile query resolves after mount) or preExtractDate drifts out of range.
  useEffect(() => {
    const today = getTodayInputValue();
    const min = accountCreatedDate || "";
    if (preExtractDate > today) {
      setPreExtractDate(today);
    } else if (min && preExtractDate < min) {
      setPreExtractDate(today);
    }
  }, [accountCreatedDate]); // eslint-disable-line react-hooks/exhaustive-deps
  const userEditedFormRef                     = useRef(false);

  useEffect(() => {
    uploadedJobIdRef.current = uploadedJobId;
  }, [uploadedJobId]);

  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);

  // 3. Authenticity check
  useEffect(() => {
    let cancelled = false;

    const checkAuth = async () => {
      if (getValidToken()) {
        if (!cancelled) setMounted(true);
        return;
      }

      let token = null;
      try {
        token = await silentRefresh();
      } catch (err) {
        if (isAuthRefreshTransientError(err)) {
          console.warn("[Auth] OCR upload preserved session after transient refresh failure", {
            at: new Date().toISOString(),
            status: err.status || 0,
          });
          if (!cancelled) setMounted(true);
          return;
        }
        throw err;
      }
      if (cancelled) return;

      if (token) {
        setMounted(true);
      } else {
        router.replace("/login");
      }
    };

    checkAuth();
    return () => { cancelled = true; };
  }, [router]);

  // 4. Setups Query
  const { strategies, setupsLoading } = useSetups(marketType);

  // 5. Initial Image Upload Mutation
  const uploadJobMutation = useMutation({
    mutationFn: ({ fileObj }) => uploadTradeImage({
      file: fileObj,
      marketType,
      broker: isInd ? broker : "",
      tradeSubType: isInd ? tradeSubType : undefined,
      tradeDate: preExtractDate,
    }),
    onSuccess: (res, variables) => {
      if (variables?.sessionId !== uploadSessionRef.current) {
        if (res?.jobId) {
          cancelUploadJob(res.jobId)
            .then(() => {
              const pendingClear = pendingUploadCancelRef.current;
              pendingUploadCancelRef.current = null;
              if (pendingClear) {
                addToast("Upload cancelled.", "success");
                clearOcrSession({ ...pendingClear, cancelJob: false });
              }
            })
            .catch((cancelError) => {
              const message = cancelError?.message || "Could not cancel upload. Please try again.";
              pendingUploadCancelRef.current = null;
              setError(message);
              addToast(message, "error");
            })
            .finally(() => setIsCancellingUpload(false));
        } else if (pendingUploadCancelRef.current) {
          const pendingClear = pendingUploadCancelRef.current;
          pendingUploadCancelRef.current = null;
          setIsCancellingUpload(false);
          clearOcrSession({ ...pendingClear, cancelJob: false });
        }
        return;
      }
      const nextJobId = String(res.jobId || "");

      // Upload finished — backend has the file. Server-side OCR starts now.
      if (variables?.uploadStartedAt != null) {
        console.info("IMAGE_UPLOAD_DURATION", {
          jobId: nextJobId,
          durationMs: Math.round(performance.now() - variables.uploadStartedAt),
        });
      }
      ocrStartedAtRef.current = performance.now();

      processedTradeIdRef.current = null;
      userEditedFormRef.current = false;
      setVisibleOcrStage((current) => keepProgressMovingForward(current, "pending"));
      setJobId(nextJobId);
      setUploadedJobId(nextJobId);
      setError(null);
      const tid = addToast(
        `Correct ${isInd ? "Indian" : "Forex"} image uploaded. AI processing started...`,
        "loading",
        Infinity
      );
      setActiveToastId(tid);
    },
    onError: (err, variables) => {
      if (variables?.sessionId !== uploadSessionRef.current && pendingUploadCancelRef.current) {
        const pendingClear = pendingUploadCancelRef.current;
        pendingUploadCancelRef.current = null;
        setIsCancellingUpload(false);
        clearOcrSession({ ...pendingClear, cancelJob: false });
        return;
      }
      if (variables?.sessionId !== uploadSessionRef.current) return;
      const friendlyMessage = getFriendlyUploadError(err);
      setError(friendlyMessage);
      addToast(friendlyMessage, "error");
    }
  });

  const clearOcrSession = async ({
    nextFile = null,
    keepFile = false,
    clearError = true,
    cancelJob = true,
    resetDate = false,
  } = {}) => {
    const activeJobId = uploadedJobIdRef.current || jobId;
    if (cancelJob && !activeJobId && uploadJobMutation.isPending) {
      pendingUploadCancelRef.current = { nextFile, keepFile, clearError, resetDate };
      setIsCancellingUpload(true);
      return false;
    }

    if (cancelJob && activeJobId && !savedRef.current) {
      setIsCancellingUpload(true);
      try {
        await cancelUploadJob(activeJobId);
        addToast("Upload cancelled.", "success");
      } catch (cancelError) {
        const message = cancelError?.message || "Could not cancel upload. Please try again.";
        setError(message);
        addToast(message, "error");
        return false;
      } finally {
        setIsCancellingUpload(false);
      }
    }

    if (activeToastId) {
      removeToast(activeToastId);
      setActiveToastId(null);
    }

    clearOcrBrowserStorage();
    queryClient.removeQueries({ queryKey: ["uploadStatus"], exact: false });
    uploadJobMutation.reset();
    saveTradeMutation.reset();

    processedTradeIdRef.current = null;
    userEditedFormRef.current = false;
    saveAllLockRef.current = false;
    setVisibleOcrStage("");
    setJobId("");
    setUploadedJobId(null);
    setTrade(null);
    setTrades([]);
    setSavedTrades([]);
    setSaved(false);
    setSetupRules(DEFAULT_SETUP_RULES);
    setExtractedText("");
    setExtractionInsights(null);
    if (clearError) setError(null);
    if (resetDate) setPreExtractDate(getTodayInputValue());
    if (!keepFile) setFile(nextFile);
    return true;
  };

  const handleFileSelect = async (nextFile) => {
    uploadSessionRef.current += 1;
    await clearOcrSession({ nextFile, cancelJob: true });
  };

  // Demo mode: fetch the bundled sample screenshot and drop it into the
  // upload zone as if the user had selected it. Runs once after mount. The
  // user still clicks "Extract" themselves, and Save stays blocked (below).
  const demoSampleLoadedRef = useRef(false);
  useEffect(() => {
    if (!isDemo || !mounted || demoSampleLoadedRef.current) return;
    demoSampleLoadedRef.current = true;
    const samplePath = isInd ? "/sample_indianmarket.jpeg" : "/sample.png";
    const sampleName = isInd ? "sample_indianmarket.jpeg" : "sample.png";
    (async () => {
      try {
        const res = await fetch(samplePath);
        if (!res.ok) throw new Error(`Sample fetch failed (${res.status})`);
        const blob = await res.blob();
        const sampleFile = new File([blob], sampleName, { type: blob.type || "image/jpeg" });
        // Indian extraction requires a broker; pick a sensible default so the
        // demo can run without forcing a selection.
        if (isInd) setBroker("Zerodha");
        uploadSessionRef.current += 1;
        await clearOcrSession({ nextFile: sampleFile, cancelJob: false });
      } catch (err) {
        console.warn("[Demo] Failed to load sample screenshot", err);
        addToast("Couldn't load the demo sample. Please try uploading your own screenshot.", "error");
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo, mounted, isInd]);

  useEffect(() => {
    return () => {
      const activeJobId = uploadedJobIdRef.current;
      if (activeJobId && !savedRef.current) {
        cancelUploadJob(activeJobId).catch(() => {});
      }
      clearOcrBrowserStorage();
      queryClient.removeQueries({ queryKey: ["uploadStatus"], exact: false });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detects if extracted data belongs to the wrong market type.
  // forexPair is restricted to real ISO currency-code pairs (e.g. EURUSD) so
  // it never false-positives on a 6-letter stock ticker or a name with
  // spaces stripped (e.g. "Data Patterns (I)" -> "DATAPATTERNS").
  const detectMarketMismatch = (payload) => {
    const pair = String(payload?.pair || payload?.stockSymbol || "").trim().toUpperCase();
    if (isInd) {
      // On Indian market page — flag Forex data
      const MAJOR_CCY = "USD|EUR|GBP|JPY|CHF|AUD|NZD|CAD|CNH|CNY|SGD|HKD|ZAR|TRY|MXN|SEK|NOK|DKK|INR|XAU|XAG";
      const forexPair = new RegExp(`^(?:(?:${MAJOR_CCY})(?:${MAJOR_CCY})(?:\\.[A-Z]+)?)$`).test(pair) ||
        /^(GOLD|SILVER|OIL|BRENT|US30|US100|US500|NASDAQ100|NAS100|DAX|FTSE|SP500|CRUDE)$/.test(pair);
      const forexBroker = /metatrader|mt4|mt5|ctrader/i.test(String(payload?.broker || ""));
      const noIndianSignals = !/CE$|PE$/.test(pair) && !payload?.strikePrice;
      if ((forexPair || forexBroker) && noIndianSignals) {
        return "This looks like a Forex/MT5 screenshot. Please go back and use the Forex upload page instead.";
      }
    } else {
      // On Forex page — flag Indian market data
      const indianPair = /CE$|PE$/.test(pair) || payload?.strikePrice != null;
      const indianBroker = /zerodha|upstox|angel|groww|dhan|fyers|kite|5paisa|kotak/i.test(String(payload?.broker || ""));
      if (indianPair || indianBroker) {
        return "This looks like an Indian broker screenshot. Please go back and use the Indian Market upload page instead.";
      }
    }
    return null;
  };

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
    if (userEditedFormRef.current) return;

    // Check for market type mismatch before populating the form
    const mismatchMessage = detectMarketMismatch(payload);
    if (mismatchMessage) {
      clearOcrSession({ nextFile: null, clearError: false, cancelJob: true });
      setError(mismatchMessage);
      addToast(mismatchMessage, "error");
      return;
    }

    const p = payload?.parsedData?.parsedTrade || payload?.parsedTrade || {};
    const parsedTradesPayload = dedupeParsedTrades(
      payload?.parsedData?.parsedTrades || payload?.parsedTrades || []
    );
    const imageUrl = payload?.imageUrl || payload?.screenshot || "";
    setExtractionInsights({
      brokerType: payload?.brokerType || null,
      detectedMarket: payload?.detectedMarket || null,
      imageQuality: payload?.imageQuality || null,
      confidenceReport: payload?.confidenceReport || null,
      needsReview: Boolean(payload?.needsReview),
      extractedValues: parsedTradesPayload.length ? parsedTradesPayload : p,
    });
    const withStatusTradeDate = (row = {}) => ({
      ...row,
      tradeDate: row.tradeDate || preExtractDate || undefined,
    });
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
        const tradeArr = multiTrades.map(t => ({ ...applyDefaultSetup(templateFn(imageUrl, withStatusTradeDate(t)), strategies), _rowId: genRowId() }));
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
        const single = withStatusTradeDate({
          ...p,
          ...row,
          profit: row.pnl ?? row.profit ?? p.profit ?? null,
          entryPrice: row.entryPrice ?? p.entryPrice ?? null,
        });
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
        const tradeArr = multiTrades.map(t => ({ ...applyDefaultSetup(buildForexTradeTemplate(imageUrl, withStatusTradeDate(t)), strategies), _rowId: genRowId() }));
        setTrades(tradeArr);
        setSavedTrades(new Array(tradeArr.length).fill(false));
        setTrade(tradeArr[0]);
        if (strategies?.[0]?.rules?.length) {
          setSetupRules(strategies[0].rules.map((r, i) => ({ id: r.id ?? i + 1, label: r.label, followed: false })));
        }
      } else {
        setTrades([]);
        setSavedTrades([]);
        const base = buildForexTradeTemplate(imageUrl, withStatusTradeDate(p));
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
    queryFn: () => getUploadJobStatus(jobId),
    enabled: !!jobId,
    // Retry transient network/server errors with exponential backoff.
    // Don't retry 404 (trade not found) — that's a definitive failure.
    retry: (failureCount, error) => [404, 429].includes(error?.status) ? false : failureCount < 3,
    retryDelay: (attempt) => Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 10000),
    refetchInterval: (query) => {
      if (query.state.error) {
        return isTransientPollingError(query.state.error) ? 5000 : false;
      }
      const status = query.state.data?.status;
      if (["COMPLETED", "FAILED", "CANCELLED", "CONFIRMED", "completed", "failed"].includes(status)) return false;
      return 4000;
    },
  });

  // Effect to process data when polling finishes (once per upload id)
  useEffect(() => {
    const currentStatus = String(jobStatusQuery.data?.status || "").toUpperCase();
    const completedPayload = jobStatusQuery.data?.data;
    if (currentStatus === "COMPLETED" && completedPayload) {
      const sourceId = uploadedJobId || jobId;
      if (!sourceId || processedTradeIdRef.current === sourceId) return;

      if (ocrStartedAtRef.current != null) {
        console.info("OCR_DURATION", {
          jobId: sourceId,
          durationMs: Math.round(performance.now() - ocrStartedAtRef.current),
        });
        ocrStartedAtRef.current = null;
      }

      processedTradeIdRef.current = sourceId;
      applyProcessedTradeData(completedPayload);
      setJobId("");
      if (activeToastId) {
        removeToast(activeToastId);
        setActiveToastId(null);
      }
      addToast("Trade details extracted successfully!", "success");
      return;
    }

    if (currentStatus === "COMPLETED" && !completedPayload) {
      clearOcrSession({ nextFile: null, clearError: false, cancelJob: false });
      const message = "Extraction completed but no trade data was returned. Please upload a clearer broker screenshot and try again.";
      setError(message);
      addToast(message, "error");
      return;
    }

    if (currentStatus === "FAILED" || currentStatus === "CANCELLED") {
      const rawError = jobStatusQuery.data.error || "Processing failed.";
      const normalizedRawError = String(rawError || "Processing failed.");
      const lc = normalizedRawError.toLowerCase();

      const isNotTradeImage =
        lc.includes("not appear to be a trade") ||
        lc.includes("could not extract any trade") ||
        lc.includes("not a trade");

      const isWrongMarket =
        lc.includes("wrong screenshot type") ||
        lc.includes("forex upload page") ||
        lc.includes("indian market upload page");

      const isSystemBusy =
        lc.includes("currently busy") ||
        lc.includes("high demand") ||
        lc.includes("timed out") ||
        lc.includes("429") ||
        lc.includes("resource_exhausted") ||
        lc.includes("quota");

      const userMessage = isWrongMarket
        ? normalizedRawError
        : isNotTradeImage
        ? "This doesn't look like a trade screenshot. Please upload a screenshot directly from your broker platform (MT5, Zerodha Kite, etc.) showing the trade details."
        : isSystemBusy
        ? "Our AI is currently busy due to high demand. Please wait a moment and try uploading again."
        : normalizedRawError;

      clearOcrSession({ nextFile: null, clearError: false, cancelJob: false });
      setError(userMessage);
      addToast(
        isWrongMarket
          ? normalizedRawError
          : isNotTradeImage
          ? "Not a valid trade screenshot — please upload from your broker app"
          : isSystemBusy
          ? "AI busy — please try again in a few minutes"
          : normalizedRawError,
        "error"
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobStatusQuery.data?.status, jobStatusQuery.data?.data]);

  // Stop polling only for definitive status errors. Transient mobile/network
  // timeouts should not discard an active OCR job after upload has succeeded.
  useEffect(() => {
    if (jobStatusQuery.error) {
      const msg = jobStatusQuery.error?.message || "Failed to check processing status.";
      if (isTransientPollingError(jobStatusQuery.error)) {
        console.warn("[OCR] status polling transient error; keeping job active", {
          jobId,
          message: msg,
          status: jobStatusQuery.error?.status || 0,
        });
        return;
      }
      clearOcrSession({ nextFile: null, clearError: false, cancelJob: false });
      setError(msg);
      addToast(msg, "error");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobStatusQuery.error]);

  const loading = uploadJobMutation.isPending || !!jobId || isCancellingUpload;
  const serverOcrStage = normalizeOcrStage(jobStatusQuery.data?.status, {
    isUploading: uploadJobMutation.isPending,
    hasJob: Boolean(jobId),
    isCancelling: isCancellingUpload,
  });

  useEffect(() => {
    setVisibleOcrStage((current) => keepProgressMovingForward(current, serverOcrStage));
  }, [serverOcrStage]);

  const processingStatus = visibleOcrStage || serverOcrStage;

  // 7. Save Mutation
  const saveTradeMutation = useMutation({
    mutationFn: async ({ idx = null, tradeSnapshot, setupRulesSnapshot, tradeDate }) => {
      const t = tradeSnapshot ?? (idx !== null ? trades[idx] : trade);
      const rules = setupRulesSnapshot ?? (idx !== null ? (t.setupRules || []) : setupRules);
      const selectedTradeDate = normalizeDateForInput(tradeDate ?? t?.tradeDate);
      const tradeData = buildTradePayload(t, isInd, rules, selectedTradeDate);
      return createTrade({
        ...tradeData,
        ocrJobId: uploadedJobId || jobId || undefined,
      }, marketType);
    },
    onSuccess: (res, variables) => {
      const { idx } = variables;
      invalidateTradeDependentQueries(queryClient);

      addToast("Trade saved to your trade log!", "success");

      if (idx !== null) {
        setSavedTrades(prev => {
          const updated = [...prev];
          updated[idx] = true;
          if (updated.every(Boolean)) {
            savedRef.current = true;
            setIsRedirecting(true);
            markOnboardingStep("tradeAdded", true).catch(() => {});
            const onboardingMode = searchParams?.get("onboarding") === "1";
            const journalRoute = isInd ? "/indian-market/trades" : "/trades";
            const dest = onboardingMode ? `${journalRoute}?onboarding=1` : journalRoute;
            setTimeout(() => router.push(dest), 1200);
          }
          return updated;
        });
      } else {
        savedRef.current = true;
        setSaved(true);
        setIsRedirecting(true);
        setUploadedJobId(null);
        processedTradeIdRef.current = null;
        userEditedFormRef.current = false;
        markOnboardingStep("tradeAdded", true).catch(() => {});
        const onboardingMode = searchParams?.get("onboarding") === "1";
        const journalRoute = isInd ? "/indian-market/trades" : "/trades";
        const dest = onboardingMode ? `${journalRoute}?onboarding=1` : journalRoute;
        setTimeout(() => router.push(dest), 1200);
      }
    },
    onError: (err) => {
      addToast(err.message || "Failed to save trade", "error");
    }
  });

  // 8. Actions
  const handleUpload = async () => {
    if (uploadJobMutation.isPending || jobId || isCancellingUpload) return;
    if (!file) return setError("Select file");
    if (isInd && broker === "AUTO") return setError("Select broker");

    // Compress BEFORE upload. PDFs and small images pass through unchanged.
    // Failures degrade gracefully — the original file is uploaded.
    let fileToUpload = file;
    try {
      const compressStart = performance.now();
      console.info("IMAGE_ORIGINAL_SIZE", { bytes: file.size, type: file.type, name: file.name });

      const result = await compressImage(file);
      const compressMs = Math.round(performance.now() - compressStart);

      if (result.skipped) {
        console.info("IMAGE_COMPRESSION_SKIPPED", {
          reason: result.reason,
          originalSizeBytes: result.originalSize,
          durationMs: compressMs,
        });
      } else {
        console.info("IMAGE_COMPRESSED_SIZE", { bytes: result.compressedSize });
        console.info("IMAGE_COMPRESSION_RATIO", {
          ratio: result.compressionRatio,
          originalBytes: result.originalSize,
          compressedBytes: result.compressedSize,
          sourceDims: { w: result.sourceWidth, h: result.sourceHeight },
          targetDims: { w: result.targetWidth, h: result.targetHeight },
          durationMs: compressMs,
        });
        fileToUpload = result.file;
      }
    } catch (err) {
      console.warn("IMAGE_COMPRESSION_ERROR", { error: err?.message || String(err) });
      // Fall through with original file — never block the user on a
      // compression failure.
    }

    const sessionId = uploadSessionRef.current + 1;
    uploadSessionRef.current = sessionId;
    const cleared = await clearOcrSession({ nextFile: fileToUpload, cancelJob: true });
    if (!cleared) return;

    setVisibleOcrStage("uploading");
    uploadJobMutation.mutate({
      fileObj: fileToUpload,
      sessionId,
      uploadStartedAt: performance.now(),
    });
  };

  const handleChange = (e) => {
    userEditedFormRef.current = true;
    const update = { [e.target.name]: e.target.value };
    if (e.target.name === "tradeDate") update._dateAutoFilled = false;
    setTrade(prev => ({ ...prev, ...update }));
  };
  const handleStrategyChange = (e) => {
    const value = e.target.value;
    setTrade(p => ({ ...p, strategy: value }));
    const select = strategies.find(s => s.name === value);
    setSetupRules(select?.rules?.length ? select.rules.map((r, i) => ({ id: r.id ?? i + 1, label: r.label, followed: false })) : []);
  };

  const handleTradeChange = (idx, e) => {
    userEditedFormRef.current = true;
    const fieldUpdate = { [e.target.name]: e.target.value };
    if (e.target.name === "tradeDate") fieldUpdate._dateAutoFilled = false;
    setTrades(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], ...fieldUpdate };
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
    if (accountCreatedDate && tradeToSave.tradeDate < accountCreatedDate) {
      addToast(`Trade date cannot be before your account creation date (${accountCreatedDate})`, "info");
      return false;
    }
    if (tradeToSave.tradeDate > getTodayInputValue()) {
      addToast("Trade date cannot be in the future", "info");
      return false;
    }
    if (!isInd) {
      const requiredForexFields = [
        ["entryPrice", "Entry price is required before saving"],
        ["exitPrice", "Exit price is required before saving"],
        ["lotSize", "Lot size is required before saving"],
        ["profit", "P&L is required before saving"],
        ["stopLoss", "Stop loss is required before saving"],
        ["takeProfit", "Take profit is required before saving"],
      ];

      for (const [field, message] of requiredForexFields) {
        if (!hasNumericValue(tradeToSave?.[field])) {
          addToast(message, "info");
          return false;
        }
      }

      if (!hasValue(tradeToSave?.riskRewardRatio)) {
        addToast("Planned R:R is required before saving", "info");
        return false;
      }
      if (tradeToSave?.riskRewardRatio === "custom" && !hasValue(tradeToSave?.riskRewardCustom)) {
        addToast("Custom R:R is required before saving", "info");
        return false;
      }
      if (strategies?.length > 0 && !hasValue(tradeToSave?.strategy)) {
        addToast("Strategy / setup is required before saving", "info");
        return false;
      }
      if (tradeToSave?.strategy === "Custom" && !hasValue(tradeToSave?.strategyCustom)) {
        addToast("Custom setup name is required before saving", "info");
        return false;
      }
      if (!hasValue(tradeToSave?.entryBasis)) {
        addToast("Entry basis is required before saving", "info");
        return false;
      }
      if (tradeToSave?.entryBasis === "Custom" && !hasValue(tradeToSave?.entryBasisCustom)) {
        addToast("Custom entry basis is required before saving", "info");
        return false;
      }
      if (!hasValue(tradeToSave?.session)) {
        addToast("Session is required before saving", "info");
        return false;
      }
      if (!hasValue(tradeToSave?.notes)) {
        addToast("Notes are required before saving", "info");
        return false;
      }
      if (!hasNumericValue(tradeToSave?.mood)) {
        addToast("Emotional state is required before saving", "info");
        return false;
      }
      if (!hasValue(tradeToSave?.confidence)) {
        addToast("Trade confidence is required before saving", "info");
        return false;
      }
      if (!Array.isArray(tradeToSave?.emotionalTags) || tradeToSave.emotionalTags.length === 0) {
        addToast("At least one emotional tag is required before saving", "info");
        return false;
      }
      if (!hasValue(tradeToSave?.wouldRetake)) {
        addToast("Would you retake this trade? is required before saving", "info");
        return false;
      }
    }
    if (isInd) {
      const isEquityTrade = String(tradeToSave?.instrumentType || "").toUpperCase() === "EQUITY";
      const hasOcrBackedProfit = Boolean(uploadedJobId || jobId) && hasNumericValue(tradeToSave?.profit);

      // P&L is always required, but entry/exit price are only required when
      // there's no P&L to fall back on. Many closed Indian positions (Avg =
      // 0.00 on the broker screenshot) never show a per-unit entry/exit
      // price — only the aggregate P&L — so don't force a fabricated price
      // just to pass validation when the real P&L was already extracted.
      if (!hasNumericValue(tradeToSave?.profit)) {
        addToast("P&L is required before saving", "info");
        return false;
      }

      // Entry/exit are validated as a pair only when at least one is filled
      // in — a partially-filled pair (e.g. a hallucinated placeholder in one
      // field) is worse than leaving both blank, so require both or neither.
      const hasEntry = hasNumericValue(tradeToSave?.entryPrice);
      const hasExit = hasNumericValue(tradeToSave?.exitPrice);
      if (hasEntry || hasExit) {
        if (!hasPositiveNumber(tradeToSave?.entryPrice)) {
          addToast("Entry price must be greater than 0", "info");
          return false;
        }
        if (!hasPositiveNumber(tradeToSave?.exitPrice)) {
          addToast("Exit price must be greater than 0", "info");
          return false;
        }
      }

      if (isEquityTrade) {
        if (!hasOcrBackedProfit && !hasPositiveNumber(tradeToSave?.sharesQty)) {
          addToast("Shares quantity is required for equity trades", "info");
          return false;
        }
      } else {
        if (!hasOcrBackedProfit && !hasPositiveNumber(tradeToSave?.quantity)) {
          addToast("Quantity/lots is required for option trades", "info");
          return false;
        }
        if (!hasOcrBackedProfit && !hasPositiveNumber(tradeToSave?.lotSize) && !inferIndianLotSize(tradeToSave)) {
          addToast("Lot size is required for option trades", "info");
          return false;
        }
      }

      if (!hasValue(tradeToSave?.entryBasis)) {
        addToast("Entry basis is required before saving", "info");
        return false;
      }
      if (tradeToSave?.entryBasis === "Custom" && !hasValue(tradeToSave?.entryBasisCustom)) {
        addToast("Custom entry basis is required before saving", "info");
        return false;
      }
      if (!hasNumericValue(tradeToSave?.mood)) {
        addToast("Mood is required before saving", "info");
        return false;
      }
      if (!hasValue(tradeToSave?.confidence)) {
        addToast("Confidence is required before saving", "info");
        return false;
      }
      if (!Array.isArray(tradeToSave?.emotionalTags) || tradeToSave.emotionalTags.length === 0) {
        addToast("At least one emotional tag is required before saving", "info");
        return false;
      }
      if (!hasValue(tradeToSave?.tradeQuality)) {
        addToast("Trade quality is required before saving", "info");
        return false;
      }
    }
    return true;
  };

  const handlePreExtractDateChange = (val) => {
    const today = getTodayInputValue();
    const min = accountCreatedDate || "";
    if (!val || val > today) {
      setPreExtractDate(today);
      return;
    }
    if (min && val < min) {
      setPreExtractDate(today);
      return;
    }
    setPreExtractDate(val);
  };

  return {
    file, setFile: handleFileSelect, trade, setTrade, trades, savedTrades, loading, error, setError,
    extractedText, extractionInsights, strategies, setupsLoading, jobId, processingStatus, mounted, saved, isRedirecting,
    showCustomRR, setShowCustomRR, broker, setBroker, setupRules, isInd, marketType,
    tradeCount, tradeSubType, setTradeSubType,
    savingAll: saveTradeMutation.isPending || isBatchSaving,
    handleUpload,
    clearOcrSession: async () => {
      uploadSessionRef.current += 1;
      await clearOcrSession({ nextFile: null, cancelJob: true, resetDate: true });
    },
    handleChange,
    handleStrategyChange,
    handleTradeChange,
    handleMultiTradeStrategyChange,
    isDemo,
    // `overrides` lets the caller pass freshly-committed data (e.g. tradeImages
    // just uploaded via TradeEvidenceSection) that bypasses setState's async
    // closure — mirrors the tradeOverrides pattern in useAddTrade.
    saveTrade: (overrides) => {
      if (isDemo) { addToast("Demo trade — not saved. Upload your own screenshot to save real trades to your trade log.", "info"); return; }
      if (saveTradeMutation.isPending || saved) return;
      const tradeToSave = overrides ? { ...trade, ...overrides } : trade;
      if (!canSaveTrade(tradeToSave)) return;
      saveTradeMutation.mutate({
        idx: null,
        tradeSnapshot: tradeToSave,
        setupRulesSnapshot: setupRules,
        tradeDate: tradeToSave.tradeDate,
      });
    },
    saveExtractedTrade: (idx, overrides) => {
      if (isDemo) { addToast("Demo trade — not saved. Upload your own screenshot to save real trades to your trade log.", "info"); return; }
      if (saveTradeMutation.isPending || savedTrades[idx]) return;
      const row = overrides ? { ...trades[idx], ...overrides } : trades[idx];
      if (!canSaveTrade(row)) return;
      saveTradeMutation.mutate({
        idx,
        tradeSnapshot: row,
        tradeDate: row.tradeDate,
      });
    },
    preExtractDate, handlePreExtractDateChange,
    todayInputMax: getTodayInputValue(),
    // `evidenceOverridesByIdx` is an optional { [tradeIndex]: tradeImages[] }
    // map — same async-closure workaround as saveExtractedTrade above, applied
    // per-row for the batch path.
    saveAllTrades: async (evidenceOverridesByIdx) => {
      if (isDemo) { addToast("Demo trades — not saved. Upload your own screenshot to save real trades to your trade log.", "info"); return; }
      // Edge #1: prevent double-tap from creating duplicate trades
      if (saveAllLockRef.current || saveTradeMutation.isPending) return;
      saveAllLockRef.current = true;

      try {
        // Edge #2: guard against saving when every trade was removed
        const unsaved = trades.filter((_, i) => !savedTrades[i]);
        if (unsaved.length === 0) {
          addToast("No trades to save — all entries have been removed.", "info");
          return;
        }

        // Edge #4: validate all trades first and report a single grouped summary
        // instead of firing one toast per failing trade.
        const failingIndices = [];
        const validIndices   = [];
        for (let i = 0; i < trades.length; i++) {
          if (savedTrades[i]) continue;
          // canSaveTrade fires individual toasts — suppress them during batch check
          // by running a silent version then showing one summary.
          const t = evidenceOverridesByIdx?.[i] ? { ...trades[i], tradeImages: evidenceOverridesByIdx[i] } : trades[i];
          const missingFields = [];
          if (!t?.pair || !String(t.pair).trim())                                          missingFields.push("Pair");
          if (!t?.tradeDate)                                                                missingFields.push("Trade Date");
          if (isInd) {
            const isEquityTrade = String(t?.instrumentType || "").toUpperCase() === "EQUITY";
            const hasOcrBackedProfit = Boolean(uploadedJobId || jobId) && hasNumericValue(t?.profit);
            // Entry/exit are only mandatory as a pair when at least one is
            // filled in — a closed position with no per-unit price (Avg =
            // 0.00) can save on P&L alone.
            const hasEntry = hasNumericValue(t?.entryPrice);
            const hasExit = hasNumericValue(t?.exitPrice);
            if (hasEntry || hasExit) {
              if (!hasPositiveNumber(t?.entryPrice))                                       missingFields.push("Entry Price");
              if (!hasPositiveNumber(t?.exitPrice))                                        missingFields.push("Exit Price");
            }
            if (!hasNumericValue(t?.profit))                                               missingFields.push("P&L");
            if (isEquityTrade) {
              if (!hasOcrBackedProfit && !hasPositiveNumber(t?.sharesQty))                 missingFields.push("Shares Quantity");
            } else {
              if (!hasOcrBackedProfit && !hasPositiveNumber(t?.quantity))                  missingFields.push("Quantity/Lots");
              if (!hasOcrBackedProfit && !hasPositiveNumber(t?.lotSize) && !inferIndianLotSize(t)) missingFields.push("Lot Size");
            }
            if (!hasValue(t?.entryBasis))                                                  missingFields.push("Entry Basis");
            if (t?.entryBasis === "Custom" && !hasValue(t?.entryBasisCustom))              missingFields.push("Custom Entry Basis");
            if (!hasNumericValue(t?.mood))                                                 missingFields.push("Mood");
            if (!hasValue(t?.confidence))                                                  missingFields.push("Confidence");
            if (!Array.isArray(t?.emotionalTags) || t.emotionalTags.length === 0)          missingFields.push("Emotional Tags");
            if (!hasValue(t?.tradeQuality))                                                missingFields.push("Trade Quality");
          } else {
            if (!hasNumericValue(t?.entryPrice))                                           missingFields.push("Entry Price");
            if (!hasNumericValue(t?.exitPrice))                                            missingFields.push("Exit Price");
            if (!hasNumericValue(t?.lotSize))                                              missingFields.push("Lot Size");
            if (!hasNumericValue(t?.profit))                                               missingFields.push("P&L");
            if (!hasNumericValue(t?.stopLoss))                                             missingFields.push("Stop Loss");
            if (!hasNumericValue(t?.takeProfit))                                           missingFields.push("Take Profit");
            if (!hasValue(t?.riskRewardRatio))                                             missingFields.push("R:R Ratio");
            if (!hasValue(t?.session))                                                     missingFields.push("Session");
            if (!hasValue(t?.notes))                                                       missingFields.push("Notes");
            if (!hasNumericValue(t?.mood))                                                 missingFields.push("Mood");
            if (!hasValue(t?.confidence))                                                  missingFields.push("Confidence");
            if (!Array.isArray(t?.emotionalTags) || t.emotionalTags.length === 0)         missingFields.push("Emotional Tags");
            if (!hasValue(t?.wouldRetake))                                                 missingFields.push("Would Retake");
          }
          if (missingFields.length > 0) {
            failingIndices.push({ i, missingFields });
          } else {
            validIndices.push(i);
          }
        }

        if (failingIndices.length > 0) {
          const tradeLabels = failingIndices
            .map(({ i, missingFields }) => `Trade #${i + 1}: ${missingFields.join(", ")}`)
            .join(" · ");
          addToast(`Cannot save — missing fields: ${tradeLabels}`, "error");
          // Only block if ALL unsaved trades have errors; otherwise save the valid ones
          if (validIndices.length === 0) return;
        }

        const batchPayload = validIndices.map((i) => {
          const row = evidenceOverridesByIdx?.[i] ? { ...trades[i], tradeImages: evidenceOverridesByIdx[i] } : trades[i];
          return buildTradePayload(row, isInd, row.setupRules || [], normalizeDateForInput(row.tradeDate));
        });

        setIsBatchSaving(true);
        const toastId = addToast(`Saving ${batchPayload.length} trades...`, "loading", Infinity);
        try {
          await createTradesBatch({
            trades: batchPayload,
            ocrJobId: uploadedJobId || jobId || undefined,
          }, marketType);

          setSavedTrades(prev => {
            const updated = [...prev];
            validIndices.forEach((i) => { updated[i] = true; });
            return updated;
          });
          savedRef.current = true;
          setSaved(true);
          setIsRedirecting(true);
          setUploadedJobId(null);
          processedTradeIdRef.current = null;
          userEditedFormRef.current = false;
          invalidateTradeDependentQueries(queryClient);
          removeToast(toastId);
          addToast(`${batchPayload.length} trades imported successfully!`, "success");
          markOnboardingStep("tradeAdded", true).catch(() => {});
          const onboardingMode = searchParams?.get("onboarding") === "1";
          const journalRoute = isInd ? "/indian-market/trades" : "/trades";
          const dest = onboardingMode ? `${journalRoute}?onboarding=1` : journalRoute;
          setTimeout(() => router.push(dest), 1200);
        } catch (err) {
          removeToast(toastId);
          addToast(err?.message || "Batch import failed. Please review and try again.", "error");
        } finally {
          setIsBatchSaving(false);
        }
      } finally {
        saveAllLockRef.current = false;
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
      // Edge #3: compute next arrays from the current closure values and call
      // each setter independently — calling setSavedTrades inside a setTrades
      // updater is a side-effect that React does not guarantee will be batched
      // atomically, which can leave the two arrays briefly out of sync.
      const nextTrades = trades.filter((_, i) => i !== idx);
      const nextSaved  = savedTrades.filter((_, i) => i !== idx);
      setTrades(nextTrades);
      setSavedTrades(nextSaved);

      // When multi-entry drops to a single remaining trade, hydrate single-trade mode
      // from that remaining row so calculations/UI stay aligned.
      if (nextTrades.length <= 1) {
        const remainingTrade = nextTrades[0] || null;
        setTrade(remainingTrade);
        setSaved(false);
        setSetupRules(remainingTrade?.setupRules || DEFAULT_SETUP_RULES);
      }
    },
  };
}
