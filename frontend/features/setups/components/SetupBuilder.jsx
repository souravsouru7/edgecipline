"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, ImagePlus, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { genId } from "@/utils/genId";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import { fetchSetups, saveSetups, uploadSetupReferenceImages } from "@/services/setupApi";
import { markOnboardingStep } from "@/services/api";
import { invalidateSetupDependentQueries } from "@/utils/queryInvalidation";
import { refreshChecklistNotificationFromSetups } from "@/services/checklistNotificationSync";

const MAX_IMAGES = 20;

const toLocalStrategies = (serverStrategies) =>
  serverStrategies.map((s, i) => ({
    id: i + 1,
    // Server id, carried through the edit and sent back on save so the
    // strategy keeps its identity (the checklist notification binds to it).
    _id: s._id ? String(s._id) : undefined,
    name: s.name || "",
    rules: Array.isArray(s.rules)
      ? s.rules.map((r, j) => ({ id: j + 1, _id: r._id ? String(r._id) : undefined, label: r.label || "" }))
      : [],
    referenceImages: Array.isArray(s.referenceImages) ? s.referenceImages : [],
  }));

/**
 * Shared setup/strategy editor for both markets. Two-pane on laptop (list +
 * editor), list → editor on phones, with a Save bar pinned to the bottom.
 *
 * Props: market, header (element), templates, marketChip, copy
 * ({ onboardingTitle, onboardingBody, namePlaceholder, rulePlaceholder }),
 * uploadRoute (onboarding redirect after save), loadingState (element).
 */
export default function SetupBuilder({ market, header, templates, marketChip, copy, uploadRoute, loadingState }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const onboardingMode = searchParams?.get("onboarding") === "1";
  const { ready } = useRequireAuth();
  const [mounted, setMounted] = useState(false);
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  // Phones show one pane at a time; laptops ignore this.
  const [mobileView, setMobileView] = useState("list");
  const [showExamples, setShowExamples] = useState(false);
  const [focusRule, setFocusRule] = useState(null);
  // { [strategyId]: [{id, file, previewUrl}] }
  const [pendingByStrategy, setPendingByStrategy] = useState({});

  const totalPendingCount = Object.values(pendingByStrategy).reduce((s, a) => s + a.length, 0);
  const selected = strategies.find(s => s.id === selectedId) || strategies[0] || null;

  useEffect(() => {
    if (!ready) return;
    setMounted(true);
    const load = async () => {
      try {
        const serverStrategies = await fetchSetups(market);
        const local = Array.isArray(serverStrategies) ? toLocalStrategies(serverStrategies) : [];
        setStrategies(local);
        setSelectedId(local[0]?.id ?? null);
      } catch (e) {
        setError(e.message || "Failed to load setups");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [ready, market]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(pendingByStrategy).flat().forEach(p => {
        try { URL.revokeObjectURL(p.previewUrl); } catch {}
      });
    };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Focus a rule input right after it's added (or on Enter → next rule).
  useEffect(() => {
    if (!focusRule) return;
    const el = document.querySelector(`[data-rule="${focusRule.strategyId}-${focusRule.ruleId}"]`);
    if (el) el.focus();
    setFocusRule(null);
  }, [focusRule]);

  const edit = (updater) => {
    setDirty(true);
    setStrategies(updater);
  };

  // ── Strategy management ────────────────────────────────────────────────

  const openStrategy = (id) => {
    setSelectedId(id);
    setMobileView("editor");
    setShowExamples(false);
  };

  const nextStrategyId = () => (strategies[strategies.length - 1]?.id || 0) + 1;

  const addStrategy = () => {
    setError("");
    const id = nextStrategyId();
    edit(prev => [...prev, { id, name: "", rules: [{ id: 1, label: "" }], referenceImages: [] }]);
    openStrategy(id);
  };

  const addStarterTemplate = (template) => {
    setError("");
    const id = nextStrategyId();
    edit(prev => [...prev, {
      id,
      name: template.name,
      rules: template.rules.map((label, index) => ({ id: index + 1, label })),
      referenceImages: [],
    }]);
    openStrategy(id);
  };

  const updateStrategyName = (id, name) =>
    edit(prev => prev.map(s => s.id === id ? { ...s, name } : s));

  const deleteStrategy = (strategyId) => {
    const strategy = strategies.find(s => s.id === strategyId);
    const pending = pendingByStrategy[strategyId] || [];
    const hasContent = strategy && (
      strategy.rules.some(r => (r.label || "").trim()) ||
      strategy.referenceImages.length > 0 ||
      pending.length > 0
    );
    if (hasContent && !window.confirm(`Delete "${strategy.name.trim() || "Untitled setup"}"? This takes effect when you save.`)) return;

    pending.forEach(p => { try { URL.revokeObjectURL(p.previewUrl); } catch {} });
    setPendingByStrategy(prev => {
      const next = { ...prev };
      delete next[strategyId];
      return next;
    });
    const idx = strategies.findIndex(s => s.id === strategyId);
    const remaining = strategies.filter(s => s.id !== strategyId);
    edit(remaining);
    setSelectedId((remaining[idx] || remaining[idx - 1])?.id ?? null);
    setMobileView("list");
  };

  // ── Rule management ────────────────────────────────────────────────────

  const addRuleToStrategy = (strategyId) => {
    const strategy = strategies.find(s => s.id === strategyId);
    if (!strategy) return;
    const ruleId = (strategy.rules[strategy.rules.length - 1]?.id || 0) + 1;
    edit(prev => prev.map(s =>
      s.id !== strategyId ? s : { ...s, rules: [...s.rules, { id: ruleId, label: "" }] }
    ));
    setFocusRule({ strategyId, ruleId });
  };

  const updateRuleLabel = (strategyId, ruleId, label) =>
    edit(prev => prev.map(s =>
      s.id !== strategyId ? s : { ...s, rules: s.rules.map(r => r.id === ruleId ? { ...r, label } : r) }
    ));

  const deleteRule = (strategyId, ruleId) =>
    edit(prev => prev.map(s =>
      s.id !== strategyId ? s : { ...s, rules: s.rules.filter(r => r.id !== ruleId) }
    ));

  const handleRuleKeyDown = (e, strategy, rIdx) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const next = strategy.rules[rIdx + 1];
    if (next) setFocusRule({ strategyId: strategy.id, ruleId: next.id });
    else addRuleToStrategy(strategy.id);
  };

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
    setDirty(true);

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

  const removePendingImage = (strategyId, pendingId) => {
    setDirty(true);
    setPendingByStrategy(prev => {
      const arr = prev[strategyId] || [];
      const item = arr.find(p => p.id === pendingId);
      if (item) { try { URL.revokeObjectURL(item.previewUrl); } catch {} }
      return { ...prev, [strategyId]: arr.filter(p => p.id !== pendingId) };
    });
  };

  const removeReferenceImage = (strategyId, imageIdx) =>
    edit(prev => prev.map(s =>
      s.id !== strategyId ? s : {
        ...s,
        referenceImages: (s.referenceImages || []).filter((_, i) => i !== imageIdx),
      }
    ));

  const moveReferenceImage = (strategyId, idx, dir) =>
    edit(prev => prev.map(s => {
      if (s.id !== strategyId) return s;
      const imgs = [...s.referenceImages];
      const ni = idx + dir;
      if (ni < 0 || ni >= imgs.length) return s;
      [imgs[idx], imgs[ni]] = [imgs[ni], imgs[idx]];
      return { ...s, referenceImages: imgs };
    }));

  const movePendingImage = (strategyId, pendingId, dir) => {
    setDirty(true);
    setPendingByStrategy(prev => {
      const arr = [...(prev[strategyId] || [])];
      const idx = arr.findIndex(p => p.id === pendingId);
      if (idx < 0) return prev;
      const ni = idx + dir;
      if (ni < 0 || ni >= arr.length) return prev;
      [arr[idx], arr[ni]] = [arr[ni], arr[idx]];
      return { ...prev, [strategyId]: arr };
    });
  };

  // ── Validation (also drives the per-setup warning dot) ────────────────

  const strategyIssue = (s) => {
    const name = (s.name || "").trim();
    if (!name) {
      const hasContent = (s.rules || []).some(r => (r.label || "").trim()) ||
        (s.referenceImages || []).length > 0 ||
        (pendingByStrategy[s.id] || []).length > 0;
      return hasContent ? "Give this setup a name before saving." : null;
    }
    const dup = strategies.find(o => o.id !== s.id && (o.name || "").trim().toLowerCase() === name.toLowerCase());
    return dup ? `Another setup is already called "${dup.name.trim()}".` : null;
  };

  // ── Save (upload pending → save all) ──────────────────────────────────

  const handleSave = async () => {
    // Check the things the server will reject *before* uploading anything.
    // Uploading first and validating second left the rejected save's images
    // stranded on Cloudinary, referenced by nothing, on every retry.
    const named = strategies.filter(s => (s.name || "").trim());
    const seen = new Map();
    for (const s of named) {
      const key = s.name.trim().toLowerCase();
      if (seen.has(key)) {
        setError(`Duplicate strategy name "${s.name.trim()}" (matches "${seen.get(key)}")`);
        openStrategy(s.id);
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
      openStrategy(unnamedWithContent.id);
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
      const saved = await saveSetups(payload, market);
      await Promise.all(invalidateSetupDependentQueries(queryClient));

      // Push the edited rules down to the pre-trade notification, which keeps
      // its own copy and would otherwise keep showing the old ones.
      if (Array.isArray(saved)) {
        const local = toLocalStrategies(saved);
        // Server keeps the order, so the selected position survives the re-id.
        const selIdx = newStrategies.findIndex(s => s.id === selected?.id);
        setStrategies(local);
        setSelectedId(local[selIdx]?.id ?? local[0]?.id ?? null);
        await refreshChecklistNotificationFromSetups({ strategies: saved, market });
      }
      setSavedAt(new Date());
      setDirty(false);

      // Mark onboarding step done if any non-empty strategy was saved.
      const hasNamedStrategy = payload.some(p => (p.name || "").trim().length > 0);
      if (hasNamedStrategy) {
        markOnboardingStep("setupAdded", true).catch(() => {});
        if (onboardingMode && uploadRoute) {
          setTimeout(() => router.push(uploadRoute), 600);
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

  // ── Render pieces ──────────────────────────────────────────────────────

  const templateCards = (
    <div className="sp-template-grid">
      {templates.map(template => (
        <button key={template.name} type="button" className="sp-template-card" onClick={() => addStarterTemplate(template)}>
          <div className="sp-template-name">{template.name}</div>
          <div className="sp-template-desc">{template.description}</div>
          <div className="sp-template-action">Use this example <ChevronRight size={12} strokeWidth={2.6} /></div>
        </button>
      ))}
    </div>
  );

  const renderEditor = (strategy) => {
    const uploadedImgs = strategy.referenceImages || [];
    const pendingImgs = pendingByStrategy[strategy.id] || [];
    const totalImgs = uploadedImgs.length + pendingImgs.length;
    const issue = strategyIssue(strategy);

    return (
      <section className="sp-editor" aria-label="Edit setup">
        <button type="button" className="sp-back" onClick={() => setMobileView("list")}>
          <ArrowLeft size={16} strokeWidth={2.4} /> All setups
        </button>

        <div className="sp-editor-head">
          <div className="sp-editor-name">
            <label className="sp-field-label" htmlFor={`sp-name-${strategy.id}`}>Setup name</label>
            <input
              id={`sp-name-${strategy.id}`}
              type="text"
              className="sp-name-input"
              value={strategy.name}
              onChange={e => updateStrategyName(strategy.id, e.target.value)}
              placeholder={copy.namePlaceholder}
              autoComplete="off"
            />
          </div>
          <button
            type="button"
            className="sp-icon-btn sp-icon-btn--danger"
            onClick={() => deleteStrategy(strategy.id)}
            aria-label="Delete setup"
            title="Delete setup"
          >
            <Trash2 size={17} strokeWidth={2.2} />
          </button>
        </div>
        {issue && <div className="sp-inline-issue">{issue}</div>}

        <div className="sp-block">
          <div className="sp-block-head">
            <div>
              <div className="sp-block-title">Rules checklist</div>
              <div className="sp-block-sub">What must be true before you enter? Press Enter for the next rule.</div>
            </div>
          </div>

          {strategy.rules.length === 0 && (
            <div className="sp-no-rules">No rules yet. Add the first thing you check before entering.</div>
          )}
          {strategy.rules.map((rule, rIdx) => (
            <div key={rule.id} className="sp-rule-row">
              <div className="sp-rule-num">{rIdx + 1}</div>
              <input
                type="text"
                className="sp-rule-input"
                data-rule={`${strategy.id}-${rule.id}`}
                value={rule.label}
                onChange={e => updateRuleLabel(strategy.id, rule.id, e.target.value)}
                onKeyDown={e => handleRuleKeyDown(e, strategy, rIdx)}
                placeholder={copy.rulePlaceholder}
                enterKeyHint="next"
              />
              <button type="button" className="sp-rule-del" aria-label={`Delete rule ${rIdx + 1}`} onClick={() => deleteRule(strategy.id, rule.id)}>
                <X size={16} strokeWidth={2.4} />
              </button>
            </div>
          ))}
          <button type="button" className="sp-btn-add-rule" onClick={() => addRuleToStrategy(strategy.id)}>
            <Plus size={15} strokeWidth={2.6} /> Add rule
          </button>
        </div>

        <div className="sp-block">
          <div className="sp-block-head">
            <div>
              <div className="sp-block-title">Reference screenshots <span className="sp-optional">optional</span></div>
              <div className="sp-block-sub">Charts of this setup done right, to compare against later.</div>
            </div>
            {totalImgs > 0 && <span className="sp-images-count">{totalImgs}/{MAX_IMAGES}</span>}
          </div>

          <div className="sp-images-grid">
            {uploadedImgs.map((img, imgIdx) => (
              <div key={`up-${imgIdx}`} className="sp-img-card">
                <img src={img.url} alt={`Reference ${imgIdx + 1}`} />
                <button type="button" className="sp-img-remove" aria-label="Remove image" onClick={() => removeReferenceImage(strategy.id, imgIdx)}>
                  <X size={13} strokeWidth={3} />
                </button>
                {uploadedImgs.length > 1 && (
                  <div className="sp-img-move-row">
                    {imgIdx > 0 && (
                      <button type="button" className="sp-img-move-btn" aria-label="Move left" onClick={() => moveReferenceImage(strategy.id, imgIdx, -1)}>‹</button>
                    )}
                    {imgIdx < uploadedImgs.length - 1 && (
                      <button type="button" className="sp-img-move-btn" aria-label="Move right" onClick={() => moveReferenceImage(strategy.id, imgIdx, 1)}>›</button>
                    )}
                  </div>
                )}
              </div>
            ))}

            {pendingImgs.map((pending, pIdx) => (
              <div key={pending.id} className="sp-img-card sp-img-card--pending">
                <img src={pending.previewUrl} alt={`New image ${pIdx + 1}`} />
                <div className="sp-img-new-badge">NEW</div>
                <button type="button" className="sp-img-remove" aria-label="Remove image" onClick={() => removePendingImage(strategy.id, pending.id)}>
                  <X size={13} strokeWidth={3} />
                </button>
                {pendingImgs.length > 1 && (
                  <div className="sp-img-move-row">
                    {pIdx > 0 && (
                      <button type="button" className="sp-img-move-btn" aria-label="Move left" onClick={() => movePendingImage(strategy.id, pending.id, -1)}>‹</button>
                    )}
                    {pIdx < pendingImgs.length - 1 && (
                      <button type="button" className="sp-img-move-btn" aria-label="Move right" onClick={() => movePendingImage(strategy.id, pending.id, 1)}>›</button>
                    )}
                  </div>
                )}
              </div>
            ))}

            {totalImgs < MAX_IMAGES && (
              <label className="sp-img-add-btn">
                <ImagePlus size={18} strokeWidth={2} />
                {totalImgs === 0 ? "Add images" : "Add more"}
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
            <div className="sp-img-pending-hint">
              {pendingImgs.length} image{pendingImgs.length > 1 ? "s" : ""} will upload when you save.
            </div>
          )}
        </div>
      </section>
    );
  };

  const saveLabel = saving
    ? (uploadStatus ? `Uploading ${uploadStatus.uploaded}/${uploadStatus.total}…` : "Saving…")
    : totalPendingCount > 0
      ? `Upload & save (${totalPendingCount})`
      : "Save setups";

  let status;
  if (error) status = <span className="sp-status sp-status--error">{error}</span>;
  else if (saving) status = <span className="sp-status">Saving your setups…</span>;
  else if (dirty) status = <span className="sp-status sp-status--dirty"><span className="sp-dot" />Unsaved changes</span>;
  else if (savedAt) status = <span className="sp-status sp-status--ok">Saved at {savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>;
  else status = <span className="sp-status">All changes saved</span>;

  return (
    <div className="sp-root">
      <style>{`
        .sp-root { --sp-green: #0D9E6E; --sp-green-soft: #EEF9F4; --sp-green-line: #C6EEE0; --sp-ink: #0F1923; --sp-muted: #64748B; --sp-faint: #94A3B8; --sp-line: #E2E8F0; --sp-bg: #F4F6F9; --sp-card: #FFFFFF; --sp-danger: #DC2626; --sp-nav-h: 0px;
          min-height: 100vh; background: var(--sp-bg); font-family: 'Inter', sans-serif; color: var(--sp-ink); display: flex; flex-direction: column; }
        .sp-root *, .sp-root *::before, .sp-root *::after { box-sizing: border-box; }

        .sp-titlebar { max-width: 1120px; width: 100%; margin: 0 auto; padding: 18px 20px 4px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .sp-page-title { font-size: 20px; font-weight: 800; letter-spacing: -0.01em; }
        .sp-market-chip { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 999px; background: var(--sp-green-soft); border: 1px solid var(--sp-green-line); font-size: var(--fs-2xs); font-family: 'JetBrains Mono', monospace; color: var(--sp-green); font-weight: 700; letter-spacing: 0.06em; }
        .sp-page-sub { flex-basis: 100%; font-size: 13px; color: var(--sp-muted); }

        .sp-main { flex: 1; max-width: 1120px; width: 100%; margin: 0 auto; padding: 14px 20px 24px; }
        .sp-onboarding { margin-bottom: 14px; padding: 14px 16px; border-radius: 14px; background: linear-gradient(135deg, rgba(34,199,142,0.10), rgba(14,165,233,0.05)); border: 1px solid rgba(13,158,110,0.28); }
        .sp-onboarding-kicker { font-size: var(--fs-2xs); font-weight: 800; letter-spacing: 0.12em; color: var(--sp-green); font-family: 'JetBrains Mono', monospace; margin-bottom: 4px; }
        .sp-onboarding-title { font-size: 15px; font-weight: 800; margin-bottom: 3px; }
        .sp-onboarding-copy { font-size: 13px; color: #475569; line-height: 1.55; }

        .sp-layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 18px; align-items: start; }
        .sp-panel { background: var(--sp-card); border: 1px solid var(--sp-line); border-radius: 16px; box-shadow: 0 1px 4px rgba(15,25,35,0.04); }

        .sp-list { position: sticky; top: 16px; padding: 10px; }
        .sp-list-head { display: flex; align-items: baseline; justify-content: space-between; padding: 6px 8px 10px; }
        .sp-list-title { font-size: 12px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--sp-muted); }
        .sp-list-count { font-size: 12px; color: var(--sp-faint); font-family: 'JetBrains Mono', monospace; }
        .sp-list-item { width: 100%; display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 8px 10px; border-radius: 10px; border: 1px solid transparent; background: transparent; text-align: left; cursor: pointer; font-family: inherit; color: inherit; }
        .sp-list-item:hover { background: #F8FAFB; }
        .sp-list-item.is-active { background: var(--sp-green-soft); border-color: var(--sp-green-line); }
        .sp-list-text { flex: 1; min-width: 0; }
        .sp-list-name { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .sp-list-name.is-empty { color: var(--sp-faint); font-weight: 600; }
        .sp-list-meta { font-size: 12px; color: var(--sp-muted); margin-top: 2px; }
        .sp-list-warn { width: 8px; height: 8px; border-radius: 50%; background: #F59E0B; flex-shrink: 0; }
        .sp-list-chev { color: var(--sp-faint); flex-shrink: 0; display: none; }
        .sp-list-actions { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; padding-top: 10px; border-top: 1px solid #F1F4F8; }
        .sp-btn-new { height: 44px; border-radius: 10px; border: 1.5px dashed var(--sp-green); background: transparent; color: var(--sp-green); font-size: 14px; font-weight: 700; font-family: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; }
        .sp-btn-new:hover { background: var(--sp-green-soft); }
        .sp-btn-link { height: 38px; border: none; background: transparent; color: var(--sp-muted); font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer; border-radius: 10px; }
        .sp-btn-link:hover { background: #F8FAFB; color: var(--sp-ink); }
        .sp-examples-mini { display: flex; flex-direction: column; gap: 4px; }
        .sp-example-mini { text-align: left; padding: 10px; border-radius: 10px; border: 1px solid var(--sp-line); background: #F8FAFB; font-family: inherit; cursor: pointer; font-size: 13px; font-weight: 700; color: var(--sp-ink); }
        .sp-example-mini:hover { border-color: var(--sp-green); background: var(--sp-green-soft); }
        .sp-example-mini span { display: block; font-size: 12px; font-weight: 500; color: var(--sp-muted); margin-top: 2px; line-height: 1.4; }

        .sp-editor { padding: 20px 22px 22px; }
        .sp-back { display: none; align-items: center; gap: 6px; height: 40px; padding: 0 12px 0 8px; margin: -6px 0 10px -6px; border: none; background: transparent; color: var(--sp-muted); font-size: 14px; font-weight: 700; font-family: inherit; cursor: pointer; border-radius: 10px; }
        .sp-editor-head { display: flex; align-items: flex-end; gap: 12px; }
        .sp-editor-name { flex: 1; min-width: 0; }
        .sp-field-label { display: block; font-size: 12px; font-weight: 700; color: var(--sp-muted); margin-bottom: 6px; }
        .sp-name-input { width: 100%; height: 48px; border: 1px solid var(--sp-line); border-radius: 12px; padding: 0 14px; font-size: 17px; font-weight: 700; font-family: inherit; color: var(--sp-ink); background: #F8FAFB; outline: none; }
        .sp-name-input:focus { border-color: var(--sp-green); background: #FFFFFF; box-shadow: 0 0 0 3px rgba(13,158,110,0.12); }
        .sp-icon-btn { width: 48px; height: 48px; flex-shrink: 0; border-radius: 12px; border: 1px solid var(--sp-line); background: #FFFFFF; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--sp-muted); }
        .sp-icon-btn--danger:hover { color: var(--sp-danger); border-color: #FECACA; background: #FEF2F2; }
        .sp-inline-issue { margin-top: 8px; font-size: 13px; color: #B45309; }

        .sp-block { margin-top: 22px; }
        .sp-block-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
        .sp-block-title { font-size: 15px; font-weight: 800; }
        .sp-optional { font-size: 12px; font-weight: 500; color: var(--sp-faint); margin-left: 4px; }
        .sp-block-sub { font-size: 13px; color: var(--sp-muted); margin-top: 2px; line-height: 1.45; }

        .sp-rule-row { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 4px 4px 4px 10px; border-radius: 12px; border: 1px solid var(--sp-line); background: #FAFBFC; margin-bottom: 8px; }
        .sp-rule-row:focus-within { border-color: var(--sp-green); background: #FFFFFF; box-shadow: 0 0 0 3px rgba(13,158,110,0.10); }
        .sp-rule-num { width: 26px; height: 26px; border-radius: 8px; background: #E8ECF0; display: flex; align-items: center; justify-content: center; font-size: 12px; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: var(--sp-muted); flex-shrink: 0; }
        .sp-rule-input { flex: 1; min-width: 0; height: 38px; min-height: 0; padding: 0 2px; border: none; outline: none; background: transparent; font-size: 15px; font-family: inherit; color: var(--sp-ink); }
        .sp-rule-input::placeholder { color: #A0AEC0; }
        .sp-rule-del { width: 40px; height: 40px; border-radius: 10px; border: none; background: transparent; color: var(--sp-faint); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .sp-rule-del:hover { color: var(--sp-danger); background: #FEF2F2; }
        .sp-no-rules { font-size: 13px; color: var(--sp-faint); padding: 6px 0 12px; }
        .sp-btn-add-rule { height: 44px; padding: 0 16px; border-radius: 12px; border: 1px solid var(--sp-green-line); background: var(--sp-green-soft); color: var(--sp-green); font-size: 14px; font-weight: 700; font-family: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
        .sp-btn-add-rule:hover { background: #D5F5E9; }

        .sp-images-count { font-size: 12px; font-family: 'JetBrains Mono', monospace; color: var(--sp-faint); flex-shrink: 0; }
        .sp-images-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
        .sp-img-card { position: relative; aspect-ratio: 4 / 3; }
        .sp-img-card img { width: 100%; height: 100%; object-fit: cover; border-radius: 12px; display: block; border: 1px solid var(--sp-line); }
        .sp-img-card--pending img { border: 2px dashed var(--sp-green); }
        .sp-img-remove { position: absolute; top: 6px; right: 6px; width: 30px; height: 30px; border-radius: 50%; border: none; background: rgba(15,25,35,0.72); color: #FFFFFF; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .sp-img-remove:hover { background: var(--sp-danger); }
        .sp-img-move-row { position: absolute; bottom: 6px; left: 0; right: 0; display: flex; justify-content: center; gap: 6px; }
        .sp-img-move-btn { width: 32px; height: 28px; border-radius: 8px; border: none; background: rgba(15,25,35,0.65); color: #FFFFFF; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1; }
        .sp-img-move-btn:hover { background: rgba(13,158,110,0.9); }
        .sp-img-new-badge { position: absolute; top: 8px; left: 8px; background: var(--sp-green); color: #FFFFFF; font-size: var(--fs-2xs); font-weight: 800; padding: 2px 6px; border-radius: 5px; letter-spacing: 0.08em; font-family: 'JetBrains Mono', monospace; }
        .sp-img-add-btn { aspect-ratio: 4 / 3; border-radius: 12px; border: 1.5px dashed #CBD5E0; background: #F8FAFB; color: var(--sp-muted); font-size: 13px; font-weight: 600; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; }
        .sp-img-add-btn:hover { border-color: var(--sp-green); background: var(--sp-green-soft); color: var(--sp-green); }
        .sp-img-pending-hint { font-size: 13px; color: var(--sp-green); margin-top: 8px; font-weight: 500; }

        .sp-empty { padding: 28px 24px; }
        .sp-empty-title { font-size: 18px; font-weight: 800; margin-bottom: 4px; }
        .sp-empty-sub { font-size: 14px; color: var(--sp-muted); line-height: 1.55; margin-bottom: 18px; max-width: 560px; }
        .sp-template-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
        .sp-template-card { padding: 14px; border-radius: 12px; border: 1px solid var(--sp-line); background: #F8FAFB; text-align: left; cursor: pointer; font-family: inherit; display: flex; flex-direction: column; }
        .sp-template-card:hover { border-color: var(--sp-green); background: var(--sp-green-soft); }
        .sp-template-name { font-size: 14px; font-weight: 800; color: var(--sp-ink); margin-bottom: 4px; }
        .sp-template-desc { font-size: 13px; color: var(--sp-muted); line-height: 1.45; margin-bottom: 12px; flex: 1; }
        .sp-template-action { font-size: 12px; font-weight: 800; color: var(--sp-green); display: inline-flex; align-items: center; gap: 2px; }
        .sp-empty-or { display: flex; align-items: center; gap: 10px; margin: 18px 0 12px; font-size: 12px; color: var(--sp-faint); }
        .sp-empty-or::before, .sp-empty-or::after { content: ""; flex: 1; height: 1px; background: var(--sp-line); }
        .sp-empty .sp-btn-new { width: 100%; max-width: 260px; margin: 0 auto; }

        .sp-skel { padding: 18px; }

        .sp-savebar { position: sticky; bottom: var(--sp-nav-h); z-index: 40; background: rgba(255,255,255,0.97); border-top: 1px solid var(--sp-line); box-shadow: 0 -4px 16px rgba(15,25,35,0.06); }
        .sp-savebar-inner { max-width: 1120px; margin: 0 auto; padding: 10px 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .sp-status { font-size: 13px; color: var(--sp-muted); display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
        .sp-status--dirty { color: #B45309; font-weight: 600; }
        .sp-status--ok { color: #16A34A; font-weight: 600; }
        .sp-status--error { color: var(--sp-danger); font-weight: 600; }
        .sp-dot { width: 8px; height: 8px; border-radius: 50%; background: #F59E0B; flex-shrink: 0; }
        .sp-btn-save { height: 46px; min-width: 170px; padding: 0 22px; border-radius: 12px; border: none; background: linear-gradient(135deg, #0D9E6E, #0BB866); color: #FFFFFF; font-size: 15px; font-weight: 700; font-family: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 12px rgba(13,158,110,0.25); flex-shrink: 0; }
        .sp-btn-save:disabled { opacity: 0.6; cursor: default; box-shadow: none; }
        .sp-spin { animation: sp-spin 1s linear infinite; }
        @keyframes sp-spin { to { transform: rotate(360deg); } }

        /* Keep the button clear of the bottom-right Help bubble (SupportWidget). */
        @media (max-width: 1340px) { .sp-savebar-inner { padding-right: 96px; } }
        @media (max-width: 899px) {
          .sp-layout { grid-template-columns: minmax(0, 1fr); }
          .sp-layout.is-list .sp-editor-pane { display: none; }
          .sp-layout.is-editor .sp-list { display: none; }
          .sp-list { position: static; }
          .sp-list-chev { display: block; }
          .sp-list-item.is-active { background: transparent; border-color: transparent; }
          .sp-back { display: inline-flex; }
          .sp-template-grid { grid-template-columns: minmax(0, 1fr); }
        }
        @media (max-width: 768px) {
          /* Sit above the fixed MobileBottomNav (68px + safe area). */
          .sp-root { --sp-nav-h: calc(68px + env(safe-area-inset-bottom, 0px)); }
          html[data-keyboard-open] .sp-root { --sp-nav-h: 0px; }
        }
        @media (max-width: 600px) {
          .sp-titlebar { padding: 14px 16px 2px; }
          .sp-page-title { font-size: 18px; }
          .sp-main { padding: 12px 16px 20px; }
          .sp-editor { padding: 16px; }
          .sp-empty { padding: 20px 16px; }
          .sp-images-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .sp-savebar-inner { padding: 10px 80px 10px 16px; flex-direction: column; align-items: stretch; gap: 6px; }
          .sp-status { justify-content: center; font-size: 12px; }
          .sp-btn-save { width: 100%; }
        }
      `}</style>

      {header}

      <div className="sp-titlebar">
        <h1 className="sp-page-title">Your setups</h1>
        {marketChip && <span className="sp-market-chip">{marketChip}</span>}
        <div className="sp-page-sub">A setup is the pattern you wait for. Its rules are the checklist you confirm before every entry.</div>
      </div>

      <main className="sp-main">
        {onboardingMode && (
          <div className="sp-onboarding">
            <div className="sp-onboarding-kicker">ONBOARDING · STEP 1 OF 3</div>
            <div className="sp-onboarding-title">{copy.onboardingTitle}</div>
            <div className="sp-onboarding-copy">{copy.onboardingBody}</div>
          </div>
        )}

        {loading ? (
          loadingState || <div className="sp-panel sp-skel">Loading setups…</div>
        ) : strategies.length === 0 ? (
          <div className="sp-panel sp-empty">
            <div className="sp-empty-title">Create your first setup</div>
            <div className="sp-empty-sub">Start from an example and edit it to match how you really trade, or build one from scratch.</div>
            {templateCards}
            <div className="sp-empty-or">or</div>
            <button type="button" className="sp-btn-new" onClick={addStrategy}>
              <Plus size={16} strokeWidth={2.6} /> Start from scratch
            </button>
          </div>
        ) : (
          <div className={`sp-layout ${mobileView === "editor" ? "is-editor" : "is-list"}`}>
            <nav className="sp-panel sp-list" aria-label="Setups">
              <div className="sp-list-head">
                <span className="sp-list-title">Setups</span>
                <span className="sp-list-count">{strategies.length}</span>
              </div>
              {strategies.map(s => {
                const filled = s.rules.filter(r => (r.label || "").trim()).length;
                const imgs = (s.referenceImages || []).length + (pendingByStrategy[s.id] || []).length;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`sp-list-item${selected?.id === s.id ? " is-active" : ""}`}
                    onClick={() => openStrategy(s.id)}
                    aria-current={selected?.id === s.id ? "true" : undefined}
                  >
                    <div className="sp-list-text">
                      <div className={`sp-list-name${s.name.trim() ? "" : " is-empty"}`}>{s.name.trim() || "Untitled setup"}</div>
                      <div className="sp-list-meta">
                        {filled} {filled === 1 ? "rule" : "rules"}{imgs > 0 ? ` · ${imgs} image${imgs > 1 ? "s" : ""}` : ""}
                      </div>
                    </div>
                    {strategyIssue(s) && <span className="sp-list-warn" title={strategyIssue(s)} />}
                    <ChevronRight className="sp-list-chev" size={18} strokeWidth={2.2} />
                  </button>
                );
              })}
              <div className="sp-list-actions">
                <button type="button" className="sp-btn-new" onClick={addStrategy}>
                  <Plus size={16} strokeWidth={2.6} /> New setup
                </button>
                <button type="button" className="sp-btn-link" onClick={() => setShowExamples(v => !v)} aria-expanded={showExamples}>
                  {showExamples ? "Hide examples" : "Start from an example"}
                </button>
                {showExamples && (
                  <div className="sp-examples-mini">
                    {templates.map(t => (
                      <button key={t.name} type="button" className="sp-example-mini" onClick={() => addStarterTemplate(t)}>
                        {t.name}
                        <span>{t.description}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </nav>

            <div className="sp-panel sp-editor-pane">
              {selected && renderEditor(selected)}
            </div>
          </div>
        )}
      </main>

      {!loading && (
        <div className="sp-savebar">
          <div className="sp-savebar-inner">
            {status}
            <button type="button" className="sp-btn-save" onClick={handleSave} disabled={saving}>
              {saving
                ? <Loader2 size={16} strokeWidth={2.4} className="sp-spin" />
                : <Save size={16} strokeWidth={2.4} />}
              {saveLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
