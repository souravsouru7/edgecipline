"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LifeBuoy,
  X,
  Send,
  FileText,
  Ticket,
  MessageSquare,
  Mail,
  ArrowRight,
  BookOpen,
  ThumbsUp,
  ThumbsDown,
  Sparkles,
} from "lucide-react";
import FocusTrap from "@/features/shared/components/FocusTrap";
import { useSupportConfig } from "@/features/support/hooks/useSupport";
import { askAssistant } from "@/features/support/api/supportApi";
import { buildWhatsAppLink, buildMailtoLink } from "@/features/support/lib/contactLinks";

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

// The handful of topics that account for most first questions. Shown as
// one-tap chips on the empty conversation so the first interaction is a click,
// not a blank text box. Values are support categories; the label sent as the
// question is what the knowledge-base search actually matches on.
const QUICK_TOPICS = ["trade_import", "subscription_billing", "account_profile", "technical_issue"];

// The bubble can be dragged anywhere on screen so it never sits on top of the
// one thing the customer is trying to tap. The position is stored as an offset
// from the CSS default (bottom-right) so the tab-bar / desktop breakpoints keep
// working; it is re-clamped whenever the viewport changes.
const DRAG_STORAGE_KEY = "ec.support.bubble.offset";
const DRAG_THRESHOLD_PX = 6; // below this a pointer-down/up is a tap, not a drag
const EDGE_MARGIN_PX = 8;

function readStoredOffset() {
  try {
    const raw = window.localStorage.getItem(DRAG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.dx !== "number" || typeof parsed?.dy !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredOffset(offset) {
  try {
    window.localStorage.setItem(DRAG_STORAGE_KEY, JSON.stringify(offset));
  } catch {
    /* private mode / storage blocked — position just resets next visit */
  }
}

/**
 * Where CSS rests the bubble, derived from its current rect minus the offset
 * we applied. Returns null when that cannot be trusted: while the route
 * entrance animation runs, the transformed page wrapper becomes the containing
 * block for position:fixed and the rect is measured against the whole
 * document, not the viewport. The CSS rest position is always on screen, so
 * anything else means "don't clamp against this".
 */
function restPosition(el, currentOffset) {
  const rect = el.getBoundingClientRect();
  const base = {
    left: rect.left - currentOffset.dx,
    top: rect.top - currentOffset.dy,
    width: rect.width,
    height: rect.height,
  };
  const onScreen =
    base.width > 0 &&
    base.left >= 0 &&
    base.top >= 0 &&
    base.left + base.width <= window.innerWidth + 1 &&
    base.top + base.height <= window.innerHeight + 1;
  return onScreen ? base : null;
}

/**
 * Keeps the bubble fully on screen. `offset` is relative to where CSS put the
 * element, so the rest position is `rect - currentOffset`.
 */
function clampOffset(el, currentOffset, wanted) {
  const base = restPosition(el, currentOffset);
  if (!base) return currentOffset;
  const minDx = EDGE_MARGIN_PX - base.left;
  const maxDx = window.innerWidth - EDGE_MARGIN_PX - base.width - base.left;
  const minDy = EDGE_MARGIN_PX - base.top;
  const maxDy = window.innerHeight - EDGE_MARGIN_PX - base.height - base.top;
  return {
    dx: Math.min(Math.max(wanted.dx, minDx), maxDx),
    dy: Math.min(Math.max(wanted.dy, minDy), maxDy),
  };
}

// Snap to whichever side edge is closer, like every other floating button
// people are used to; vertical position is kept where they left it.
function snapToEdge(el, currentOffset, wanted) {
  const base = restPosition(el, currentOffset);
  if (!base) return currentOffset;
  const leftDx = EDGE_MARGIN_PX - base.left;
  const rightDx = window.innerWidth - EDGE_MARGIN_PX - base.width - base.left;
  const centre = base.left + wanted.dx + base.width / 2;
  const dx = centre < window.innerWidth / 2 ? leftDx : rightDx;
  return clampOffset(el, currentOffset, { dx, dy: wanted.dy });
}

function useDraggableBubble(bubbleRef, enabled) {
  const [offset, setOffset] = useState({ dx: 0, dy: 0 });
  const [dragging, setDragging] = useState(false);
  // Mirror of `offset` for the pointer handlers, which must read the latest
  // value without being re-created on every move. Every setOffset below
  // updates the ref first.
  const offsetRef = useRef({ dx: 0, dy: 0 });
  // Pointer bookkeeping lives in a ref so moves never re-render on their own.
  const gesture = useRef(null);

  // Restore the saved spot, then keep it on screen as the viewport changes
  // (rotation, keyboard, resize). The restore is retried after the route
  // entrance animation (see restPosition) so the first measurement that is
  // actually against the viewport wins.
  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const el = bubbleRef.current;
    if (!el) return undefined;
    const apply = (wanted) => {
      if (!restPosition(el, offsetRef.current)) return false;
      const next = clampOffset(el, offsetRef.current, wanted);
      offsetRef.current = next;
      setOffset(next);
      return true;
    };
    const stored = readStoredOffset();
    let retry = null;
    const restore = () => {
      if (!apply(stored || offsetRef.current)) retry = setTimeout(restore, 250);
    };
    const raf = requestAnimationFrame(restore);
    const onResize = () => apply(offsetRef.current);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      if (retry) clearTimeout(retry);
      window.removeEventListener("resize", onResize);
    };
  }, [bubbleRef, enabled]);

  const onPointerDown = useCallback((event) => {
    if (event.button !== undefined && event.button !== 0) return;
    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: offsetRef.current,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    if (!g.moved) {
      g.moved = true;
      setDragging(true);
    }
    const next = clampOffset(event.currentTarget, offsetRef.current, {
      dx: g.startOffset.dx + dx,
      dy: g.startOffset.dy + dy,
    });
    offsetRef.current = next;
    setOffset(next);
  }, []);

  // Returns true when the gesture was a drag (so the click must be ignored).
  const endGesture = useCallback((event) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return false;
    gesture.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!g.moved) return false;
    const next = snapToEdge(event.currentTarget, offsetRef.current, offsetRef.current);
    offsetRef.current = next;
    setOffset(next);
    setDragging(false);
    writeStoredOffset(next);
    return true;
  }, []);

  return { offset, dragging, onPointerDown, onPointerMove, endGesture };
}

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

  const drag = useDraggableBubble(bubbleRef, !hidden && !open);
  // A drag must not also open the panel. Pointer-up fires before click, so
  // the flag set there is what the click handler checks.
  const suppressClick = useRef(false);

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

  const ask = useCallback(
    async (rawText) => {
      const text = String(rawText || "").trim();
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
    [pending, escalate]
  );

  const send = useCallback(
    (event) => {
      event?.preventDefault();
      ask(input);
    },
    [ask, input]
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

  const quickTopics = QUICK_TOPICS.map((value) => config?.categories?.find((c) => c.value === value)).filter(
    Boolean
  );
  const conversationStarted = messages.length > 1;

  return (
    <>
      {!open && (
        <button
          ref={bubbleRef}
          type="button"
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            setOpen(true);
          }}
          onPointerDown={drag.onPointerDown}
          onPointerMove={drag.onPointerMove}
          onPointerUp={(event) => {
            suppressClick.current = drag.endGesture(event);
          }}
          onPointerCancel={(event) => {
            suppressClick.current = drag.endGesture(event);
          }}
          className={`sw-bubble${drag.dragging ? " sw-bubble-dragging" : ""}`}
          style={{ translate: `${drag.offset.dx}px ${drag.offset.dy}px` }}
          aria-label="Open support help (drag to move)"
          title="Drag to move"
        >
          <span className="sw-bubble-icon">
            <LifeBuoy size={20} aria-hidden="true" />
          </span>
          <span className="sw-bubble-text">Help</span>
        </button>
      )}

      {open && (
        <FocusTrap active>
          <div className="sw-panel" role="dialog" aria-modal="false" aria-label="Support help">
            <header className="sw-head">
              <div className="sw-head-brand">
                <span className="sw-avatar sw-avatar-lg" aria-hidden="true">
                  <LifeBuoy size={18} />
                </span>
                <div className="sw-head-text">
                  <div className="sw-head-title">Edgecipline Support</div>
                  <div className="sw-head-sub">
                    <span className="sw-online" aria-hidden="true" />
                    {config?.ticketsEnabled === false ? "Guides available now" : "We reply to every ticket"}
                  </div>
                </div>
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
              {messages.map((message) => {
                const isUser = message.from === "user";
                return (
                  <div key={message.id} className={`sw-row ${isUser ? "sw-row-user" : ""}`}>
                    {!isUser && (
                      <span className="sw-avatar sw-avatar-sm" aria-hidden="true">
                        <LifeBuoy size={12} />
                      </span>
                    )}
                    <div className={`sw-msg ${isUser ? "sw-msg-user" : "sw-msg-bot"}`}>
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
                              <span className="sw-article-icon">
                                <FileText size={14} aria-hidden="true" />
                              </span>
                              <span className="sw-article-body">
                                <span className="sw-article-title">{article.title}</span>
                                <span className="sw-article-cta">Read guide</span>
                              </span>
                              <ArrowRight size={14} aria-hidden="true" className="sw-article-arrow" />
                            </Link>
                          ))}
                        </div>
                      )}

                      {message.askHelpful && (
                        <div className="sw-helpful">
                          <span>Did that solve it?</span>
                          <span className="sw-helpful-btns">
                            <button
                              type="button"
                              onClick={() => resolveHelpful(message.id, true)}
                              className="sw-yn"
                            >
                              <ThumbsUp size={12} aria-hidden="true" /> Yes
                            </button>
                            <button
                              type="button"
                              onClick={() => resolveHelpful(message.id, false, message.articles?.[0]?.category)}
                              className="sw-yn"
                            >
                              <ThumbsDown size={12} aria-hidden="true" /> No
                            </button>
                          </span>
                        </div>
                      )}

                      {message.resolved === true && (
                        <div className="sw-resolved">
                          <ThumbsUp size={11} aria-hidden="true" /> Marked as helpful
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Empty-conversation launcher: common topics as one tap, plus
                  the two things people most often actually want. */}
              {!conversationStarted && !pending && (
                <div className="sw-start">
                  {quickTopics.length > 0 && (
                    <>
                      <div className="sw-start-label">
                        <Sparkles size={12} aria-hidden="true" /> Common topics
                      </div>
                      <div className="sw-chips">
                        {quickTopics.map((topic) => (
                          <button
                            key={topic.value}
                            type="button"
                            className="sw-chip"
                            onClick={() => ask(topic.label)}
                          >
                            {topic.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="sw-tiles">
                    <Link href="/support" onClick={() => setOpen(false)} className="sw-tile">
                      <span className="sw-tile-icon">
                        <BookOpen size={16} aria-hidden="true" />
                      </span>
                      <span className="sw-tile-text">
                        <span className="sw-tile-title">Browse guides</span>
                        <span className="sw-tile-sub">Guides &amp; FAQs</span>
                      </span>
                    </Link>
                    <Link href="/support/tickets/new" onClick={() => setOpen(false)} className="sw-tile">
                      <span className="sw-tile-icon sw-tile-icon-dark">
                        <Ticket size={16} aria-hidden="true" />
                      </span>
                      <span className="sw-tile-text">
                        <span className="sw-tile-title">Open a ticket</span>
                        <span className="sw-tile-sub">Talk to the team</span>
                      </span>
                    </Link>
                  </div>
                </div>
              )}

              {pending && (
                <div className="sw-row">
                  <span className="sw-avatar sw-avatar-sm" aria-hidden="true">
                    <LifeBuoy size={12} />
                  </span>
                  <div className="sw-msg sw-msg-bot sw-typing" aria-label="Looking for an answer">
                    <span className="sw-dot" />
                    <span className="sw-dot" />
                    <span className="sw-dot" />
                  </div>
                </div>
              )}

              {escalation && (
                <div className="sw-escalate">
                  <div className="sw-escalate-head">
                    <div className="sw-escalate-title">Talk to the team</div>
                    <div className="sw-escalate-sub">
                      A person will pick this up{categoryLabel ? ` — ${categoryLabel}` : ""}.
                    </div>
                  </div>

                  <Link
                    href={`/support/tickets/new?category=${encodeURIComponent(escalation.category)}`}
                    onClick={() => setOpen(false)}
                    className="sw-action sw-action-primary"
                  >
                    <Ticket size={15} aria-hidden="true" />
                    <span>Create a support ticket</span>
                    <ArrowRight size={14} aria-hidden="true" className="sw-action-arrow" />
                  </Link>

                  {(whatsappHref || mailHref) && (
                    <div className="sw-action-row">
                      {whatsappHref && (
                        <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="sw-action">
                          <MessageSquare size={14} aria-hidden="true" />
                          <span>WhatsApp</span>
                        </a>
                      )}
                      {mailHref && (
                        <a href={mailHref} className="sw-action">
                          <Mail size={14} aria-hidden="true" />
                          <span>Email</span>
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="sw-foot">
              <form onSubmit={send} className="sw-composer">
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
              <div className="sw-foot-meta">
                <span className="sw-foot-hint">Answers come from our published guides</span>
                <Link href="/support" onClick={() => setOpen(false)} className="sw-full">
                  Help Center <ArrowRight size={11} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
        </FocusTrap>
      )}

      <style jsx>{`
        /* ── Launcher ─────────────────────────────────────────────────── */
        .sw-bubble {
          position: fixed;
          right: 16px;
          /* Clears the mobile tab bar (68px + safe area), which only exists
             below 768px. Overlapping it would cover the Add-trade button. */
          bottom: calc(84px + env(safe-area-inset-bottom, 0px));
          z-index: 880;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          height: 52px;
          padding: 0 20px 0 6px;
          border: none;
          border-radius: 999px;
          background: var(--color-dark);
          color: #fff;
          font-family: var(--font-plus-jakarta-sans);
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.01em;
          cursor: grab;
          /* The browser must not turn a drag into a page scroll or a
             long-press context menu. */
          touch-action: none;
          user-select: none;
          -webkit-user-select: none;
          -webkit-touch-callout: none;
          box-shadow: 0 10px 30px -6px rgba(15, 25, 35, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.06) inset;
          /* The dragged offset lives in the CSS "translate" property, not
             "transform", so the hover lift below still composes with it. The
             translate transition is what animates the snap-to-edge on release. */
          transition: transform 0.18s ease, box-shadow 0.18s ease, translate 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .sw-bubble-dragging {
          cursor: grabbing;
          /* Follow the finger exactly — no easing while the pointer is down. */
          transition: box-shadow 0.18s ease;
          transform: scale(1.06);
          box-shadow: 0 18px 40px -8px rgba(15, 25, 35, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.08) inset;
        }
        .sw-bubble-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--color-primary-light), var(--color-primary));
          color: #fff;
          box-shadow: 0 4px 12px rgba(13, 158, 110, 0.4);
        }
        .sw-bubble:hover:not(.sw-bubble-dragging) {
          transform: translateY(-2px);
          box-shadow: 0 16px 36px -8px rgba(15, 25, 35, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08) inset;
        }
        .sw-bubble:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 3px;
        }

        /* ── Panel ────────────────────────────────────────────────────── */
        .sw-panel {
          position: fixed;
          right: 16px;
          bottom: calc(84px + env(safe-area-inset-bottom, 0px));
          z-index: 890;
          display: flex;
          flex-direction: column;
          width: min(392px, calc(100vw - 32px));
          /* Never taller than the viewport minus the tab bar and some breathing
             room, so the composer is always reachable. */
          max-height: min(600px, calc(100dvh - 160px));
          border-radius: 22px;
          border: 1px solid rgba(15, 25, 35, 0.08);
          background: var(--color-surface);
          box-shadow: 0 30px 70px -18px rgba(15, 25, 35, 0.45), 0 2px 8px rgba(15, 25, 35, 0.08);
          overflow: hidden;
          font-family: var(--font-plus-jakarta-sans);
          transform-origin: bottom right;
          animation: sw-in 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes sw-in {
          from {
            opacity: 0;
            transform: translateY(12px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        /* ── Header ───────────────────────────────────────────────────── */
        .sw-head {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 16px 14px 16px 16px;
          background: linear-gradient(135deg, #0f1923 0%, #16283a 100%);
          color: #fff;
          flex-shrink: 0;
          overflow: hidden;
        }
        .sw-head::before {
          content: "";
          position: absolute;
          right: -60px;
          top: -70px;
          width: 190px;
          height: 190px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(34, 199, 142, 0.35) 0%, rgba(34, 199, 142, 0) 70%);
          pointer-events: none;
        }
        .sw-head-brand {
          position: relative;
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }
        .sw-avatar {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--color-primary-light), var(--color-primary));
          color: #fff;
        }
        .sw-avatar-lg {
          width: 40px;
          height: 40px;
          box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.08), 0 6px 16px rgba(13, 158, 110, 0.35);
        }
        .sw-avatar-sm {
          width: 24px;
          height: 24px;
          margin-right: 8px;
          margin-top: 2px;
        }
        .sw-head-text {
          min-width: 0;
        }
        .sw-head-title {
          font-size: 14.5px;
          font-weight: 800;
          letter-spacing: -0.01em;
          line-height: 1.2;
        }
        .sw-head-sub {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 3px;
          font-size: 11.5px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.7);
        }
        .sw-online {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--color-primary-light);
          box-shadow: 0 0 0 3px rgba(34, 199, 142, 0.25);
        }
        .sw-close {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          flex-shrink: 0;
          border: none;
          border-radius: 10px;
          background: transparent;
          color: rgba(255, 255, 255, 0.7);
          cursor: pointer;
          transition: background 0.15s;
        }
        .sw-close:hover {
          background: rgba(255, 255, 255, 0.16);
          color: #fff;
        }
        .sw-close:focus-visible {
          outline: 2px solid var(--color-primary-light);
          outline-offset: 1px;
        }

        /* ── Conversation ─────────────────────────────────────────────── */
        .sw-body {
          flex: 1;
          overflow-y: auto;
          padding: 16px 14px 12px;
          background: #f6f5f1;
          background-image: radial-gradient(rgba(15, 25, 35, 0.045) 1px, transparent 1px);
          background-size: 18px 18px;
        }
        .sw-row {
          display: flex;
          align-items: flex-start;
          margin-bottom: 10px;
        }
        .sw-row-user {
          justify-content: flex-end;
        }
        .sw-msg {
          max-width: 84%;
          padding: 11px 14px;
          border-radius: 16px;
          font-size: 13.5px;
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .sw-msg-bot {
          background: var(--color-surface);
          border: 1px solid rgba(15, 25, 35, 0.07);
          border-top-left-radius: 6px;
          color: var(--color-dark);
          box-shadow: 0 1px 2px rgba(15, 25, 35, 0.04);
        }
        .sw-msg-user {
          background: linear-gradient(135deg, var(--color-primary) 0%, #0b8a60 100%);
          border-top-right-radius: 6px;
          color: #fff;
          font-weight: 500;
          box-shadow: 0 6px 16px -6px rgba(13, 158, 110, 0.5);
        }

        .sw-typing {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 13px 16px;
        }
        .sw-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--color-text-disabled);
          animation: sw-bounce 1.2s infinite ease-in-out;
        }
        .sw-dot:nth-child(2) {
          animation-delay: 0.15s;
        }
        .sw-dot:nth-child(3) {
          animation-delay: 0.3s;
        }
        @keyframes sw-bounce {
          0%,
          60%,
          100% {
            transform: translateY(0);
            opacity: 0.5;
          }
          30% {
            transform: translateY(-4px);
            opacity: 1;
          }
        }

        /* ── Article cards ────────────────────────────────────────────── */
        .sw-articles {
          display: flex;
          flex-direction: column;
          gap: 7px;
          margin-top: 12px;
        }
        :global(.sw-article) {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 11px;
          border-radius: 12px;
          background: #fff;
          border: 1px solid var(--color-border);
          color: var(--color-dark);
          text-decoration: none;
          line-height: 1.35;
          transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
        }
        :global(.sw-article:hover) {
          border-color: rgba(13, 158, 110, 0.45);
          box-shadow: 0 6px 16px -8px rgba(13, 158, 110, 0.4);
          transform: translateY(-1px);
        }
        :global(.sw-article:focus-visible) {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        :global(.sw-article-icon) {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          flex-shrink: 0;
          border-radius: 9px;
          background: var(--color-primary-bg);
          color: var(--color-primary);
        }
        :global(.sw-article-body) {
          display: flex;
          flex-direction: column;
          min-width: 0;
          flex: 1;
        }
        :global(.sw-article-title) {
          font-size: 12.5px;
          font-weight: 700;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        :global(.sw-article-cta) {
          font-size: 11px;
          font-weight: 600;
          color: var(--color-primary);
          margin-top: 1px;
        }
        :global(.sw-article-arrow) {
          flex-shrink: 0;
          color: var(--color-text-disabled);
        }

        /* ── Helpful ──────────────────────────────────────────────────── */
        .sw-helpful {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-top: 12px;
          padding-top: 10px;
          border-top: 1px solid var(--color-border-subtle);
          font-size: 12px;
          color: var(--color-text-muted);
          flex-wrap: wrap;
        }
        .sw-helpful-btns {
          display: flex;
          gap: 6px;
        }
        .sw-yn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          height: 28px;
          padding: 0 11px;
          border-radius: 999px;
          border: 1px solid var(--color-border);
          background: #fff;
          color: var(--color-text-secondary);
          font-size: 11.5px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
          transition: border-color 0.15s, color 0.15s, background 0.15s;
        }
        .sw-yn:hover {
          border-color: var(--color-primary);
          color: var(--color-primary);
          background: var(--color-primary-bg);
        }
        .sw-yn:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        .sw-resolved {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          margin-top: 10px;
          font-size: 11px;
          font-weight: 700;
          color: var(--color-primary);
        }

        /* ── Empty-state launcher ─────────────────────────────────────── */
        .sw-start {
          margin: 6px 0 4px 32px;
        }
        .sw-start-label {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--color-text-disabled);
          margin-bottom: 8px;
        }
        .sw-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 12px;
        }
        .sw-chip {
          height: 32px;
          padding: 0 13px;
          border-radius: 999px;
          border: 1px solid rgba(13, 158, 110, 0.35);
          background: #fff;
          color: var(--color-primary);
          font-family: inherit;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
        }
        .sw-chip:hover {
          background: var(--color-primary-bg);
          transform: translateY(-1px);
          box-shadow: 0 6px 14px -8px rgba(13, 158, 110, 0.5);
        }
        .sw-chip:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        .sw-tiles {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        :global(.sw-tile) {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 11px;
          border-radius: 13px;
          background: #fff;
          border: 1px solid var(--color-border);
          text-decoration: none;
          color: var(--color-dark);
          min-width: 0;
          transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
        }
        :global(.sw-tile:hover) {
          border-color: rgba(13, 158, 110, 0.45);
          box-shadow: 0 8px 18px -10px rgba(15, 25, 35, 0.3);
          transform: translateY(-1px);
        }
        :global(.sw-tile:focus-visible) {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        :global(.sw-tile-icon) {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          flex-shrink: 0;
          border-radius: 10px;
          background: var(--color-primary-bg);
          color: var(--color-primary);
        }
        :global(.sw-tile-icon-dark) {
          background: var(--color-dark);
          color: var(--color-primary-light);
        }
        :global(.sw-tile-text) {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        :global(.sw-tile-title) {
          font-size: 12.5px;
          font-weight: 800;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        :global(.sw-tile-sub) {
          font-size: 11px;
          color: var(--color-text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* ── Escalation ───────────────────────────────────────────────── */
        .sw-escalate {
          margin: 6px 0 4px 32px;
          padding: 14px;
          border-radius: 16px;
          border: 1px solid var(--color-border);
          background: #fff;
          box-shadow: 0 8px 24px -14px rgba(15, 25, 35, 0.35);
        }
        .sw-escalate-head {
          margin-bottom: 12px;
        }
        .sw-escalate-title {
          font-size: 13.5px;
          font-weight: 800;
          color: var(--color-dark);
          letter-spacing: -0.01em;
        }
        .sw-escalate-sub {
          font-size: 12px;
          color: var(--color-text-muted);
          margin-top: 2px;
          line-height: 1.5;
        }
        :global(.sw-action) {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 10px 12px;
          border-radius: 11px;
          border: 1px solid var(--color-border);
          background: #fff;
          color: var(--color-dark);
          font-size: 12.5px;
          font-weight: 700;
          text-decoration: none;
          transition: border-color 0.15s, color 0.15s, background 0.15s;
        }
        :global(.sw-action:hover) {
          border-color: var(--color-primary);
          color: var(--color-primary);
          background: var(--color-primary-bg);
        }
        :global(.sw-action:focus-visible) {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        :global(.sw-action-primary) {
          justify-content: flex-start;
          padding: 13px 14px;
          margin-bottom: 8px;
          border: none;
          background: linear-gradient(135deg, var(--color-primary) 0%, #0f1923 140%);
          color: #fff;
          font-size: 13.5px;
          font-weight: 800;
          box-shadow: 0 10px 22px -10px rgba(13, 158, 110, 0.6);
        }
        :global(.sw-action-primary:hover) {
          color: #fff;
          background: linear-gradient(135deg, var(--color-primary-light) 0%, #0f1923 150%);
        }
        :global(.sw-action-arrow) {
          margin-left: auto;
          opacity: 0.85;
        }
        .sw-action-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        /* ── Composer ─────────────────────────────────────────────────── */
        .sw-foot {
          flex-shrink: 0;
          padding: 10px 12px 10px;
          border-top: 1px solid var(--color-border-subtle);
          background: var(--color-surface);
        }
        .sw-composer {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 5px 5px 5px 6px;
          border-radius: 999px;
          border: 1px solid var(--color-border);
          background: #fafaf8;
          transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
        }
        .sw-composer:focus-within {
          border-color: var(--color-primary);
          background: #fff;
          box-shadow: 0 0 0 3px var(--color-primary-bg);
        }
        .sw-input {
          flex: 1;
          min-width: 0;
          height: 38px;
          padding: 0 10px;
          border: none;
          background: transparent;
          font-family: inherit;
          /* 16px stops iOS Safari zooming the whole page on focus. */
          font-size: 16px;
          color: var(--color-dark);
          outline: none;
        }
        .sw-input::placeholder {
          color: var(--color-text-disabled);
        }
        .sw-send {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 38px;
          height: 38px;
          flex-shrink: 0;
          border: none;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--color-primary-light), var(--color-primary));
          color: #fff;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(13, 158, 110, 0.35);
          transition: transform 0.15s, opacity 0.15s, box-shadow 0.15s;
        }
        .sw-send:hover:not(:disabled) {
          transform: scale(1.05);
        }
        .sw-send:disabled {
          background: #e2e8f0;
          color: #94a3b8;
          box-shadow: none;
          cursor: not-allowed;
        }
        .sw-send:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        .sw-foot-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-top: 8px;
          padding: 0 4px;
        }
        .sw-foot-hint {
          font-size: 10.5px;
          color: var(--color-text-disabled);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        :global(.sw-full) {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          flex-shrink: 0;
          font-size: 11px;
          font-weight: 700;
          color: var(--color-primary);
          text-decoration: none;
        }
        :global(.sw-full:hover) {
          text-decoration: underline;
        }
        .sw-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
        }

        /* ── Responsive ───────────────────────────────────────────────── */
        /* Above the tab-bar breakpoint there is no bottom nav to clear. */
        @media (min-width: 769px) {
          .sw-bubble,
          .sw-panel {
            bottom: 24px;
            right: 24px;
          }
          .sw-panel {
            max-height: min(640px, calc(100dvh - 120px));
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
          .sw-bubble-icon {
            width: 52px;
            height: 52px;
          }
          .sw-tiles,
          .sw-action-row {
            grid-template-columns: 1fr;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .sw-bubble:hover,
          .sw-chip:hover,
          .sw-send:hover:not(:disabled) {
            transform: none;
          }
          .sw-panel {
            animation: none;
          }
          .sw-dot {
            animation: none;
            opacity: 0.7;
          }
        }
      `}</style>
    </>
  );
}
