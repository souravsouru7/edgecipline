"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { X } from "lucide-react";
import { uploadTradeEvidenceImages } from "@/services/uploadApi";

const MAX_IMAGES = 20;

function genId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Reusable evidence-image section used in add-trade, edit-trade, and OCR
 * review flows.
 *
 * Pattern: parent owns the canonical `images` array on the trade. Component
 * manages local pending File objects. On save, parent calls
 * `ref.current.commitPending()` which uploads + returns the final merged array,
 * which the parent then includes in the trade payload.
 *
 * Props:
 *   value:    current images on the trade (array of {url, publicId, thumbnailUrl, mediumUrl})
 *   onChange: called whenever the uploaded images array changes (delete/reorder)
 *   disabled: disable all interactions (during save)
 *   accentColor: theme color (default green)
 *   compact: smaller thumbnails for tight layouts
 */
const TradeEvidenceSection = forwardRef(function TradeEvidenceSection(
  { value = [], onChange, disabled = false, accentColor = "#0D9E6E", compact = false },
  ref
) {
  const [pending, setPending] = useState([]); // [{id, file, previewUrl}]
  const [error, setError] = useState("");
  const [uploadProgress, setUploadProgress] = useState(null); // null | { uploaded, total }

  const uploadedImgs = Array.isArray(value) ? value : [];
  const totalImgs = uploadedImgs.length + pending.length;

  // Revoke blob URLs on unmount
  useEffect(() => {
    return () => {
      pending.forEach(p => {
        try { URL.revokeObjectURL(p.previewUrl); } catch {}
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    /**
     * Compress + upload pending files, merge with uploaded, return final array.
     * Parent should await this before saving the trade.
     */
    async commitPending() {
      if (pending.length === 0) return uploadedImgs;
      setError("");
      setUploadProgress({ uploaded: 0, total: pending.length });
      try {
        const files = pending.map(p => p.file);
        const uploaded = await uploadTradeEvidenceImages(files);
        // Revoke blob URLs
        pending.forEach(p => {
          try { URL.revokeObjectURL(p.previewUrl); } catch {}
        });
        const merged = [
          ...uploadedImgs,
          ...(Array.isArray(uploaded) ? uploaded : []),
        ].slice(0, MAX_IMAGES).map((img, idx) => ({ ...img, order: idx }));
        setPending([]);
        setUploadProgress(null);
        onChange?.(merged);
        return merged;
      } catch (e) {
        setUploadProgress(null);
        setError(e?.message || "Image upload failed");
        throw e;
      }
    },
    hasPending() { return pending.length > 0; },
    pendingCount() { return pending.length; },
  }), [pending, uploadedImgs, onChange]);

  const handleFilesSelected = (fileList) => {
    if (disabled) return;
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;

    const remaining = MAX_IMAGES - uploadedImgs.length - pending.length;
    if (remaining <= 0) {
      setError(`Maximum ${MAX_IMAGES} images per trade`);
      return;
    }
    if (files.length > remaining) {
      setError(`Only ${remaining} more image${remaining > 1 ? "s" : ""} can be added (max ${MAX_IMAGES})`);
    } else {
      setError("");
    }

    const toAdd = files.slice(0, remaining).map(file => ({
      id: genId(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setPending(prev => [...prev, ...toAdd]);
  };

  const removePending = (id) => {
    setPending(prev => {
      const item = prev.find(p => p.id === id);
      if (item) {
        try { URL.revokeObjectURL(item.previewUrl); } catch {}
      }
      return prev.filter(p => p.id !== id);
    });
  };

  const movePending = (id, dir) => {
    setPending(prev => {
      const idx = prev.findIndex(p => p.id === id);
      if (idx < 0) return prev;
      const ni = idx + dir;
      if (ni < 0 || ni >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[ni]] = [arr[ni], arr[idx]];
      return arr;
    });
  };

  const removeUploaded = (idx) => {
    if (disabled) return;
    const next = uploadedImgs.filter((_, i) => i !== idx).map((img, i) => ({ ...img, order: i }));
    onChange?.(next);
  };

  const moveUploaded = (idx, dir) => {
    if (disabled) return;
    const ni = idx + dir;
    if (ni < 0 || ni >= uploadedImgs.length) return;
    const arr = [...uploadedImgs];
    [arr[idx], arr[ni]] = [arr[ni], arr[idx]];
    onChange?.(arr.map((img, i) => ({ ...img, order: i })));
  };

  const thumbW = compact ? 76 : 96;
  const thumbH = compact ? 58 : 72;

  return (
    <div className="evidence-section">
      <style>{`
        .evidence-section {
          padding: 12px 14px;
          border-radius: 12px;
          background: #F8FAFB;
          border: 1px solid #E8ECF0;
        }
        .evidence-head {
          display: flex; align-items: center; justify-content: space-between;
          gap: 10px; margin-bottom: 8px;
        }
        .evidence-label {
          font-size: 10px; font-weight: 700;
          letter-spacing: 0.1em; color: #64748B;
          font-family: 'JetBrains Mono', monospace;
        }
        .evidence-count {
          font-size: 10px; color: #94A3B8;
          font-family: 'JetBrains Mono', monospace;
        }
        .evidence-grid {
          display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-start;
        }
        .evidence-thumb {
          position: relative; flex-shrink: 0;
        }
        .evidence-thumb img {
          width: ${thumbW}px; height: ${thumbH}px;
          object-fit: cover; border-radius: 9px;
          display: block;
        }
        .evidence-thumb--uploaded img {
          border: 1px solid #E2E8F0;
        }
        .evidence-thumb--pending img {
          border: 2px dashed ${accentColor};
        }
        .evidence-remove {
          position: absolute; top: -6px; right: -6px;
          width: 20px; height: 20px; border-radius: 50%;
          border: 2px solid #FFFFFF; background: #EF4444;
          color: #FFFFFF; cursor: pointer; z-index: 2;
          display: flex; align-items: center; justify-content: center;
        }
        .evidence-remove:disabled { opacity: 0.5; cursor: default; }
        .evidence-move-row {
          position: absolute; bottom: 4px; left: 0; right: 0;
          display: flex; justify-content: center; gap: 3px;
        }
        .evidence-move {
          width: 20px; height: 18px; border-radius: 4px; border: none;
          background: rgba(15,25,35,0.62); color: #FFFFFF;
          font-size: 11px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
        .evidence-move:hover { background: ${accentColor}; }
        .evidence-new-badge {
          position: absolute; top: 4px; left: 4px;
          background: ${accentColor}; color: #FFFFFF;
          font-size: 8px; font-weight: 800;
          padding: 2px 5px; border-radius: 4px; letter-spacing: 0.08em;
          font-family: 'JetBrains Mono', monospace;
        }
        .evidence-add {
          width: ${thumbW}px; height: ${thumbH}px;
          border-radius: 9px;
          border: 1.5px dashed #CBD5E0; background: #FFFFFF;
          color: #64748B; font-size: 10px; font-weight: 600;
          cursor: pointer;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 4px; transition: border-color 0.15s, background 0.15s;
          flex-shrink: 0;
        }
        .evidence-add:hover {
          border-color: ${accentColor}; background: rgba(13,158,110,0.05); color: ${accentColor};
        }
        .evidence-pending-hint {
          font-size: 11px; color: ${accentColor};
          margin-top: 6px; font-weight: 500;
        }
        .evidence-empty-hint {
          font-size: 11px; color: #94A3B8;
          margin-top: 4px;
        }
        .evidence-upload-bar {
          margin-top: 10px;
          padding: 8px 10px; border-radius: 8px;
          background: rgba(13,158,110,0.08); color: ${accentColor};
          font-size: 11px; font-weight: 600;
          display: flex; align-items: center; gap: 8px;
        }
        .evidence-upload-bar svg { animation: ev-spin 1s linear infinite; }
        @keyframes ev-spin { to { transform: rotate(360deg); } }
        .evidence-error {
          margin-top: 8px; padding: 6px 10px; border-radius: 8px;
          background: #FEF2F2; border: 1px solid #FCA5A5;
          font-size: 11px; color: #B91C1C;
        }
      `}</style>

      <div className="evidence-head">
        <div className="evidence-label">TRADE EVIDENCE</div>
        {totalImgs > 0 && <div className="evidence-count">{totalImgs}/{MAX_IMAGES}</div>}
      </div>

      <div className="evidence-grid">
        {uploadedImgs.map((img, idx) => (
          <div key={`up-${img.publicId || img.url || idx}`} className="evidence-thumb evidence-thumb--uploaded">
            <img src={img.thumbnailUrl || img.url} alt={`evidence ${idx + 1}`} loading="lazy" />
            <button type="button" className="evidence-remove" title="Remove" disabled={disabled} onClick={() => removeUploaded(idx)}>
              <X size={10} strokeWidth={3} />
            </button>
            {uploadedImgs.length > 1 && (
              <div className="evidence-move-row">
                {idx > 0 && (
                  <button type="button" className="evidence-move" title="Move left" onClick={() => moveUploaded(idx, -1)}>‹</button>
                )}
                {idx < uploadedImgs.length - 1 && (
                  <button type="button" className="evidence-move" title="Move right" onClick={() => moveUploaded(idx, 1)}>›</button>
                )}
              </div>
            )}
          </div>
        ))}

        {pending.map((p, idx) => (
          <div key={p.id} className="evidence-thumb evidence-thumb--pending">
            <img src={p.previewUrl} alt={`pending ${idx + 1}`} />
            <div className="evidence-new-badge">NEW</div>
            <button type="button" className="evidence-remove" title="Remove" disabled={disabled} onClick={() => removePending(p.id)}>
              <X size={10} strokeWidth={3} />
            </button>
            {pending.length > 1 && (
              <div className="evidence-move-row">
                {idx > 0 && (
                  <button type="button" className="evidence-move" title="Move left" onClick={() => movePending(p.id, -1)}>‹</button>
                )}
                {idx < pending.length - 1 && (
                  <button type="button" className="evidence-move" title="Move right" onClick={() => movePending(p.id, 1)}>›</button>
                )}
              </div>
            )}
          </div>
        ))}

        {totalImgs < MAX_IMAGES && !disabled && (
          <label className="evidence-add">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            {totalImgs === 0 ? "Add Images" : "+ More"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              style={{ display: "none" }}
              onChange={e => {
                handleFilesSelected(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>

      {pending.length > 0 && !uploadProgress && (
        <div className="evidence-pending-hint">
          {pending.length} image{pending.length > 1 ? "s" : ""} selected — will compress &amp; upload on Save
        </div>
      )}
      {totalImgs === 0 && (
        <div className="evidence-empty-hint">
          Attach up to {MAX_IMAGES} screenshots — entry, MSS, exit, result, etc. Auto-compressed before upload.
        </div>
      )}

      {uploadProgress && (
        <div className="evidence-upload-bar">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
          Uploading {uploadProgress.uploaded}/{uploadProgress.total}…
        </div>
      )}

      {error && <div className="evidence-error">{error}</div>}
    </div>
  );
});

export default TradeEvidenceSection;
