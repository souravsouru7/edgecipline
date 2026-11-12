"use client";

import { useId } from "react";

/**
 * Accessible on/off switch row: label + optional hint on the left, switch on
 * the right. The whole row is the click target.
 */
export default function Switch({ checked, onChange, label, hint, disabled = false }) {
  const id = useId();
  return (
    <label className={`ec-switch-row${disabled ? " is-disabled" : ""}`} htmlFor={id}>
      <span className="ec-switch-row__text">
        <span className="ec-switch-row__label">{label}</span>
        {hint && <span className="ec-switch-row__hint">{hint}</span>}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={Boolean(checked)}
        disabled={disabled}
        className="ec-switch ec-focusable"
        onClick={() => onChange(!checked)}
      >
        <span className="ec-switch__thumb" aria-hidden="true" />
      </button>
    </label>
  );
}
