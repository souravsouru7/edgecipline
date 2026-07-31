"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isNativeCapacitor } from "@/utils/auth";
import { hideNativeSplash } from "@/utils/nativeSplash";

// The animated intro belongs to a cold start. AuthSessionBootstrap stays mounted
// for the life of the WebView, so this module-level flag keeps a later remount
// (route change, resume re-render) from replaying the brand reveal.
let introConsumed = false;

// Video is 3.63s. The cap is the escape hatch for a stalled decode: without it a
// video that never fires `ended` would hold the app behind the loader forever.
const INTRO_MAX_MS = 5000;

/**
 * Animated brand loader for the Android cold start.
 *
 * `public/loadingspin.mp4` is a 1080x1920 logo reveal that ends on the full
 * "EDGECIPLINE / DISCIPLINE OVER EMOTION" lockup. It is deliberately not looped
 * — its first frame is blank white, so looping would flash the screen empty.
 *
 * What this replaces: the static native splash (`@drawable/splash`) that Android
 * shows until `hideNativeSplash()` runs. That call used to happen at the same
 * moment app content appeared, so the web loading shell underneath was never
 * actually visible. This component hides the native splash the instant the video
 * starts rendering frames, so the animation — not the static PNG — is the boot
 * screen, then reports back when it is done.
 *
 * Native only: on the web this same file would be a 465KB download on every cold
 * load, while inside the APK it is a local asset. Web calls `onFinished`
 * immediately and keeps the existing static-logo shell.
 *
 * @param {() => void} onFinished Called once when the intro is over, or right
 *   away when it cannot run (web, reduced motion, replay, decode failure). The
 *   caller must not gate app content on anything else — this always fires.
 */
export default function BootSplashVideo({ onFinished }) {
  const videoRef = useRef(null);
  const finishedRef = useRef(false);
  // Starts false: isNativeCapacitor() reads `window`, so deciding during render
  // would desync the server-rendered HTML from the first client paint.
  const [playing, setPlaying] = useState(false);

  // Latest-value ref so the timeout and media handlers below never re-subscribe
  // just because the parent passed a new closure.
  const finishRef = useRef(onFinished);
  useEffect(() => { finishRef.current = onFinished; });

  const finishNow = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setPlaying(false);
    finishRef.current?.();
  }, []);

  useEffect(() => {
    let timer = 0;
    // Decided one frame in rather than in the effect body: the inputs are
    // browser-only (Capacitor bridge, media query), so this cannot be resolved
    // during render without desyncing the prerendered HTML — and resolving it
    // synchronously here would be a setState cascade inside the effect. The
    // native splash is still covering the screen for this frame either way.
    const raf = window.requestAnimationFrame(() => {
      const canPlay =
        !introConsumed &&
        isNativeCapacitor() &&
        !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

      if (!canPlay) {
        finishNow();
        return;
      }

      introConsumed = true;
      setPlaying(true);
      timer = window.setTimeout(finishNow, INTRO_MAX_MS);
    });

    return () => {
      window.cancelAnimationFrame(raf);
      if (timer) window.clearTimeout(timer);
    };
  }, [finishNow]);

  useEffect(() => {
    if (!playing) return;
    const el = videoRef.current;
    if (!el) return;
    // Capacitor's WebView permits muted autoplay, but a rejected play() must not
    // strand the user on the blank-white first frame.
    const attempt = el.play();
    if (attempt?.catch) attempt.catch(finishNow);
  }, [playing, finishNow]);

  if (!playing) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        // Matches the video's own white background so no seam shows while the
        // first frame decodes and `cover` cropping never reveals a mismatch.
        background: "#FFFFFF",
      }}
    >
      <video
        ref={videoRef}
        src="/loadingspin.mp4"
        autoPlay
        muted
        playsInline
        preload="auto"
        // Fires once real frames are on screen — the safe moment to drop the
        // native splash, so there is no gap between the two.
        onPlaying={() => hideNativeSplash({ fadeOutDuration: 120 })}
        onEnded={finishNow}
        onError={finishNow}
        onStalled={finishNow}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    </div>
  );
}
