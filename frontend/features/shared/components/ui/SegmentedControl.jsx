"use client";

import { useRef } from "react";
import { tapLight } from "@/utils/haptics";

/**
 * Segmented control / tab bar.
 *
 * options: [{ value, label }]
 * mode:    "tabs"   → role=tablist, arrow keys move selection (pair with panels)
 *          "toggle" → plain pressed buttons (filters, period pickers)
 */
export default function SegmentedControl({ options, value, onChange, label, mode = "toggle", block = false }) {
  const listRef = useRef(null);
  const isTabs = mode === "tabs";

  const onKeyDown = (e) => {
    if (!isTabs || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length];
    onChange(next.value);
    listRef.current?.querySelector(`[data-value="${CSS.escape(String(next.value))}"]`)?.focus();
  };

  return (
    <div
      ref={listRef}
      className={`ec-seg${block ? " ec-seg--block" : ""}`}
      role={isTabs ? "tablist" : "group"}
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            data-value={o.value}
            className="ec-seg__item"
            role={isTabs ? "tab" : undefined}
            aria-selected={isTabs ? selected : undefined}
            aria-pressed={isTabs ? undefined : selected}
            tabIndex={isTabs && !selected ? -1 : 0}
            onClick={() => {
              if (selected) return;
              tapLight();
              onChange(o.value);
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
