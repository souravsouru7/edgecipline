"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { ResponsiveModal } from "@/features/shared/components/ui";
import { MIND_COMPONENTS, MIND_LEVELS } from "@/features/mind-progress/mindComponents";

const RULES = [
  { emoji: "💰", text: "It never looks at profit or loss. A calm, honest losing day can raise it." },
  { emoji: "📅", text: "It updates each day you journal a trade or a reflection." },
  { emoji: "🛡️", text: "One bad day costs at most 4 points. A clean journal day always adds at least +1." },
  { emoji: "🏖️", text: "Taking a break never lowers it. It simply waits for you." },
  { emoji: "🪞", text: "You're only compared with yourself, never with other traders." },
];

/** Plain-language explainer of the Mind Score. Static copy, no network. */
export function MindHowItWorksSheet({ open, onClose }) {
  return (
    <ResponsiveModal open={open} onClose={onClose} title="How Mind Score works" width={520}>
      <div className="ec-mind-how">
        <p className="ec-mind-how__lead">
          Your Mind Score (0–100) shows how calm and disciplined your trading is, built only from your own journal.
          It unlocks after 3 journal days (days, not trades).
        </p>

        <h3 className="ec-mind-how__h">What it&apos;s made of</h3>
        <ul className="ec-mind-how__parts">
          {MIND_COMPONENTS.map((c) => (
            <li key={c.key}>
              <span className="ec-mind-how__part-head">
                <span><span aria-hidden="true">{c.emoji}</span> {c.label}</span>
                <span className="ec-mind-how__weight">{c.weight}%</span>
              </span>
              <span className="ec-mind-how__part-what">{c.explain}</span>
            </li>
          ))}
        </ul>
        <p className="ec-mind-how__note">A part with too little data yet is skipped, not counted as zero.</p>

        <h3 className="ec-mind-how__h">The rules</h3>
        <ul className="ec-mind-how__rules">
          {RULES.map((r) => (
            <li key={r.text}><span aria-hidden="true">{r.emoji}</span><span>{r.text}</span></li>
          ))}
        </ul>

        <h3 className="ec-mind-how__h">Levels</h3>
        <ol className="ec-mind-how__levels">
          {MIND_LEVELS.map((l) => (
            <li key={l.level}>
              <span><span aria-hidden="true">{l.emoji}</span> {l.name}</span>
              <span className="ec-mind-how__weight">{l.min}+</span>
            </li>
          ))}
        </ol>

        <h3 className="ec-mind-how__h">How to raise it</h3>
        <p className="ec-mind-how__note ec-mind-how__note--plain">
          Journal daily, tag your emotions honestly, follow your plan, and take a pause after a loss instead of
          jumping back in. Pick a weekly focus to work on one habit at a time.
        </p>
      </div>
    </ResponsiveModal>
  );
}

/** Small ⓘ button that opens the explainer. */
export default function MindInfoButton({ label = "How Mind Score works" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="ec-mind__info ec-focusable" aria-label={label} title={label} onClick={() => setOpen(true)}>
        <Info size={15} aria-hidden="true" />
      </button>
      <MindHowItWorksSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
