"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Sparkles, Plus, Trash2, MessageSquare } from "lucide-react";
import ErrorBoundary from "@/components/ErrorBoundary";
import PageHeader from "@/features/shared/components/PageHeader";
import { useToast } from "@/features/shared/components/ui/Toast";
import { Button, ResponsiveModal } from "@/features/shared/components/ui";
import { reportUserError } from "@/utils/userMessage";
import { registerDismissable } from "@/utils/backNavigation";
import CoachChat from "@/features/coach-chat/components/CoachChat";
import CoachQuotaPill from "@/features/coach-chat/components/CoachQuotaPill";
import {
  useCoachConversations,
  useCoachQuota,
  useCreateConversation,
  useDeleteConversation,
} from "@/features/coach-chat/hooks/useCoach";

const MOBILE_QUERY = "(max-width: 820px)";

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia(MOBILE_QUERY);
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  return mobile;
}

// "now", "5m", "3h", "Yesterday", "Mon", "12 Oct": the row only needs a hint
// of recency, the way messaging apps show it.
function relativeTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const ms = Date.now() - date.getTime();
  if (Number.isNaN(ms)) return "";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString("en-IN", { weekday: "short" });
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// While the full-screen chat is open on a phone:
//  - Android back / Escape returns to the list. /coach is not a root tab, so
//    without this the back press navigated away from Coach entirely.
//  - The page behind is scroll-locked so swipes don't bleed through.
//  - The layer tracks window.visualViewport. Capacitor shrinks the body for
//    the keyboard (KeyboardResize.Body), but iOS Safari does not, and 100dvh
//    there would leave the composer under the keyboard.
function useMobileChatLayer(active, onBack) {
  const [viewport, setViewport] = useState(null);

  useEffect(() => {
    // A stale viewport from a previous open is harmless: the caller only
    // applies it while the layer is active.
    if (!active || typeof window === "undefined") return undefined;
    const vv = window.visualViewport;
    const html = document.documentElement;
    const body = document.body;
    const prev = { html: html.style.overflow, body: body.style.overflow };
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";

    const sync = () => {
      if (vv) setViewport({ height: Math.round(vv.height), top: Math.round(vv.offsetTop) });
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") onBack();
    };
    sync();
    vv?.addEventListener("resize", sync);
    vv?.addEventListener("scroll", sync);
    window.addEventListener("keydown", onKeyDown);
    const unregister = registerDismissable(onBack);

    return () => {
      html.style.overflow = prev.html;
      body.style.overflow = prev.body;
      vv?.removeEventListener("resize", sync);
      vv?.removeEventListener("scroll", sync);
      window.removeEventListener("keydown", onKeyDown);
      unregister();
    };
  }, [active, onBack]);

  return viewport;
}

function Page() {
  const { addToast } = useToast();
  const conversationsQuery = useCoachConversations();
  const quotaQuery = useCoachQuota();
  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();
  const [selectedId, setSelectedId] = useState(null);
  // Master-detail. Below 820px only one pane shows at a time, and the chat
  // pane goes full screen over the tab bar like any messaging app.
  const [mobilePane, setMobilePane] = useState("list");
  const isMobile = useIsMobile();

  const conversations = useMemo(
    () => conversationsQuery.data?.conversations || [],
    [conversationsQuery.data?.conversations]
  );

  const activeId = useMemo(() => {
    if (selectedId) return selectedId;
    return conversations[0]?._id || null;
  }, [selectedId, conversations]);

  // /coach?ask=<question>: Home's "Today's plan" rows link here with a
  // question built from the trader's numbers. Start a fresh conversation and
  // put the question in the composer: the user reviews it and taps send, so
  // nothing spends coach quota on their behalf. The param is stripped straight
  // away so a refresh or back press never opens a second conversation.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const askHandled = useRef(false);
  const [askDraft, setAskDraft] = useState(null);
  useEffect(() => {
    if (askHandled.current) return;
    const raw = searchParams?.get("ask");
    if (raw === null || raw === undefined) return;
    askHandled.current = true;
    router.replace(pathname || "/coach");
    const text = String(raw).trim().slice(0, 200);
    if (!text) return;
    (async () => {
      try {
        const result = await createConversation.mutateAsync({
          anchor: { kind: "dashboard", label: "Today's plan" },
          market: "any",
        });
        const id = result?.conversation?._id;
        if (!id) return;
        setAskDraft({ id, text });
        setSelectedId(id);
        setMobilePane("chat");
      } catch (err) {
        addToast(
          reportUserError("coach_conversation_create_failed", err, "We couldn't start a conversation. Please try again."),
          "error"
        );
      }
    })();
  }, [searchParams, router, pathname, createConversation, addToast]);

  const backToList = useCallback(() => setMobilePane("list"), []);
  const chatOpenOnMobile = isMobile && mobilePane === "chat" && Boolean(activeId);
  const viewport = useMobileChatLayer(chatOpenOnMobile, backToList);

  const openConversation = (id) => {
    setSelectedId(id);
    setMobilePane("chat");
  };

  const handleNew = async () => {
    try {
      const result = await createConversation.mutateAsync({
        anchor: { kind: "dashboard", label: "New coach session" },
        market: "any",
      });
      openConversation(result.conversation._id);
    } catch (err) {
      addToast(
        reportUserError("coach_conversation_create_failed", err, "We couldn't start a conversation. Please try again."),
        "error"
      );
    }
  };

  // Conversation awaiting delete confirmation: { id, title } or null.
  const [pendingDelete, setPendingDelete] = useState(null);
  const deleting = deleteConversation.isPending;
  const closeDelete = useCallback(() => {
    if (!deleting) setPendingDelete(null);
  }, [deleting]);

  const confirmDelete = async () => {
    const id = pendingDelete?.id;
    if (!id) return;
    try {
      await deleteConversation.mutateAsync(id);
    } catch (err) {
      setPendingDelete(null);
      // Previously unhandled: a failed delete rejected into nothing, so the row
      // stayed and the user was told neither that it failed nor why.
      addToast(
        reportUserError("coach_conversation_delete_failed", err, "We couldn't delete this conversation. Please try again."),
        "error"
      );
      return;
    }
    setPendingDelete(null);
    if (selectedId === id) {
      setSelectedId(null);
      setMobilePane("list");
    }
  };

  const layerStyle = chatOpenOnMobile && viewport
    ? { top: viewport.top, height: viewport.height }
    : undefined;

  return (
    <div className="ec-app ec-home">
      <PageHeader themed showMarketSwitcher={false} title="Coach" />
      <main className="coach-grid" data-pane={mobilePane}>
        <aside className="coach-list">
          <div className="coach-list-head">
            <div className="coach-list-heading">
              <div className="coach-eyebrow">Coach</div>
              <h1>Conversations</h1>
            </div>
            <CoachQuotaPill quota={quotaQuery.data?.quota} />
          </div>

          <button
            type="button"
            onClick={handleNew}
            disabled={createConversation.isPending}
            className="coach-new"
          >
            <Plus size={16} strokeWidth={2.6} /> New conversation
          </button>

          {conversationsQuery.isLoading && (
            <div className="coach-skeletons" aria-hidden>
              <div /><div /><div />
            </div>
          )}

          {!conversationsQuery.isLoading && conversations.length === 0 && (
            <div className="coach-empty-list">
              <Sparkles size={22} color="#7C3AED" />
              <strong>Your coach is ready</strong>
              <span>It already knows your last 20 trades, reflections and weekly report. Start with any question.</span>
            </div>
          )}

          <ul className="coach-rows">
            {conversations.map((c) => {
              const active = c._id === activeId;
              const when = relativeTime(c.lastMessageAt || c.updatedAt || c.createdAt);
              return (
                /* Row and delete are siblings, not nested buttons — a <button>
                   inside role="button" is invalid and confuses screen readers. */
                <li key={c._id} className={`coach-item${active ? " is-active" : ""}`}>
                  <button
                    type="button"
                    onClick={() => openConversation(c._id)}
                    aria-current={active ? "true" : undefined}
                    className="coach-row"
                  >
                    <span className="coach-row-icon" aria-hidden>
                      <MessageSquare size={16} />
                    </span>
                    <span className="coach-row-text">
                      <span className="coach-row-top">
                        <span className="coach-title">{c.title || "Coach session"}</span>
                        {when && <span className="coach-time">{when}</span>}
                      </span>
                      <span className="coach-preview">{c.lastMessagePreview || "No messages yet"}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete({ id: c._id, title: c.title })}
                    aria-label={`Delete conversation: ${c.title || "Coach session"}`}
                    className="coach-del"
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section
          className={`coach-detail${chatOpenOnMobile ? " is-fullscreen" : ""}`}
          style={layerStyle}
          aria-label="Coach chat"
        >
          {activeId ? (
            <CoachChat
              // Remount when a ?ask= question lands so the composer picks it up.
              key={askDraft?.id === activeId ? `${activeId}:ask` : activeId}
              mode="inline"
              open
              conversationId={activeId}
              defaultPrompt={askDraft?.id === activeId ? askDraft.text : ""}
              anchor={{ kind: "dashboard" }}
              onBack={isMobile ? backToList : undefined}
            />
          ) : (
            <div className="coach-welcome">
              <span className="coach-welcome-badge"><Sparkles size={26} /></span>
              <h2>Ask your coach anything.</h2>
              <p>
                Every reply is grounded in your last 20 trades, your reflections, your discipline streak, and your most recent weekly report.
                Nothing generic.
              </p>
              <button type="button" onClick={handleNew} disabled={createConversation.isPending} className="coach-new coach-welcome-cta">
                Start a conversation
              </button>
              <Link href="/intelligence" className="coach-welcome-link">
                Or browse insights first →
              </Link>
            </div>
          )}
        </section>
      </main>

      <ResponsiveModal open={Boolean(pendingDelete)} onClose={closeDelete} title="Delete conversation?" width={420}>
        <p className="ec-journal__confirm">
          <strong>{pendingDelete?.title || "This conversation"}</strong> and all its messages will be permanently deleted. This can&apos;t be undone.
        </p>
        <div className="ec-journal__confirm-actions">
          <Button variant="secondary" onClick={closeDelete} disabled={deleting}>Cancel</Button>
          <Button variant="danger" onClick={confirmDelete} loading={deleting}>Delete</Button>
        </div>
      </ResponsiveModal>

      <style jsx global>{`
        .coach-grid {
          flex: 1;
          max-width: 1100px;
          width: 100%;
          margin: 0 auto;
          padding: 20px 16px 40px;
          box-sizing: border-box;
          display: grid;
          grid-template-columns: minmax(260px, 300px) minmax(0, 1fr);
          gap: 16px;
        }

        .coach-list {
          background: var(--lg-card, #FFFFFF);
          border: 1px solid var(--lg-line, #E2E8F0);
          border-radius: 14px;
          padding: 14px;
          height: fit-content;
          min-width: 0;
          overflow: hidden;
        }
        .coach-list-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 12px;
        }
        .coach-eyebrow {
          font-size: 11px;
          color: var(--lg-muted, #94A3B8);
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .coach-list-heading h1 { margin: 2px 0 0; font-size: 16px; font-weight: 800; color: var(--lg-ink, #0F1923); }

        .coach-new {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          min-height: 44px;
          padding: 0 16px;
          margin-bottom: 12px;
          border: none;
          border-radius: 12px;
          background: var(--lg-green, #0D9E6E);
          color: #FFFFFF;
          font: inherit;
          font-size: 14px;
          font-weight: 800;
          cursor: pointer;
          touch-action: manipulation;
          box-shadow: 0 6px 16px rgba(13, 158, 110, 0.22);
          transition: transform 0.1s ease, opacity 0.15s ease;
        }
        .coach-new:active:not(:disabled) { transform: scale(0.98); }
        .coach-new:disabled { opacity: 0.65; cursor: default; }

        .coach-skeletons { display: grid; gap: 8px; }
        .coach-skeletons div {
          height: 64px;
          border-radius: 12px;
          background: var(--lg-line, #F1F5F9);
          animation: coachpulse 1.2s ease-in-out infinite;
        }
        @keyframes coachpulse { 50% { opacity: 0.55; } }

        .coach-empty-list {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 22px 14px;
          text-align: center;
          border: 1px dashed var(--lg-line-strong, #CBD5E1);
          border-radius: 12px;
          color: var(--lg-sub, #64748B);
          font-size: 12.5px;
          line-height: 1.55;
        }
        .coach-empty-list strong { color: var(--lg-ink, #0F1923); font-size: 14px; }

        .coach-rows { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; min-width: 0; }
        .coach-item {
          display: flex;
          align-items: stretch;
          min-width: 0;
          overflow: hidden;
          border: 1px solid var(--lg-line, #E2E8F0);
          border-radius: 12px;
          background: var(--lg-card, #FFFFFF);
        }
        .coach-item.is-active {
          border-color: rgba(139, 92, 246, 0.5);
          background: rgba(139, 92, 246, 0.06);
        }

        /* Conversation row: fills the card, leaves the delete button its own
           hit area beside it rather than nested inside. */
        .coach-row {
          flex: 1;
          min-width: 0;
          min-height: 64px;
          display: flex;
          gap: 10px;
          align-items: center;
          text-align: left;
          padding: 10px 6px 10px 12px;
          background: none;
          border: none;
          font: inherit;
          color: inherit;
          cursor: pointer;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
        }
        .coach-row:active { background: rgba(15, 25, 35, 0.04); }
        .coach-row-icon {
          width: 36px;
          height: 36px;
          border-radius: 11px;
          display: grid;
          place-items: center;
          flex-shrink: 0;
          background: var(--lg-soft, #F1F5F9);
          color: var(--lg-muted, #94A3B8);
        }
        .coach-item.is-active .coach-row-icon { background: rgba(139, 92, 246, 0.14); color: #7C3AED; }
        .coach-row-text { min-width: 0; flex: 1; display: block; }
        .coach-row-top { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
        .coach-title {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 13.5px;
          font-weight: 800;
          color: var(--lg-ink, #0F1923);
          line-height: 1.35;
        }
        .coach-time { flex-shrink: 0; font-size: 11px; color: var(--lg-muted, #94A3B8); font-weight: 600; }
        .coach-preview {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12px;
          color: var(--lg-sub, #64748B);
          margin-top: 3px;
          line-height: 1.45;
        }

        /* Was a 12px icon in 4px padding — a 20x20 target sitting directly on
           top of the row, so a mis-tap deleted the conversation. */
        .coach-del {
          width: 46px;
          align-self: stretch;
          display: grid;
          place-items: center;
          flex-shrink: 0;
          background: none;
          border: none;
          color: var(--lg-muted, #94A3B8);
          opacity: 0.7;
          cursor: pointer;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
        }
        .coach-del:hover { opacity: 1; }
        .coach-del:active { background: rgba(214, 59, 59, 0.09); color: var(--lg-red, #D63B3B); opacity: 1; }

        .coach-detail {
          min-height: 540px;
          height: calc(100dvh - 160px);
          min-width: 0;
          display: flex;
          flex-direction: column;
        }

        .coach-welcome {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          border: 1px dashed var(--lg-line-strong, #CBD5E1);
          border-radius: 14px;
          background: var(--lg-soft, #F8F9FB);
          color: var(--lg-sub, #64748B);
          padding: 24px;
          text-align: center;
        }
        .coach-welcome-badge {
          display: grid;
          place-items: center;
          width: 56px;
          height: 56px;
          border-radius: 18px;
          background: rgba(139, 92, 246, 0.12);
          color: #7C3AED;
        }
        .coach-welcome h2 { margin: 14px 0 6px; font-size: 18px; font-weight: 800; color: var(--lg-ink, #0F1923); }
        .coach-welcome p { margin: 0; font-size: 13.5px; line-height: 1.6; max-width: 440px; }
        .coach-welcome-cta { width: auto; margin: 18px 0 0; }
        .coach-welcome-link {
          display: inline-flex;
          align-items: center;
          min-height: 44px;
          font-size: 12.5px;
          color: #7C3AED;
          font-weight: 700;
          text-decoration: none;
        }

        @media (max-width: 820px) {
          .coach-grid {
            grid-template-columns: 1fr;
            padding: 12px 12px 16px;
          }

          /* One pane at a time. Both panes stacked meant scrolling past the
             whole list to reach the composer. */
          .coach-grid[data-pane="list"] .coach-detail { display: none; }
          .coach-grid[data-pane="chat"] .coach-list { display: none; }

          /* The page header already says "Coach". */
          .coach-eyebrow { display: none; }
          .coach-list { padding: 14px 12px; border-radius: 16px; }
          .coach-list-heading h1 { font-size: 18px; margin: 0; }
          .coach-new { min-height: 48px; font-size: 15px; border-radius: 14px; }
          .coach-row { min-height: 68px; }
          .coach-title { font-size: 14.5px; }
          .coach-preview { font-size: 13px; }

          .coach-detail {
            height: auto;
            min-height: calc(100dvh - 220px);
          }

          /* Full-screen chat: covers the app header and the tab bar, like
             WhatsApp / ChatGPT. top/height come from visualViewport inline
             so the composer rides on top of the keyboard. */
          .coach-detail.is-fullscreen {
            position: fixed;
            left: 0;
            right: 0;
            top: 0;
            height: 100dvh;
            min-height: 0;
            z-index: 1050;
            background: var(--lg-card, #FFFFFF);
            animation: coachslide 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
          }
          .coach-detail.is-fullscreen .coach-inline-shell {
            border: none;
            border-radius: 0;
            box-shadow: none;
          }
          .coach-detail.is-fullscreen .cc-header {
            padding-top: calc(10px + env(safe-area-inset-top, 0px));
          }
          .coach-detail.is-fullscreen .cc-footer {
            padding-bottom: env(safe-area-inset-bottom, 0px);
          }
        }

        @keyframes coachslide {
          from { transform: translateX(24px); opacity: 0; }
          to { transform: none; opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .coach-detail.is-fullscreen, .coach-skeletons div { animation: none; }
        }
      `}</style>
    </div>
  );
}

export default function CoachPage() {
  return (
    <ErrorBoundary fallback={<div style={{ padding: "2rem", textAlign: "center" }}>Coach failed to load. Please refresh.</div>}>
      <Suspense><Page /></Suspense>
    </ErrorBoundary>
  );
}
