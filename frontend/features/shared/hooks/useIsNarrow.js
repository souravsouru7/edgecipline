"use client";

import { useEffect, useState } from "react";

// The trade list used to render a desktop row AND a mobile card for every
// trade, then hide one with CSS, so the DOM carried twice the nodes it showed.
// This picks one. It starts false so the server render and the first client
// render agree, then corrects on mount.
export default function useIsNarrow(maxWidth = 640) {
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const query = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const sync = () => setIsNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [maxWidth]);

  return isNarrow;
}
