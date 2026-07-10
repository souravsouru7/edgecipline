"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export default function FocusTrap({ children, active = true }) {
  const containerRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    previousFocusRef.current = document.activeElement;

    const container = containerRef.current;
    if (!container) return;

    const focusable = () => Array.from(container.querySelectorAll(FOCUSABLE));
    const first = () => focusable()[0];
    const last = () => focusable().at(-1);

    // Move focus into the trap on open
    const initialFocus = first();
    if (initialFocus) initialFocus.focus();

    const onKeyDown = (e) => {
      if (e.key !== "Tab") return;
      const els = focusable();
      if (!els.length) { e.preventDefault(); return; }
      if (e.shiftKey) {
        if (document.activeElement === els[0]) {
          e.preventDefault();
          last()?.focus();
        }
      } else {
        if (document.activeElement === els[els.length - 1]) {
          e.preventDefault();
          first()?.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [active]);

  return (
    <div ref={containerRef} style={{ display: "contents" }}>
      {children}
    </div>
  );
}
