"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LifeBuoy, X, Send, FileText, Ticket, MessageSquare, Mail, ArrowRight } from "lucide-react";
import FocusTrap from "@/features/shared/components/FocusTrap";
import { useSupportConfig } from "@/features/support/hooks/useSupport";
import { askAssistant } from "@/features/support/api/supportApi";
import { buildWhatsAppLink, buildMailtoLink } from "@/features/support/lib/contactLinks";
import { InlineSpinner } from "./SupportBits";

/**
 * The floating help widget.
 *
 * Answers small questions in place from the knowledge base, and hands over to a
 * human the moment it cannot — or the moment the question is about money or
 * account access, which it never tries to answer at all.
 *
 * Nothing here is generated. Every reply is either a fixed string or an article
 * a human published, so the widget cannot invent a refund policy. See
 * services/supportAssistant.service.js for where that is enforced.
 *
 * The conversation lives in component state only. Nothing is persisted, so
 * there is no transcript to leak and nothing to clean up — if the customer
 * wants a record, that is what a ticket is for.
 */

// Where the bubble would be in the way rather than useful.
const HIDDEN_PREFIXES = [
  "/admin",          // staff console has its own support surface
  "/support",        // already on the Help Center
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-otp",
  "/accept-terms",
  "/onboarding",     // a help bubble mid-onboarding competes with the tour
];

const GREETING = {
  id: "greeting",
  from: "bot",
  text: "Hi — what do you need help with? I'll find the right guide, or put you through to the team.",
};

export default function SupportWidget() {
  const pathname = usePathname() || "";
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([GREETING]);
  const [pending, setPending] = useState(false);
  const [escalation, setEscalation] = useState(null);

  const { data: config } = useSupportConfig();
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const bubbleRef = useRef(null);

  const hidden = HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Esc closes, and focus returns to the bubble rather than being dumped at the
  // top of the page.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        bubbleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, escalation, pending]);

  const escalate = useCallback((category, reason) => {
    setEscalation({ category: category || "other", reason: reason || "unresolved" });
  }, []);

  const send = useCallback(
    async (event) => {
      event?.preventDefault();
      const text = input.trim();
      if (!text || pending) return;

      setMessages((prev) => [...prev, { id: `u${Date.now()}`, from: "user", text }]);
      setInput("");
      setEscalation(null);
      setPending(true);

      try {
        const result = await askAssistant(text);

        setMessages((prev) => [
          ...prev,
          {
            id: `b${Date.now()}`,
            from: "bot",
            text: result.message,
            articles: result.articles || [],
            // Only offer "did this help?" when an article was actually given.
            askHelpful: result.outcome === "articles",
          },
        ]);

        if (result.outcome !== "articles") {
          escalate(result.category, result.reason);
        }
      } catch {
        // The assistant failing must not strand anyone — drop straight to the
        // human channels, which do not depend on this endpoint.
        setMessages((prev) => [
          ...prev,
          {
            id: `e${Date.now()}`,
            from: "bot",
            text: "I could not reach the help guides just now. You can still contact the team directly:",
          },
        ]);
        escalate("other", "assistant_unavailable");
      } finally {
        setPending(false);
      }
    },
    [input, pending, escalate]
  );

  const resolveHelpful = (messageId, helpful, category) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, askHelpful: false, resolved: helpful } : m))
    );
    if (helpful) {
      setMessages((prev) => [
        ...prev,
        { id: `t${Date.now()}`, from: "bot", text: "Good — glad that sorted it." },
      ]);
      setEscalation(null);
    } else {
      escalate(category, "article_did_not_help");
    }
  };

  if (hidden) return null;

  const categoryLabel = config?.categories?.find((c) => c.value === escalation?.category)?.label;
  const whatsappHref = config?.whatsapp?.enabled
    ? buildWhatsAppLink({ number: config.whatsapp.number, categoryLabel })
    : "";
  const mailHref = buildMailtoLink({ email: config?.email, categoryLabel });

  return (
    <>
      {!open && (
        <button
          ref={bubbleRef}
          type="button"
          onClick={() => setOpen(true)}
          className="sw-bubble"
          aria-label="Open support help"
        >
          <LifeBuoy size={21} aria-hidden="true" />
          <span className="sw-bubble-text">Help</span>
        </button>
      )}

      {open && (
        <FocusTrap active>
          <div className="sw-panel" role="dialog" aria-modal="false" aria-label="Support help">
            <header className="sw-head">
              <div className="sw-head-title">
                <LifeBuoy size={16} aria-hidden="true" />
                <span>Edgecipline Support</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  bubbleRef.current?.focus();
                }}
                aria-label="Close support help"
                className="sw-close"
              >
                <X size={17} aria-hidden="true" />
              </button>
            </header>

            <div className="sw-body" ref={scrollRef} aria-live="polite">
              {messages.map((message) => (
                <div key={message.id} className={`sw-row ${message.from === "user" ? "sw-row-user" : ""}`}>
                  <div className={`sw-msg ${message.from === "user" ? "sw-msg-user" : "sw-msg-bot"}`}>
                    {message.text}

                    {message.articles?.length > 0 && (
                      <div className="sw-articles">
                        {message.articles.map((article) => (
                          <Link
                            key={article.slug}
                            href={`/support/article?slug=${encodeURIComponent(article.slug)}`}
                            onClick={() => setOpen(false)}
                            className="sw-article"
                          >
                            <FileText size={13} aria-hidden="true" />
                            <span>{article.title}</span>
                            <ArrowRight size={12} aria-hidden="true" className="sw-article-arrow" />
                          </Link>
                        ))}
                      </div>
                    )}

                    {message.askHelpful && (
                      <div className="sw-helpful">
                        <span>Did that solve it?</span>
                        <button type="button" onClick={() => resolveHelpful(message.id, true)} className="sw-yn">
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => resolveHelpful(message.id, false, message.articles?.[0]?.category)}
                          className="sw-yn"
                        >
                          No
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {pending && (
                <div className="sw-row">
                  <div className="sw-msg sw-msg-bot sw-thinking">
                    <InlineSpinner size={13} /> Looking…
                  </div>
                </div>
              )}

              {escalation && (
                <div className="sw-escalate">
                  <div className="sw-escalate-title">Talk to the team</div>

                  <Link
                    href={`/support/tickets/new?category=${encodeURIComponent(escalation.category)}`}
                    onClick={() => setOpen(false)}
                    className="sw-action sw-action-primary"
                  >
                    <Ticket size={15} aria-hidden="true" />
                    <span>Create a support ticket</span>
                  </Link>

                  {whatsappHref && (
                    <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="sw-action">
                      <MessageSquare size={15} aria-hidden="true" />
                      <span>WhatsApp {config.whatsapp.display}</span>
                    </a>
                  )}

                  {mailHref && (
                    <a href={mailHref} className="sw-action">
                      <Mail size={15} aria-hidden="true" />
                      <span>Email {config?.email}</span>
                    </a>
                  )}
                </div>
              )}
            </div>

            <form onSubmit={send} className="sw-foot">
              <label htmlFor="sw-input" className="sw-sr">
                Describe your problem
              </label>
              <input
                id="sw-input"
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Describe your problem…"
                maxLength={500}
                autoComplete="off"
                className="sw-input"
              />
              <button type="submit" disabled={pending || !input.trim()} className="sw-send" aria-label="Send">
                <Send size={15} aria-hidden="true" />
              </button>
            </form>

            <Link href="/support" onClick={() => setOpen(false)} className="sw-full">
              Open the full Help Center
            </Link>
          </div>
        </FocusTrap>
      )}

      <style jsx>{`
        .sw-bubble {
          position: fixed;
          right: 16px;
          /* Clears the mobile tab bar (68px + safe area), which only exists
             below 768px. Overlapping it would cover the Add-trade button. */
          bottom: calc(84px + env(safe-area-inset-bottom, 0px));
          z-index: 880;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          height: 48px;
          padding: 0 18px 0 15px;
          border: none;
          border-radius: 999px;
          background: var(--color-dark);
          color: var(--color-primary-light);
          font-family: var(--font-plus-jakarta-sans);
          font-size: 13.5px;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 6px 20px rgba(15, 25, 35, 0.22);
        }
        .sw-bubble:hover {
          transform: translateY(-2px);
        }
        .sw-bubble:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 3px;
        }
        .sw-panel {
          position: fixed;
          right: 16px;
          bottom: calc(84px + env(safe-area-inset-bottom, 0px));
          z-index: 890;
          display: flex;
          flex-direction: column;
          width: min(380px, calc(100vw - 32px));
          /* Never taller than the viewport minus the tab bar and some breathing
             room, so the composer is always reachable. */
          max-height: min(560px, calc(100dvh - 160px));
          border-radius: 18px;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          box-shadow: 0 18px 48px rgba(15, 25, 35, 0.26);
          overflow: hidden;
          font-family: var(--font-plus-jakarta-sans);
        }
        .sw-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 13px 15px;
          background: var(--color-dark);
          color: #fff;
          flex-shrink: 0;
        }
        .sw-head-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13.5px;
          font-weight: 700;
        }
        .sw-close {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border: none;
          border-radius: 8px;
          background: transparent;
          color: rgba(255, 255, 255, 0.75);
          cursor: pointer;
        }
        .sw-close:hover {
          background: rgba(255, 255, 255, 0.12);
          color: #fff;
        }
        .sw-close:focus-visible {
          outline: 2px solid var(--color-primary-light);
          outline-offset: 1px;
        }
        .sw-body {
          flex: 1;
          overflow-y: auto;
          padding: 14px;
          background: var(--background);
        }
        .sw-row {
          display: flex;
          margin-bottom: 10px;
        }
        .sw-row-user {
          justify-content: flex-end;
        }
        .sw-msg {
          max-width: 88%;
          padding: 10px 13px;
          border-radius: 13px;
          font-size: 13.5px;
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .sw-msg-bot {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          color: var(--color-text-secondary);
        }
        .sw-msg-user {
          background: var(--color-primary-bg);
          border: 1px solid rgba(13, 158, 110, 0.28);
          color: var(--color-dark);
        }
        .sw-thinking {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: var(--color-text-disabled);
        }
        .sw-articles {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 10px;
        }
        :global(.sw-article) {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 9px 11px;
          border-radius: 9px;
          background: var(--color-primary-bg);
          border: 1px solid rgba(13, 158, 110, 0.22);
          color: var(--color-dark);
          font-size: 12.5px;
          font-weight: 600;
          text-decoration: none;
          line-height: 1.4;
        }
        :global(.sw-article:hover) {
          background: rgba(13, 158, 110, 0.14);
        }
        :global(.sw-article:focus-visible) {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        :global(.sw-article-arrow) {
          margin-left: auto;
          flex-shrink: 0;
          color: var(--color-primary);
        }
        .sw-helpful {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 11px;
          padding-top: 10px;
          border-top: 1px solid var(--color-border);
          font-size: 12.5px;
          color: var(--color-text-muted);
          flex-wrap: wrap;
        }
        .sw-yn {
          height: 30px;
          padding: 0 14px;
          border-radius: 8px;
          border: 1px solid var(--color-border);
          background: var(--background);
          color: var(--color-text-secondary);
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
        }
        .sw-yn:hover {
          border-color: var(--color-primary);
          color: var(--color-primary);
        }
        .sw-yn:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        .sw-escalate {
          margin-top: 4px;
          padding: 13px;
          border-radius: 13px;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
        }
        .sw-escalate-title {
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--color-text-muted);
          margin-bottom: 10px;
        }
        .sw-action {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 11px 12px;
          margin-bottom: 7px;
          border-radius: 10px;
          border: 1px solid var(--color-border);
          background: var(--background);
          color: var(--color-dark);
          font-size: 12.5px;
          font-weight: 600;
          text-decoration: none;
        }
        .sw-action:last-child {
          margin-bottom: 0;
        }
        .sw-action:hover {
          border-color: var(--color-primary);
          color: var(--color-primary);
        }
        .sw-action:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        .sw-action-primary {
          background: var(--color-dark);
          border-color: var(--color-dark);
          color: var(--color-primary-light);
        }
        .sw-action-primary:hover {
          color: var(--color-primary-light);
          opacity: 0.92;
        }
        .sw-foot {
          display: flex;
          gap: 8px;
          padding: 11px;
          border-top: 1px solid var(--color-border);
          background: var(--color-surface);
          flex-shrink: 0;
        }
        .sw-input {
          flex: 1;
          min-width: 0;
          height: 40px;
          padding: 0 13px;
          border-radius: 10px;
          border: 1px solid var(--color-border);
          background: var(--background);
          font-family: inherit;
          /* 16px stops iOS Safari zooming the whole page on focus. */
          font-size: 16px;
          color: var(--color-dark);
          outline: none;
        }
        .sw-input:focus {
          border-color: var(--color-primary);
        }
        .sw-send {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          flex-shrink: 0;
          border: none;
          border-radius: 10px;
          background: var(--color-dark);
          color: var(--color-primary-light);
          cursor: pointer;
        }
        .sw-send:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .sw-send:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        .sw-full {
          display: block;
          padding: 9px;
          text-align: center;
          background: var(--color-surface);
          border-top: 1px solid var(--color-border-subtle);
          font-size: 11.5px;
          font-weight: 600;
          color: var(--color-text-muted);
          text-decoration: none;
          flex-shrink: 0;
        }
        .sw-full:hover {
          color: var(--color-primary);
        }
        .sw-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
        }
        /* Above the tab-bar breakpoint there is no bottom nav to clear. */
        @media (min-width: 769px) {
          .sw-bubble,
          .sw-panel {
            bottom: 24px;
            right: 24px;
          }
          .sw-panel {
            max-height: min(600px, calc(100dvh - 120px));
          }
        }
        @media (max-width: 420px) {
          .sw-bubble-text {
            display: none;
          }
          .sw-bubble {
            width: 52px;
            height: 52px;
            padding: 0;
            justify-content: center;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .sw-bubble:hover {
            transform: none;
          }
        }
      `}</style>
    </>
  );
}
