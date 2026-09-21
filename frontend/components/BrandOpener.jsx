"use client";

// Brand opener shown while AuthSessionBootstrap restores the session.
//
// This continues the AndroidX boot splash (res/drawable/splash.xml) rather
// than replacing it. The two must be indistinguishable: the splash paints the
// logo at 230dp centred on #F4F2EE before the WebView exists, and this paints
// the same logo at 230 CSS px centred on the same colour the moment the
// WebView draws. CSS px and dp are the same unit on Android, so the mark does
// not move, resize or re-animate across the hand-off — the user sees one
// continuous screen instead of the logo appearing twice.
//
// That is why the mark has NO entrance animation. Only the progress sweep and
// the label fade in, because those are genuinely new: they are the signal
// that work is happening, which a static splash cannot give. The whole
// overlay crossfades out once the first screen is ready.
//
// The mark is positioned by centring it in the viewport, not by centring a
// stack that also contains the sweep and the label — that would push the logo
// above centre by half the stack's height and reintroduce the jump. The sweep
// and label are placed relative to the centre instead.
//
// Colours are inlined because this must paint before any stylesheet or font
// finishes loading.

const BG = "#F4F2EE";
const ACCENT = "#0D9E6E";
const GOLD = "#B8860B";
const MUTED = "#64748B";

// Keep in sync with drawable/splash.xml's 230dp logo width.
const MARK_WIDTH_PX = 230;
const MARK_ASPECT = 880 / 201;

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
          background: ${BG};
          font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
          -webkit-tap-highlight-color: transparent;
          transform: translateZ(0);
        }
        .brand-opener--exit {
          animation: brandOpenerExit ${OPENER_EXIT_MS}ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
          pointer-events: none;
        }
        /* Centred exactly like the native splash bitmap. No animation: this
           mark is already on screen when the WebView takes over. */
        .brand-opener__mark {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: ${MARK_WIDTH_PX}px;
          max-width: 68vw;
          height: auto;
          display: block;
        }
        /* Offset from the centre by half the mark's height plus a gap, so the
           mark itself stays put whatever is underneath it. */
        .brand-opener__status {
          position: absolute;
          top: calc(50% + ${Math.round(MARK_WIDTH_PX / MARK_ASPECT / 2)}px + 34px);
          left: 50%;
          transform: translateX(-50%);
          display: grid;
          justify-items: center;
          gap: 14px;
          width: max-content;
        }
        .brand-opener__bar {
          position: relative;
          width: 120px;
          height: 2px;
          border-radius: 2px;
          background: rgba(15, 25, 35, 0.08);
          overflow: hidden;
          animation: brandOpenerFadeIn 420ms ease-out 260ms both;
        }
        .brand-opener__bar::after {
          content: "";
          position: absolute;
          inset: 0;
          width: 46%;
          border-radius: 2px;
          background: linear-gradient(90deg, ${ACCENT}, ${GOLD});
          animation: brandOpenerSweep 1.15s cubic-bezier(0.65, 0, 0.35, 1) 320ms infinite;
        }
        .brand-opener__label {
          margin: 0;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: ${MUTED};
          white-space: nowrap;
          animation: brandOpenerFadeIn 520ms ease-out 480ms both;
        }
        @keyframes brandOpenerSweep {
          0%   { transform: translateX(-120%); }
          100% { transform: translateX(260%); }
        }
        @keyframes brandOpenerFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes brandOpenerExit {
          from { opacity: 1; }
          to   { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .brand-opener__bar,
          .brand-opener__label { animation: none !important; opacity: 1; }
          .brand-opener__bar::after { animation: none !important; width: 100%; transform: none; opacity: 0.6; }
        }
      `}</style>
      {/* Plain <img>, not next/image: this renders before hydration settles and
          must not wait on the image loader. The asset is pre-sized so decode
          cost on a phone is trivial. */}
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
      <div className="brand-opener__status">
        <div className="brand-opener__bar" aria-hidden="true" />
        <p className="brand-opener__label">{label}</p>
      </div>
    </div>
  );
}
