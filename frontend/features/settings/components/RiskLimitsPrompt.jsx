"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { getRiskLimits, updateRiskLimits } from "@/services/riskLimitsApi";
import { shouldPromptForLimits, MARKET_META } from "@/features/settings/utils/riskLimits";
import RiskLimitsForm from "./RiskLimitsForm";

/**
 * One-time card on the trade entry screens asking for a daily loss limit and
 * max trades per day for this market. Never blocks logging a trade: it renders
 * nothing while loading, on any error, or once answered (Save or Not now).
 */
export default function RiskLimitsPrompt({ market, disabled = false }) {
  const [block, setBlock] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [doneMessage, setDoneMessage] = useState("");

  useEffect(() => {
    if (disabled || !MARKET_META[market]) return undefined;
    let cancelled = false;
    setBlock(null);
    setHidden(false);
    setDoneMessage("");
    getRiskLimits()
      .then((all) => { if (!cancelled) setBlock(all?.[market] || null); })
      .catch(() => { /* fail quiet: the trade form matters more */ });
    return () => { cancelled = true; };
  }, [market, disabled]);

  if (disabled || hidden) return null;
  if (doneMessage) {
    return (
      <div className="ec-rl-prompt ec-rl-prompt--done" role="status">
        <ShieldCheck size={16} aria-hidden="true" /> {doneMessage}
      </div>
    );
  }
  if (!shouldPromptForLimits(block)) return null;

  const notNow = () => {
    setHidden(true);
    // Best effort: if this fails the card may show once more next time.
    updateRiskLimits({ market, promptAnswered: true }).catch(() => {});
  };

  const meta = MARKET_META[market];

  return (
    <section className="ec-rl-prompt" aria-labelledby={`rl-prompt-${market}`}>
      <div className="ec-rl-prompt__head">
        <span className="ec-rl-prompt__icon" aria-hidden="true"><ShieldCheck size={18} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id={`rl-prompt-${market}`} className="ec-rl-prompt__title">Set your daily limits ({meta.label})</h2>
          <p className="ec-rl-prompt__lead">
            We&apos;ll alert you at 80% and 100% of your loss limit, and when you reach your trade count. Leave a box blank to skip it.
          </p>
        </div>
        <button type="button" className="ec-rl-prompt__close ec-focusable" onClick={notNow} aria-label="Not now">
          <X size={16} />
        </button>
      </div>
      <RiskLimitsForm
        market={market}
        initial={block}
        onSaved={() => setDoneMessage("Limits saved. Change them any time in Settings → Trading limits.")}
        secondaryAction={
          <button type="button" className="ec-btn ec-btn--ghost ec-btn--sm" onClick={notNow}>Not now</button>
        }
      />
    </section>
  );
}
