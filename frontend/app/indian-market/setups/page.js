"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import { fetchSetups, saveSetups, uploadSetupReferenceImage } from "@/services/setupApi";
import { MARKETS } from "@/context/MarketContext";
import IndianMarketHeader from "@/components/IndianMarketHeader";
import { Trash2 } from "lucide-react";

export default function IndianSetupStrategiesPage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const [mounted, setMounted] = useState(false);
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingByStrategy, setUploadingByStrategy] = useState({});
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState(null);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const uploadingCount = Object.values(uploadingByStrategy).reduce((sum, count) => sum + count, 0);

  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!ready) return;
    setMounted(true);

    const load = async () => {
      try {
        const serverStrategies = await fetchSetups(MARKETS.INDIAN_MARKET);
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
            referenceImages: Array.isArray(s.referenceImages) ? s.referenceImages : [],
          }));
          setStrategies(mapped);
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
  }, [ready, router]);

  const addStrategy = () => {
    setError("");
    setStrategies(prev => {
      const nextId = (prev[prev.length - 1]?.id || 0) + 1;
      return [
        ...prev,
        {
          id: nextId,
          name: "",
          rules: [],
          referenceImages: [],
        },
      ];
    });
  };

  const updateStrategyName = (id, name) => {
    setStrategies(prev =>
      prev.map(s => (s.id === id ? { ...s, name } : s))
    );
  };

  const addRuleToStrategy = (strategyId) => {
    setStrategies(prev =>
      prev.map(s => {
        if (s.id !== strategyId) return s;
        const nextRuleId = (s.rules[s.rules.length - 1]?.id || 0) + 1;
        return {
          ...s,
          rules: [
            ...s.rules,
            { id: nextRuleId, label: "", followed: false },
          ],
        };
      })
    );
  };

  const toggleRule = (strategyId, ruleId) => {
    setStrategies(prev =>
      prev.map(s => {
        if (s.id !== strategyId) return s;
        return {
          ...s,
          rules: s.rules.map(r =>
            r.id === ruleId ? { ...r, followed: !r.followed } : r
          ),
        };
      })
    );
  };

  const updateRuleLabel = (strategyId, ruleId, label) => {
    setStrategies(prev =>
      prev.map(s => {
        if (s.id !== strategyId) return s;
        return {
          ...s,
          rules: s.rules.map(r =>
            r.id === ruleId ? { ...r, label } : r
          ),
        };
      })
    );
  };

  const clearTicksForStrategy = (strategyId) => {
    setStrategies(prev =>
      prev.map(s => {
        if (s.id !== strategyId) return s;
        return {
          ...s,
          rules: s.rules.map(r => ({ ...r, followed: false })),
        };
      })
    );
  };

  const deleteStrategy = (strategyId) => {
    setStrategies(prev => prev.filter(s => s.id !== strategyId));
  };

  const deleteRule = (strategyId, ruleId) => {
    setStrategies(prev =>
      prev.map(s => {
        if (s.id !== strategyId) return s;
        return {
          ...s,
          rules: s.rules.filter(r => r.id !== ruleId),
        };
      })
    );
  };

  const handleReferenceImageChange = async (strategyId, files) => {
    const selectedFiles = Array.from(files || []).filter(Boolean);
    if (selectedFiles.length === 0) return;

    try {
      setError("");
      setUploadingByStrategy(prev => ({
        ...prev,
        [strategyId]: (prev[strategyId] || 0) + selectedFiles.length,
      }));

      const results = await Promise.allSettled(
        selectedFiles.map((file) => uploadSetupReferenceImage(file))
      );

      const uploadedImages = results
        .filter((result) => result.status === "fulfilled")
        .map((result) => ({
          url: result.value?.imageUrl || "",
          publicId: result.value?.publicId || "",
        }))
        .filter((image) => image.url);

      if (uploadedImages.length > 0) {
        setStrategies(prev =>
          prev.map(s =>
            s.id === strategyId
              ? {
                  ...s,
                  referenceImages: [
                    ...(Array.isArray(s.referenceImages) ? s.referenceImages : []),
                    ...uploadedImages,
                  ],
                }
              : s
          )
        );
      }

      const failedUploads = results.length - uploadedImages.length;
      if (failedUploads > 0) {
        setError(
          failedUploads === results.length
            ? "Failed to upload setup image(s)"
            : `${failedUploads} image${failedUploads === 1 ? "" : "s"} failed to upload.`
        );
      }
    } catch (e) {
      setError(e.message || "Failed to upload setup image");
    } finally {
      setUploadingByStrategy(prev => {
        const nextCount = Math.max((prev[strategyId] || 0) - selectedFiles.length, 0);
        if (nextCount === 0) {
          const next = { ...prev };
          delete next[strategyId];
          return next;
        }
        return { ...prev, [strategyId]: nextCount };
      });
    }
  };

  const removeReferenceImage = (strategyId, imageIdx) => {
    setStrategies(prev =>
      prev.map(s =>
        s.id === strategyId
          ? {
              ...s,
              referenceImages: (s.referenceImages || []).filter((_, idx) => idx !== imageIdx),
            }
          : s
      )
    );
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError("");
      const payload = strategies.map(s => ({
        name: s.name,
        referenceImages: Array.isArray(s.referenceImages) ? s.referenceImages : [],
        rules: (s.rules || []).map(r => ({ label: r.label })),
      }));
      await saveSetups(payload, MARKETS.INDIAN_MARKET);
      setSavedAt(new Date());
    } catch (e) {
      setError(e.message || "Failed to save setups");
    } finally {
      setIsSaving(false);
    }
  };

  if (!mounted) return null;

  return (
    <div style={{
      minHeight: "100vh",
      background: "#F4F6F9",
      fontFamily: "'Plus Jakarta Sans',sans-serif",
      color: "#0F1923",
    }}>
      <IndianMarketHeader />

      {/* Sticky action bar */}
      <div style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        padding: "0 16px",
        borderBottom: "1px solid #E8ECF0",
        background: "#FFFFFF",
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Link
            href="/indian-market/dashboard"
            style={{
              flexShrink: 0,
              width: 34, height: 34,
              borderRadius: 10,
              border: "1px solid #E8ECF0",
              background: "#F8FAFB",
              display: "flex", alignItems: "center", justifyContent: "center",
              textDecoration: "none",
              color: "#0F1923",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          </Link>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#0F1923", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              Setup / Strategies
            </div>
          </div>
          <span style={{
            flexShrink: 0,
            display: "inline-flex", alignItems: "center",
            padding: "3px 8px", borderRadius: 6,
            background: "#EEF9F4", border: "1px solid #C6EEE0",
            fontSize: 10, fontFamily: "'JetBrains Mono',monospace",
            color: "#0D9E6E", fontWeight: 600,
          }}>
            NSE / BSE
          </span>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving || uploadingCount > 0}
          style={{
            flexShrink: 0,
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 12, fontWeight: 700,
            padding: "8px 16px", borderRadius: 10,
            border: "none",
            background: isSaving || uploadingCount > 0 ? "#E2E8F0" : "linear-gradient(135deg,#0D9E6E,#22C78E)",
            color: isSaving || uploadingCount > 0 ? "#64748B" : "#FFFFFF",
            cursor: isSaving || uploadingCount > 0 ? "default" : "pointer",
            boxShadow: isSaving || uploadingCount > 0 ? "none" : "0 4px 12px rgba(13,158,110,0.25)",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          {isSaving ? "Saving…" : uploadingCount > 0 ? `Uploading ${uploadingCount}…` : "Save Setups"}
        </button>
      </div>

      <main style={{ maxWidth: 900, margin: "0 auto", padding: "20px 16px 40px" }}>
        {error && (
          <div style={{ marginBottom: 12, padding: "8px 10px", borderRadius: 8, background: "#FEF2F2", border: "1px solid #FCA5A5", fontSize: 12, color: "#B91C1C" }}>
            {error}
          </div>
        )}
        {savedAt && !error && (
          <div style={{ marginBottom: 12, padding: "6px 10px", borderRadius: 8, background: "#ECFDF5", border: "1px solid #A7F3D0", fontSize: 11, color: "#047857" }}>
            Saved setups at {savedAt.toLocaleTimeString()}
          </div>
        )}
        {loading ? (
          <div style={{ padding: "60px 0", textAlign: "center", fontSize: 13, color: "#64748B" }}>
            Loading setups…
          </div>
        ) : (
        <div style={{
          background: "#FFFFFF",
          borderRadius: 14,
          border: "1px solid #E2E8F0",
          padding: "18px 20px 14px",
          boxShadow: "0 2px 10px rgba(15,25,35,0.04)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 10 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#0F1923" }}>Your Strategies</div>
              <div style={{ fontSize: 11, color: "#64748B", marginTop: 3 }}>
                Define rules for each setup to follow before entering a trade.
              </div>
            </div>
            <button
              type="button"
              onClick={addStrategy}
              style={{
                flexShrink: 0,
                fontSize: 12, fontWeight: 700,
                padding: "8px 14px",
                borderRadius: 10,
                border: "1.5px dashed #0D9E6E",
                background: "transparent",
                color: "#0D9E6E",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              + Add Strategy
            </button>
          </div>

          {strategies.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: "rgba(13,158,110,0.08)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0D9E6E" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0F1923", marginBottom: 6 }}>No strategies yet</div>
              <div style={{ fontSize: 12, color: "#64748B", lineHeight: 1.6, marginBottom: 20 }}>
                Create your first trading setup and add the rules you expect to follow before entering a trade.
              </div>
              <button
                type="button"
                onClick={addStrategy}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  background: "linear-gradient(135deg,#0D9E6E,#22C78E)",
                  color: "#fff", borderRadius: 10,
                  padding: "11px 20px", fontSize: 13, fontWeight: 700,
                  border: "none", cursor: "pointer",
                  boxShadow: "0 4px 14px rgba(13,158,110,0.25)",
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add First Strategy
              </button>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {strategies.map(strategy => {
              const activeRules = strategy.rules.filter(r => r.label && r.label.trim().length > 0);
              const followedCount = activeRules.filter(r => r.followed).length;
              const score = activeRules.length > 0
                ? Math.round((followedCount / activeRules.length) * 100)
                : null;
              const isExpanded = expandedIds.has(strategy.id);

              return (
                <div
                  key={strategy.id}
                  style={{
                    borderRadius: 12,
                    border: "1px solid #E2E8F0",
                    background: "linear-gradient(135deg,rgba(248,250,252,0.9),#FFFFFF)",
                    overflow: "hidden",
                  }}
                >
                  {/* Section */}
                  <div
                    onClick={() => toggleExpand(strategy.id)}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 9, letterSpacing: "0.12em", color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace", marginBottom: 2 }}>
                        TRADING SETUP
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: strategy.name ? "#0F1923" : "#A0AEC0", fontFamily: "'Plus Jakarta Sans',sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {strategy.name || "Untitled Setup"}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: "#0D9E6E", fontWeight: 700 }}>
                          {score !== null ? `${score}% FOLLOWED` : "NO TICKS"}
                        </div>
                        <div style={{ fontSize: 10, color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace" }}>
                          {activeRules.length} rule{activeRules.length === 1 ? "" : "s"}
                        </div>
                      </div>
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
                  {isExpanded && <div style={{ borderTop: "1px solid #F1F4F8", padding: "10px 12px 10px" }}>

                  {/* Name input */}
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 9, letterSpacing: "0.12em", color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace" }}>
                      TRADING SETUP NAME
                    </label>
                    <input
                      type="text"
                      value={strategy.name}
                      onChange={e => updateStrategyName(strategy.id, e.target.value)}
                      onClick={e => e.stopPropagation()}
                      placeholder="e.g. NIFTY Opening Range Breakout..."
                      style={{
                        borderRadius: 8,
                        border: "1px solid #E2E8F0",
                        padding: "7px 10px",
                        fontSize: 12,
                        fontFamily: "'Plus Jakarta Sans',sans-serif",
                        outline: "none",
                        width: "100%",
                        marginTop: 4,
                      }}
                    />
                  </div>

                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 9, letterSpacing: "0.12em", color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace", marginBottom: 6 }}>
                      REFERENCE SCREENSHOT
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <label
                        style={{
                          fontSize: 10,
                          fontFamily: "'JetBrains Mono',monospace",
                          letterSpacing: "0.08em",
                          padding: "7px 11px",
                          borderRadius: 999,
                          border: "1px solid #0D9E6E33",
                          background: "rgba(13,158,110,0.04)",
                          color: "#0D9E6E",
                          cursor: "pointer",
                        }}
                      >
                          {uploadingByStrategy[strategy.id] ? `UPLOADING ${uploadingByStrategy[strategy.id]}...` : "+ ADD IMAGES"}
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          style={{ display: "none" }}
                          onChange={e => {
                            handleReferenceImageChange(strategy.id, e.target.files);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      {(strategy.referenceImages?.length || 0) > 0 ? (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {strategy.referenceImages.map((image, imageIdx) => (
                            <div key={`${strategy.id}-${imageIdx}`} style={{ position: "relative" }}>
                              <img
                                src={image.url}
                                alt={`${strategy.name || "Setup"} reference ${imageIdx + 1}`}
                                style={{
                                  width: 120,
                                  height: 72,
                                  objectFit: "cover",
                                  borderRadius: 10,
                                  border: "1px solid #E2E8F0",
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => removeReferenceImage(strategy.id, imageIdx)}
                                style={{
                                  position: "absolute",
                                  top: 6,
                                  right: 6,
                                  width: 22,
                                  height: 22,
                                  borderRadius: 999,
                                  border: "1px solid rgba(255,255,255,0.7)",
                                  background: "rgba(15,25,35,0.7)",
                                  color: "#FFFFFF",
                                  cursor: "pointer",
                                  fontSize: 11,
                                }}
                              >
                                x
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, color: "#64748B" }}>
                          Add as many ideal setup screenshots as you want for future comparison.
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => clearTicksForStrategy(strategy.id)}
                      style={{
                        fontSize: 9,
                        fontFamily: "'JetBrains Mono',monospace",
                        letterSpacing: "0.08em",
                        padding: "5px 9px",
                        borderRadius: 999,
                        border: "1px solid #E2E8F0",
                        background: "#F8FAFC",
                        color: "#64748B",
                        cursor: "pointer",
                      }}
                    >
                      CLEAR TICKS
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteStrategy(strategy.id)}
                      style={{
                        fontSize: 9,
                        fontFamily: "'JetBrains Mono',monospace",
                        letterSpacing: "0.08em",
                        padding: "5px 9px",
                        borderRadius: 999,
                        border: "1px solid #FCA5A5",
                        background: "#FEF2F2",
                        color: "#B91C1C",
                        cursor: "pointer",
                      }}
                    >
                      DELETE SETUP
                    </button>
                    <button
                      type="button"
                      onClick={() => addRuleToStrategy(strategy.id)}
                      style={{
                        fontSize: 9,
                        fontFamily: "'JetBrains Mono',monospace",
                        letterSpacing: "0.08em",
                        padding: "5px 9px",
                        borderRadius: 999,
                        border: "1px solid #0D9E6E33",
                        background: "rgba(13,158,110,0.04)",
                        color: "#0D9E6E",
                        cursor: "pointer",
                      }}
                    >
                      + ADD RULE
                    </button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {strategy.rules.map(rule => (
                      <div
                        key={rule.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "5px 8px",
                          borderRadius: 9,
                          background: rule.followed ? "rgba(13,158,110,0.04)" : "transparent",
                          border: "1px solid #E2E8F0",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleRule(strategy.id, rule.id)}
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 5,
                            border: rule.followed ? "1.5px solid #0D9E6E" : "1.5px solid #CBD5E1",
                            background: rule.followed ? "linear-gradient(135deg,#0D9E6E,#22C78E)" : "#FFFFFF",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            flexShrink: 0,
                          }}
                        >
                          {rule.followed && (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.4">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </button>
                        <input
                          type="text"
                          value={rule.label}
                          onChange={e => updateRuleLabel(strategy.id, rule.id, e.target.value)}
                          placeholder="Add rule for this trading setup..."
                          style={{
                            flex: 1,
                            border: "none",
                            outline: "none",
                            background: "transparent",
                            fontSize: 12,
                            fontFamily: "'Plus Jakarta Sans',sans-serif",
                            color: "#0F1923",
                          }}
                        />
                        <button
                          type="button"
                          aria-label="Delete rule"
                          title="Delete rule"
                          onClick={() => deleteRule(strategy.id, rule.id)}
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 999,
                            border: "1px solid #FCA5A5",
                            background: "#FEF2F2",
                            color: "#B91C1C",
                            cursor: "pointer",
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Trash2 size={13} strokeWidth={2.4} />
                        </button>
                      </div>
                    ))}
                    {strategy.rules.length === 0 && (
                      <div style={{ fontSize: 11, color: "#94A3B8", fontFamily: "'Plus Jakarta Sans',sans-serif", marginTop: 4 }}>
                        No rules yet - add your first rule for this trading setup.
                      </div>
                    )}
                  </div>

                  </div>}
                </div>
              );
            })}
          </div>
        </div>
        )}
      </main>
    </div>
  );
}
