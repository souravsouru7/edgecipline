"use client";

import Link from "next/link";
import { MessageSquare, Mail, Ticket, ExternalLink } from "lucide-react";
import { buildWhatsAppLink, buildMailtoLink } from "@/features/support/lib/contactLinks";

/**
 * The three ways to reach a human.
 *
 * Ordering is deliberate. The ticket comes first because it is the only
 * channel that produces a durable, searchable record with the customer's
 * account attached — it is the source of truth for anything account-specific.
 * WhatsApp and email follow as fast, low-friction alternatives.
 *
 * Both external channels are stateless links. They carry no dependency on the
 * ticket system: if tickets are disabled or the API is down, these still work,
 * which is exactly the point of having them.
 */
export default function ContactChannels({
  config,
  categoryLabel,
  ticketCode,
  ticketsEnabled = true,
  ticketHref = "/support/tickets/new",
  compact = false,
}) {
  const whatsappHref = config?.whatsapp?.enabled
    ? buildWhatsAppLink({ number: config.whatsapp.number, categoryLabel, ticketCode })
    : "";

  const mailHref = buildMailtoLink({ email: config?.email, categoryLabel, ticketCode });

  return (
    <div className={`cc-grid ${compact ? "cc-compact" : ""}`}>
      {ticketsEnabled && (
        <Link href={ticketHref} className="cc-card cc-primary">
          <span className="cc-icon" aria-hidden="true">
            <Ticket size={19} />
          </span>
          <span className="cc-body">
            <span className="cc-title">Create a support ticket</span>
            <span className="cc-desc">
              Account, billing, or technical problems. You get a ticket number and a written trail.
            </span>
            <span className="cc-meta">Typical first reply within 24 hours</span>
          </span>
        </Link>
      )}

      {whatsappHref && (
        <a
          href={whatsappHref}
          // Leaving the app entirely — and on Capacitor this hands off to the
          // WhatsApp app. noreferrer matters: without it the opened page gets
          // window.opener and can navigate this tab.
          target="_blank"
          rel="noopener noreferrer"
          className="cc-card"
        >
          <span className="cc-icon cc-icon-wa" aria-hidden="true">
            <MessageSquare size={19} />
          </span>
          <span className="cc-body">
            <span className="cc-title">
              Chat on WhatsApp <ExternalLink size={12} aria-hidden="true" style={{ opacity: 0.5 }} />
            </span>
            <span className="cc-desc">Quick questions and anything you would rather just talk through.</span>
            {/* Printed as text as well as linked: if the deep link fails —
                no WhatsApp installed, desktop without WhatsApp Web — the
                customer can still copy the number. */}
            <span className="cc-meta cc-mono">{config?.whatsapp?.display}</span>
          </span>
        </a>
      )}

      {mailHref && (
        <a href={mailHref} className="cc-card">
          <span className="cc-icon cc-icon-mail" aria-hidden="true">
            <Mail size={19} />
          </span>
          <span className="cc-body">
            <span className="cc-title">Email support</span>
            <span className="cc-desc">
              Longer questions, or when you need to send documents and statements.
            </span>
            <span className="cc-meta cc-mono">{config?.email}</span>
          </span>
        </a>
      )}

      <style jsx>{`
        .cc-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 14px;
        }
        .cc-compact {
          grid-template-columns: 1fr;
        }
        .cc-card {
          display: flex;
          gap: 14px;
          align-items: flex-start;
          padding: 18px;
          border-radius: 14px;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          text-decoration: none;
          transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
          /* Comfortably above the 44px touch-target minimum on mobile. */
          min-height: 96px;
        }
        .cc-card:hover {
          border-color: var(--color-primary);
          transform: translateY(-2px);
          box-shadow: 0 6px 18px rgba(15, 25, 35, 0.07);
        }
        .cc-card:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 3px;
        }
        .cc-primary {
          border-color: rgba(13, 158, 110, 0.35);
          background: linear-gradient(180deg, rgba(13, 158, 110, 0.05), var(--color-surface));
        }
        .cc-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border-radius: 11px;
          flex-shrink: 0;
          background: var(--color-primary-bg);
          color: var(--color-primary);
        }
        .cc-icon-wa {
          background: rgba(37, 211, 102, 0.12);
          color: #1da851;
        }
        .cc-icon-mail {
          background: rgba(184, 134, 11, 0.12);
          color: var(--color-gold);
        }
        .cc-body {
          display: flex;
          flex-direction: column;
          gap: 5px;
          min-width: 0;
        }
        .cc-title {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 14px;
          font-weight: 700;
          color: var(--color-dark);
        }
        .cc-desc {
          font-size: 12.5px;
          line-height: 1.55;
          color: var(--color-text-muted);
        }
        .cc-meta {
          font-size: 11.5px;
          color: var(--color-text-disabled);
          margin-top: 2px;
        }
        .cc-mono {
          font-family: var(--font-jetbrains-mono);
          color: var(--color-text-secondary);
          font-weight: 600;
          word-break: break-all;
        }
        @media (prefers-reduced-motion: reduce) {
          .cc-card,
          .cc-card:hover {
            transform: none;
            transition: none;
          }
        }
      `}</style>
    </div>
  );
}
