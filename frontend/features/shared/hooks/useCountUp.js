"use client";

import { useEffect, useRef, useState } from "react";

function prefersReducedMotion() {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch {
    return false;
  }
}

/**
 * Counts a number up from 0 the first time it is shown (easeOutCubic).
 * Later changes (refetch, market switch) jump straight to the new value so
 * figures never replay. Pass null to disable; returns null in that case.
 */
export function useCountUp(target, duration = 700) {
  const enabled = typeof target === "number" && Number.isFinite(target);
  const [shown, setShown] = useState(() => (enabled && !prefersReducedMotion() ? 0 : target));
  const playedRef = useRef(false);

  useEffect(() => {
    if (!enabled) { setShown(target); return undefined; }
    // A 0 is usually a placeholder before real data lands: show it, but keep
    // the count-up for the first real value.
    if (target === 0) { setShown(0); return undefined; }
    if (playedRef.current || prefersReducedMotion()) {
      playedRef.current = true;
      setShown(target);
      return undefined;
    }
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
      else playedRef.current = true;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, target, duration]);

  return enabled ? shown : null;
}
