"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown, ArrowLeft, ArrowUp, ChevronLeft, ChevronRight, Copy, ImagePlus, ListChecks, Plus, Save, Trash2, X,
} from "lucide-react";
import { genId } from "@/utils/genId";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import { fetchSetups, saveSetups, uploadSetupReferenceImages } from "@/services/setupApi";
import { markOnboardingStep } from "@/services/api";
import { invalidateSetupDependentQueries } from "@/utils/queryInvalidation";
import { refreshChecklistNotificationFromSetups } from "@/services/checklistNotificationSync";
import PageHeader from "@/features/shared/components/PageHeader";
import { Button, Card, Placeholder, ResponsiveModal } from "@/features/shared/components/ui";
import { ImageLightbox } from "@/features/checklist/components/ChecklistParts";
import { useTheme } from "@/utils/theme";
import { useSystemBars } from "@/features/shared/hooks/useSystemBars";

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
 * Props: market, templates, marketChip, copy
 * ({ onboardingTitle, onboardingBody, namePlaceholder, rulePlaceholder }),
 * uploadRoute (onboarding redirect after save).
 */
export default function SetupBuilder({ market, templates, marketChip, copy, uploadRoute }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const onboardingMode = searchParams?.get("onboarding") === "1";
  const { ready } = useRequireAuth();
  const { theme } = useTheme();
  useSystemBars(theme);
  const [mounted, setMounted] = useState(false);
  // Setup awaiting delete confirmation (replaces window.confirm).
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const closePreview = useCallback(() => setPreviewUrl(""), []);
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

  // Highest id + 1, not "last + 1": rules can be reordered, so the last item
  // is not necessarily the highest, and a reused id would make two rows edit
  // as one.
  const nextId = (items) => items.reduce((max, it) => Math.max(max, Number(it.id) || 0), 0) + 1;
  const nextStrategyId = () => nextId(strategies);

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

  // Asks first when the setup has anything in it; an empty one goes at once.
  const requestDeleteStrategy = (strategyId) => {
    const strategy = strategies.find(s => s.id === strategyId);
    const pending = pendingByStrategy[strategyId] || [];
    const hasContent = strategy && (
      strategy.rules.some(r => (r.label || "").trim()) ||
      strategy.referenceImages.length > 0 ||
      pending.length > 0
    );
    if (hasContent) setConfirmDelete(strategy);
    else deleteStrategy(strategyId);
  };

  const deleteStrategy = (strategyId) => {
    setConfirmDelete(null);
    const pending = pendingByStrategy[strategyId] || [];
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

  // Copy of a setup (rules + already-uploaded images), as a new unsaved setup.
  const duplicateStrategy = (strategyId) => {
    const src = strategies.find(s => s.id === strategyId);
    if (!src) return;
    setError("");
    // "X (copy 2)" rather than "X (copy) (copy)" when duplicating a copy.
    const base = ((src.name || "").trim() || "Untitled setup").replace(/ \(copy(?: \d+)?\)$/, "");
    const taken = new Set(strategies.map(s => (s.name || "").trim().toLowerCase()));
    let name = `${base} (copy)`;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (copy ${n})`;
    const id = nextStrategyId();
    edit(prev => [...prev, {
      id,
      name,
      rules: src.rules.map((r, i) => ({ id: i + 1, label: r.label })),
      referenceImages: [...(src.referenceImages || [])],
    }]);
    openStrategy(id);
  };

  // ── Rule management ────────────────────────────────────────────────────

  const addRuleToStrategy = (strategyId) => {
    const strategy = strategies.find(s => s.id === strategyId);
    if (!strategy) return;
    const ruleId = nextId(strategy.rules);
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

  // Order matters: the checklist shows rules in this order.
  const moveRule = (strategyId, ruleIdx, dir) =>
    edit(prev => prev.map(s => {
      if (s.id !== strategyId) return s;
      const rules = [...s.rules];
      const ni = ruleIdx + dir;
      if (ni < 0 || ni >= rules.length) return s;
      [rules[ruleIdx], rules[ni]] = [rules[ni], rules[ruleIdx]];
      return { ...s, rules };
    }));

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

  const templateCards = (compact) => (
    <div className={compact ? "ec-setup__examples" : "ec-setup__templates"}>
      {templates.map(template => (
        <button key={template.name} type="button" className="ec-setup__template ec-focusable" onClick={() => addStarterTemplate(template)}>
          <span className="ec-setup__template-name">{template.name}</span>
          <span className="ec-setup__template-desc">{template.description}</span>
          {!compact && (
            <span className="ec-setup__template-meta">
              {template.rules.length} rules <ChevronRight size={14} aria-hidden="true" />
            </span>
          )}
        </button>
      ))}
    </div>
  );

  const renderEditor = (strategy) => {
    const uploadedImgs = strategy.referenceImages || [];
    const pendingImgs = pendingByStrategy[strategy.id] || [];
    const totalImgs = uploadedImgs.length + pendingImgs.length;
    const issue = strategyIssue(strategy);
    const filled = strategy.rules.filter(r => (r.label || "").trim()).length;

    return (
      <section className="ec-setup__editor" aria-label="Edit setup">
        <button type="button" className="ec-setup__back ec-focusable" onClick={() => setMobileView("list")}>
          <ChevronLeft size={18} aria-hidden="true" /> All setups
        </button>

        <div className="ec-setup__name-row">
          <div className="ec-field" style={{ flex: 1, minWidth: 0 }}>
            <label className="ec-field__label" htmlFor={`sp-name-${strategy.id}`}>Setup name</label>
            <input
              id={`sp-name-${strategy.id}`}
              type="text"
              className="ec-input ec-setup__name-input"
              value={strategy.name}
              onChange={e => updateStrategyName(strategy.id, e.target.value)}
              placeholder={copy.namePlaceholder}
              autoComplete="off"
              aria-invalid={issue ? true : undefined}
            />
          </div>
          <div className="ec-setup__head-actions">
            <button type="button" className="ec-setup__icon-btn ec-focusable" onClick={() => duplicateStrategy(strategy.id)} aria-label="Duplicate setup" title="Duplicate setup">
              <Copy size={17} />
            </button>
            <button type="button" className="ec-setup__icon-btn ec-setup__icon-btn--danger ec-focusable" onClick={() => requestDeleteStrategy(strategy.id)} aria-label="Delete setup" title="Delete setup">
              <Trash2 size={17} />
            </button>
          </div>
        </div>
        {issue && <p className="ec-field__error" role="alert" style={{ marginTop: 6 }}>{issue}</p>}

        <div className="ec-setup__block">
          <div className="ec-setup__block-head">
            <div>
              <h3 className="ec-setup__block-title">Rules</h3>
              <p className="ec-setup__block-sub">What must be true before you enter? These become your pre-trade checklist, in this order. Press Enter for the next rule.</p>
            </div>
            {filled > 0 && <span className="ec-setup__count">{filled}</span>}
          </div>

          {strategy.rules.length === 0 && (
            <p className="ec-setup__empty-rules">No rules yet. Add the first thing you check before entering.</p>
          )}
          <ol className="ec-setup__rules">
            {strategy.rules.map((rule, rIdx) => (
              <li key={rule.id} className="ec-setup__rule">
                <span className="ec-setup__rule-num" aria-hidden="true">{rIdx + 1}</span>
                <input
                  type="text"
                  className="ec-setup__rule-input"
                  data-rule={`${strategy.id}-${rule.id}`}
                  value={rule.label}
                  onChange={e => updateRuleLabel(strategy.id, rule.id, e.target.value)}
                  onKeyDown={e => handleRuleKeyDown(e, strategy, rIdx)}
                  placeholder={copy.rulePlaceholder}
                  aria-label={`Rule ${rIdx + 1}`}
                  enterKeyHint="next"
                />
                <span className="ec-setup__rule-tools">
                  <button type="button" className="ec-setup__rule-btn ec-focusable" aria-label={`Move rule ${rIdx + 1} up`} disabled={rIdx === 0} onClick={() => moveRule(strategy.id, rIdx, -1)}>
                    <ArrowUp size={15} />
                  </button>
                  <button type="button" className="ec-setup__rule-btn ec-focusable" aria-label={`Move rule ${rIdx + 1} down`} disabled={rIdx === strategy.rules.length - 1} onClick={() => moveRule(strategy.id, rIdx, 1)}>
                    <ArrowDown size={15} />
                  </button>
                  <button type="button" className="ec-setup__rule-btn ec-setup__rule-btn--danger ec-focusable" aria-label={`Delete rule ${rIdx + 1}`} onClick={() => deleteRule(strategy.id, rule.id)}>
                    <X size={16} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
          <Button variant="secondary" size="sm" icon={<Plus size={15} />} onClick={() => addRuleToStrategy(strategy.id)}>Add rule</Button>
        </div>

        <div className="ec-setup__block">
          <div className="ec-setup__block-head">
            <div>
              <h3 className="ec-setup__block-title">Reference charts <span className="ec-setup__optional">optional</span></h3>
              <p className="ec-setup__block-sub">Screenshots of this setup done right. The checklist shows them so you can compare the live chart.</p>
            </div>
            {totalImgs > 0 && <span className="ec-setup__count">{totalImgs}/{MAX_IMAGES}</span>}
          </div>

          <div className="ec-setup__images">
            {uploadedImgs.map((img, imgIdx) => (
              <div key={`up-${imgIdx}`} className="ec-setup__img">
                <button type="button" className="ec-setup__img-open" onClick={() => setPreviewUrl(img.url)} aria-label={`Open reference ${imgIdx + 1}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="" />
                </button>
                <button type="button" className="ec-setup__img-remove" aria-label="Remove image" onClick={() => removeReferenceImage(strategy.id, imgIdx)}>
                  <X size={13} strokeWidth={3} />
                </button>
                {uploadedImgs.length > 1 && (
                  <div className="ec-setup__img-move">
                    <button type="button" aria-label="Move left" disabled={imgIdx === 0} onClick={() => moveReferenceImage(strategy.id, imgIdx, -1)}><ArrowLeft size={14} /></button>
                    <button type="button" aria-label="Move right" disabled={imgIdx === uploadedImgs.length - 1} onClick={() => moveReferenceImage(strategy.id, imgIdx, 1)}><ArrowLeft size={14} style={{ transform: "rotate(180deg)" }} /></button>
                  </div>
                )}
              </div>
            ))}

            {pendingImgs.map((pending, pIdx) => (
              <div key={pending.id} className="ec-setup__img is-pending">
                <button type="button" className="ec-setup__img-open" onClick={() => setPreviewUrl(pending.previewUrl)} aria-label={`Open new image ${pIdx + 1}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pending.previewUrl} alt="" />
                </button>
                <span className="ec-setup__img-badge">New</span>
                <button type="button" className="ec-setup__img-remove" aria-label="Remove image" onClick={() => removePendingImage(strategy.id, pending.id)}>
                  <X size={13} strokeWidth={3} />
                </button>
                {pendingImgs.length > 1 && (
                  <div className="ec-setup__img-move">
                    <button type="button" aria-label="Move left" disabled={pIdx === 0} onClick={() => movePendingImage(strategy.id, pending.id, -1)}><ArrowLeft size={14} /></button>
                    <button type="button" aria-label="Move right" disabled={pIdx === pendingImgs.length - 1} onClick={() => movePendingImage(strategy.id, pending.id, 1)}><ArrowLeft size={14} style={{ transform: "rotate(180deg)" }} /></button>
                  </div>
                )}
              </div>
            ))}

            {totalImgs < MAX_IMAGES && (
              <label className="ec-setup__img-add ec-focusable">
                <ImagePlus size={20} aria-hidden="true" />
                {totalImgs === 0 ? "Add images" : "Add more"}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="ec-sr"
                  onChange={e => {
                    handleFilesSelected(strategy.id, e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>

          {pendingImgs.length > 0 && (
            <p className="ec-setup__pending-hint">
              {pendingImgs.length} image{pendingImgs.length > 1 ? "s" : ""} will upload when you save.
            </p>
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
  if (error) status = <span className="ec-remind__status is-error" role="alert">{error}</span>;
  else if (saving) status = <span className="ec-remind__status">Saving your setups…</span>;
  else if (dirty) status = <span className="ec-remind__status is-dirty"><span className="ec-remind__dot" />Unsaved changes</span>;
  else if (savedAt) status = <span className="ec-remind__status is-ok">Saved at {savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>;
  else status = <span className="ec-remind__status">All changes saved</span>;

  return (
    <div className="ec-app ec-home">
      <PageHeader themed showMarketSwitcher title="Setups" />
      <main className="ec-page ec-setup">
        <div className="ec-setup__head">
          <div style={{ minWidth: 0 }}>
            <h1 className="ec-setup__title">Your setups</h1>
            <p className="ec-setup__sub">
              A setup is the pattern you wait for. Its rules become the checklist you confirm before every entry.
              {marketChip ? ` · ${marketChip}` : ""}
            </p>
          </div>
          {strategies.length > 0 && (
            <Button as={Link} href="/checklist" variant="secondary" size="sm" icon={<ListChecks size={16} />}>Open checklist</Button>
          )}
        </div>

        {onboardingMode && (
          <div className="ec-journal__banner" role="status">
            <span className="ec-journal__banner-icon" aria-hidden="true"><ListChecks size={18} /></span>
            <div>
              <strong>Step 1 of 3 · {copy.onboardingTitle}</strong>
              <p>{copy.onboardingBody}</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="ec-setup__layout" aria-busy="true">
            <Placeholder height={260} radius={16} />
            <Placeholder height={420} radius={16} />
          </div>
        ) : strategies.length === 0 ? (
          <Card className="ec-setup__start">
            <h2 className="ec-setup__start-title">Create your first setup</h2>
            <p className="ec-setup__start-sub">Start from an example and edit it to match how you really trade, or build one from scratch.</p>
            {templateCards(false)}
            <div className="ec-setup__or">or</div>
            <Button variant="secondary" icon={<Plus size={16} />} onClick={addStrategy}>Start from scratch</Button>
          </Card>
        ) : (
          <div className={`ec-setup__layout ${mobileView === "editor" ? "is-editor" : "is-list"}`}>
            <nav className="ec-card ec-setup__list" aria-label="Setups">
              <div className="ec-setup__list-head">
                <span className="ec-dash__eyebrow" style={{ margin: 0 }}>Setups</span>
                <span className="ec-setup__count">{strategies.length}</span>
              </div>
              {strategies.map(s => {
                const filled = s.rules.filter(r => (r.label || "").trim()).length;
                const imgs = (s.referenceImages || []).length + (pendingByStrategy[s.id] || []).length;
                const active = selected?.id === s.id;
                const warn = strategyIssue(s);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`ec-setup__item ec-focusable${active ? " is-active" : ""}`}
                    onClick={() => openStrategy(s.id)}
                    aria-current={active ? "true" : undefined}
                  >
                    <span className="ec-setup__item-text">
                      <span className={`ec-setup__item-name${s.name.trim() ? "" : " is-empty"}`}>{s.name.trim() || "Untitled setup"}</span>
                      <span className="ec-setup__item-meta">
                        {filled} {filled === 1 ? "rule" : "rules"}{imgs > 0 ? ` · ${imgs} image${imgs > 1 ? "s" : ""}` : ""}
                      </span>
                    </span>
                    {warn && <span className="ec-setup__warn" title={warn} aria-label="Needs attention" />}
                    <ChevronRight className="ec-setup__item-chev" size={18} aria-hidden="true" />
                  </button>
                );
              })}
              <div className="ec-setup__list-actions">
                <Button variant="secondary" icon={<Plus size={16} />} onClick={addStrategy} block>New setup</Button>
                <button type="button" className="ec-setup__link ec-focusable" onClick={() => setShowExamples(v => !v)} aria-expanded={showExamples}>
                  {showExamples ? "Hide examples" : "Start from an example"}
                </button>
                {showExamples && templateCards(true)}
              </div>
            </nav>

            <div className="ec-card ec-setup__pane">
              {selected && renderEditor(selected)}
            </div>
          </div>
        )}
      </main>

      {!loading && (
        <div className="ec-remind__savebar ec-setup__savebar">
          <div className="ec-remind__savebar-inner">
            {status}
            <Button icon={<Save size={16} />} onClick={handleSave} loading={saving}>{saveLabel}</Button>
          </div>
        </div>
      )}

      <ResponsiveModal open={Boolean(confirmDelete)} onClose={() => setConfirmDelete(null)} title="Delete this setup?" width={420}>
        <p className="ec-journal__confirm">
          <strong>{confirmDelete?.name?.trim() || "Untitled setup"}</strong> and its rules will be removed when you save. Trades already logged with it keep their data.
        </p>
        <div className="ec-journal__confirm-actions">
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => deleteStrategy(confirmDelete.id)}>Delete setup</Button>
        </div>
      </ResponsiveModal>

      <ImageLightbox url={previewUrl} onClose={closePreview} />
    </div>
  );
}
