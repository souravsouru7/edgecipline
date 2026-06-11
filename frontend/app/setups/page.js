"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import { fetchSetups, saveSetups, uploadSetupReferenceImage } from "@/services/setupApi";
import { useMarket } from "@/context/MarketContext";
import { Skeleton } from "@/features/shared";
import PageHeader from "@/features/shared/components/PageHeader";
import IndianMarketHeader from "@/components/IndianMarketHeader";
import { Trash2, X } from "lucide-react";

export default function SetupStrategiesPage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const { currentMarket, getMarketLabel } = useMarket();
  const [mounted, setMounted] = useState(false);
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState(null);
  const [expandedIds, setExpandedIds] = useState(new Set());

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
        const serverStrategies = await fetchSetups(currentMarket);
        if (Array.isArray(serverStrategies) && serverStrategies.length) {
          const mapped = serverStrategies.map((s, sIdx) => ({
            id: sIdx + 1,
            name: s.name || "",
            rules: Array.isArray(s.rules)
                ? s.rules.map((r, rIdx) => ({
                    id: rIdx + 1,
                    label: r.label || "",
                  }))
                : [],
            referenceImages: Array.isArray(s.referenceImages) ? s.referenceImages.slice(0, 5) : [],
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
  }, [ready, router, currentMarket]);

  const addStrategy = () => {
    setError("");
    setStrategies(prev => {
      const nextId = (prev[prev.length - 1]?.id || 0) + 1;
      return [
        ...prev,
        { id: nextId, name: "", rules: [], referenceImages: [] },
      ];
    });
  };

  const updateStrategyName = (id, name) => {
    setStrategies(prev => prev.map(s => (s.id === id ? { ...s, name } : s)));
  };

  const addRuleToStrategy = (strategyId) => {
    setStrategies(prev =>
      prev.map(s => {
        if (s.id !== strategyId) return s;
        const nextRuleId = (s.rules[s.rules.length - 1]?.id || 0) + 1;
        return { ...s, rules: [...s.rules, { id: nextRuleId, label: "" }] };
      })
    );
  };

  const updateRuleLabel = (strategyId, ruleId, label) => {
    setStrategies(prev =>
      prev.map(s => {
        if (s.id !== strategyId) return s;
        return { ...s, rules: s.rules.map(r => (r.id === ruleId ? { ...r, label } : r)) };
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
        return { ...s, rules: s.rules.filter(r => r.id !== ruleId) };
      })
    );
  };

  const handleReferenceImageChange = async (strategyId, file) => {
    if (!file) return;
    try {
      setSaving(true);
      setError("");
      const uploaded = await uploadSetupReferenceImage(file);
      setStrategies(prev =>
        prev.map(s =>
          s.id === strategyId
            ? {
                ...s,
                referenceImages: [
                  ...(Array.isArray(s.referenceImages) ? s.referenceImages : []),
                  { url: uploaded.imageUrl || "", publicId: uploaded.publicId || "" },
                ].filter(img => img.url).slice(0, 5),
              }
            : s
        )
      );
    } catch (e) {
      setError(e.message || "Failed to upload setup image");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError("");
      const payload = strategies.map(s => ({
        name: s.name,
        referenceImages: Array.isArray(s.referenceImages) ? s.referenceImages.slice(0, 5) : [],
        rules: (s.rules || []).map(r => ({ label: r.label })),
      }));
      await saveSetups(payload, currentMarket);
      setSavedAt(new Date());
    } catch (e) {
      setError(e.message || "Failed to save setups");
    } finally {
      setSaving(false);
    }
  };

  const removeReferenceImage = (strategyId, imageIdx) => {
    setStrategies(prev =>
      prev.map(s =>
        s.id === strategyId
          ? { ...s, referenceImages: (s.referenceImages || []).filter((_, idx) => idx !== imageIdx) }
          : s
      )
    );
  };

  if (!mounted) return null;

  return (
    <div className="sp-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

        * { box-sizing: border-box; }

        .sp-root {
          min-height: 100vh;
          background: #F4F6F9;
          font-family: 'Inter', sans-serif;
          color: #0F1923;
        }

        /* -- Header -- */
        .sp-header {
          position: sticky;
          top: 0;
          z-index: 50;
          background: #FFFFFF;
          border-bottom: 1px solid #E8ECF0;
          padding: 0 16px;
          height: 56px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .sp-header-left {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .sp-back-btn {
          flex-shrink: 0;
          width: 34px;
          height: 34px;
          border-radius: 10px;
          border: 1px solid #E8ECF0;
          background: #F8FAFB;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.15s;
        }
        .sp-back-btn:hover { background: #EEF1F4; }
        .sp-title {
          font-size: 15px;
          font-weight: 700;
          color: #0F1923;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sp-market-chip {
          display: inline-flex;
          align-items: center;
          padding: 3px 8px;
          border-radius: 6px;
          background: #EEF9F4;
          border: 1px solid #C6EEE0;
          font-size: 10px;
          font-family: 'JetBrains Mono', monospace;
          color: #0D9E6E;
          font-weight: 600;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .sp-header-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
        .sp-btn-dashboard {
          height: 36px;
          padding: 0 14px;
          border-radius: 10px;
          border: 1px solid #E8ECF0;
          background: #F8FAFB;
          color: #4A5568;
          font-size: 12px;
          font-weight: 600;
          font-family: 'Inter', sans-serif;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.15s;
        }
        .sp-btn-dashboard:hover { background: #EEF1F4; }
        .sp-btn-save {
          height: 36px;
          padding: 0 16px;
          border-radius: 10px;
          border: none;
          background: linear-gradient(135deg, #0D9E6E, #0BB866);
          color: #FFFFFF;
          font-size: 12px;
          font-weight: 600;
          font-family: 'Inter', sans-serif;
          cursor: pointer;
          white-space: nowrap;
          transition: opacity 0.15s;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .sp-btn-save:disabled { opacity: 0.55; cursor: default; }

        /* -- Main -- */
        .sp-main {
          max-width: 720px;
          margin: 0 auto;
          padding: 20px 16px 40px;
        }

        /* -- Alert -- */
        .sp-alert-error {
          padding: 10px 14px;
          border-radius: 10px;
          background: #FEF2F2;
          border: 1px solid #FECACA;
          font-size: 13px;
          color: #DC2626;
          margin-bottom: 14px;
        }
        .sp-alert-success {
          padding: 10px 14px;
          border-radius: 10px;
          background: #F0FDF4;
          border: 1px solid #BBF7D0;
          font-size: 13px;
          color: #16A34A;
          margin-bottom: 14px;
        }

        /* -- Section header -- */
        .sp-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
          gap: 12px;
        }
        .sp-section-title {
          font-size: 13px;
          font-weight: 700;
          color: #0F1923;
        }
        .sp-section-sub {
          font-size: 12px;
          color: #8A97A6;
          margin-top: 2px;
        }
        .sp-btn-add-strategy {
          flex-shrink: 0;
          height: 34px;
          padding: 0 14px;
          border-radius: 10px;
          border: 1.5px dashed #0D9E6E;
          background: transparent;
          color: #0D9E6E;
          font-size: 12px;
          font-weight: 600;
          font-family: 'Inter', sans-serif;
          cursor: pointer;
          white-space: nowrap;
          display: flex;
          align-items: center;
          gap: 5px;
          transition: background 0.15s;
        }
        .sp-btn-add-strategy:hover { background: #EEF9F4; }

        /* -- Strategy card -- */
        .sp-card {
          background: #FFFFFF;
          border-radius: 14px;
          border: 1px solid #E8ECF0;
          overflow: hidden;
          margin-bottom: 14px;
          box-shadow: 0 1px 4px rgba(15,25,35,0.05);
        }
        .sp-card-header {
          padding: 14px 16px 12px;
          border-bottom: 1px solid #F1F4F8;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          cursor: pointer;
          user-select: none;
        }
        .sp-card-header:hover { background: #FAFBFC; }
        .sp-chevron {
          flex-shrink: 0;
          width: 22px;
          height: 22px;
          border-radius: 6px;
          background: #F1F4F8;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: none;
        }
        .sp-chevron.open { transform: rotate(180deg); }
        .sp-card-name-wrap {
          flex: 1;
          min-width: 0;
        }
        .sp-field-label {
          font-size: 10px;
          font-family: 'JetBrains Mono', monospace;
          font-weight: 600;
          letter-spacing: 0.08em;
          color: #A0AEC0;
          margin-bottom: 5px;
        }
        .sp-name-input {
          width: 100%;
          border: 1px solid #E8ECF0;
          border-radius: 8px;
          padding: 8px 11px;
          font-size: 13px;
          font-weight: 600;
          font-family: 'Inter', sans-serif;
          color: #0F1923;
          background: #F8FAFB;
          outline: none;
          transition: border-color 0.15s, background 0.15s;
        }
        .sp-name-input:focus { border-color: #0D9E6E; background: #FFFFFF; }
        .sp-rules-badge {
          flex-shrink: 0;
          padding: 4px 10px;
          border-radius: 20px;
          background: #F1F4F8;
          font-size: 11px;
          font-family: 'JetBrains Mono', monospace;
          font-weight: 600;
          color: #64748B;
          white-space: nowrap;
        }

        /* -- Images section -- */
        .sp-images-section {
          padding: 12px 16px;
          border-bottom: 1px solid #F1F4F8;
        }
        .sp-images-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
          margin-top: 6px;
        }
        .sp-img-upload-btn {
          height: 60px;
          padding: 0 14px;
          border-radius: 10px;
          border: 1.5px dashed #CBD5E0;
          background: #F8FAFB;
          color: #64748B;
          font-size: 11px;
          font-weight: 600;
          font-family: 'Inter', sans-serif;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 5px;
          transition: border-color 0.15s, background 0.15s;
          white-space: nowrap;
        }
        .sp-img-upload-btn:hover { border-color: #0D9E6E; background: #EEF9F4; color: #0D9E6E; }
        .sp-img-thumb {
          position: relative;
          flex-shrink: 0;
        }
        .sp-img-thumb img, .sp-img-thumb span {
          border-radius: 10px;
          display: block;
        }
        .sp-img-remove {
          position: absolute;
          top: -6px;
          right: -6px;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          border: 2px solid #FFFFFF;
          background: #EF4444;
          color: #FFFFFF;
          font-size: 9px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }
        .sp-img-remove svg,
        .sp-rule-del svg,
        .sp-btn-delete-setup svg {
          flex-shrink: 0;
        }
        .sp-img-hint {
          font-size: 11px;
          color: #A0AEC0;
        }

        /* -- Rules section -- */
        .sp-rules-section {
          padding: 12px 16px;
        }
        .sp-rules-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
        }
        .sp-btn-add-rule {
          height: 30px;
          padding: 0 12px;
          border-radius: 8px;
          border: 1px solid #C6EEE0;
          background: #EEF9F4;
          color: #0D9E6E;
          font-size: 11px;
          font-weight: 600;
          font-family: 'Inter', sans-serif;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 4px;
          transition: background 0.15s;
        }
        .sp-btn-add-rule:hover { background: #D5F5E9; }
        .sp-btn-delete-setup {
          height: 30px;
          padding: 0 12px;
          border-radius: 8px;
          border: 1px solid #FECACA;
          background: #FEF2F2;
          color: #DC2626;
          font-size: 11px;
          font-weight: 600;
          font-family: 'Inter', sans-serif;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 4px;
          transition: background 0.15s;
        }
        .sp-btn-delete-setup:hover { background: #FEE2E2; }

        .sp-rule-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 9px;
          border: 1px solid #F1F4F8;
          background: #FAFBFC;
          margin-bottom: 6px;
          transition: border-color 0.15s;
        }
        .sp-rule-row:focus-within {
          border-color: #0D9E6E;
          background: #FFFFFF;
        }
        .sp-rule-num {
          width: 22px;
          height: 22px;
          border-radius: 6px;
          background: #E8ECF0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-family: 'JetBrains Mono', monospace;
          font-weight: 700;
          color: #64748B;
          flex-shrink: 0;
        }
        .sp-rule-input {
          flex: 1;
          border: none;
          outline: none;
          background: transparent;
          font-size: 13px;
          font-family: 'Inter', sans-serif;
          color: #0F1923;
          min-width: 0;
        }
        .sp-rule-input::placeholder { color: #CBD5E0; }
        .sp-rule-del {
          width: 24px;
          height: 24px;
          border-radius: 6px;
          border: 1px solid #FECACA;
          background: #FEF2F2;
          color: #DC2626;
          font-size: 12px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: background 0.15s;
          line-height: 1;
        }
        .sp-rule-del:hover { background: #FEE2E2; }

        .sp-no-rules {
          font-size: 12px;
          color: #A0AEC0;
          text-align: center;
          padding: 12px 0 4px;
        }

        /* -- Empty state -- */
        .sp-empty {
          text-align: center;
          padding: 48px 20px;
          background: #FFFFFF;
          border-radius: 14px;
          border: 1.5px dashed #DDE2E8;
        }
        .sp-empty-icon {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          background: #EEF9F4;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 12px;
        }
        .sp-empty-title {
          font-size: 14px;
          font-weight: 700;
          color: #0F1923;
          margin-bottom: 6px;
        }
        .sp-empty-sub {
          font-size: 12px;
          color: #8A97A6;
          margin-bottom: 18px;
        }
        .sp-empty-btn {
          height: 38px;
          padding: 0 20px;
          border-radius: 10px;
          border: none;
          background: linear-gradient(135deg, #0D9E6E, #0BB866);
          color: #FFFFFF;
          font-size: 13px;
          font-weight: 600;
          font-family: 'Inter', sans-serif;
          cursor: pointer;
        }

        /* -- Skeleton -- */
        .sp-skel-card {
          background: #FFFFFF;
          border-radius: 14px;
          border: 1px solid #E8ECF0;
          padding: 16px;
          margin-bottom: 14px;
        }
      `}</style>

      {currentMarket === "Indian_Market" ? <IndianMarketHeader /> : <PageHeader />}

      {/* Page toolbar */}
      <div style={{
        background: "#FFFFFF", borderBottom: "1px solid #E8EDF2",
        padding: "10px 20px", display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: 12, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#0F1923" }}>Setup / Strategies</span>
          {getMarketLabel() && (
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#0D9E6E", background: "rgba(13,158,110,0.08)", border: "1px solid rgba(13,158,110,0.2)", padding: "3px 8px", borderRadius: 20 }}>
              {getMarketLabel()}
            </span>
          )}
        </div>
        <button
          type="button"
          className="sp-btn-save"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin 1s linear infinite" }}>
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              Saving...
            </>
          ) : (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              Save Setups
            </>
          )}
        </button>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <main className="sp-main">
        {error && <div className="sp-alert-error">{error}</div>}
        {savedAt && !error && (
          <div className="sp-alert-success">
            Setups saved successfully at {savedAt.toLocaleTimeString()}
          </div>
        )}

        {loading ? (
          <>
            {[...Array(2)].map((_, i) => (
              <div key={i} className="sp-skel-card">
                <Skeleton width="140px" height="13px" style={{ marginBottom: 12 }} />
                <Skeleton width="100%" height="38px" style={{ borderRadius: 8, marginBottom: 10 }} />
                {[...Array(3)].map((_, j) => (
                  <Skeleton key={j} width="100%" height="34px" style={{ borderRadius: 8, marginBottom: 6 }} />
                ))}
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="sp-section-header">
              <div>
                <div className="sp-section-title">Your Strategies</div>
                <div className="sp-section-sub">Define rules for each setup to follow before entering a trade.</div>
              </div>
              <button type="button" className="sp-btn-add-strategy" onClick={addStrategy}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add Strategy
              </button>
            </div>

            {strategies.length === 0 ? (
              <div className="sp-empty">
                <div className="sp-empty-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0D9E6E" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="3" />
                    <line x1="9" y1="9" x2="15" y2="9" /><line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="15" x2="12" y2="15" />
                  </svg>
                </div>
                <div className="sp-empty-title">No strategies yet</div>
                <div className="sp-empty-sub">Create your first setup with rules to keep your trading disciplined.</div>
                <button type="button" className="sp-empty-btn" onClick={addStrategy}>+ Add Strategy</button>
              </div>
            ) : (
              strategies.map(strategy => {
                const filledRules = strategy.rules.filter(r => r.label?.trim().length > 0).length;
                const isExpanded = expandedIds.has(strategy.id);
                return (
                  <div key={strategy.id} className="sp-card">
                    {/* Card header - name */}
                    <div className="sp-card-header" onClick={() => toggleExpand(strategy.id)}>
                      <div className="sp-card-name-wrap">
                        <div className="sp-field-label">STRATEGY NAME</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: strategy.name ? "#0F1923" : "#A0AEC0", fontFamily: "'Inter', sans-serif" }}>
                          {strategy.name || "Untitled Strategy"}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="sp-rules-badge">
                          {filledRules} {filledRules === 1 ? "rule" : "rules"}
                        </div>
                        <div className={`sp-chevron${isExpanded ? " open" : ""}`}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2.5">
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </div>
                      </div>
                    </div>

                    {/* Collapsible body */}
                    {isExpanded && <>

                    {/* Name input (inside expanded) */}
                    <div style={{ padding: "12px 16px", borderBottom: "1px solid #F1F4F8" }} onClick={e => e.stopPropagation()}>
                      <div className="sp-field-label">STRATEGY NAME</div>
                      <input
                        type="text"
                        className="sp-name-input"
                        value={strategy.name}
                        onChange={e => updateStrategyName(strategy.id, e.target.value)}
                        placeholder="e.g. London Breakout, NY Reversal..."
                      />
                    </div>

                    {/* Reference images */}
                    <div className="sp-images-section">
                      <div className="sp-field-label">REFERENCE SCREENSHOTS</div>
                      <div className="sp-images-row">
                        {(strategy.referenceImages?.length || 0) < 5 && (
                          <label className="sp-img-upload-btn">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="3" y="3" width="18" height="18" rx="2" />
                              <circle cx="8.5" cy="8.5" r="1.5" />
                              <polyline points="21 15 16 10 5 21" />
                            </svg>
                            Add Image
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: "none" }}
                              onChange={e => handleReferenceImageChange(strategy.id, e.target.files?.[0])}
                            />
                          </label>
                        )}
                        {(strategy.referenceImages || []).map((image, imageIdx) => (
                          <div key={`${strategy.id}-${imageIdx}`} className="sp-img-thumb">
                            <Image src={image.url} alt={`ref ${imageIdx + 1}`} width={80} height={60} style={{ objectFit: "cover", borderRadius: 10, border: "1px solid #E8ECF0", display: "block" }} unoptimized />
                            <button
                              type="button"
                              className="sp-img-remove"
                              aria-label="Remove reference image"
                              title="Remove image"
                              onClick={() => removeReferenceImage(strategy.id, imageIdx)}
                            >
                              <X size={11} strokeWidth={3} />
                            </button>
                          </div>
                        ))}
                        {(strategy.referenceImages?.length || 0) === 0 && (
                          <span className="sp-img-hint">Add up to 5 reference screenshots</span>
                        )}
                      </div>
                    </div>

                    {/* Rules */}
                    <div className="sp-rules-section">
                      <div className="sp-rules-top">
                        <div className="sp-field-label" style={{ margin: 0 }}>RULES CHECKLIST</div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button type="button" className="sp-btn-add-rule" onClick={() => addRuleToStrategy(strategy.id)}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                            Add Rule
                          </button>
                          <button type="button" className="sp-btn-delete-setup" onClick={() => deleteStrategy(strategy.id)}>
                            <Trash2 size={12} strokeWidth={2.4} />
                            Delete
                          </button>
                        </div>
                      </div>

                      {strategy.rules.length === 0 ? (
                        <div className="sp-no-rules">No rules yet - click Add Rule to get started.</div>
                      ) : (
                        strategy.rules.map(rule => (
                          <div key={rule.id} className="sp-rule-row">
                            <div className="sp-rule-num">{strategy.rules.indexOf(rule) + 1}</div>
                            <input
                              type="text"
                              className="sp-rule-input"
                              value={rule.label}
                              onChange={e => updateRuleLabel(strategy.id, rule.id, e.target.value)}
                              placeholder="Describe this rule..."
                            />
                            <button
                              type="button"
                              className="sp-rule-del"
                              aria-label="Delete rule"
                              title="Delete rule"
                              onClick={() => deleteRule(strategy.id, rule.id)}
                            >
                              <Trash2 size={13} strokeWidth={2.4} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>

                    </>}
                  </div>
                );
              })
            )}
          </>
        )}
      </main>
    </div>
  );
}
