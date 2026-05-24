"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createTrade } from "@/services/tradeApi";
import { fetchSetups } from "@/services/setupApi";
import { uploadTradeImage } from "@/services/uploadApi";
import { MARKETS } from "@/context/MarketContext";
import { useToast } from "@/features/shared/components/ui/Toast";

const getTodayInputValue = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split("T")[0];
};

/**
 * useAddTrade
 * Encapsulates setup loading, screenshot uploading, and form submission logic using TanStack Query.
 * Integrated with useToast for clear user feedback.
 */
export function useAddTrade(marketType, isIndianMarket) {
  const router = useRouter();
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
    riskRewardRatio: "",
    riskRewardCustom: "",
    screenshot: "",
    // Indian Market Fields
    segment: "Equity",
    instrumentType: "EQUITY",
    quantity: "",
    strikePrice: "",
    expiryDate: "",
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
  });

  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [setupRules, setSetupRules] = useState([]);
  const [mounted, setMounted] = useState(false);
  const submitLockRef = useRef(false);

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
  });

  // 2. Submit Trade via useMutation
  const createTradeMutation = useMutation({
    mutationFn: (data) => createTrade(data, marketType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trades"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
      
      addToast("Trade created and synced successfully!", "success");
      
      setTimeout(() => {
        router.push(marketType === MARKETS.INDIAN_MARKET ? "/indian-market/dashboard" : "/dashboard");
      }, 1000);
    },
    onError: (err) => {
      addToast(err.message || "Failed to save trade. Please check your inputs.", "error");
    },
    onSettled: () => {
      submitLockRef.current = false;
    },
  });

  useEffect(() => {
    setMounted(true);
    const token = localStorage.getItem("token");
    if (!token) router.push("/login");

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
  }, [isIndianMarket, router]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setTrade(prev => ({ ...prev, [name]: value }));
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
      const data = await uploadTradeImage({ file, marketType });
      setTrade(prev => ({ ...prev, screenshot: data.screenshotUrl || data.url }));
      addToast("Screenshot uploaded!", "success");
    } catch (err) {
      console.error("Upload error:", err);
      addToast("Failed to upload screenshot. Limits or network error.", "error");
    } finally {
      setUploading(false);
    }
  };

  const toggleSetupRule = (id) => setSetupRules(p => p.map(r => r.id === id ? { ...r, followed: !r.followed } : r));
  const updateSetupRuleLabel = (id, val) => setSetupRules(p => p.map(r => r.id === id ? { ...r, label: val } : r));
  const addSetupRule = () => setSetupRules(p => [...p, { id: Date.now(), label: "", followed: false }]);
  const clearSetupRules = () => setSetupRules(p => p.map(r => ({ ...r, followed: false })));

  const handleSubmit = (e, { accountCreatedDate } = {}) => {
    if (e) e.preventDefault();
    if (submitLockRef.current || createTradeMutation.isPending) {
      return;
    }
    if (!trade.pair) {
      addToast(`Please enter a ${isIndianMarket ? "Symbol" : "Pair"}`, "info");
      return;
    }
    if (!trade.tradeDate) {
      addToast("Please select a trade date", "info");
      return;
    }
    if (accountCreatedDate && trade.tradeDate < accountCreatedDate) {
      addToast(`Trade date cannot be before your account creation date (${accountCreatedDate})`, "info");
      return;
    }

    const tradeData = {
      ...trade,
      type: trade.type.toUpperCase(),
      entryPrice: parseFloat(trade.entryPrice) || undefined,
      exitPrice: parseFloat(trade.exitPrice) || undefined,
      stopLoss: parseFloat(trade.stopLoss) || undefined,
      takeProfit: parseFloat(trade.takeProfit) || undefined,
      profit: parseFloat(trade.profit) || undefined,
      lotSize: !isIndianMarket ? parseFloat(trade.lotSize) : undefined,
      quantity: isIndianMarket ? parseFloat(trade.quantity) : undefined,
      strategy: trade.strategy === "Custom" ? trade.strategyCustom : trade.strategy,
      tradeDate: trade.tradeDate,
      riskRewardRatio: trade.riskRewardCustom?.trim() ? "custom" : (trade.riskRewardRatio || ""),
      riskRewardCustom: trade.riskRewardCustom?.trim() || "",
    };

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
    isSaving: createTradeMutation.isPending
  };
}
