"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createTrade } from "@/services/tradeApi";
import { isTradeLimitError, tradeLimitQuota, tradeLimitRequested } from "@/features/trade/lib/tradeLimit";
import { applyQuotaFromResponse } from "@/features/trade/hooks/useTradeQuota";
import { fetchSetups } from "@/services/setupApi";
import { uploadTradeScreenshot } from "@/services/uploadApi";
import { MARKETS } from "@/context/MarketContext";
import { useToast } from "@/features/shared/components/ui/Toast";
import {
  invalidateTradeDependentQueries,
  TRADE_QUERY_FRESHNESS_OPTIONS,
} from "@/utils/queryInvalidation";
import { markOnboardingStep } from "@/services/api";
import { getTodayInputValue } from "@/features/trade/lib/dateInput";
import * as haptics from "@/utils/haptics";
import { sanitizeNumericField, parseNumericField } from "@/features/trade/lib/numericInput";
import {
  appendSetupRule,
  clearSetupRules as clearSetupRulesFollowed,
  setSetupRuleLabel,
  toggleSetupRule as toggleSetupRuleFollowed,
} from "@/features/trade/lib/setupRules";

// Re-exported for the form pages that previously imported these from here.
export { sanitizeNumericInput, blockInvalidNumberKeys } from "@/features/trade/lib/numericInput";

// Indian options: underlying picklist and the lot size each one trades in.
// Mirrors the constants in app/indian-market/add-trade/page.js so both
// manual-entry forms compute the same lotSize for the same underlying.
export const UNDERLYINGS = ["NIFTY", "BANK NIFTY", "FIN NIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX", "Other"];
export const LOT_SIZES = { "NIFTY": 25, "BANK NIFTY": 15, "FIN NIFTY": 25, "MIDCPNIFTY": 50, "SENSEX": 10, "BANKEX": 15, "Other": 1 };

/**
 * useAddTrade
 * Encapsulates setup loading, screenshot uploading, and form submission logic using TanStack Query.
 * Integrated with useToast for clear user feedback.
 *
 * Field set and validation are shared across Forex and Indian Market so
 * manual entry looks and behaves the same for both — the Indian branch
 * (tradeSubType EQUITY/OPTION) mirrors app/indian-market/add-trade/page.js.
 */
export function useAddTrade(marketType, isIndianMarket) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const onboardingMode = searchParams?.get("onboarding") === "1";
  const queryClient = useQueryClient();
  const { addToast } = useToast();

  const [trade, setTrade] = useState({
    pair: "",
    type: "BUY",
    lotSize: "",
    entryPrice: "",
    exitPrice: "",
    stopLoss: "",
    takeProfit: "",
    profit: "",
    commission: "",
    swap: "",
    balance: "",
    strategy: "",
    strategyCustom: "",
    tradeDate: getTodayInputValue(),
    session: "",
    notes: "",
    setup: "",
    riskRewardRatio: "",
    riskRewardCustom: "",
    screenshot: "",
    tradeImages: [],
    // Indian Market Fields — options
    underlying: "NIFTY",
    underlyingOther: "",
    strikePrice: "",
    optionType: "CE",
    quantity: "",
    expiryDate: "",
    // Indian Market Fields — intraday stocks (EQUITY)
    stockSymbol: "",
    exchange: "NSE",
    sharesQty: "",
    sector: "",
    // Indian Market Fields — shared
    segment: "F&O",
    instrumentType: "OPTION",
    tradeType: "INTRADAY",
    brokerage: "",
    sttTaxes: "",
    entryBasis: "Plan",
    entryBasisCustom: "",
    // Psychology fields
    mood: null,
    confidence: "",
    emotionalTags: [],
    mistakeTag: "",
    lesson: "",
    wouldRetake: "",
    tradeQuality: "",
  });

  // Indian Market only: toggles the Options vs Intraday Stocks (EQUITY) field
  // set, same as app/indian-market/add-trade/page.js. Ignored for Forex.
  const [tradeSubType, setTradeSubType] = useState(
    searchParams?.get("type") === "EQUITY" ? "EQUITY" : "OPTION"
  );
  const isEquity = isIndianMarket && tradeSubType === "EQUITY";

  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [setupRules, setSetupRules] = useState([]);
  // Auth-gated "mounted": true once the route guard has confirmed a session
  // (or decided to keep one after a transient refresh failure).
  const { ready: mounted } = useRequireAuth();
  const submitLockRef = useRef(false);

  const getUnderlyingLabel = () => (trade.underlying === "Other" ? trade.underlyingOther : trade.underlying);
  const getLotSize = () => LOT_SIZES[trade.underlying] || 1;

  // 1. Fetch Setups Strategy via useQuery
  const { data: strategies = [], isLoading: setupsLoading } = useQuery({
    queryKey: ["setups", marketType],
    queryFn: async () => {
      const serverStrategies = await fetchSetups(marketType);
      if (Array.isArray(serverStrategies) && serverStrategies.length) {
        return serverStrategies.map((s, idx) => ({
          id: idx + 1,
          name: s.name || "",
          rules: Array.isArray(s.rules)
            ? s.rules.map((r, ri) => ({ id: ri + 1, label: r.label || "", followed: false }))
            : [],
        }));
      }
      return [];
    },
    ...TRADE_QUERY_FRESHNESS_OPTIONS,
  });

  // Non-null while a create is blocked by the free-tier allowance.
  const [limitBlock, setLimitBlock] = useState(null);
  // Non-null while the post-save "you've used your free trades" sheet is up.
  // The redirect below waits for it to close so the sheet is not unmounted
  // mid-read by the navigation.
  const [lastFreeTradeSheet, setLastFreeTradeSheet] = useState(null);

  const goAfterSave = () => {
    const isInd = marketType === MARKETS.INDIAN_MARKET;
    if (onboardingMode) {
      router.push(isInd ? "/indian-market/trades?onboarding=1" : "/trades?onboarding=1");
      return;
    }
    router.push(isInd ? "/indian-market/dashboard" : "/dashboard");
  };

  // 2. Submit Trade via useMutation
  const createTradeMutation = useMutation({
    mutationFn: (data) => createTrade(data, marketType),
    onSuccess: (res) => {
      invalidateTradeDependentQueries(queryClient);
      // The create response carries the post-save allowance, so the quota
      // pill flips without a second request.
      const quota = applyQuotaFromResponse(queryClient, marketType, res);

      addToast("Trade created and synced successfully!", "success");
      void haptics.success();

      markOnboardingStep("tradeAdded", true).catch(() => {});

      if (res?.showLastFreeTradeSheet && quota) {
        setLastFreeTradeSheet({ quota });
        return;
      }
      setTimeout(goAfterSave, 1000);
    },
    onError: (err) => {
      // Hitting the free allowance is not a form error — a toast would scroll
      // away and leave the user re-submitting the same trade forever. Surface
      // it as a dedicated dialog that explains the limit and offers upgrade.
      if (isTradeLimitError(err)) {
        setLimitBlock({ quota: tradeLimitQuota(err), requested: tradeLimitRequested(err) });
        return;
      }
      addToast(err.message || "Failed to save trade. Please check your inputs.", "error");
    },
    onSettled: () => {
      submitLockRef.current = false;
    },
  });

  useEffect(() => {
    // Session detection
    const now = new Date();
    const hour = now.getUTCHours();
    if (isIndianMarket) {
      setTrade(prev => ({ ...prev, session: "Morning Session" }));
    } else {
      let det = "Asian";
      if (hour >= 8 && hour < 13) det = "London";
      else if (hour >= 13 && hour < 21) det = "New York";
      setTrade(prev => ({ ...prev, session: det }));
    }
  }, [isIndianMarket]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setTrade(prev => ({ ...prev, [name]: sanitizeNumericField(name, value) }));
  };

  const handleStrategyChange = (e) => {
    const value = e.target.value;
    setTrade(prev => ({ ...prev, strategy: value }));
    const selected = strategies.find(s => s.name === value);
    if (selected?.rules?.length) {
      setSetupRules(selected.rules.map((r, i) => ({ id: r.id ?? i + 1, label: r.label || "", followed: false })));
    } else {
      setSetupRules([]);
    }
  };

  const handleScreenshotChange = async (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setScreenshotPreview(reader.result);
    reader.readAsDataURL(file);

    setUploading(true);
    addToast("Uploading screenshot...", "loading");

    try {
      const data = await uploadTradeScreenshot(file);
      setTrade(prev => ({ ...prev, screenshot: data.screenshotUrl || data.imageUrl || data.url }));
      addToast("Screenshot uploaded!", "success");
    } catch (err) {
      console.error("Upload error:", err);
      addToast("Failed to upload screenshot. Limits or network error.", "error");
    } finally {
      setUploading(false);
    }
  };

  const toggleSetupRule = (id) => setSetupRules(p => toggleSetupRuleFollowed(p, id));
  const updateSetupRuleLabel = (id, val) => setSetupRules(p => setSetupRuleLabel(p, id, val));
  const addSetupRule = () => setSetupRules(p => appendSetupRule(p));
  const clearSetupRules = () => setSetupRules(p => clearSetupRulesFollowed(p));

  // parseNumericField preserves 0 — unlike `parseFloat(x) || undefined` which
  // silently drops legitimate zero values (e.g. breakeven P&L).
  // Validation and payload shape mirror app/indian-market/add-trade/page.js
  // so manual entry requires and stores the same information regardless of
  // which page the user lands on for a given market.
  const handleSubmit = (e, { accountCreatedDate, tradeOverrides = {} } = {}) => {
    if (e) e.preventDefault();
    if (submitLockRef.current || createTradeMutation.isPending) {
      return;
    }

    const showValidation = (message) => addToast(message, "info");

    if (isIndianMarket) {
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
    } else if (!trade.pair) {
      showValidation("Please enter a Pair");
      return;
    }

    const pnl = String(trade.profit).trim();
    if (pnl === "" || isNaN(parseFloat(pnl))) {
      showValidation("Enter profit or loss.");
      return;
    }
    const ep = String(trade.entryPrice).trim();
    if (!ep || isNaN(parseFloat(ep)) || parseFloat(ep) <= 0) {
      showValidation(isEquity ? "Enter avg buy price." : "Enter entry price.");
      return;
    }
    const xp = String(trade.exitPrice).trim();
    if (!xp || isNaN(parseFloat(xp)) || parseFloat(xp) <= 0) {
      showValidation(isEquity ? "Enter avg sell price." : "Enter exit price.");
      return;
    }
    if (!trade.tradeDate) {
      showValidation("Please select a trade date");
      return;
    }
    if (accountCreatedDate && trade.tradeDate < accountCreatedDate) {
      showValidation(`Trade date cannot be before your account creation date (${accountCreatedDate})`);
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
      type: trade.type.toUpperCase(),
      profit: parseNumericField(trade.profit),
      entryPrice: parseNumericField(trade.entryPrice),
      exitPrice: parseNumericField(trade.exitPrice),
      stopLoss: parseNumericField(trade.stopLoss),
      takeProfit: parseNumericField(trade.takeProfit),
      strategy: trade.strategy === "Custom" ? (trade.strategyCustom?.trim() || "Custom") : (trade.strategy || undefined),
      setup: trade.setup || undefined,
      tradeDate: trade.tradeDate,
      riskRewardRatio: trade.riskRewardCustom?.trim() ? "custom" : (trade.riskRewardRatio || ""),
      riskRewardCustom: trade.riskRewardCustom?.trim() || "",
      entryBasis: trade.entryBasis || "Plan",
      entryBasisCustom: trade.entryBasis === "Custom" ? trade.entryBasisCustom : "",
      notes: trade.notes || undefined,
      mistakeTag: trade.mistakeTag || undefined,
      lesson: trade.lesson || undefined,
      mood: trade.mood ?? undefined,
      confidence: trade.confidence || undefined,
      emotionalTags: Array.isArray(trade.emotionalTags) ? trade.emotionalTags : undefined,
      wouldRetake: trade.wouldRetake || undefined,
      tradeQuality: trade.tradeQuality || undefined,
      screenshot: trade.screenshot || "",
      tradeImages: trade.tradeImages || [],
    };

    let tradeData;
    if (isIndianMarket) {
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
          tradeType: "INTRADAY",
          brokerage: trade.brokerage ? parseFloat(trade.brokerage) : undefined,
          sttTaxes: trade.sttTaxes ? parseFloat(trade.sttTaxes) : undefined,
        };
      } else {
        const underlyingLabel = getUnderlyingLabel();
        const strike = trade.strikePrice.trim();
        const qty = trade.quantity.trim();
        tradeData = {
          ...sharedFields,
          pair: `${underlyingLabel.trim()} ${strike} ${trade.optionType}`,
          underlying: underlyingLabel.trim(),
          strikePrice: parseFloat(strike),
          optionType: trade.optionType,
          segment: "F&O",
          instrumentType: "OPTION",
          tradeType: trade.tradeType || "INTRADAY",
          quantity: parseFloat(qty),
          lotSize: getLotSize(),
          expiryDate: trade.expiryDate || undefined,
          brokerage: trade.brokerage ? parseFloat(trade.brokerage) : undefined,
          sttTaxes: trade.sttTaxes ? parseFloat(trade.sttTaxes) : undefined,
        };
      }
    } else {
      tradeData = {
        ...sharedFields,
        pair: trade.pair,
        lotSize: parseNumericField(trade.lotSize),
        commission: trade.commission ? parseFloat(trade.commission) : undefined,
        swap: trade.swap ? parseFloat(trade.swap) : undefined,
      };
    }

    // Page-level overrides (e.g. tradeImages after async upload) win over
    // the in-state snapshot to bypass setState's async closure issue.
    tradeData = { ...tradeData, ...tradeOverrides };

    const activeRules = setupRules.filter(r => r.label?.trim());
    tradeData.setupRules = activeRules.map(r => ({ label: r.label.trim(), followed: r.followed }));
    tradeData.setupScore = activeRules.length ? Math.round((activeRules.filter(r => r.followed).length / activeRules.length) * 100) : null;

    submitLockRef.current = true;
    createTradeMutation.mutate(tradeData);
  };

  return {
    trade, setTrade, handleChange, handleStrategyChange, handleScreenshotChange,
    setupRules, toggleSetupRule, updateSetupRuleLabel, addSetupRule, clearSetupRules,
    handleSubmit, screenshotPreview, uploading, setupsLoading, strategies, mounted,
    isSaving: createTradeMutation.isPending,
    limitBlock,
    dismissLimitBlock: () => setLimitBlock(null),
    lastFreeTradeSheet,
    closeLastFreeTradeSheet: () => {
      setLastFreeTradeSheet(null);
      goAfterSave();
    },
    tradeSubType, setTradeSubType, isEquity,
    getUnderlyingLabel, getLotSize,
  };
}
