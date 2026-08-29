"use client";

import Link from "next/link";
import { LogIn } from "lucide-react";
import SupportShell from "./SupportShell";
import ContactChannels from "./ContactChannels";
import { EmptyState } from "./SupportBits";

/**
 * Shown on the /support/tickets* screens when there is no session.
 *
 * These pages need an account, but they sit under /support — which
 * AuthSessionBootstrap treats as public so that the store-facing Help Center
 * renders for a logged-out reviewer. Rather than widen or complicate that
 * contract (the one thing that must not break, or app-store review fails), the
 * ticket screens handle the signed-out case themselves.
 *
 * That turns out to be the better experience anyway: a hard redirect to /login
 * loses whatever the customer was doing and gives no explanation, while this
 * keeps them oriented and still offers WhatsApp and email — which need no
 * account at all.
 */
export default function SignInRequired({ next = "/support/tickets", config, title = "Your support tickets" }) {
  return (
    <SupportShell title={title} backHref="/support">
      <EmptyState
        icon={<LogIn size={28} aria-hidden="true" />}
        title="Sign in to see your tickets"
        description="Tickets are tied to your account so we can see your plan and history. It only takes a moment."
        action={
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="sr-cta">
            Sign in
          </Link>
        }
      />

      <div style={{ marginTop: 30 }}>
        <h2 className="sr-h2">Or reach us without signing in</h2>
        <ContactChannels config={config} ticketsEnabled={false} />
      </div>

      <style jsx>{`
        :global(.sr-cta) {
          display: inline-block;
          padding: 12px 26px;
          border-radius: 10px;
          background: var(--color-dark);
          color: var(--color-primary-light);
          font-size: 13.5px;
          font-weight: 700;
          text-decoration: none;
        }
        :global(.sr-cta:focus-visible) {
          outline: 2px solid var(--color-primary);
          outline-offset: 3px;
        }
        .sr-h2 {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.09em;
          text-transform: uppercase;
          color: var(--color-text-muted);
          margin: 0 0 13px;
        }
      `}</style>
    </SupportShell>
  );
}
