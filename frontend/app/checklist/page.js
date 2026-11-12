"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tapLight } from "@/utils/haptics";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brain, ChevronRight, ClipboardList, PartyPopper } from "lucide-react";
import { useRequireAuth } from "@/features/auth/hooks/useRequireAuth";
import { fetchSetups } from "@/services/setupApi";
import { logChecklistEvent } from "@/services/checklistApi";
import { useMarket } from "@/context/MarketContext";
import PageHeader from "@/features/shared/components/PageHeader";
import {
  Button, Card, EmptyState, ErrorState, Placeholder, ResponsiveModal, useToast,
} from "@/features/shared/components/ui";
import { marketRoutes } from "@/features/shared/navigation";
import { useTheme } from "@/utils/theme";
import { useSystemBars } from "@/features/shared/hooks/useSystemBars";
import { syncChecklistItems, addChecklistToggleListener } from "@/plugins/ChecklistNotificationPlugin";
import { ruleItemId, MAX_NOTIFICATION_ITEMS } from "@/services/checklistNotificationSync";
import { getChecklistNotificationSettings } from "@/services/checklistNotificationApi";
import {
  ConfidencePanel, ImageLightbox, ReferenceImages, RuleList, SetupPicker,
} from "@/features/checklist/components/ChecklistParts";

const REDIRECT_DELAY_MS = 1800;

export default function PreTradeChecklistPage() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const { currentMarket, getMarketLabel } = useMarket();
  const { theme } = useTheme();
  useSystemBars(theme);
  const { addToast } = useToast();
  const routes = marketRoutes(currentMarket);

  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [checked, setChecked] = useState({});
  const [setupSimilarity, setSetupSimilarity] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState("");
  const redirectTimer = useRef(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => () => clearTimeout(redirectTimer.current), []);

  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    fetchSetups(currentMarket)
      .then((data) => {
        if (cancelled) return;
        setStrategies(Array.isArray(data) ? data : []);
        setSelectedIdx(0);
        setChecked({});
        setSetupSimilarity("");
      })
      .catch(() => { if (!cancelled) setLoadError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ready, currentMarket, reloadKey]);

  const selected = strategies[selectedIdx] || null;
  const rules = useMemo(
    () => (selected?.rules || []).filter((r) => r.label && r.label.trim().length > 0),
    [selected]
  );

  // Which strategy the on-device reminder is bound to. Only that strategy's
  // ticks are synced into the notification; null = no reminder → never sync.
  const [boundReminder, setBoundReminder] = useState(null);
  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    getChecklistNotificationSettings(currentMarket)
      .then((s) => {
        if (cancelled) return;
        setBoundReminder(s?.enabled ? { id: s.strategyId || null, name: s.strategyName || "" } : null);
      })
      .catch(() => { if (!cancelled) setBoundReminder(null); });
    return () => { cancelled = true; };
  }, [ready, currentMarket]);

  const selectedIsBound = Boolean(
    selected && boundReminder && (
      boundReminder.id
        ? String(selected._id) === String(boundReminder.id)
        // Older settings saved only the name.
        : boundReminder.name && selected.name === boundReminder.name
    )
  );

  useEffect(() => {
    if (!selected || !selectedIsBound) return;
    const items = rules.slice(0, MAX_NOTIFICATION_ITEMS).map((r, i) => ({
      id: ruleItemId(r, i),
      label: r.label,
      checked: !!checked[ruleItemId(r, i)],
    }));
    syncChecklistItems(items, currentMarket).catch(() => {});
  }, [checked, rules, selected, selectedIsBound, currentMarket]);

  // Ticks made inside the notification. itemId is the rule's own id.
  useEffect(() => {
    const listener = addChecklistToggleListener(({ itemId, checked: isChecked }) => {
      if (itemId != null) setChecked((prev) => ({ ...prev, [String(itemId)]: isChecked }));
    });
    return () => listener.remove();
  }, []);

  const totalRules = rules.length;
  const checkedCount = rules.filter((r, i) => checked[ruleItemId(r, i)]).length;
  const score = totalRules > 0 ? Math.round((checkedCount / totalRules) * 100) : 0;

  const toggleRule = useCallback((key) => {
    void tapLight();
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);
  const clearAll = useCallback(() => setChecked({}), []);

  const selectStrategy = (idx) => {
    if (idx === selectedIdx) return;
    setSelectedIdx(idx);
    setChecked({});
    setSetupSimilarity("");
    setPreviewImageUrl("");
  };

  const goToUpload = useCallback(() => router.push(routes.uploadTrade), [router, routes.uploadTrade]);

  const handleTakeTrade = async () => {
    if (!selected || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await logChecklistEvent({
        market: currentMarket,
        strategyName: selected.name,
        totalRules,
        followedRules: checkedCount,
        score,
        isAPlus: score >= 80,
        setupSimilarity,
      });
      setShowSuccess(true);
      redirectTimer.current = setTimeout(goToUpload, REDIRECT_DELAY_MS);
    } catch {
      // Tracking is best effort: never block the trade on it.
      addToast("Couldn't save this checklist, but you can still log your trade.", "error");
      goToUpload();
    } finally {
      setIsSubmitting(false);
    }
  };

  const showPanel = !loading && !loadError && selected && totalRules > 0;
  const panelProps = {
    score, checkedCount, totalRules,
    onTakeTrade: handleTakeTrade, onReset: clearAll, submitting: isSubmitting,
  };

  return (
    <div className={`ec-app ec-home${showPanel ? " ec-check-has-bar" : ""}`}>
      <PageHeader themed showMarketSwitcher title="Checklist" />
      <main className="ec-page ec-check">
        <div className="ec-check__head">
          <h1 className="ec-check__title">Pre-trade checklist</h1>
          <p className="ec-check__sub">
            Tick each rule before you enter. 80% or more is an A+ setup. · {getMarketLabel()}
          </p>
        </div>

        {loading ? (
          <div style={{ display: "grid", gap: 12 }}>
            <Placeholder height={56} radius={14} />
            <Placeholder height={320} radius={16} />
          </div>
        ) : loadError ? (
          <Card><ErrorState title="Couldn't load your setups" onRetry={() => setReloadKey((k) => k + 1)} /></Card>
        ) : strategies.length === 0 ? (
          <Card>
            <EmptyState
              icon={<ClipboardList size={22} />}
              title="Create a setup first"
              body="A setup is a strategy written as rules. Add one, then come back here before each trade to check it."
              action={<Button as={Link} href={routes.setups}>Create a setup</Button>}
            />
          </Card>
        ) : (
          <>
            <SetupPicker strategies={strategies} selectedIdx={selectedIdx} onSelect={selectStrategy} />

            <div className="ec-check__layout">
              <div className="ec-check__main">
                <Card className="ec-check__card">
                  <div className="ec-check__card-head">
                    <h2>{selected?.name || "Unnamed setup"}</h2>
                    {totalRules > 0 && <span className="ec-check__progress">{checkedCount} of {totalRules}</span>}
                  </div>
                  {totalRules === 0 ? (
                    <p className="ec-check__norules">
                      This setup has no rules yet. <Link href={routes.setups}>Add rules</Link>
                    </p>
                  ) : (
                    <RuleList rules={rules} checked={checked} keyFor={ruleItemId} onToggle={toggleRule} />
                  )}
                  <ReferenceImages
                    setup={selected}
                    similarity={setupSimilarity}
                    onSimilarity={setSetupSimilarity}
                    onOpenImage={setPreviewImageUrl}
                  />
                </Card>

                <Link href="/checklist/psychology" className="ec-check__psy ec-focusable">
                  <span className="ec-check__psy-icon" aria-hidden="true"><Brain size={18} /></span>
                  <span className="ec-check__psy-text">
                    <strong>Feeling emotional?</strong>
                    <span>Open the psychology guide before you trade.</span>
                  </span>
                  <ChevronRight size={18} aria-hidden="true" />
                </Link>
              </div>

              {showPanel && (
                <aside className="ec-check__side">
                  <ConfidencePanel {...panelProps} />
                </aside>
              )}
            </div>
          </>
        )}
      </main>

      {/* Phone: compact score + action pinned above the bottom nav. */}
      {showPanel && (
        <div className="ec-check__dock">
          <ConfidencePanel {...panelProps} compact />
        </div>
      )}

      <ResponsiveModal open={showSuccess} onClose={goToUpload} title="A+ setup confirmed" width={420}>
        <div className="ec-check__success">
          <span className="ec-check__success-icon" aria-hidden="true"><PartyPopper size={26} /></span>
          <p>You checked your plan before entering. That&apos;s the edge. Taking you to log the trade…</p>
          <Button onClick={() => { clearTimeout(redirectTimer.current); goToUpload(); }} block>Log trade now</Button>
        </div>
      </ResponsiveModal>

      <ImageLightbox url={previewImageUrl} onClose={() => setPreviewImageUrl("")} />
    </div>
  );
}
