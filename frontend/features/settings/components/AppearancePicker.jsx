"use client";

import { useId, useRef } from "react";
import { Check } from "lucide-react";
import { useTheme } from "@/utils/theme";
import { tapLight } from "@/utils/haptics";

// Dark · Light · System. Each tile previews the theme with its real surface
// colours (hard-coded on purpose: a preview must show the *other* theme, not
// the one currently applied). Radiogroup semantics with arrow-key movement.

const OPTIONS = [
  { value: "dark", label: "Dark", hint: "Easy on the eyes at night" },
  { value: "light", label: "Light", hint: "Bright and crisp by day" },
  { value: "system", label: "System", hint: "Match your device" },
];

const PREVIEW = {
  dark: { bg: "#0A0D12", card: "#11161D", line: "#22C78E", text: "#E8EDF2", sub: "#3A4350" },
  light: { bg: "#F7F7F5", card: "#FFFFFF", line: "#0D9E6E", text: "#0F1923", sub: "#D9DDE2" },
};

function Scene({ p }) {
  return (
    <>
      <rect width="120" height="72" fill={p.bg} />
      <rect x="0" y="0" width="22" height="72" fill={p.card} />
      <rect x="5" y="8" width="12" height="4" rx="2" fill={p.line} />
      <rect x="5" y="18" width="12" height="3" rx="1.5" fill={p.sub} />
      <rect x="5" y="25" width="12" height="3" rx="1.5" fill={p.sub} />
      <rect x="30" y="8" width="82" height="56" rx="6" fill={p.card} />
      <rect x="37" y="15" width="26" height="5" rx="2.5" fill={p.text} />
      <polyline points="37,54 50,46 60,50 72,36 84,40 104,24" fill="none" stroke={p.line} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

// System = the light scene with the dark scene clipped over its right half.
function Preview({ value }) {
  const clipId = `ec-split-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 120 72" aria-hidden="true" preserveAspectRatio="none">
      {value === "system" ? (
        <>
          <defs><clipPath id={clipId}><rect x="60" y="0" width="60" height="72" /></clipPath></defs>
          <Scene p={PREVIEW.light} />
          <g clipPath={`url(#${clipId})`}><Scene p={PREVIEW.dark} /></g>
        </>
      ) : (
        <Scene p={PREVIEW[value]} />
      )}
    </svg>
  );
}

export default function AppearancePicker() {
  const { preference, setPreference } = useTheme();
  const groupRef = useRef(null);

  const choose = (value) => {
    if (value === preference) return;
    tapLight();
    setPreference(value);
  };

  const onKeyDown = (e) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const i = OPTIONS.findIndex((o) => o.value === preference);
    const next = OPTIONS[(i + keys[e.key] + OPTIONS.length) % OPTIONS.length];
    choose(next.value);
    groupRef.current?.querySelector(`[data-value="${next.value}"]`)?.focus();
  };

  return (
    <div className="ec-appearance">
      <div ref={groupRef} className="ec-appearance__grid" role="radiogroup" aria-label="Appearance" onKeyDown={onKeyDown}>
        {OPTIONS.map((o) => {
          const selected = o.value === preference;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              data-value={o.value}
              className="ec-appearance__tile ec-focusable"
              onClick={() => choose(o.value)}
            >
              <span className="ec-appearance__preview"><Preview value={o.value} /></span>
              <span className="ec-appearance__meta">
                <span className="ec-appearance__radio" aria-hidden="true">{selected && <Check size={12} strokeWidth={3} />}</span>
                <span>
                  <strong>{o.label}</strong>
                  <small>{o.hint}</small>
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="ec-appearance__note">
        Applies to Home, Settings and navigation now. More screens switch over as they&apos;re redesigned.
      </p>
    </div>
  );
}
