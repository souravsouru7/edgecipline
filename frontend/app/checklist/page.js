"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import { fetchSetups } from "@/services/setupApi";
import { logChecklistEvent } from "@/services/checklistApi";
import { useMarket } from "@/context/MarketContext";
import { Skeleton } from "@/features/shared";
import PageHeader from "@/features/shared/components/PageHeader";
import IndianMarketHeader from "@/components/IndianMarketHeader";
import { Brain, ClipboardList, Bell } from "lucide-react";
import {
  syncChecklistItems,
  addChecklistToggleListener,
} from "@/plugins/ChecklistNotificationPlugin";

function ReferenceImageThumb({ image, alt, onOpen }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <button
      type="button"
      className="checklist-reference-thumb"
      onClick={onOpen}
      aria-label={alt}
    >
      {!loaded && !failed && (
        <span className="checklist-image-loading" aria-hidden="true">
          <span className="checklist-spinner" />
        </span>
      )}
      {failed && (
        <span className="checklist-image-error">
          Image unavailable
        </span>
      )}
      <img
        src={image.url}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onError={() => {
          setFailed(true);
          setLoaded(false);
        }}
        style={{
          opacity: loaded ? 1 : 0,
        }}
      />
    </button>
  );
}

export default function PreTradeChecklistPage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const { currentMarket, getMarketLabel } = useMarket();
  const [mounted, setMounted] = useState(false);
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [checked, setChecked] = useState({});
  const [setupSimilarity, setSetupSimilarity] = useState("");
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState("");
  const [previewImageLoaded, setPreviewImageLoaded] = useState(false);

  useEffect(() => {
    if (!ready) return;
    setMounted(true);

    const load = async () => {
      try {
        const data = await fetchSetups(currentMarket);
        if (Array.isArray(data) && data.length) {
          setStrategies(data);
          setSelectedIdx(0);
          setChecked({});
          setSetupSimilarity("");
        } else {
          setStrategies([]);
        }
      } catch (e) {
        setError(e.message || "Failed to load setups");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [ready, router, currentMarket]);

  const selected = strategies[selectedIdx] || null;
  const rules = useMemo(() => {
    if (!selected?.rules) return [];
    return selected.rules.filter(r => r.label && r.label.trim().length > 0);
  }, [selected]);

  // ── Sync checked state to live notification whenever it changes ──────────
  useEffect(() => {
    if (!selected) return;
    const items = rules.map((r, i) => ({
      id: String(i),
      label: r.label,
      checked: !!checked[i],
    }));
    syncChecklistItems(items, currentMarket).catch(() => {});
  }, [checked, rules, selected]);

  // ── Listen for toggles made inside the notification ───────────────────
  useEffect(() => {
    const listener = addChecklistToggleListener(({ itemId, checked: isChecked }) => {
      const idx = parseInt(itemId, 10);
      if (!isNaN(idx)) {
        setChecked((prev) => ({ ...prev, [idx]: isChecked }));
      }
    });
    return () => listener.remove();
  }, []);

  const totalRules = rules.length;
  const checkedCount = rules.filter((_, i) => checked[i]).length;
  const score = totalRules > 0 ? Math.round((checkedCount / totalRules) * 100) : 0;

  const level = score >= 80 ? "high" : score >= 50 ? "moderate" : "low";
  const levelConfig = {
    high: { label: "A+ SETUP", sub: "All systems go - execute with confidence", color: "#0D9E6E", bg: "rgba(13,158,110,0.08)", border: "rgba(13,158,110,0.3)", icon: "check" },
    moderate: { label: "MODERATE", sub: "Some rules not met - proceed with caution", color: "#B8860B", bg: "rgba(184,134,11,0.08)", border: "rgba(184,134,11,0.3)", icon: "dot" },
    low: { label: "LOW CONFIDENCE", sub: "Most rules not met - consider skipping this trade", color: "#D63B3B", bg: "rgba(214,59,59,0.08)", border: "rgba(214,59,59,0.3)", icon: "x" },
  };
  const lc = levelConfig[level];

  const confidenceIcon = {
    check: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
    dot: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="12" r="5" />
      </svg>
    ),
    x: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    ),
  }[lc.icon];

  const toggleRule = (idx) => {
    setChecked(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const clearAll = () => setChecked({});

  const handleSelectStrategy = (idx) => {
    if (selectedIdx === idx) {
      setSelectedIdx(null);
      return;
    }
    setSelectedIdx(idx);
    setChecked({});
    setSetupSimilarity("");
    setPreviewImageUrl("");
    setPreviewImageLoaded(false);
  };

  const openPreviewImage = (url) => {
    setPreviewImageLoaded(false);
    setPreviewImageUrl(url);
  };

  const closePreviewImage = () => {
    setPreviewImageUrl("");
    setPreviewImageLoaded(false);
  };

  const handleTakeTrade = async () => {
    if (!selected) return;
    
    setIsSubmitting(true);
    try {
      // Log to backend
      await logChecklistEvent({
        market: currentMarket,
        strategyName: selected.name,
        totalRules,
        followedRules: checkedCount,
        score,
        isAPlus: score >= 80,
        setupSimilarity,
      });
      
      // Show happy dialog
      setShowSuccessDialog(true);
      
      // Navigate after delay
      setTimeout(() => {
        router.push("/upload-trade");
      }, 2000);
    } catch (err) {
      setError(err.message || "Failed to log checklist. You can still proceed.");
      // Even if tracking fails, let them trade
      router.push("/upload-trade");
    } finally {
      setIsSubmitting(false);
    }
  };

  const isIndian = currentMarket === "Indian_Market";

  if (!mounted) return null;

  return (
    <div style={{
      minHeight: "100vh",
      background: "#F0EEE9",
      fontFamily: "'Plus Jakarta Sans',sans-serif",
      color: "#0F1923",
    }}>
      {isIndian ? <IndianMarketHeader /> : <PageHeader />}

      {/* MAIN */}
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "28px 16px 40px" }}>

        {/* Page title */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>
                Pre-Trade <span style={{ color: "#0D9E6E" }}>Checklist</span>
              </h1>
              <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 4, fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.06em" }}>
                TRADE WITH PLAN - NOT WITH EMOTION - {getMarketLabel()}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link
                href="/checklist/notification-settings"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 10,
                  fontFamily: "'JetBrains Mono',monospace",
                  letterSpacing: "0.08em",
                  fontWeight: 700,
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(13,158,110,0.3)",
                  background: "rgba(13,158,110,0.06)",
                  color: "#0D9E6E",
                  textDecoration: "none",
                  flexShrink: 0,
                }}
              >
                <Bell size={13} strokeWidth={2.4} />
                NOTIFY
              </Link>
              <Link
                href="/checklist/psychology"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 10,
                  fontFamily: "'JetBrains Mono',monospace",
                  letterSpacing: "0.08em",
                  fontWeight: 700,
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(214,59,59,0.3)",
                  background: "rgba(214,59,59,0.06)",
                  color: "#D63B3B",
                  textDecoration: "none",
                  flexShrink: 0,
                }}
              >
                <Brain size={13} strokeWidth={2.4} />
                PSYCHOLOGY GUIDE
              </Link>
            </div>
          </div>
        </div>

        {error && (
          <div style={{ marginBottom: 14, padding: "8px 10px", borderRadius: 8, background: "#FEF2F2", border: "1px solid #FCA5A5", fontSize: 12, color: "#B91C1C" }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Strategy selector skeleton */}
            <div style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid #E2E8F0", padding: "14px 16px", boxShadow: "0 2px 10px rgba(15,25,35,0.04)" }}>
              <Skeleton width="160px" height="10px" style={{ marginBottom: 12 }} />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} width={`${70 + i * 20}px`} height="34px" style={{ borderRadius: 999 }} />
                ))}
              </div>
            </div>
            {/* Rules checklist skeleton */}
            <div style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid #E2E8F0", overflow: "hidden", boxShadow: "0 2px 10px rgba(15,25,35,0.04)" }}>
              <div style={{ height: 4, background: "#EDF2F7" }} />
              <div style={{ padding: "16px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div>
                    <Skeleton width="140px" height="16px" style={{ marginBottom: 6 }} />
                    <Skeleton width="100px" height="10px" />
                  </div>
                  <Skeleton width="70px" height="28px" style={{ borderRadius: 999 }} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} width="100%" height="48px" style={{ borderRadius: 12 }} />
                  ))}
                </div>
              </div>
            </div>
            {/* Confidence meter skeleton */}
            <div style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid #E2E8F0", padding: "18px 18px", boxShadow: "0 2px 10px rgba(15,25,35,0.04)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <Skeleton width="120px" height="10px" />
                <Skeleton width="50px" height="24px" />
              </div>
              <Skeleton width="100%" height="12px" style={{ borderRadius: 12, marginBottom: 12 }} />
              <Skeleton width="100%" height="60px" style={{ borderRadius: 10 }} />
            </div>
          </div>
        ) : strategies.length === 0 ? (
          <div style={{
            background: "#FFFFFF", borderRadius: 14, border: "1px solid #E2E8F0",
            padding: "40px 20px", textAlign: "center",
            boxShadow: "0 2px 10px rgba(15,25,35,0.04)",
          }}>
            <div style={{ width: 48, height: 48, margin: "0 auto 12px", borderRadius: 14, background: "#ECFDF5", color: "#0D9E6E", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ClipboardList size={24} strokeWidth={2.2} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>No Strategies Found</div>
            <div style={{ fontSize: 12, color: "#64748B", marginBottom: 16 }}>
              Create your strategies and rules first, then come back here before each trade.
            </div>
            <Link
              href="/setups"
              style={{
                display: "inline-block",
                fontSize: 11, fontFamily: "'JetBrains Mono',monospace",
                letterSpacing: "0.08em", padding: "10px 18px",
                borderRadius: 8, border: "none",
                background: "linear-gradient(135deg,#0D9E6E,#22C78E)",
                color: "#FFFFFF", textDecoration: "none", fontWeight: 700,
              }}
            >
              CREATE SETUPS -&gt;
            </Link>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {strategies.map((s, idx) => {
              const isExpanded = selectedIdx === idx;
              const strategyRules = (s.rules || []).filter(r => r.label && r.label.trim().length > 0);
              const totalRulesForCard = strategyRules.length;

              return (
                <div key={s._id || idx} style={{
                  background: "#FFFFFF", borderRadius: 14,
                  border: isExpanded ? "1.5px solid rgba(13,158,110,0.5)" : "1px solid #E2E8F0",
                  overflow: "hidden",
                  boxShadow: isExpanded ? "0 4px 20px rgba(13,158,110,0.08)" : "0 2px 10px rgba(15,25,35,0.04)",
                  transition: "border 0.2s, box-shadow 0.2s",
                }}>
                  {/* Collapsed header - always visible */}
                  <div
                    onClick={() => handleSelectStrategy(idx)}
                    style={{
                      padding: "14px 16px", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                      userSelect: "none",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#0F1923", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {s.name || "Unnamed Strategy"}
                      </div>
                      <div style={{ fontSize: 10, color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.08em", marginTop: 3 }}>
                        {totalRulesForCard} RULE{totalRulesForCard !== 1 ? "S" : ""}
                        {isExpanded && totalRulesForCard > 0 ? ` - ${checkedCount}/${totalRulesForCard} CHECKED` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                      {isExpanded && totalRulesForCard > 0 && (
                        <div style={{ fontSize: 20, fontWeight: 900, fontFamily: "'JetBrains Mono',monospace", color: lc.color }}>
                          {score}%
                        </div>
                      )}
                      <div style={{
                        width: 22, height: 22, borderRadius: 6, background: "#F1F4F8",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                        transition: "none",
                      }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2.5">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  {/* Expanded body */}
                  {isExpanded && (
                    <div>
                      <div style={{ height: 4, background: `linear-gradient(90deg, ${lc.color}, ${lc.color}44)` }} />
                      <div style={{ padding: "16px 18px" }}>

                        {/* Reset button */}
                        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
                          <button onClick={clearAll} style={{
                            fontSize: 9, fontFamily: "'JetBrains Mono',monospace",
                            letterSpacing: "0.08em", padding: "5px 10px",
                            borderRadius: 999, border: "1px solid #E2E8F0",
                            background: "#F8FAFC", color: "#64748B", cursor: "pointer",
                          }}>
                            RESET ALL
                          </button>
                        </div>

                        {/* Reference images */}
                        {Array.isArray(s.referenceImages) && s.referenceImages.length > 0 && (
                          <div style={{
                            display: "grid", gridTemplateColumns: "1fr", gap: 14, padding: "12px",
                            marginBottom: 14, borderRadius: 12, border: "1px solid #E2E8F0",
                            background: "#F8FAFC", alignItems: "center",
                          }}>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", maxWidth: "100%" }}>
                              {s.referenceImages.slice(0, 5).map((image, imgIdx) => (
                                <ReferenceImageThumb
                                  key={`${s._id || s.name}-${imgIdx}`}
                                  alt={`${s.name} reference ${imgIdx + 1}`}
                                  image={image}
                                  onOpen={() => openPreviewImage(image.url)}
                                />
                              ))}
                            </div>
                            <div>
                              <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace", marginBottom: 6 }}>
                                SETUP REFERENCES
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                                Compare the live chart with your saved ideal setup examples
                              </div>
                              <div style={{ fontSize: 12, color: "#64748B" }}>
                                Use these screenshots as your visual benchmark before you commit to the trade.
                              </div>
                            </div>
                            <div style={{ padding: "12px", borderRadius: 12, border: "1px solid #E2E8F0", background: "#FFFFFF" }}>
                              <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace", marginBottom: 8 }}>
                                VISUAL MATCH CHECK
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                                Is the current chart setup similar to these reference images?
                              </div>
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                {[
                                  { value: "yes", label: "YES", color: "#0D9E6E", bg: "rgba(13,158,110,0.08)", border: "rgba(13,158,110,0.35)" },
                                  { value: "partly", label: "PARTLY", color: "#B8860B", bg: "rgba(184,134,11,0.08)", border: "rgba(184,134,11,0.35)" },
                                  { value: "no", label: "NO", color: "#D63B3B", bg: "rgba(214,59,59,0.08)", border: "rgba(214,59,59,0.35)" },
                                ].map((option) => {
                                  const active = setupSimilarity === option.value;
                                  return (
                                    <button key={option.value} type="button" onClick={() => setSetupSimilarity(option.value)} style={{
                                      padding: "10px 18px", minHeight: 42, borderRadius: 999,
                                      border: active ? `2px solid ${option.color}` : `1px solid ${option.border}`,
                                      background: active ? option.bg : "#F8FAFC",
                                      color: option.color, cursor: "pointer",
                                      fontSize: 11, fontWeight: 800,
                                      fontFamily: "'JetBrains Mono',monospace",
                                      letterSpacing: "0.04em", flex: 1,
                                    }}>
                                      {option.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Rules */}
                        {rules.length === 0 ? (
                          <div style={{ fontSize: 12, color: "#94A3B8", padding: "20px 0", textAlign: "center" }}>
                            No rules defined for this strategy. <Link href="/setups" style={{ color: "#0D9E6E", fontWeight: 700 }}>Add rules -&gt;</Link>
                          </div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                            {rules.map((rule, ruleIdx) => {
                              const isChecked = !!checked[ruleIdx];
                              return (
                                <button key={ruleIdx} onClick={() => toggleRule(ruleIdx)} style={{
                                  display: "flex", alignItems: "center", gap: 12,
                                  padding: "12px 14px", borderRadius: 12,
                                  border: isChecked ? "1.5px solid rgba(13,158,110,0.4)" : "1px solid #E2E8F0",
                                  background: isChecked ? "rgba(13,158,110,0.04)" : "#FAFAFA",
                                  cursor: "pointer", textAlign: "left",
                                  transition: "all 0.2s", width: "100%",
                                }}>
                                  <div style={{
                                    width: 24, height: 24, borderRadius: 7, flexShrink: 0,
                                    border: isChecked ? "2px solid #0D9E6E" : "2px solid #CBD5E1",
                                    background: isChecked ? "linear-gradient(135deg,#0D9E6E,#22C78E)" : "#FFFFFF",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    transition: "all 0.2s",
                                    boxShadow: isChecked ? "0 2px 8px rgba(13,158,110,0.3)" : "none",
                                  }}>
                                    {isChecked && (
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3">
                                        <polyline points="20 6 9 17 4 12" />
                                      </svg>
                                    )}
                                  </div>
                                  <span style={{
                                    fontSize: 13, fontWeight: 600,
                                    color: isChecked ? "#0D9E6E" : "#0F1923",
                                    textDecoration: isChecked ? "line-through" : "none",
                                    opacity: isChecked ? 0.7 : 1,
                                    transition: "all 0.2s",
                                    fontFamily: "'Plus Jakarta Sans',sans-serif",
                                  }}>
                                    {rule.label}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Confidence meter */}
                        {totalRules > 0 && (
                          <div style={{
                            background: "#F8FAFC", borderRadius: 12, border: "1px solid #E2E8F0",
                            padding: "14px 16px", marginBottom: 14,
                          }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                              <div style={{ fontSize: 9, letterSpacing: "0.14em", color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>
                                SETUP CONFIDENCE
                              </div>
                              <div style={{ fontSize: 22, fontWeight: 900, fontFamily: "'JetBrains Mono',monospace", color: lc.color }}>
                                {score}%
                              </div>
                            </div>
                            <div style={{ height: 10, background: "#E2E8F0", borderRadius: 10, overflow: "hidden", marginBottom: 10 }}>
                              <div style={{
                                height: "100%", borderRadius: 10, width: `${score}%`,
                                background: `linear-gradient(90deg, ${lc.color}, ${lc.color}99)`,
                                boxShadow: `0 0 12px ${lc.color}44`,
                                transition: "width 0.4s cubic-bezier(0.22,1,0.36,1)",
                              }} />
                            </div>
                            <div style={{
                              display: "flex", alignItems: "center", gap: 10,
                              padding: "10px 12px", borderRadius: 10,
                              background: lc.bg, border: `1px solid ${lc.border}`,
                            }}>
                              <div style={{
                                width: 32, height: 32, borderRadius: 8, background: `${lc.color}18`,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 16, fontWeight: 900, color: lc.color,
                              }}>
                                {confidenceIcon}
                              </div>
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 800, color: lc.color, fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.06em" }}>
                                  {lc.label}
                                </div>
                                <div style={{ fontSize: 11, color: "#4A5568", marginTop: 2 }}>{lc.sub}</div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Take trade / Reset */}
                        {totalRules > 0 && (
                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                            {score >= 80 ? (
                              <button onClick={handleTakeTrade} disabled={isSubmitting} style={{
                                flex: 1, minWidth: 180, padding: "15px 18px", minHeight: 52,
                                borderRadius: 12, border: "none", cursor: isSubmitting ? "not-allowed" : "pointer",
                                background: "linear-gradient(135deg, #0D9E6E, #22C78E)", color: "#FFFFFF",
                                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                                fontSize: 13, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace",
                                letterSpacing: "0.06em",
                                boxShadow: "0 4px 20px rgba(13,158,110,0.35)",
                                opacity: isSubmitting ? 0.7 : 1,
                              }}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                                {isSubmitting ? "LOGGING..." : "TAKE TRADE ->"}
                              </button>
                            ) : (
                              <div style={{
                                flex: 1, minWidth: 180, padding: "15px 18px", minHeight: 52, borderRadius: 12,
                                background: score >= 50 ? "rgba(184,134,11,0.08)" : "rgba(214,59,59,0.06)",
                                border: `1px solid ${score >= 50 ? "rgba(184,134,11,0.3)" : "rgba(214,59,59,0.25)"}`,
                                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                                fontSize: 12, fontWeight: 800, fontFamily: "'JetBrains Mono',monospace",
                                letterSpacing: "0.04em", color: score >= 50 ? "#B8860B" : "#D63B3B",
                              }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                  <circle cx="12" cy="12" r="10" />
                                  <line x1="15" y1="9" x2="9" y2="15" />
                                  <line x1="9" y1="9" x2="15" y2="15" />
                                </svg>
                                {score >= 50 ? "REVIEW RULES" : "SKIP TRADE"}
                              </div>
                            )}
                            <button onClick={clearAll} style={{
                              padding: "15px 16px", minHeight: 52, borderRadius: 12,
                              background: "#FFFFFF", border: "1px solid #E2E8F0",
                              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                              fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace",
                              letterSpacing: "0.06em", color: "#64748B", cursor: "pointer",
                            }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="1 4 1 10 7 10" />
                                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                              </svg>
                              RESET
                            </button>
                          </div>
                        )}

                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        
        {/* Success Modal */}
        {showSuccessDialog && (
          <div style={{
            position: "fixed", inset: 0, zIndex: 999,
            background: "rgba(15,25,35,0.4)", backdropFilter: "blur(8px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "fadeIn 0.2s ease",
          }}>
            <div style={{
              background: "#FFFFFF", padding: "40px", borderRadius: 24, textAlign: "center",
              boxShadow: "0 20px 40px rgba(15,25,35,0.1)",
              transform: "scale(1)", animation: "popIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
              maxWidth: 400, width: "90%",
            }}>
              <div style={{
                width: 80, height: 80, borderRadius: 40, background: "rgba(13,158,110,0.1)",
                color: "#0D9E6E", display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 20px",
              }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <h2 style={{ fontSize: 24, fontWeight: 800, color: "#0F1923", marginBottom: 8 }}>Incredible Discipline!</h2>
              <p style={{ fontSize: 14, color: "#64748B", lineHeight: 1.5, marginBottom: 24 }}>
                You&apos;ve identified an <strong>A+ Setup</strong>. Trading your plan is the ultimate edge.
              </p>
              <div style={{ display: "inline-block", background: "#F8FAFC", padding: "8px 16px", borderRadius: 999 }}>
                <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: "#0D9E6E", letterSpacing: "0.05em" }}>
                  Tracking saved. Redirecting to trade log...
                </span>
              </div>
            </div>
          </div>
        )}

        {previewImageUrl && (
          <div
            onClick={closePreviewImage}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1000,
              background: "rgba(15,25,35,0.72)",
              backdropFilter: "blur(10px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "24px",
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "relative",
                maxWidth: "min(1100px, 96vw)",
                maxHeight: "90vh",
                width: "100%",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <button
                type="button"
                onClick={closePreviewImage}
                style={{
                  alignSelf: "flex-end",
                  width: 38,
                  height: 38,
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.25)",
                  background: "rgba(255,255,255,0.08)",
                  color: "#FFFFFF",
                  cursor: "pointer",
                  fontSize: 18,
                  fontWeight: 700,
                }}
              >
                x
              </button>
              <div className="checklist-preview-frame">
                {!previewImageLoaded && (
                  <div className="checklist-preview-loading">
                    <span className="checklist-spinner checklist-spinner-lg" />
                  </div>
                )}
                <img
                  src={previewImageUrl}
                  alt="Setup reference preview"
                  onLoad={() => setPreviewImageLoaded(true)}
                  onError={() => setPreviewImageLoaded(true)}
                  style={{
                    width: "100%",
                    maxHeight: "calc(90vh - 56px)",
                    objectFit: "contain",
                    borderRadius: 18,
                    background: "#FFFFFF",
                    border: "1px solid rgba(255,255,255,0.2)",
                    boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
                    opacity: previewImageLoaded ? 1 : 0,
                    display: "block",
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </main>

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes popIn {
          from { opacity: 0; transform: scale(0.9) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes checklistSpin {
          to { transform: rotate(360deg); }
        }
        .checklist-reference-thumb {
          width: clamp(110px, 28vw, 160px);
          aspect-ratio: 16 / 10;
          border: 1px solid #E2E8F0;
          border-radius: 10px;
          background: #EEF2F6;
          cursor: zoom-in;
          flex-shrink: 0;
          overflow: hidden;
          padding: 0;
          position: relative;
          display: block;
        }
        .checklist-reference-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          transition: opacity 0.18s ease;
        }
        .checklist-image-loading,
        .checklist-preview-loading {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #F8FAFC, #EEF2F6);
          z-index: 1;
        }
        .checklist-preview-frame {
          position: relative;
          min-height: min(420px, calc(90vh - 56px));
          border-radius: 18px;
        }
        .checklist-preview-loading {
          border-radius: 18px;
        }
        .checklist-spinner {
          width: 22px;
          height: 22px;
          border-radius: 999px;
          border: 3px solid rgba(13, 158, 110, 0.18);
          border-top-color: #0D9E6E;
          animation: checklistSpin 0.75s linear infinite;
        }
        .checklist-spinner-lg {
          width: 34px;
          height: 34px;
          border-width: 4px;
        }
        .checklist-image-error {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 8px;
          color: #D63B3B;
          background: #FEF2F2;
          font-size: 10px;
          font-family: 'JetBrains Mono', monospace;
          font-weight: 700;
          text-align: center;
        }
      `}</style>
    </div>
  );
}
