"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { useIsSignedIn } from "@/features/support/hooks/useSupport";

/**
 * Page chrome for every /support screen.
 *
 * Deliberately NOT the app's PageHeader. PageHeader calls useUserProfile, which
 * fires an authenticated request on mount — and /support has to render for a
 * visitor with no session at all. It is the support URL submitted to Google
 * Play and App Store Connect, and both open it cold in a browser; a reviewer
 * who lands on a spinner or a login screen fails the submission. See
 * AuthSessionBootstrap PUBLIC_PATH_PREFIXES and scripts/check-public-routes.mjs.
 *
 * Signed-in state is read from the local token only. No network call, so the
 * page paints identically whether the API is reachable or not.
 */
export default function SupportShell({
  title,
  eyebrow = "Help",
  backHref,
  backLabel = "Back",
  actions,
  maxWidth = 960,
  children,
}) {
  const router = useRouter();
  // Reads the client-only token without a hydration mismatch and without
  // scheduling a second render from an effect — see useIsSignedIn.
  const signedIn = useIsSignedIn();

  const goBack = () => {
    if (backHref) {
      router.push(backHref);
      return;
    }
    // Step back only when the previous page was ours: opened from a store
    // listing or an email, the tab's history belongs to another site.
    if (
      typeof window !== "undefined" &&
      window.history.length > 1 &&
      document.referrer.startsWith(window.location.origin)
    ) {
      router.back();
      return;
    }
    router.push("/support");
  };

  return (
    <div className="ec-app ec-support sup-root">
      <header className="sup-header">
        <div className="sup-header-inner" style={{ maxWidth }}>
          <div className="sup-header-left">
            {(backHref || title) && (
              <button type="button" onClick={goBack} className="sup-back" aria-label={backLabel}>
                <ChevronLeft size={19} aria-hidden="true" />
              </button>
            )}
            <Link href="/support" className="sup-brand" aria-label="Edgecipline Support home">
              {/* The wordmark image has black lettering, so the mark + live text
                  is used instead; it follows the theme. */}
              <img src="/logo.png" alt="" aria-hidden="true" width={26} height={26} className="sup-logo" />
              <span className="sup-wordmark">Edgecipline</span>
              <span className="sup-eyebrow">{eyebrow}</span>
            </Link>
          </div>

          <div className="sup-header-right">
            {actions}
            {signedIn ? (
              <Link href="/dashboard" className="sup-exit">
                Dashboard
              </Link>
            ) : (
              <Link href="/login" className="sup-exit">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main id="support-main" className="sup-main" style={{ maxWidth }}>
        {title && <h1 className="sup-title">{title}</h1>}
        {children}
      </main>

      <footer className="sup-footer" style={{ maxWidth }}>
        <Link href="/privacy-policy">Privacy</Link>
        <span aria-hidden="true">·</span>
        <Link href="/terms">Terms</Link>
        <span aria-hidden="true">·</span>
        <Link href="/delete-account">Delete account</Link>
      </footer>

      <style jsx>{`
        .sup-root {
          min-height: 100dvh;
          background: var(--background);
          color: var(--foreground);
          /* Room for the iOS home indicator and the Android gesture bar. */
          padding-bottom: calc(32px + env(safe-area-inset-bottom, 0px));
        }
        .sup-header {
          position: sticky;
          top: 0;
          z-index: 50;
          background: color-mix(in srgb, var(--ec-bg) 92%, transparent);
          border-bottom: 1px solid var(--ec-border);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          padding-top: env(safe-area-inset-top, 0px);
        }
        .sup-header-inner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          height: 58px;
          margin: 0 auto;
          padding: 0 calc(18px + env(safe-area-inset-right, 0px)) 0 calc(18px + env(safe-area-inset-left, 0px));
        }
        .sup-header-left,
        .sup-header-right {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        /* The actions must never shrink below their labels — a flex item
           that gets squeezed keeps painting its nowrap text, so two buttons
           end up drawn on top of each other. The brand side gives way
           instead (see the narrow-screen rules below). */
        .sup-header-right {
          flex-shrink: 0;
        }
        .sup-header-left {
          flex: 1 1 auto;
        }
        .sup-back {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 38px;
          height: 38px;
          margin-left: -8px;
          border: none;
          border-radius: 10px;
          background: transparent;
          color: var(--color-dark);
          cursor: pointer;
          flex-shrink: 0;
        }
        .sup-back:hover {
          background: var(--color-surface-hover);
        }
        .sup-back:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        /* styled-jsx only stamps its scope class onto DOM elements it renders
           itself. Anything rendered through a component — next/link, a lucide
           icon — comes back as plain <a>/<svg> with no jsx- hash, so a bare
           .sup-brand rule silently matches nothing. :global() is how the rest
           of this file already reaches those (see .sup-footer below); without
           it the whole support header renders unstyled. */
        :global(.sup-brand) {
          display: flex;
          align-items: center;
          gap: 9px;
          text-decoration: none;
          min-width: 0;
        }
        .sup-logo {
          width: 26px;
          height: 26px;
          display: block;
          flex-shrink: 0;
        }
        .sup-wordmark {
          font-size: 16px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--ec-text);
          white-space: nowrap;
        }
        .sup-eyebrow {
          font-size: 12px;
          font-weight: 600;
          color: var(--ec-text-2);
          padding-left: 10px;
          border-left: 1px solid var(--ec-border-strong);
          white-space: nowrap;
        }
        :global(.sup-exit) {
          font-size: 12.5px;
          font-weight: 700;
          color: var(--color-text-muted);
          text-decoration: none;
          padding: 8px 10px;
          border-radius: 8px;
          white-space: nowrap;
        }
        :global(.sup-exit:hover) {
          color: var(--color-primary);
          background: var(--color-primary-bg);
        }
        :global(.sup-exit:focus-visible) {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        .sup-main {
          margin: 0 auto;
          padding: 26px calc(18px + env(safe-area-inset-right, 0px)) 40px calc(18px + env(safe-area-inset-left, 0px));
        }
        .sup-title {
          font-size: 25px;
          font-weight: 800;
          line-height: 1.2;
          margin: 0 0 20px;
          color: var(--color-dark);
          letter-spacing: -0.015em;
        }
        .sup-footer {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          margin: 0 auto;
          padding: 0 18px 8px;
          font-size: 11.5px;
          color: var(--color-text-disabled);
        }
        .sup-footer :global(a) {
          color: var(--color-text-disabled);
          text-decoration: none;
        }
        .sup-footer :global(a:hover) {
          color: var(--color-text-muted);
          text-decoration: underline;
        }
        /* Phone widths: logo + badge + up to three actions do not fit in
           360px. Drop the badge (the logo already says Edgecipline) and
           tighten the logo and gaps so the actions keep their full labels. */
        @media (max-width: 519px) {
          .sup-header-inner {
            gap: 8px;
            padding: 0 calc(14px + env(safe-area-inset-right, 0px)) 0 calc(14px + env(safe-area-inset-left, 0px));
          }
          .sup-header-right {
            gap: 4px;
          }
          .sup-eyebrow {
            display: none;
          }
          /* The mark alone carries the brand here, so the header actions
             (up to three) keep their full labels without overlapping it. */
          .sup-wordmark {
            display: none;
          }
          :global(.sup-exit) {
            padding: 8px 8px;
          }
        }
        /* Signed in on desktop the app sidebar already shows the brand and the
           way back to the app, so the header keeps only "Help" and actions. */
        @media (min-width: 1024px) {
          :global(body.has-app-sidebar) .sup-logo,
          :global(body.has-app-sidebar) .sup-wordmark,
          :global(body.has-app-sidebar .sup-exit) {
            display: none;
          }
          :global(body.has-app-sidebar) .sup-eyebrow {
            padding-left: 0;
            border-left: 0;
            font-size: 17px;
            font-weight: 700;
            color: var(--ec-text);
          }
        }
        @media (min-width: 720px) {
          .sup-title {
            font-size: 30px;
          }
          .sup-main {
            padding-top: 34px;
          }
        }
      `}</style>
    </div>
  );
}
