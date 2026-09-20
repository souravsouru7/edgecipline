"use client";

import { useEffect, useRef } from "react";

// Sits under a paginated list. Loads the next page when it scrolls into view
// (or on tap, for users who scroll faster than the network), so a trader with
// a thousand trades gets them 50 at a time instead of a 1,000-row DOM.
export default function LoadMoreSentinel({ hasMore, loading, onLoadMore, label = "Load more trades", loaded, total }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!hasMore || loading || !ref.current || typeof IntersectionObserver === "undefined") return undefined;
    const node = ref.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadMore?.();
      },
      { rootMargin: "240px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  if (!hasMore && !loading) return null;

  return (
    <div ref={ref} style={{ display: "flex", justifyContent: "center", padding: "14px 0 6px" }}>
      <button
        type="button"
        onClick={onLoadMore}
        disabled={loading}
        style={{
          minHeight: 44,
          padding: "0 18px",
          borderRadius: 999,
          border: "1px solid #E2E8F0",
          background: "#fff",
          color: "#0F1923",
          fontSize: "var(--fs-xs)",
          fontWeight: 700,
          letterSpacing: "0.04em",
          cursor: loading ? "default" : "pointer",
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? "Loading…" : total ? `${label} (${loaded}/${total})` : label}
      </button>
    </div>
  );
}
