"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { C, FONT } from "./tokens";
import ShareableCard from "./ShareableCard";
import { createTradingDnaShareToken } from "../api/tradingDnaApi";

const PNG_SCALE = 2;

function buildFilename(archetype) {
  const slug = (archetype || "trading-dna")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "trading-dna"}.png`;
}

function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

function statusColor(kind) {
  if (kind === "error") return C.bear;
  if (kind === "success") return C.bull;
  return C.muted;
}

export default function ShareModal({
  open,
  onClose,
  report,
  ai,
  bundle,
}) {
  const cardRef = useRef(null);
  const [busy, setBusy] = useState(null);
  const [status, setStatus] = useState({ kind: null, message: "" });
  const [linkState, setLinkState] = useState({ url: "", expiresAt: null });

  useEffect(() => {
    if (!open) {
      setBusy(null);
      setStatus({ kind: null, message: "" });
      setLinkState({ url: "", expiresAt: null });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const renderPng = useCallback(async () => {
    if (!cardRef.current) throw new Error("Share card not ready");
    // html-to-image does not wait for the page's @font-face declarations to
    // finish loading, so the first capture after page open can fall back to
    // the system font and look off-brand. document.fonts.ready resolves once
    // every face referenced by a *currently-rendered* element is loaded —
    // since the ShareableCard is mounted (offscreen) the moment the modal
    // opens, this is the right signal.
    if (typeof document !== "undefined" && document.fonts?.ready) {
      try {
        await document.fonts.ready;
      } catch {
        // Non-fatal — proceed even if the font-loading API rejects.
      }
    }
    // pixelRatio: 2 gives a crisp 2160x2160 export from a 1080x1080 surface,
    // which is the right resolution for most social platforms.
    return toPng(cardRef.current, {
      pixelRatio: PNG_SCALE,
      cacheBust: true,
      // Keep the gradient + radial backgrounds rendered. Default is fine,
      // but we explicitly set backgroundColor so transparent fonts don't
      // sample the page background mid-capture.
      backgroundColor: "#0F1923",
    });
  }, []);

  const handleDownload = useCallback(async () => {
    setBusy("download");
    setStatus({ kind: "info", message: "Rendering image…" });
    try {
      const dataUrl = await renderPng();
      downloadDataUrl(dataUrl, buildFilename(ai?.identity?.archetype));
      setStatus({ kind: "success", message: "Image downloaded." });
    } catch (err) {
      console.error("[TradingDNA] PNG download failed", err);
      setStatus({
        kind: "error",
        message: "Could not render the image. Please try again.",
      });
    } finally {
      setBusy(null);
    }
  }, [renderPng, ai]);

  const handleNativeShare = useCallback(async () => {
    setBusy("native");
    setStatus({ kind: "info", message: "Preparing image…" });
    try {
      const dataUrl = await renderPng();
      const blob = await dataUrlToBlob(dataUrl);
      const file = new File([blob], buildFilename(ai?.identity?.archetype), {
        type: "image/png",
      });
      const canShareFiles =
        typeof navigator !== "undefined" &&
        navigator.canShare &&
        navigator.canShare({ files: [file] });
      if (!canShareFiles) {
        // Fall back to plain download — the parent caller's UI conditionally
        // shows this button, but we guard here in case the support check
        // diverges between mount time and click time.
        downloadDataUrl(dataUrl, buildFilename(ai?.identity?.archetype));
        setStatus({
          kind: "success",
          message: "Sharing not supported on this device — image downloaded.",
        });
        return;
      }
      await navigator.share({
        files: [file],
        title: `My Trading DNA — ${ai?.identity?.archetype || "Trader"}`,
        text: ai?.identity?.tagline || "My Trading DNA from Edgecipline",
      });
      setStatus({ kind: "success", message: "Shared." });
    } catch (err) {
      if (err?.name === "AbortError") {
        setStatus({ kind: null, message: "" });
      } else {
        console.error("[TradingDNA] Native share failed", err);
        setStatus({
          kind: "error",
          message: "Could not open the share sheet. Try Download instead.",
        });
      }
    } finally {
      setBusy(null);
    }
  }, [renderPng, ai]);

  const handleCopyLink = useCallback(async () => {
    if (!report?._id) {
      setStatus({
        kind: "error",
        message: "No report loaded to share.",
      });
      return;
    }
    setBusy("link");
    setStatus({ kind: "info", message: "Generating share link…" });
    try {
      const payload = await createTradingDnaShareToken({
        reportId: report._id,
      });
      await navigator.clipboard.writeText(payload.url);
      setLinkState({ url: payload.url, expiresAt: payload.expiresAt });
      setStatus({
        kind: "success",
        message: "Link copied to clipboard.",
      });
    } catch (err) {
      console.error("[TradingDNA] Share-link mint failed", err);
      setStatus({
        kind: "error",
        message:
          err?.response?.data?.message ||
          err?.message ||
          "Could not generate a share link.",
      });
    } finally {
      setBusy(null);
    }
  }, [report]);

  if (!open) return null;

  const canNativeShare =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trading-dna-share-title"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(15,25,35,0.74)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        fontFamily: FONT.body,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          background: C.surface,
          borderRadius: 16,
          padding: "24px 24px 22px",
          color: C.primary,
          boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 8,
            marginBottom: 16,
          }}
        >
          <div>
            <div
              id="trading-dna-share-title"
              style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}
            >
              Share your Trading DNA
            </div>
            <div style={{ fontSize: 11, color: C.muted }}>
              Download a 1080×1080 image, or copy a private share link.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              color: C.muted,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            type="button"
            onClick={handleDownload}
            disabled={Boolean(busy)}
            style={primaryButton}
          >
            {busy === "download" ? "Rendering…" : "Download image"}
          </button>

          {canNativeShare ? (
            <button
              type="button"
              onClick={handleNativeShare}
              disabled={Boolean(busy)}
              style={secondaryButton}
            >
              {busy === "native" ? "Opening share…" : "Share image"}
            </button>
          ) : null}

          <button
            type="button"
            onClick={handleCopyLink}
            disabled={Boolean(busy)}
            style={secondaryButton}
          >
            {busy === "link" ? "Generating…" : "Copy share link"}
          </button>
        </div>

        {linkState.url ? (
          <div
            style={{
              marginTop: 12,
              padding: "10px 12px",
              background: C.surfaceAlt,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              fontSize: 11,
              color: C.primary,
              wordBreak: "break-all",
              fontFamily: FONT.mono,
            }}
          >
            {linkState.url}
            {linkState.expiresAt ? (
              <div style={{ marginTop: 6, color: C.muted }}>
                Expires{" "}
                {new Date(linkState.expiresAt).toLocaleDateString()}
              </div>
            ) : null}
          </div>
        ) : null}

        {status.message ? (
          <div
            style={{
              marginTop: 12,
              fontSize: 11,
              color: statusColor(status.kind),
              letterSpacing: "0.02em",
            }}
          >
            {status.message}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 16,
            fontSize: 10,
            color: C.muted,
            lineHeight: 1.6,
          }}
        >
          Shared links show your archetype, coach summary, and top strengths
          only — raw trade P&amp;L is never exposed.
        </div>

        {/* Offscreen render target — kept in the DOM at fixed pixel size so
            html-to-image can rasterise it. visibility:hidden preserves layout
            but keeps it invisible to the user. */}
        <div
          aria-hidden
          style={{
            position: "fixed",
            top: -10000,
            left: -10000,
            pointerEvents: "none",
            visibility: "hidden",
          }}
        >
          <ShareableCard
            ref={cardRef}
            identity={ai?.identity}
            coachSummary={ai?.coachSummary}
            topStrengths={ai?.strengths}
            sample={bundle?.sample}
          />
        </div>
      </div>
    </div>
  );
}

const primaryButton = {
  padding: "12px 16px",
  borderRadius: 10,
  border: "none",
  background: C.primary,
  color: "#F8FAFC",
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.04em",
  cursor: "pointer",
};

const secondaryButton = {
  padding: "12px 16px",
  borderRadius: 10,
  border: `1px solid ${C.border}`,
  background: C.surface,
  color: C.primary,
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.04em",
  cursor: "pointer",
};
