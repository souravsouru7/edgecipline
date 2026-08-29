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
  eyebrow = "SUPPORT",
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
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/support");
  };

  return (
    <div className="sup-root">
      <header className="sup-header">
        <div className="sup-header-inner" style={{ maxWidth }}>
          <div className="sup-header-left">
            {(backHref || title) && (
              <button type="button" onClick={goBack} className="sup-back" aria-label={backLabel}>
                <ChevronLeft size={19} aria-hidden="true" />
              </button>
            )}
            <Link href="/support" className="sup-brand" aria-label="Edgecipline Support home">
              <img src="/mainlogo1.png" alt="" aria-hidden="true" className="sup-logo" />
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
        <div className="sup-rule" aria-hidden="true" />
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
          font-family: var(--font-plus-jakarta-sans);
          /* Room for the iOS home indicator and the Android gesture bar. */
          padding-bottom: calc(32px + env(safe-area-inset-bottom, 0px));
        }
        .sup-header {
          position: sticky;
          top: 0;
          z-index: 50;
          background: rgba(240, 238, 233, 0.97);
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
          width: 108px;
          height: 30px;
          object-fit: contain;
          object-position: left center;
          flex-shrink: 0;
        }
        .sup-eyebrow {
          font-family: var(--font-jetbrains-mono);
          font-size: 9.5px;
          font-weight: 700;
          letter-spacing: 0.16em;
          color: var(--color-primary);
          padding: 3px 7px;
          border-radius: 5px;
          background: var(--color-primary-bg);
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
        .sup-rule {
          height: 2px;
          background: linear-gradient(90deg, var(--color-gold) 0%, var(--color-primary) 50%, var(--color-gold) 100%);
          opacity: 0.75;
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
