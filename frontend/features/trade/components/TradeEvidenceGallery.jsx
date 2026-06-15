"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Read-only multi-image gallery for trade detail pages.
 *
 * Loads thumbnails by default (Cloudinary `w_300,c_fill`) and only fetches
 * the medium variant when the user opens an image. Full-resolution loads
 * lazily inside the fullscreen viewer.
 *
 * Accepts either:
 *   - `images` prop: array of {url, thumbnailUrl, mediumUrl} (preferred)
 *   - `legacyScreenshot`: single URL fallback (back-compat for old trades)
 */
export default function TradeEvidenceGallery({
  images = [],
  legacyScreenshot = "",
  title = "Trade Evidence",
}) {
  // Merge legacy single screenshot into the gallery if it isn't already there.
  // Old trades only have `screenshot`; new trades have tradeImages[]. Show both
  // cleanly without duplicates.
  const merged = useMemo(() => {
    const out = [];
    if (legacyScreenshot) {
      const seen = (images || []).some(i => i.url === legacyScreenshot);
      if (!seen) {
        out.push({
          url: legacyScreenshot,
          thumbnailUrl: legacyScreenshot,
          mediumUrl: legacyScreenshot,
          publicId: "",
        });
      }
    }
    return [...out, ...(Array.isArray(images) ? images : [])];
  }, [images, legacyScreenshot]);

  const [viewerIdx, setViewerIdx] = useState(-1);

  const openViewer = (idx) => setViewerIdx(idx);
  const closeViewer = () => setViewerIdx(-1);

  const next = useCallback(() => {
    setViewerIdx(i => (i + 1) % merged.length);
  }, [merged.length]);

  const prev = useCallback(() => {
    setViewerIdx(i => (i - 1 + merged.length) % merged.length);
  }, [merged.length]);

  // Keyboard nav in viewer
  useEffect(() => {
    if (viewerIdx < 0) return;
    const handler = (e) => {
      if (e.key === "Escape") closeViewer();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [viewerIdx, next, prev]);

  if (merged.length === 0) return null;

  const active = viewerIdx >= 0 ? merged[viewerIdx] : null;

  return (
    <div className="teg-root">
      <style>{`
        .teg-root { margin-top: 12px; }
        .teg-title {
          font-size: 10px; font-weight: 700; letter-spacing: 0.1em;
          color: #64748B; font-family: 'JetBrains Mono', monospace;
          margin-bottom: 8px;
          display: flex; align-items: center; justify-content: space-between;
        }
        .teg-count {
          font-size: 10px; color: #94A3B8;
          font-family: 'JetBrains Mono', monospace;
        }
        .teg-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
          gap: 8px;
        }
        .teg-thumb {
          position: relative; aspect-ratio: 4/3;
          border-radius: 10px; overflow: hidden;
          cursor: pointer; border: 1px solid #E2E8F0;
          background: #F1F4F8;
        }
        .teg-thumb img {
          width: 100%; height: 100%; object-fit: cover; display: block;
          transition: transform 0.2s;
        }
        .teg-thumb:hover img { transform: scale(1.04); }
        .teg-thumb-idx {
          position: absolute; bottom: 4px; right: 4px;
          background: rgba(15,25,35,0.75); color: #FFFFFF;
          font-size: 10px; font-weight: 700;
          padding: 2px 6px; border-radius: 4px;
          font-family: 'JetBrains Mono', monospace;
        }
        /* Fullscreen viewer */
        .teg-viewer {
          position: fixed; inset: 0; z-index: 10000;
          background: rgba(0,0,0,0.92);
          display: flex; align-items: center; justify-content: center;
        }
        .teg-viewer img {
          max-width: 95vw; max-height: 88vh;
          object-fit: contain;
          touch-action: pinch-zoom;
        }
        .teg-viewer-close {
          position: absolute; top: 16px; right: 16px;
          width: 40px; height: 40px; border-radius: 50%;
          border: none; background: rgba(255,255,255,0.12);
          color: #FFFFFF; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
        .teg-viewer-nav {
          position: absolute; top: 50%; transform: translateY(-50%);
          width: 44px; height: 44px; border-radius: 50%;
          border: none; background: rgba(255,255,255,0.12);
          color: #FFFFFF; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
        .teg-viewer-nav.prev { left: 16px; }
        .teg-viewer-nav.next { right: 16px; }
        .teg-viewer-counter {
          position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%);
          background: rgba(255,255,255,0.12); color: #FFFFFF;
          padding: 6px 14px; border-radius: 999px;
          font-size: 13px; font-weight: 600;
          font-family: 'JetBrains Mono', monospace;
        }
        @media (max-width: 600px) {
          .teg-grid { grid-template-columns: repeat(3, 1fr); }
        }
      `}</style>

      <div className="teg-title">
        <span>{title}</span>
        <span className="teg-count">{merged.length} image{merged.length > 1 ? "s" : ""}</span>
      </div>

      <div className="teg-grid">
        {merged.map((img, idx) => (
          <div key={img.publicId || img.url || idx} className="teg-thumb" onClick={() => openViewer(idx)}>
            <img
              src={img.thumbnailUrl || img.mediumUrl || img.url}
              alt={`evidence ${idx + 1}`}
              loading="lazy"
            />
            <div className="teg-thumb-idx">{idx + 1}</div>
          </div>
        ))}
      </div>

      {active && (
        <div className="teg-viewer" onClick={closeViewer}>
          <button type="button" className="teg-viewer-close" onClick={(e) => { e.stopPropagation(); closeViewer(); }}>
            <X size={20} />
          </button>
          {merged.length > 1 && (
            <>
              <button type="button" className="teg-viewer-nav prev" onClick={(e) => { e.stopPropagation(); prev(); }}>
                <ChevronLeft size={24} />
              </button>
              <button type="button" className="teg-viewer-nav next" onClick={(e) => { e.stopPropagation(); next(); }}>
                <ChevronRight size={24} />
              </button>
            </>
          )}
          <img
            src={active.url || active.mediumUrl}
            alt={`evidence ${viewerIdx + 1}`}
            onClick={(e) => e.stopPropagation()}
          />
          <div className="teg-viewer-counter">
            {viewerIdx + 1} of {merged.length}
          </div>
        </div>
      )}
    </div>
  );
}
