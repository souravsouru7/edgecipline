"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Download, Link2, Share2 } from "lucide-react";
import { toPng } from "html-to-image";
import { Button, ResponsiveModal } from "@/features/shared/components/ui";
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

function isNativeApp() {
  return typeof window !== "undefined" && Boolean(window.Capacitor?.isNativePlatform?.());
}

// Inside the Android/iOS app the WebView has no Web Share API and ignores
// <a download>, so the image goes to the app cache and out through the
// system share sheet (which also offers Save to Photos / Files).
async function shareImageNatively(dataUrl, filename, { title, text }) {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);
  // cache/images/ is the folder Android's FileProvider exposes
  // (res/xml/file_paths.xml), so the share target can read the file.
  const written = await Filesystem.writeFile({
    path: `images/${filename}`,
    data: dataUrl.split(",")[1] || "",
    directory: Directory.Cache,
    recursive: true,
  });
  await Share.share({ title, text, files: [written.uri], dialogTitle: "Share your Trading DNA" });
}

async function shareLinkNatively(url, title) {
  const { Share } = await import("@capacitor/share");
  await Share.share({ title, text: title, url, dialogTitle: "Share link" });
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Clipboard is blocked in some WebViews and on http: — fall through.
  }
  return false;
}

export default function ShareModal({ open, onClose, report, ai, bundle }) {
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

  const archetype = ai?.identity?.archetype;

  const renderPng = useCallback(async () => {
    if (!cardRef.current) throw new Error("Share card not ready");
    // html-to-image doesn't wait for web fonts; without this the first
    // capture can fall back to the system font.
    if (typeof document !== "undefined" && document.fonts?.ready) {
      try {
        await document.fonts.ready;
      } catch {
        // Non-fatal.
      }
    }
    // 2x of a 1080 surface gives a crisp 2160px square for social posts.
    return toPng(cardRef.current, {
      pixelRatio: PNG_SCALE,
      cacheBust: true,
      backgroundColor: "#0F1923",
    });
  }, []);

  const handleDownload = useCallback(async () => {
    setBusy("download");
    setStatus({ kind: "info", message: "Making the image…" });
    try {
      const dataUrl = await renderPng();
      downloadDataUrl(dataUrl, buildFilename(archetype));
      setStatus({ kind: "success", message: "Image saved." });
    } catch (err) {
      console.error("[TradingDNA] PNG download failed", err);
      setStatus({ kind: "error", message: "Couldn't make the image. Please try again." });
    } finally {
      setBusy(null);
    }
  }, [renderPng, archetype]);

  const handleNativeShare = useCallback(async () => {
    setBusy("native");
    setStatus({ kind: "info", message: "Preparing the image…" });
    try {
      const dataUrl = await renderPng();
      if (isNativeApp()) {
        await shareImageNatively(dataUrl, buildFilename(archetype), {
          title: `My Trading DNA: ${archetype || "Trader"}`,
          text: ai?.identity?.tagline || "My Trading DNA from Edgecipline",
        });
        setStatus({ kind: null, message: "" });
        return;
      }
      const blob = await dataUrlToBlob(dataUrl);
      const file = new File([blob], buildFilename(archetype), { type: "image/png" });
      const canShareFiles = navigator.canShare?.({ files: [file] });
      if (!canShareFiles) {
        downloadDataUrl(dataUrl, buildFilename(archetype));
        setStatus({ kind: "success", message: "This device can't share images directly, so it was saved instead." });
        return;
      }
      await navigator.share({
        files: [file],
        title: `My Trading DNA: ${archetype || "Trader"}`,
        text: ai?.identity?.tagline || "My Trading DNA from Edgecipline",
      });
      setStatus({ kind: "success", message: "Shared." });
    } catch (err) {
      if (err?.name === "AbortError" || /cancel/i.test(err?.message || "")) {
        setStatus({ kind: null, message: "" });
      } else {
        console.error("[TradingDNA] Native share failed", err);
        setStatus({ kind: "error", message: "Couldn't open the share sheet. Try saving the image instead." });
      }
    } finally {
      setBusy(null);
    }
  }, [renderPng, archetype, ai]);

  const handleCopyLink = useCallback(async () => {
    if (!report?._id) {
      setStatus({ kind: "error", message: "There's no report to share yet." });
      return;
    }
    // A link already made in this dialog is reused rather than minting another.
    if (linkState.url) {
      const copied = await copyText(linkState.url);
      setStatus(copied
        ? { kind: "success", message: "Link copied." }
        : { kind: "info", message: "Copy the link below." });
      return;
    }
    setBusy("link");
    setStatus({ kind: "info", message: "Making a link…" });
    let payload;
    try {
      payload = await createTradingDnaShareToken({ reportId: report._id });
    } catch (err) {
      console.error("[TradingDNA] Share-link mint failed", err);
      setStatus({ kind: "error", message: err?.message || "Couldn't make a share link. Please try again." });
      setBusy(null);
      return;
    }
    // The link exists even if the clipboard is blocked, so always show it.
    setLinkState({ url: payload?.url || "", expiresAt: payload?.expiresAt || null });
    if (isNativeApp() && payload?.url) {
      setBusy(null);
      try {
        await shareLinkNatively(payload.url, `My Trading DNA: ${ai?.identity?.archetype || "Trader"}`);
        setStatus({ kind: null, message: "" });
      } catch {
        setStatus({ kind: "info", message: "Link ready. Copy it below." });
      }
      return;
    }
    const copied = payload?.url ? await copyText(payload.url) : false;
    setStatus(copied
      ? { kind: "success", message: "Link copied." }
      : { kind: "info", message: "Link ready. Copy it below." });
    setBusy(null);
  }, [report, linkState.url, ai]);

  const native = isNativeApp();
  const canNativeShare =
    native ||
    (typeof navigator !== "undefined" &&
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function");

  const expires = linkState.expiresAt ? new Date(linkState.expiresAt) : null;

  return (
    <>
      <ResponsiveModal open={open} onClose={onClose} title="Share your Trading DNA" width={480}>
        <p className="ec-dna__share-sub">
          Share an image of your trading style, or a private link to a summary page.
        </p>
        <div className="ec-dna__share-actions">
          {!native && (
            <Button
              onClick={handleDownload}
              disabled={Boolean(busy)}
              loading={busy === "download"}
              icon={<Download size={16} aria-hidden="true" />}
            >
              Save image
            </Button>
          )}
          {canNativeShare ? (
            <Button
              variant={native ? "primary" : "secondary"}
              onClick={handleNativeShare}
              disabled={Boolean(busy)}
              loading={busy === "native"}
              icon={<Share2 size={16} aria-hidden="true" />}
            >
              {native ? "Share or save image" : "Share image"}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            onClick={handleCopyLink}
            disabled={Boolean(busy)}
            loading={busy === "link"}
            icon={<Link2 size={16} aria-hidden="true" />}
          >
            {native ? "Share link" : linkState.url ? "Copy link again" : "Copy share link"}
          </Button>
        </div>

        {linkState.url ? (
          <div className="ec-dna__link">
            <input
              className="ec-input"
              readOnly
              value={linkState.url}
              aria-label="Share link"
              onFocus={(e) => e.target.select()}
            />
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label="Copy link"
              icon={<Copy size={16} />}
              onClick={handleCopyLink}
            />
          </div>
        ) : null}
        {expires && !Number.isNaN(expires.getTime()) ? (
          <p className="ec-dna__fine">Link works until {expires.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}.</p>
        ) : null}

        <p className={`ec-dna__status ec-tone--${status.kind === "error" ? "bad" : status.kind === "success" ? "good" : "muted"}`} role="status" aria-live="polite">
          {status.message}
        </p>

        <p className="ec-dna__fine">
          Shared pages show your trading style, coach summary and top strengths. Your P&amp;L and individual trades are never shown.
        </p>
      </ResponsiveModal>

      {/* Off-screen render target for the PNG. It sits outside the dialog
          (a bottom sheet's transform would pin a fixed child inside it), and is
          not visibility:hidden: html-to-image copies computed styles, so a
          hidden source came out as an empty image. */}
      {open ? (
        <div aria-hidden="true" className="ec-dna__offscreen">
          <ShareableCard
            ref={cardRef}
            identity={ai?.identity}
            coachSummary={ai?.coachSummary}
            topStrengths={ai?.strengths}
            sample={bundle?.sample}
          />
        </div>
      ) : null}
    </>
  );
}
