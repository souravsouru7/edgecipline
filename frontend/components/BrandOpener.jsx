"use client";

// Brand opener shown while AuthSessionBootstrap restores the session.
//
// This is the hand-off from the native splash (a static PNG of the same logo,
// painted by AndroidX SplashScreen before the WebView exists) to the app. The
// previous web-side loader was that same logo again with a 1% pulse, so the
// user saw one frozen image for native + web combined — on a slow network
// that read as "stuck", even though the app was working.
//
// The motion is deliberately restrained: the mark settles in once, a thin
// sweep line signals ongoing work, and the whole overlay crossfades out when
// the session is ready. It runs concurrently with the auth check and never
// extends it; the only hold is a short minimum in AuthSessionBootstrap so the
// entrance is not cut mid-frame on a fast start.
//
// Colours are the app palette (see AppLoadingShell.PALETTES) — inlined here
// because this must paint before any stylesheet or font finishes loading.

const BG = "#F4F2EE";
const INK = "#0F1923";
const ACCENT = "#0D9E6E";
const GOLD = "#B8860B";
const MUTED = "#64748B";

export const OPENER_EXIT_MS = 320;

export default function BrandOpener({ exiting = false, label = "Restoring your session" }) {
  return (
    <div
      className={`brand-opener${exiting ? " brand-opener--exit" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy={!exiting}
    >
      <style>{`
        .brand-opener {
          position: fixed;
          inset: 0;
          z-index: 2147483000;
          display: grid;
          place-items: center;
          background: ${BG};
          color: ${INK};
          font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
          padding: 24px;
          padding-top: calc(24px + env(safe-area-inset-top, 0px));
          padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
          -webkit-tap-highlight-color: transparent;
          transform: translateZ(0);
        }
        .brand-opener--exit {
          animation: brandOpenerExit ${OPENER_EXIT_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
          pointer-events: none;
        }
        .brand-opener__stack {
          display: grid;
          justify-items: center;
          gap: 22px;
          width: min(260px, 64vw);
        }
        .brand-opener__mark {
          width: 100%;
          height: auto;
          display: block;
          animation: brandOpenerMarkIn 760ms cubic-bezier(0.22, 1, 0.36, 1) both;
          will-change: transform, opacity, filter;
        }
        .brand-opener__bar {
          position: relative;
          width: 132px;
          height: 2px;
          border-radius: 2px;
          background: rgba(15, 25, 35, 0.08);
          overflow: hidden;
          animation: brandOpenerFadeIn 420ms ease-out 360ms both;
        }
        .brand-opener__bar::after {
          content: "";
          position: absolute;
          inset: 0;
          width: 46%;
          border-radius: 2px;
          background: linear-gradient(90deg, ${ACCENT}, ${GOLD});
          animation: brandOpenerSweep 1.15s cubic-bezier(0.65, 0, 0.35, 1) 420ms infinite;
        }
        .brand-opener__label {
          margin: 0;
          font-size: 10.5px;
          font-weight: 600;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: ${MUTED};
          animation: brandOpenerFadeIn 520ms ease-out 640ms both;
        }
        @keyframes brandOpenerMarkIn {
          from { opacity: 0; transform: translateY(10px) scale(0.94); filter: blur(6px); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    filter: blur(0); }
        }
        @keyframes brandOpenerSweep {
          0%   { transform: translateX(-120%); }
          100% { transform: translateX(260%); }
        }
        @keyframes brandOpenerFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes brandOpenerExit {
          from { opacity: 1; transform: scale(1); }
          to   { opacity: 0; transform: scale(1.025); }
        }
        @media (prefers-reduced-motion: reduce) {
          .brand-opener__mark,
          .brand-opener__bar,
          .brand-opener__label { animation: none !important; opacity: 1; transform: none; filter: none; }
          .brand-opener__bar::after { animation: none !important; width: 100%; transform: none; opacity: 0.6; }
          .brand-opener--exit { animation: brandOpenerExitReduced 180ms linear forwards; }
        }
        @keyframes brandOpenerExitReduced {
          to { opacity: 0; }
        }
      `}</style>
      <div className="brand-opener__stack">
        {/* Plain <img>, not next/image: this renders before hydration settles and
            must not wait on the image loader. The asset is pre-sized (880px)
            so decode cost is trivial on a phone. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- see comment above */}
        <img
          className="brand-opener__mark"
          src="/brand-opener-logo.png"
          alt="Edgecipline"
          width="880"
          height="201"
          decoding="async"
          fetchPriority="high"
          draggable="false"
        />
        <div className="brand-opener__bar" aria-hidden="true" />
        <p className="brand-opener__label">{label}</p>
      </div>
    </div>
  );
}
