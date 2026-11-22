"use client";

import Link from "next/link";
import { BookOpen, CheckSquare, LineChart, MessageCircle } from "lucide-react";

const POINTS = [
  { Icon: BookOpen, title: "Log a trade in seconds", body: "Type it in, or upload a screenshot from your broker." },
  { Icon: CheckSquare, title: "Check your rules first", body: "Tick your setup's checklist before you enter." },
  { Icon: LineChart, title: "See what costs you money", body: "Which mistakes, sessions and setups lose the most." },
  { Icon: MessageCircle, title: "Coaching from your own trades", body: "A weekly review and an AI coach that knows your journal." },
];

/**
 * Frame for every signed-out screen: sign in, sign up, password reset and
 * terms. Desktop shows what Edgecipline does beside the form; phones get the
 * form alone with the brand above it.
 *
 * `aside={false}` drops the product panel for focused one-task screens.
 * `hero` is the sign-in / sign-up treatment: centred app-icon brand, glow
 * background, larger headline.
 */
export default function AuthShell({ title, subtitle, children, footer, aside = true, wide = false, hero = false }) {
  return (
    <div className={`ec-app ec-auth${aside ? " ec-auth--split" : ""}${hero ? " ec-auth--hero" : ""}`}>
      {aside && (
        <aside className="ec-auth__aside" aria-label="About Edgecipline">
          <div className="ec-auth__brand">
            <img src="/logo.png" alt="" width={30} height={30} />
            <span>Edgecipline</span>
          </div>
          <div className="ec-auth__pitch">
            <h2>Trade your plan, not your mood.</h2>
            <p>A trading journal that shows you where discipline slips, and what it costs.</p>
            <ul>
              {POINTS.map(({ Icon, title: t, body }) => (
                <li key={t}>
                  <span className="ec-auth__pitch-icon" aria-hidden="true"><Icon size={18} /></span>
                  <span>
                    <strong>{t}</strong>
                    <span>{body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="ec-auth__markets">For Forex and Indian markets</p>
        </aside>
      )}

      <div className="ec-auth__col">
        <div className="ec-auth__brand ec-auth__brand--top">
          {hero ? (
            <span className="ec-auth__logo-tile" aria-hidden="true">
              <img src="/logo.png" alt="" width={38} height={38} />
            </span>
          ) : (
            <img src="/logo.png" alt="" width={28} height={28} />
          )}
          <span>Edgecipline</span>
        </div>

        <main className={`ec-auth__card${wide ? " ec-auth__card--wide" : ""}`}>
          {title && <h1 className="ec-auth__title">{title}</h1>}
          {subtitle && <p className="ec-auth__sub">{subtitle}</p>}
          {children}
        </main>

        {footer && <div className="ec-auth__after">{footer}</div>}

        <nav className="ec-auth__legal" aria-label="Legal">
          <Link href="/privacy-policy">Privacy</Link>
          <span aria-hidden="true">·</span>
          <Link href="/terms">Terms</Link>
          <span aria-hidden="true">·</span>
          <Link href="/support">Help</Link>
        </nav>
      </div>
    </div>
  );
}

/** Inline message box for auth forms. tone: "error" | "success" | "info" */
export function AuthNotice({ tone = "error", title, children }) {
  return (
    <div className={`ec-auth__notice ec-auth__notice--${tone}`} role={tone === "error" ? "alert" : "status"}>
      {title && <strong>{title}</strong>}
      {children && <div>{children}</div>}
    </div>
  );
}
