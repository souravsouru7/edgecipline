"use client";

import { Sparkles } from "lucide-react";

// One row that scrolls sideways. Wrapped chips stacked 2-3 rows above the
// composer and ate a third of a phone screen on every message.
export default function CoachQuickPrompts({ prompts = [], onSelect, disabled }) {
  if (!prompts.length) return null;
  return (
    <div className="cqp" role="group" aria-label="Suggested questions">
      {prompts.map((p) => (
        <button
          key={p.id}
          type="button"
          className="cqp-chip"
          onClick={() => onSelect?.(p)}
          disabled={disabled}
        >
          <Sparkles size={12} color="#7C3AED" aria-hidden />
          {p.label}
        </button>
      ))}
      <style jsx>{`
        .cqp {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          scroll-snap-type: x proximity;
          /* Without this, snapping to the first chip ignores the padding
             and parks it against the card edge. */
          scroll-padding-inline: 14px;
          scrollbar-width: none;
          -webkit-overflow-scrolling: touch;
          /* Let chips run to the screen edge instead of clipping at the padding. */
          margin: 0 -14px;
          padding: 2px 14px;
        }
        .cqp::-webkit-scrollbar { display: none; }
        .cqp-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
          white-space: nowrap;
          scroll-snap-align: start;
          min-height: 36px;
          padding: 0 14px;
          border-radius: 999px;
          border: 1px solid var(--lg-line, #E2E8F0);
          background: var(--lg-card, #FFFFFF);
          color: var(--lg-ink, #0F1923);
          font: inherit;
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          touch-action: manipulation;
          transition: background 0.12s ease, border-color 0.12s ease;
        }
        .cqp-chip:hover:not(:disabled) { border-color: rgba(139, 92, 246, 0.45); }
        .cqp-chip:active:not(:disabled) { background: rgba(139, 92, 246, 0.08); }
        .cqp-chip:disabled { opacity: 0.55; cursor: default; }
      `}</style>
    </div>
  );
}
