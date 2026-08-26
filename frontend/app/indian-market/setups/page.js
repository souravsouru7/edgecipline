"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import { fetchSetups, saveSetups, uploadSetupReferenceImages } from "@/services/setupApi";
import { markOnboardingStep } from "@/services/api";
import { MARKETS } from "@/context/MarketContext";
import IndianMarketHeader from "@/components/IndianMarketHeader";
import IndianMarketLoadingState from "@/components/IndianMarketLoadingState";
import { Trash2, X } from "lucide-react";
import { invalidateSetupDependentQueries } from "@/utils/queryInvalidation";
import { refreshChecklistNotificationFromSetups } from "@/services/checklistNotificationSync";

const MAX_IMAGES = 20;

const STARTER_TEMPLATES = [
  {
    name: "NIFTY Opening Range Breakout",
    description: "Use when NIFTY breaks the first range with volume and clean risk.",
    rules: [
      "First 15-minute range is clearly formed",
      "Breakout candle closes beyond the range high or low",
      "Volume supports the breakout direction",
      "Stop loss is inside or below the broken range",
    ],
  },
  {
    name: "BANKNIFTY VWAP Pullback",
    description: "Use when BANKNIFTY trends, pulls back to VWAP, then rejects.",
    rules: [
      "Trend direction is clear before the pullback",
      "Price pulls back near VWAP or a key moving average",
      "Rejection candle forms in the trend direction",
      "Target gives at least 1:2 risk reward",
    ],
  },
  {
    name: "Stock Breakout Retest",
    description: "Use for NSE stocks breaking a major level and retesting it cleanly.",
    rules: [
      "Stock breaks a strong support or resistance level",
      "Retest holds the broken level",
      "Entry happens after confirmation, not during the first spike",
      "Invalidation level is clear before entry",
    ],
  },
];

function genId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export default function IndianSetupStrategiesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const onboardingMode = searchParams?.get("onboarding") === "1";
  const { ready } = useRequireAuth();
  const [mounted, setMounted] = useState(false);
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState(null);
  const [expandedIds, setExpandedIds] = useState(new Set());
  // { [strategyId]: [{id, file, previewUrl}] }
  const [pendingByStrategy, setPendingByStrategy] = useState({});

  const totalPendingCount = Object.values(pendingByStrategy).reduce((s, a) => s + a.length, 0);

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
          setStrategies(serverStrategies.map((s, i) => ({
            id: i + 1,
            // Kept so the save can update this strategy in place instead of
            // recreating it — the checklist notification binds to this id.
            _id: s._id ? String(s._id) : undefined,
            name: s.name || "",
            rules: Array.isArray(s.rules)
              ? s.rules.map((r, j) => ({ id: j + 1, _id: r._id ? String(r._id) : undefined, label: r.label || "" }))
              : [],
            referenceImages: Array.isArray(s.referenceImages) ? s.referenceImages : [],
          })));
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

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(pendingByStrategy).flat().forEach(p => {
        try { URL.revokeObjectURL(p.previewUrl); } catch {}
      });
    };
  }, []);

  // ── Strategy management ────────────────────────────────────────────────

  const addStrategy = () => {
    setError("");
    setStrategies(prev => {
      const nextId = (prev[prev.length - 1]?.id || 0) + 1;
      return [...prev, { id: nextId, name: "", rules: [], referenceImages: [] }];
    });
  };

  const addStarterTemplate = (template) => {
    setError("");
    setStrategies(prev => {
      const nextId = (prev[prev.length - 1]?.id || 0) + 1;
      const nextStrategy = {
        id: nextId,
        name: template.name,
        rules: template.rules.map((label, index) => ({ id: index + 1, label })),
        referenceImages: [],
      };
      setExpandedIds(ids => new Set([...ids, nextId]));
      return [...prev, nextStrategy];
    });
  };

  const updateStrategyName = (id, name) =>
    setStrategies(prev => prev.map(s => s.id === id ? { ...s, name } : s));

  const deleteStrategy = (strategyId) => {
    const pending = pendingByStrategy[strategyId] || [];
    pending.forEach(p => { try { URL.revokeObjectURL(p.previewUrl); } catch {} });
    setPendingByStrategy(prev => {
      const next = { ...prev };
      delete next[strategyId];
      return next;
    });
    setStrategies(prev => prev.filter(s => s.id !== strategyId));
  };

  // ── Rule management ────────────────────────────────────────────────────

  const addRuleToStrategy = (strategyId) =>
    setStrategies(prev => prev.map(s => {
      if (s.id !== strategyId) return s;
      const nextId = (s.rules[s.rules.length - 1]?.id || 0) + 1;
      return { ...s, rules: [...s.rules, { id: nextId, label: "" }] };
    }));

  const updateRuleLabel = (strategyId, ruleId, label) =>
    setStrategies(prev => prev.map(s =>
      s.id !== strategyId ? s : { ...s, rules: s.rules.map(r => r.id === ruleId ? { ...r, label } : r) }
    ));

  const deleteRule = (strategyId, ruleId) =>
    setStrategies(prev => prev.map(s =>
      s.id !== strategyId ? s : { ...s, rules: s.rules.filter(r => r.id !== ruleId) }
    ));

  // ── Image management ───────────────────────────────────────────────────

  const handleFilesSelected = (strategyId, fileList) => {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;

    const strategy = strategies.find(s => s.id === strategyId);
    const uploadedCount = strategy?.referenceImages?.length || 0;
    const pendingCount = (pendingByStrategy[strategyId] || []).length;
    const remaining = MAX_IMAGES - uploadedCount - pendingCount;
    if (remaining <= 0) {
      setError(`Maximum ${MAX_IMAGES} images per strategy`);
      return;
    }
    setError("");

    const toAdd = files.slice(0, remaining).map(file => ({
      id: genId(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    setPendingByStrategy(prev => ({
      ...prev,
      [strategyId]: [...(prev[strategyId] || []), ...toAdd],
    }));
  };

  const removePendingImage = (strategyId, pendingId) =>
    setPendingByStrategy(prev => {
      const arr = prev[strategyId] || [];
      const item = arr.find(p => p.id === pendingId);
      if (item) { try { URL.revokeObjectURL(item.previewUrl); } catch {} }
      return { ...prev, [strategyId]: arr.filter(p => p.id !== pendingId) };
    });

  const removeReferenceImage = (strategyId, imageIdx) =>
    setStrategies(prev => prev.map(s =>
      s.id !== strategyId ? s : {
        ...s,
        referenceImages: (s.referenceImages || []).filter((_, i) => i !== imageIdx),
      }
    ));

  const moveReferenceImage = (strategyId, idx, dir) =>
    setStrategies(prev => prev.map(s => {
      if (s.id !== strategyId) return s;
      const imgs = [...s.referenceImages];
      const ni = idx + dir;
      if (ni < 0 || ni >= imgs.length) return s;
      [imgs[idx], imgs[ni]] = [imgs[ni], imgs[idx]];
      return { ...s, referenceImages: imgs };
    }));

  const movePendingImage = (strategyId, pendingId, dir) =>
    setPendingByStrategy(prev => {
      const arr = [...(prev[strategyId] || [])];
      const idx = arr.findIndex(p => p.id === pendingId);
      if (idx < 0) return prev;
      const ni = idx + dir;
      if (ni < 0 || ni >= arr.length) return prev;
      [arr[idx], arr[ni]] = [arr[ni], arr[idx]];
      return { ...prev, [strategyId]: arr };
    });

  // ── Save (upload pending → save all) ──────────────────────────────────

  const handleSave = async () => {
    // Validate before uploading: a save rejected after the upload step leaves
    // the just-uploaded images on Cloudinary with nothing referencing them.
    const named = strategies.filter(s => (s.name || "").trim());
    const seen = new Map();
    for (const s of named) {
      const key = s.name.trim().toLowerCase();
      if (seen.has(key)) {
        setError(`Duplicate strategy name "${s.name.trim()}" (matches "${seen.get(key)}")`);
        return;
      }
      seen.set(key, s.name.trim());
    }
    const unnamedWithContent = strategies.find(
      s => !(s.name || "").trim() &&
        ((s.rules || []).some(r => (r.label || "").trim()) ||
          (s.referenceImages || []).length > 0 ||
          (pendingByStrategy[s.id] || []).length > 0)
    );
    if (unnamedWithContent) {
      setError("Give every strategy a name before saving.");
      return;
    }

    setSaving(true);
    setError("");
    setUploadStatus(null);

    try {
      let newStrategies = [...strategies];

      if (totalPendingCount > 0) {
        setUploadStatus({ uploaded: 0, total: totalPendingCount });

        await Promise.all(
          Object.entries(pendingByStrategy).map(async ([sid, pending]) => {
            if (!pending.length) return;
            const strategyId = Number(sid);
            const files = pending.map(p => p.file);
            const uploaded = await uploadSetupReferenceImages(files);
            pending.forEach(p => { try { URL.revokeObjectURL(p.previewUrl); } catch {} });

            newStrategies = newStrategies.map(s => {
              if (s.id !== strategyId) return s;
              return {
                ...s,
                referenceImages: [
                  ...(s.referenceImages || []),
                  ...(Array.isArray(uploaded) ? uploaded : [])
                    .map(u => ({ url: u.imageUrl || "", publicId: u.publicId || "" }))
                    .filter(img => img.url),
                ].slice(0, MAX_IMAGES),
              };
            });

            setUploadStatus(prev => prev
              ? { ...prev, uploaded: prev.uploaded + files.length }
              : null
            );
          })
        );
      }

      setStrategies(newStrategies);
      setPendingByStrategy({});
      setUploadStatus(null);

      const payload = newStrategies.map(s => ({
        ...(s._id ? { _id: s._id } : {}),
        name: s.name,
        referenceImages: (s.referenceImages || []).slice(0, MAX_IMAGES),
        rules: (s.rules || []).map(r => ({ label: r.label })),
      }));
      const saved = await saveSetups(payload, MARKETS.INDIAN_MARKET);
      await Promise.all(invalidateSetupDependentQueries(queryClient));

      if (Array.isArray(saved)) {
        setStrategies(saved.map((s, i) => ({
          id: i + 1,
          _id: s._id ? String(s._id) : undefined,
          name: s.name || "",
          rules: Array.isArray(s.rules)
            ? s.rules.map((r, j) => ({ id: j + 1, _id: r._id ? String(r._id) : undefined, label: r.label || "" }))
            : [],
          referenceImages: Array.isArray(s.referenceImages) ? s.referenceImages : [],
        })));
        await refreshChecklistNotificationFromSetups({
          strategies: saved,
          market: MARKETS.INDIAN_MARKET,
        });
      }
      setSavedAt(new Date());

      const hasNamedStrategy = payload.some(p => (p.name || "").trim().length > 0);
      if (hasNamedStrategy) {
        markOnboardingStep("setupAdded", true).catch(() => {});
        if (onboardingMode) {
          setTimeout(() => router.push("/indian-market/upload-trade?onboarding=1"), 600);
        }
      }
    } catch (e) {
      setError(e.message || "Failed to save setups");
    } finally {
      setSaving(false);
      setUploadStatus(null);
    }
  };

  if (!mounted) return null;

  const imgCardBase = {
    position: "relative", flexShrink: 0,
  };
  const imgStyle = {
    width: 96, height: 72, objectFit: "cover", borderRadius: 10, display: "block",
  };
  const removeBtnStyle = {
    position: "absolute", top: -6, right: -6,
    width: 20, height: 20, borderRadius: "50%",
    border: "2px solid #FFFFFF", background: "#EF4444", color: "#FFFFFF",
    fontSize: 9, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 2,
  };
  const moveBtnRowStyle = {
    position: "absolute", bottom: 4, left: 0, right: 0,
    display: "flex", justifyContent: "center", gap: 3,
  };
  const moveBtnStyle = {
    width: 20, height: 18, borderRadius: 4, border: "none",
    background: "rgba(15,25,35,0.58)", color: "#FFFFFF",
    fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F4F6F9", fontFamily: "'Plus Jakarta Sans',sans-serif", color: "#0F1923" }}>
      <IndianMarketHeader />

      {/* Sticky action bar */}
      <div style={{
        position: "sticky", top: 0, zIndex: 50,
        padding: "0 16px", borderBottom: "1px solid #E8ECF0",
        background: "#FFFFFF", height: 56,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Link href="/indian-market/dashboard" style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 10, border: "1px solid #E8ECF0", background: "#F8FAFB", display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none", color: "#0F1923" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          </Link>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0F1923", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            Setup / Strategies
          </div>
          <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", padding: "3px 8px", borderRadius: 6, background: "#EEF9F4", border: "1px solid #C6EEE0", fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "#0D9E6E", fontWeight: 600 }}>
            NSE / BSE
          </span>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            flexShrink: 0, display: "flex", alignItems: "center", gap: 6,
            fontSize: 12, fontWeight: 700, padding: "8px 16px", borderRadius: 10, border: "none",
            background: saving ? "#E2E8F0" : "linear-gradient(135deg,#0D9E6E,#22C78E)",
            color: saving ? "#64748B" : "#FFFFFF",
            cursor: saving ? "default" : "pointer",
            boxShadow: saving ? "none" : "0 4px 12px rgba(13,158,110,0.25)",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          {saving
            ? (uploadStatus
                ? `Uploading ${uploadStatus.uploaded}/${uploadStatus.total}…`
                : "Saving…")
            : totalPendingCount > 0
              ? `Upload & Save (${totalPendingCount})`
              : "Save Setups"}
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

        {onboardingMode && (
          <div style={{ marginBottom: 16, padding: 16, borderRadius: 14, background: "linear-gradient(135deg, rgba(34,199,142,0.10), rgba(184,134,11,0.06))", border: "1px solid rgba(13,158,110,0.28)", boxShadow: "0 2px 10px rgba(15,25,35,0.04)" }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", color: "#0D9E6E", fontFamily: "'JetBrains Mono',monospace", marginBottom: 6 }}>
              ONBOARDING - STEP 1 OF 3
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#0F1923", marginBottom: 5 }}>
              Create one Indian market setup first.
            </div>
            <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.6, maxWidth: 680 }}>
              Pick an example below or create your own, add simple NSE / BSE rules, then press Save Setups. After saving, we will take you to import your first Indian trade.
            </div>
          </div>
        )}

        {loading ? (
          <IndianMarketLoadingState
            title="Loading Indian Market setups"
            subtitle="Preparing strategies, setup rules, and reference images"
            dense
          />
        ) : (
          <div style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid #E2E8F0", padding: "18px 20px 14px", boxShadow: "0 2px 10px rgba(15,25,35,0.04)" }}>
            <div style={{ marginBottom: 16, padding: 14, borderRadius: 14, background: "#F8FAFB", border: "1px solid #DDEFE8" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#0F1923", marginBottom: 4 }}>Use an Indian market example</div>
              <div style={{ fontSize: 12, color: "#64748B", lineHeight: 1.55, marginBottom: 12 }}>
                Pick a sample setup to prefill the strategy name and rules, then edit it to match your real process.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
                {STARTER_TEMPLATES.map(template => (
                  <button
                    key={template.name}
                    type="button"
                    onClick={() => addStarterTemplate(template)}
                    style={{
                      minHeight: 112,
                      padding: 12,
                      borderRadius: 12,
                      border: "1px solid #E2E8F0",
                      background: "#FFFFFF",
                      textAlign: "left",
                      cursor: "pointer",
                      fontFamily: "'Plus Jakarta Sans',sans-serif",
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#0F1923", marginBottom: 5 }}>{template.name}</div>
                    <div style={{ fontSize: 11, color: "#64748B", lineHeight: 1.45, marginBottom: 10 }}>{template.description}</div>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "#0D9E6E", fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.06em" }}>
                      USE EXAMPLE
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#0F1923" }}>Your Strategies</div>
                <div style={{ fontSize: 11, color: "#64748B", marginTop: 3 }}>Define rules for each setup to follow before entering a trade.</div>
              </div>
              <button type="button" onClick={addStrategy} style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, padding: "8px 14px", borderRadius: 10, border: "1.5px dashed #0D9E6E", background: "transparent", color: "#0D9E6E", cursor: "pointer", whiteSpace: "nowrap" }}>
                + Add Strategy
              </button>
            </div>

            {strategies.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 20px" }}>
                <div style={{ width: 52, height: 52, borderRadius: 14, background: "rgba(13,158,110,0.08)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0D9E6E" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#0F1923", marginBottom: 6 }}>No strategies yet</div>
                <div style={{ fontSize: 12, color: "#64748B", lineHeight: 1.6, marginBottom: 20 }}>Create your first trading setup and add the rules you expect to follow before entering a trade.</div>
                <button type="button" onClick={addStrategy} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "linear-gradient(135deg,#0D9E6E,#22C78E)", color: "#fff", borderRadius: 10, padding: "11px 20px", fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer", boxShadow: "0 4px 14px rgba(13,158,110,0.25)" }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Add First Strategy
                </button>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {strategies.map(strategy => {
                const activeRules = strategy.rules.filter(r => r.label && r.label.trim().length > 0);
                const isExpanded = expandedIds.has(strategy.id);
                const uploadedImgs = strategy.referenceImages || [];
                const pendingImgs = pendingByStrategy[strategy.id] || [];
                const totalImgs = uploadedImgs.length + pendingImgs.length;

                return (
                  <div key={strategy.id} style={{ borderRadius: 12, border: "1px solid #E2E8F0", background: "linear-gradient(135deg,rgba(248,250,252,0.9),#FFFFFF)", overflow: "hidden" }}>

                    {/* Section header */}
                    <div onClick={() => toggleExpand(strategy.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 12px", cursor: "pointer", userSelect: "none" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 9, letterSpacing: "0.12em", color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace", marginBottom: 2 }}>TRADING SETUP</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: strategy.name ? "#0F1923" : "#A0AEC0", fontFamily: "'Plus Jakarta Sans',sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {strategy.name || "Untitled Setup"}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: "#0D9E6E", fontWeight: 700 }}>
                            {activeRules.length} RULE{activeRules.length === 1 ? "" : "S"}
                          </div>
                          <div style={{ fontSize: 10, color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace" }}>
                            setup checklist
                          </div>
                        </div>
                        <div style={{ width: 22, height: 22, borderRadius: 6, background: "#F1F4F8", display: "flex", alignItems: "center", justifyContent: "center", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "none" }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
                        </div>
                      </div>
                    </div>

                    {/* Expanded body */}
                    {isExpanded && <div style={{ borderTop: "1px solid #F1F4F8", padding: "10px 12px" }}>

                      {/* Name input */}
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ fontSize: 9, letterSpacing: "0.12em", color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace" }}>TRADING SETUP NAME</label>
                        <input
                          type="text"
                          value={strategy.name}
                          onChange={e => updateStrategyName(strategy.id, e.target.value)}
                          onClick={e => e.stopPropagation()}
                          placeholder="e.g. NIFTY Opening Range Breakout..."
                          style={{ borderRadius: 8, border: "1px solid #E2E8F0", padding: "7px 10px", fontSize: 12, fontFamily: "'Plus Jakarta Sans',sans-serif", outline: "none", width: "100%", marginTop: 4 }}
                        />
                      </div>

                      {/* Reference images */}
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                          <div style={{ fontSize: 9, letterSpacing: "0.12em", color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace" }}>REFERENCE SCREENSHOTS</div>
                          {totalImgs > 0 && (
                            <span style={{ fontSize: 10, color: "#94A3B8", fontFamily: "'JetBrains Mono',monospace" }}>{totalImgs}/{MAX_IMAGES}</span>
                          )}
                        </div>

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                          {/* Uploaded images */}
                          {uploadedImgs.map((img, imgIdx) => (
                            <div key={`up-${imgIdx}`} style={imgCardBase}>
                              <img src={img.url} alt={`ref ${imgIdx + 1}`} style={{ ...imgStyle, border: "1px solid #E2E8F0" }} />
                              <button type="button" style={removeBtnStyle} title="Remove" onClick={() => removeReferenceImage(strategy.id, imgIdx)}>
                                <X size={10} strokeWidth={3} />
                              </button>
                              {uploadedImgs.length > 1 && (
                                <div style={moveBtnRowStyle}>
                                  {imgIdx > 0 && (
                                    <button type="button" style={moveBtnStyle} title="Move left" onClick={() => moveReferenceImage(strategy.id, imgIdx, -1)}>‹</button>
                                  )}
                                  {imgIdx < uploadedImgs.length - 1 && (
                                    <button type="button" style={moveBtnStyle} title="Move right" onClick={() => moveReferenceImage(strategy.id, imgIdx, 1)}>›</button>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}

                          {/* Pending images (local preview, not yet uploaded) */}
                          {pendingImgs.map((pending, pIdx) => (
                            <div key={pending.id} style={imgCardBase}>
                              <img src={pending.previewUrl} alt={`pending ${pIdx + 1}`} style={{ ...imgStyle, border: "2px dashed #0D9E6E" }} />
                              <div style={{ position: "absolute", top: 4, left: 4, background: "#0D9E6E", color: "#fff", fontSize: 8, fontWeight: 800, padding: "2px 5px", borderRadius: 4, letterSpacing: "0.08em", fontFamily: "'JetBrains Mono',monospace" }}>NEW</div>
                              <button type="button" style={removeBtnStyle} title="Remove" onClick={() => removePendingImage(strategy.id, pending.id)}>
                                <X size={10} strokeWidth={3} />
                              </button>
                              {pendingImgs.length > 1 && (
                                <div style={moveBtnRowStyle}>
                                  {pIdx > 0 && (
                                    <button type="button" style={moveBtnStyle} title="Move left" onClick={() => movePendingImage(strategy.id, pending.id, -1)}>‹</button>
                                  )}
                                  {pIdx < pendingImgs.length - 1 && (
                                    <button type="button" style={moveBtnStyle} title="Move right" onClick={() => movePendingImage(strategy.id, pending.id, 1)}>›</button>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}

                          {/* Add images button */}
                          {totalImgs < MAX_IMAGES && (
                            <label style={{ width: 96, height: 72, borderRadius: 10, border: "1.5px dashed #0D9E6E33", background: "rgba(13,158,110,0.03)", color: "#0D9E6E", fontSize: 10, fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.08em", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, flexShrink: 0 }}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                              {totalImgs === 0 ? "ADD IMAGES" : "+ MORE"}
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                style={{ display: "none" }}
                                onChange={e => {
                                  handleFilesSelected(strategy.id, e.target.files);
                                  e.target.value = "";
                                }}
                              />
                            </label>
                          )}
                        </div>

                        {pendingImgs.length > 0 && (
                          <div style={{ fontSize: 11, color: "#0D9E6E", marginTop: 6, fontWeight: 500 }}>
                            {pendingImgs.length} image{pendingImgs.length > 1 ? "s" : ""} selected — will upload when you Save
                          </div>
                        )}
                        {totalImgs === 0 && (
                          <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>
                            Add up to {MAX_IMAGES} ideal setup screenshots for future comparison.
                          </div>
                        )}
                      </div>

                      {/* Rule management buttons */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
                        <div style={{ fontSize: 9, fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.08em", color: "#94A3B8" }}>
                          RULES CHECKLIST
                        </div>
                        <button type="button" onClick={() => deleteStrategy(strategy.id)} style={{ fontSize: 9, fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.08em", padding: "5px 9px", borderRadius: 999, border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#B91C1C", cursor: "pointer" }}>
                          DELETE SETUP
                        </button>
                        <button type="button" onClick={() => addRuleToStrategy(strategy.id)} style={{ fontSize: 9, fontFamily: "'JetBrains Mono',monospace", letterSpacing: "0.08em", padding: "5px 9px", borderRadius: 999, border: "1px solid #0D9E6E33", background: "rgba(13,158,110,0.04)", color: "#0D9E6E", cursor: "pointer" }}>
                          + ADD RULE
                        </button>
                      </div>

                      {/* Rules list */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {strategy.rules.map((rule, ruleIdx) => (
                          <div key={rule.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 9, background: "#FAFBFC", border: "1px solid #E2E8F0" }}>
                            <div style={{ width: 24, height: 24, borderRadius: 7, background: "#E8ECF0", color: "#64748B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontFamily: "'JetBrains Mono',monospace", fontWeight: 800, flexShrink: 0 }}>
                              {ruleIdx + 1}
                            </div>
                            <input
                              type="text"
                              value={rule.label}
                              onChange={e => updateRuleLabel(strategy.id, rule.id, e.target.value)}
                              placeholder="Add rule for this trading setup..."
                              style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 12, fontFamily: "'Plus Jakarta Sans',sans-serif", color: "#0F1923" }}
                            />
                            <button type="button" aria-label="Delete rule" onClick={() => deleteRule(strategy.id, rule.id)} style={{ width: 26, height: 26, borderRadius: 999, border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#B91C1C", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <Trash2 size={13} strokeWidth={2.4} />
                            </button>
                          </div>
                        ))}
                        {strategy.rules.length === 0 && (
                          <div style={{ fontSize: 11, color: "#94A3B8", fontFamily: "'Plus Jakarta Sans',sans-serif", marginTop: 4 }}>
                            No rules yet — add your first rule for this trading setup.
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
