"use client";

import { useState, useRef } from "react";
import { validateSelectableImage, readPickedImage } from "@/utils/imageUpload";

/**
 * FileUploadZone
 * Drag-and-drop + click-to-browse image upload zone for trade screenshots.
 *
 * @param {Function} onFileSelect  - Called with File when a valid image is selected
 * @param {File|null} selectedFile - Currently selected file (to show preview)
 * @param {Function} onClear       - Called when user clicks REMOVE
 */
export default function FileUploadZone({ onFileSelect, selectedFile, onClear }) {
  const [isDragging, setIsDragging] = useState(false);
  const [sizeError, setSizeError] = useState(null);
  const [reading, setReading] = useState(false);
  const fileInputRef = useRef(null);
  const readingRef = useRef(false);

  const validateAndSelect = async (f) => {
    if (!f || readingRef.current) return;
    const validationError = validateSelectableImage(f);
    if (validationError) {
      setSizeError(validationError);
      return;
    }
    setSizeError(null);
    // Pull the bytes in now: on Android a picked cloud photo can be an
    // unreadable reference, which used to surface later as "Network error".
    readingRef.current = true;
    setReading(true);
    try {
      const copy = await readPickedImage(f);
      onFileSelect(copy);
    } catch (err) {
      setSizeError(err?.message || "Couldn't open this image. Please pick it again.");
    } finally {
      readingRef.current = false;
      setReading(false);
    }
  };

  const handleDragOver  = e => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = e => {
    e.preventDefault(); setIsDragging(false);
    validateAndSelect(e.dataTransfer.files[0]);
  };

  return (
    <div
      onClick={() => fileInputRef.current?.click()}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        border: `2px dashed ${isDragging ? "var(--lg-green, #0D9E6E)" : "var(--lg-line, #E2E8F0)"}`,
        borderRadius: 12,
        background: isDragging ? "var(--lg-green-soft, #ECFDF5)" : "var(--lg-soft, #F8FAFC)",
        padding: "40px 24px", textAlign: "center", cursor: "pointer",
        transition: "all 0.25s ease",
        transform: isDragging ? "scale(1.01)" : "scale(1)",
      }}
      onMouseEnter={e => { if (!isDragging) { e.currentTarget.style.borderColor = "var(--lg-green, #0D9E6E)"; e.currentTarget.style.background = "rgba(13,158,110,0.08)"; } }}
      onMouseLeave={e => { if (!isDragging) { e.currentTarget.style.borderColor = "var(--lg-line, #E2E8F0)"; e.currentTarget.style.background = "var(--lg-soft, #F8FAFC)"; } }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={e => {
          const picked = e.target.files?.[0];
          // Reset so picking the same photo again still fires onChange.
          e.target.value = "";
          validateAndSelect(picked);
        }}
        style={{ display: "none" }}
      />

      {sizeError && (
        <div style={{ color: "var(--lg-red, #D63B3B)", fontSize: 12, fontWeight: 600, marginBottom: 8, fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)" }}>
          {sizeError}
        </div>
      )}

      {reading ? (
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--lg-sub, #64748B)", fontFamily: "var(--lg-sans, 'Plus Jakarta Sans', sans-serif)", padding: "20px 0" }}>
          Reading image…
        </div>
      ) : selectedFile ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{ width: 68, height: 68, borderRadius: 14, background: "var(--lg-green-soft, #ECFDF5)", border: "1.5px solid var(--lg-green-line, #A7F3D0)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--lg-green, #0D9E6E)" }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--lg-ink, #0F1923)", fontFamily: "var(--lg-sans, 'Plus Jakarta Sans', sans-serif)", marginBottom: 4 }}>{selectedFile.name}</div>
            <div style={{ fontSize: 11, color: "var(--lg-muted, #94A3B8)", fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)" }}>{(selectedFile.size / 1024).toFixed(1)} KB · Ready to extract</div>
          </div>
          <button
            onClick={e => { e.stopPropagation(); onClear(); }}
            style={{ padding: "6px 16px", fontSize: "var(--fs-2xs)", fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)", fontWeight: 700, letterSpacing: "0.1em", color: "var(--lg-red, #D63B3B)", background: "var(--lg-red-soft, #FEF2F2)", border: "1px solid var(--lg-red-soft, #FCA5A5)", borderRadius: 6, cursor: "pointer", transition: "all 0.2s" }}
            onMouseEnter={e => e.currentTarget.style.background = "var(--lg-red-soft, #FEE2E2)"}
            onMouseLeave={e => e.currentTarget.style.background = "var(--lg-red-soft, #FEF2F2)"}
          >
            REMOVE
          </button>
        </div>
      ) : (
        <>
          <div style={{ width: 60, height: 60, borderRadius: 14, background: "rgba(184,134,11,0.1)", border: "1.5px solid rgba(184,134,11,0.25)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--lg-gold, #B8860B)", margin: "0 auto 16px" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--lg-ink, #0F1923)", fontFamily: "var(--lg-sans, 'Plus Jakarta Sans', sans-serif)", marginBottom: 6 }}>Drop your trade screenshot here</div>
          <div style={{ fontSize: 12, color: "var(--lg-muted, #94A3B8)", fontFamily: "var(--lg-sans, 'Plus Jakarta Sans', sans-serif)", marginBottom: 12 }}>or click to browse</div>
          <div style={{ display: "inline-flex", gap: 6 }}>
            {["PNG", "JPG", "JPEG", "WEBP"].map(f => (
              <span key={f} style={{ fontSize: "var(--fs-2xs)", color: "var(--lg-gold, #B8860B)", background: "rgba(184,134,11,0.08)", border: "1px solid rgba(184,134,11,0.2)", borderRadius: 4, padding: "2px 8px", fontFamily: "var(--lg-mono, 'JetBrains Mono', monospace)", fontWeight: 600 }}>{f}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
