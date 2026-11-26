"use client";

import { useState } from "react";
import { Target } from "lucide-react";
import { Button, Placeholder, ResponsiveModal, useToast } from "@/features/shared/components/ui";
import { success as hapticSuccess } from "@/utils/haptics";
import { useCancelMindTarget, useMindTargetSuggestions, useSetMindTarget } from "@/features/mind-progress/hooks/useMindProgress";

/**
 * Weekly focus picker. Every option is built by the server from the trader's
 * own last two weeks (their top emotion tag, weakest rule, tilt days…), with
 * the reason shown under it. The trader chooses; nothing is imposed.
 */
export default function TargetPicker({ open, onClose, current = null }) {
  const { data, isLoading, error, refetch } = useMindTargetSuggestions({ enabled: open });
  const setTarget = useSetMindTarget();
  const cancel = useCancelMindTarget();
  const { addToast } = useToast();
  const [busyKey, setBusyKey] = useState(null);

  const choose = (s) => {
    const key = `${s.preset}:${JSON.stringify(s.params)}`;
    setBusyKey(key);
    setTarget.mutate(
      { preset: s.preset, params: s.params },
      {
        onSuccess: () => {
          void hapticSuccess();
          addToast(`Focus set: ${s.label} 🎯`, "success");
          onClose();
        },
        onError: (e) => {
          addToast(e?.message || "Couldn't set that focus. Try again.", "error");
          if (e?.status === 400) refetch();
        },
        onSettled: () => setBusyKey(null),
      }
    );
  };

  const stop = () => {
    cancel.mutate(undefined, {
      onSuccess: () => { addToast("Focus cleared. Pick a new one anytime.", "info"); onClose(); },
      onError: () => addToast("Couldn't clear it. Try again.", "error"),
    });
  };

  const suggestions = data?.suggestions || [];

  return (
    <ResponsiveModal open={open} onClose={onClose} title="Pick this week's focus">
      <p className="ec-mind__picker-intro">
        One focus for 7 days. Hit 5 clean days and it&apos;s yours 💪 These come from your own recent trades.
      </p>
      {current && (
        <p className="ec-mind__picker-current">
          Current: <strong>{current.label}</strong> ({current.cleanDays}/{current.goal} clean days). Picking a new one replaces it.
        </p>
      )}
      {isLoading ? (
        <div style={{ display: "grid", gap: 10 }} aria-busy="true">
          <Placeholder height={64} radius={14} />
          <Placeholder height={64} radius={14} />
          <Placeholder height={64} radius={14} />
        </div>
      ) : error ? (
        <div className="ec-mind__picker-error">
          <p>Couldn&apos;t load your options.</p>
          <Button variant="secondary" size="sm" onClick={() => refetch()}>Try again</Button>
        </div>
      ) : (
        <ul className="ec-mind__options">
          {suggestions.map((s, i) => {
            const key = `${s.preset}:${JSON.stringify(s.params)}`;
            return (
              <li key={key}>
                <button
                  type="button"
                  className="ec-mind__option ec-focusable"
                  onClick={() => choose(s)}
                  disabled={Boolean(busyKey)}
                  aria-busy={busyKey === key}
                >
                  <span className="ec-mind__option-icon" aria-hidden="true"><Target size={16} /></span>
                  <span className="ec-mind__option-text">
                    <strong>{s.label}</strong>
                    {s.why && <span>{s.why}</span>}
                  </span>
                  {i === 0 && <span className="ec-mind__option-tag">Best fit</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {current && (
        <div className="ec-mind__picker-foot">
          <Button variant="ghost" size="sm" onClick={stop} disabled={cancel.isPending}>Clear current focus</Button>
        </div>
      )}
    </ResponsiveModal>
  );
}
