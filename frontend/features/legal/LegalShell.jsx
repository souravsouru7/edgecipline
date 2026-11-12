"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useIsSignedIn } from "@/features/support/hooks/useSupport";

/**
 * Frame for the public legal pages (privacy, terms, account deletion).
 *
 * These URLs are submitted to Google Play and App Store Connect and are opened
 * cold, with no session and no history, so nothing here may need a sign-in
 * or a network call. The back arrow falls back to a real page when there is
 * no history, and the top-right link offers the way in that fits the visitor.
 */
export default function LegalShell({ title, intro, updated, toc = [], children, related = [] }) {
  const router = useRouter();
  const signedIn = useIsSignedIn();

  const goBack = () => {
    // Only step back when the previous page was ours. A link opened from a
    // store listing or an email still has history (the tab's last site), and
    // router.back() would leave Edgecipline entirely.
    const cameFromUs =
      typeof window !== "undefined" &&
      window.history.length > 1 &&
      typeof document !== "undefined" &&
      document.referrer.startsWith(window.location.origin);
    if (cameFromUs) {
      router.back();
      return;
    }
    router.push(signedIn ? "/settings" : "/login");
  };

  return (
    <div className="ec-app ec-legal">
      <header className="ec-legal__bar">
        <div className="ec-legal__bar-in">
          <button type="button" className="ec-legal__back" onClick={goBack} aria-label="Go back">
            <ArrowLeft size={18} />
          </button>
          <Link href="/" className="ec-auth__brand ec-legal__brand" aria-label="Edgecipline home">
            <img src="/logo.png" alt="" width={24} height={24} />
            <span>Edgecipline</span>
          </Link>
          <Link href={signedIn ? "/dashboard" : "/login"} className="ec-legal__exit">
            {signedIn ? "Back to app" : "Sign in"}
          </Link>
        </div>
      </header>

      <main className="ec-legal__main">
        <div className="ec-legal__hero">
          <h1>{title}</h1>
          {intro && <p>{intro}</p>}
          {updated && <span className="ec-legal__updated">Last updated {updated}</span>}
        </div>

        {toc.length > 0 && (
          <nav className="ec-legal__toc" aria-label="On this page">
            <h2>On this page</h2>
            <ol>
              {toc.map((item) => (
                <li key={item.id}>
                  <a href={`#${item.id}`}>{item.label}</a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <div className="ec-legal__body">{children}</div>

        <footer className="ec-legal__foot">
          <span>© {new Date().getFullYear()} Edgecipline</span>
          <nav aria-label="Related pages">
            {related.map((r) => (
              <Link key={r.href} href={r.href}>{r.label}</Link>
            ))}
          </nav>
        </footer>
      </main>
    </div>
  );
}

export function Section({ title, children, id }) {
  return (
    <section id={id} className="ec-legal__section">
      <h2>{title}</h2>
      <div className="ec-legal__prose">{children}</div>
    </section>
  );
}

export function BulletList({ items }) {
  return (
    <ul className="ec-legal__list">
      {items.map((item) => (
        <li key={typeof item === "string" ? item : undefined}>{item}</li>
      ))}
    </ul>
  );
}

export function Highlight({ children }) {
  return <div className="ec-legal__callout ec-legal__callout--warn">{children}</div>;
}

export function Warning({ children }) {
  return <div className="ec-legal__callout ec-legal__callout--bad">{children}</div>;
}
