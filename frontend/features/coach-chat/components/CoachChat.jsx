"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { X, ArrowUp, Sparkles, Loader2, RefreshCw, ChevronLeft, ArrowDown } from "lucide-react";
import CoachMessage from "./CoachMessage";
import CoachQuickPrompts from "./CoachQuickPrompts";
import CoachQuotaPill from "./CoachQuotaPill";
import BottomSheet from "@/features/shared/components/BottomSheet";
import {
  useCoachConversation,
  useCoachQuota,
  useCoachStream,
  useQuickPrompts,
  useRefreshCoachContext,
} from "@/features/coach-chat/hooks/useCoach";

// The main chat surface. Used both as a modal/sheet (`mode="modal"`) anchored
// to something the user clicked ("Ask Coach about this insight"), and as an
// inline panel on the dedicated /coach page (`mode="inline"`).
//
// When `conversationId` is provided we open an existing thread; otherwise the
// first send call creates a new conversation server-side using the supplied
// `anchor` (insight, trade, reflection, etc.).
// A failure that happened in this session carries everything a retry needs on
// the message itself. One loaded from the server after a reopen doesn't, so
// rebuild it: the question to re-ask is the user turn right above the failed
// reply, and the code is the prefix we persist in `error`.
const RETRYABLE_CODES = ["COACH_UNAVAILABLE", "COACH_BUSY", "COACH_STREAM_ERROR", "COACH_EMPTY_RESPONSE"];

function withRetryContext(messages) {
  if (!messages?.some((m) => m.status === "error" && !m.retryPrompt)) return messages;
  let lastUser = null;
  return messages.map((m) => {
    if (m.role === "user") {
      lastUser = m;
      return m;
    }
    if (m.status !== "error" || m.retryPrompt || !lastUser) return m;
    const code = String(m.error || "").split(":")[0].trim() || "COACH_STREAM_ERROR";
    return {
      ...m,
      errorCode: code,
      retryable: RETRYABLE_CODES.includes(code),
      retryPrompt: lastUser.content,
      retryUserMessageId: lastUser._id,
    };
  });
}

// Phones and tablets: no physical keyboard, so Enter inserts a newline (the
// send button sends) and we never pop the keyboard open uninvited.
function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(pointer: coarse)");
    const sync = () => setCoarse(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  return coarse;
}

// How close to the bottom (px) still counts as "reading the latest message".
const STICK_THRESHOLD = 120;
const MAX_INPUT_HEIGHT = 132; // ~5 lines at 16px

export default function CoachChat({
  open = true,
  onClose,
  mode = "modal",
  conversationId,
  anchor,
  market,
  defaultPrompt = "",
  title,
  onBack,
}) {
  const isModal = mode === "modal";
  const inputRef = useRef(null);
  const scrollerRef = useRef(null);
  const stickRef = useRef(true);
  const [draft, setDraft] = useState(defaultPrompt || "");
  // Updated only from scroll events; drives the "jump to latest" pill.
  const [atBottom, setAtBottom] = useState(true);
  const coarse = useCoarsePointer();

  const quotaQuery = useCoachQuota();
  const promptsQuery = useQuickPrompts(anchor?.kind || "freeform");
  const existing = useCoachConversation(conversationId);
  const refreshContextMutation = useRefreshCoachContext();

  const initial = existing.data || null;
  const stream = useCoachStream(initial);

  // Autofocus only with a mouse/trackpad. On a phone it threw the keyboard
  // over the conversation the moment it opened.
  useEffect(() => {
    if (!open || !inputRef.current) return;
    if (window.matchMedia?.("(pointer: coarse)").matches) return;
    inputRef.current.focus();
  }, [open]);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    stickRef.current = true;
  }, []);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
    stickRef.current = nearBottom;
    setAtBottom(nearBottom);
  };

  // Follow the reply while it streams in, but only if the reader is already
  // at the bottom. Someone who scrolled up to re-read is not yanked down;
  // they get a "New reply" pill instead.
  const lastContent = stream.messages[stream.messages.length - 1]?.content || "";
  useLayoutEffect(() => {
    if (stickRef.current) scrollToBottom();
  }, [stream.messages.length, lastContent.length, stream.streaming, scrollToBottom]);

  // A different thread always opens at its latest message.
  useEffect(() => {
    stickRef.current = true;
  }, [conversationId]);

  // Stay pinned when the scroller itself changes size: the chat mounting
  // while hidden (display:none on the phone list view, where scrollTo is a
  // no-op) and then being shown, or the keyboard opening and shrinking it.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const showJump = !atBottom && stream.messages.length > 0;

  // Grow with the text up to ~5 lines, then scroll inside.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, [draft]);

  // The server pins a thread's market on its first reply, so prefer what it
  // resolved over the prop the surface opened us with.
  const activeMarket = stream.conversation?.conversation?.market
    || initial?.conversation?.market
    || market;
  const quota = stream.quota || quotaQuery.data?.quota || null;
  const exhausted = quota && !quota.premium && quota.remaining <= 0;

  const handleSend = async (textOverride) => {
    const value = (textOverride ?? draft).trim();
    if (!value || stream.streaming || exhausted) return;
    setDraft("");
    stickRef.current = true;
    await stream.send({
      conversationId: stream.conversation?.conversation?._id || conversationId,
      content: value,
      anchor,
      market,
    });
  };

  if (!open) return null;

  const headerTitle = title
    || stream.conversation?.conversation?.title
    || anchor?.label
    || "Ask Coach";

  const Container = isModal ? ModalShell : InlineShell;

  return (
    <Container onClose={onClose}>
      <header className={`cc-header${isModal ? " cc-header-modal" : ""}`}>
        {onBack && (
          <button type="button" className="cc-icon cc-back" aria-label="Back to conversations" onClick={onBack}>
            <ChevronLeft size={22} strokeWidth={2.4} />
          </button>
        )}
        <span className="cc-badge" aria-hidden>
          <Sparkles size={14} />
        </span>
        <div className="cc-titles">
          <div className="cc-title">{headerTitle}</div>
          {anchor?.kind && !["freeform", "dashboard"].includes(anchor.kind) ? (
            <div className="cc-sub">
              Anchored to {anchor.kind}{anchor.label ? ` · ${anchor.label}` : ""}
            </div>
          ) : (
            <div className={`cc-sub${quota ? " has-quota" : ""}`}>
              <span className="cc-sub-default">Knows your trades &amp; reflections</span>
              {quota && (
                // Phones: the pill squeezed the title to "Why do I…", so the
                // quota moves into this line instead.
                <span className="cc-sub-quota">
                  {quota.premium ? "Premium · unlimited questions" : `${quota.remaining} of ${quota.limit} free questions left this week`}
                </span>
              )}
            </div>
          )}
        </div>
        <span className="cc-quota-pill"><CoachQuotaPill quota={quota} /></span>
        <button
          type="button"
          title="Refresh trader context"
          aria-label="Refresh context"
          onClick={() => refreshContextMutation.mutate(activeMarket)}
          disabled={refreshContextMutation.isPending}
          className="cc-icon"
        >
          <RefreshCw size={16} className={refreshContextMutation.isPending ? "spin" : undefined} />
        </button>
        {isModal && (
          // Solid, 40px, own background: the previous ghost button was 32px
          // with no fill, which on a phone read as decoration and was easy
          // to miss with a thumb.
          <button type="button" aria-label="Close" onClick={onClose} className="cc-icon cc-close">
            <X size={18} strokeWidth={2.4} />
          </button>
        )}
      </header>

      <div className="cc-body">
      <div ref={scrollerRef} onScroll={onScroll} className="cc-scroller">
        {stream.messages.length === 0 && (
          <EmptyState anchor={anchor} />
        )}
        {withRetryContext(stream.messages).map((m) => (
          <CoachMessage
            key={m._id}
            message={m}
            streaming={stream.streaming}
            onRetry={stream.retry}
          />
        ))}
        {/* The failure is stated once, inside the assistant bubble that failed.
            A centered banner here repeated the same sentence directly under it.
            The one case with no bubble to carry it is a send that never
            started, so that alone still needs a line of its own. */}
        {stream.error
          && stream.error.code !== "COACH_QUOTA_EXHAUSTED"
          && !stream.messages.some((m) => m.status === "error") && (
          <div style={{ fontSize: 12, color: "var(--lg-red, #D63B3B)", textAlign: "center" }} role="alert">
            {stream.error.message}
          </div>
        )}
      </div>
      {showJump && (
        <button type="button" className="cc-jump" onClick={() => scrollToBottom(true)}>
          <ArrowDown size={14} /> {stream.streaming ? "New reply" : "Latest"}
        </button>
      )}
      </div>

      <footer className="cc-footer">
        <div className={`cc-prompts${stream.messages.length > 0 ? " cc-prompts-used" : ""}`}>
          <CoachQuickPrompts
            prompts={promptsQuery.data?.prompts || []}
            onSelect={(p) => handleSend(p.prompt)}
            disabled={stream.streaming || exhausted}
          />
        </div>

        {exhausted ? (
          <QuotaExhaustedBanner quota={quota} />
        ) : (
          <form
            className="cc-composer"
            onSubmit={(event) => { event.preventDefault(); handleSend(); }}
          >
            <div className="cc-field">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value.slice(0, 1200))}
                onKeyDown={(event) => {
                  // Desktop: Enter sends, Shift+Enter is a newline. Touch:
                  // Enter is a newline and the button sends, as in every
                  // messaging app, so a stray Return cannot fire a question
                  // that counts against the free quota.
                  if (!coarse && event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={stream.streaming ? "Coach is replying…" : "Ask your coach…"}
                aria-label="Message your coach"
                rows={1}
                enterKeyHint={coarse ? "enter" : "send"}
                disabled={stream.streaming}
                className="cc-input"
              />
              <button
                type="submit"
                aria-label="Send"
                disabled={!draft.trim() || stream.streaming}
                className="cc-send"
              >
                {stream.streaming ? <Loader2 size={18} className="spin" /> : <ArrowUp size={18} strokeWidth={2.6} />}
              </button>
            </div>
          </form>
        )}
      </footer>

      <style jsx>{`
        @keyframes spinkey { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        :global(.spin) { animation: spinkey 0.9s linear infinite; }

        .cc-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 10px 12px 16px;
          border-bottom: 1px solid var(--lg-line, #E2E8F0);
          background: var(--lg-card, #FFFFFF);
          flex-shrink: 0;
          min-width: 0;
        }
        .cc-header-modal { padding: 6px 12px 12px 16px; }
        .cc-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 10px;
          background: rgba(139, 92, 246, 0.14);
          color: #7C3AED;
          flex-shrink: 0;
        }
        .cc-titles { flex: 1; min-width: 0; }
        .cc-title {
          font-size: 14px;
          font-weight: 800;
          color: var(--lg-ink, #0F1923);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .cc-sub {
          font-size: 11.5px;
          color: var(--lg-muted, #94A3B8);
          margin-top: 1px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .cc-icon {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          border: none;
          background: transparent;
          color: var(--lg-sub, #64748B);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
        }
        .cc-icon:active { background: var(--lg-line, #F1F5F9); }
        .cc-icon:disabled { opacity: 0.6; cursor: default; }
        .cc-back { margin-left: -8px; margin-right: -4px; color: var(--lg-ink, #0F1923); }
        .cc-close { background: var(--lg-line, #F1F5F9); color: var(--lg-ink, #0F1923); }

        .cc-body { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
        .cc-scroller {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          padding: 18px 18px 12px;
          background: var(--lg-soft, #F8F9FB);
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .cc-jump {
          position: absolute;
          left: 50%;
          bottom: 12px;
          transform: translateX(-50%);
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 36px;
          padding: 0 14px;
          border-radius: 999px;
          border: 1px solid var(--lg-line, #E2E8F0);
          background: var(--lg-card, #FFFFFF);
          color: #7C3AED;
          font: inherit;
          font-size: 12.5px;
          font-weight: 800;
          box-shadow: 0 6px 18px rgba(15, 25, 35, 0.14);
          cursor: pointer;
          touch-action: manipulation;
        }

        .cc-footer {
          border-top: 1px solid var(--lg-line, #E2E8F0);
          background: var(--lg-card, #FFFFFF);
          flex-shrink: 0;
        }
        .cc-prompts { padding: 10px 14px 2px; }
        .cc-prompts:empty { display: none; }
        .cc-composer { padding: 8px 12px 12px; }
        .cc-field {
          display: flex;
          align-items: flex-end;
          gap: 6px;
          border: 1px solid var(--lg-line-strong, #CBD5E1);
          border-radius: 22px;
          background: var(--lg-card, #FFFFFF);
          padding: 4px 4px 4px 14px;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .cc-field:focus-within {
          border-color: var(--lg-green, #0D9E6E);
          box-shadow: 0 0 0 3px rgba(13, 158, 110, 0.12);
        }
        .cc-input {
          flex: 1;
          min-width: 0;
          resize: none;
          border: none;
          outline: none;
          background: transparent;
          color: var(--lg-ink, #0F1923);
          font-family: inherit;
          /* 16px: anything smaller makes iOS zoom the page on focus. */
          font-size: 16px;
          line-height: 1.45;
          padding: 8px 0;
          min-height: 40px;
          max-height: 132px;
          overflow-y: auto;
        }
        .cc-input::placeholder { color: var(--lg-muted, #94A3B8); }
        .cc-send {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: none;
          background: var(--lg-green, #0D9E6E);
          color: #FFFFFF;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          cursor: pointer;
          touch-action: manipulation;
          transition: background 0.15s ease, transform 0.1s ease;
        }
        .cc-send:active:not(:disabled) { transform: scale(0.94); }
        .cc-send:disabled { background: var(--lg-line-strong, #CBD5E1); cursor: default; }

        @media (pointer: coarse) {
          .cc-icon { width: 44px; height: 44px; }
          .cc-send { width: 42px; height: 42px; }
        }

        .cc-quota-pill { display: inline-flex; flex-shrink: 0; }
        .cc-sub-quota { display: none; }

        @media (max-width: 600px) {
          .cc-quota-pill { display: none; }
          .cc-sub-quota { display: inline; }
          .has-quota .cc-sub-default { display: none; }
          .cc-scroller { padding: 16px 14px 12px; gap: 18px; }
          /* Suggestions start a conversation; once the thread has messages
             they only push the composer up. */
          .cc-prompts-used { display: none; }
        }
      `}</style>
      <style jsx global>{`
        .coach-inline-shell {
          height: 100%;
          display: flex;
          flex-direction: column;
          min-width: 0;
          width: 100%;
          background: var(--lg-card, #FFFFFF);
          border: 1px solid var(--lg-line, #E2E8F0);
          border-radius: 14px;
          overflow: hidden;
          box-shadow: 0 2px 12px rgba(15, 25, 35, 0.05);
        }
      `}</style>
    </Container>
  );
}

function ModalShell({ children, onClose }) {
  return (
    <BottomSheet onClose={onClose} label="Coach chat">
      {children}
    </BottomSheet>
  );
}

// `coach-inline-shell` is a stable global class: the /coach page restyles it
// edge-to-edge when the chat goes full screen on a phone.
function InlineShell({ children }) {
  return <div className="coach-inline-shell">{children}</div>;
}

function EmptyState({ anchor }) {
  const kindLine =
    anchor?.kind === "insight"      ? "Ask why this insight matters, or what to do about it."
    : anchor?.kind === "trade"      ? "Ask why this trade went the way it did, or what to repeat."
    : anchor?.kind === "reflection" ? "Coach me on today's reflection."
    : anchor?.kind === "weekly-report" ? "Ask anything about this week's report."
    : "Ask anything — your trades, streak, reflections, and weekly report are all loaded.";
  return (
    <div style={{
      margin: "auto 0", textAlign: "center", color: "var(--lg-muted, #94A3B8)",
      fontSize: 13, lineHeight: 1.6, padding: "30px 12px",
    }}>
      <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 42, height: 42, borderRadius: 14, background: "rgba(139,92,246,0.12)", color: "#7C3AED", marginBottom: 10 }}>
        <Sparkles size={20} />
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--lg-ink, #0F1923)", marginBottom: 4 }}>Edgecipline Coach</div>
      <div>{kindLine}</div>
    </div>
  );
}

function QuotaExhaustedBanner({ quota }) {
  return (
    <div style={{
      margin: 14,
      padding: "12px 14px",
      borderRadius: 12,
      background: "rgba(214,59,59,0.06)",
      border: "1px solid rgba(214,59,59,0.22)",
      color: "var(--lg-ink, #0F1923)",
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--lg-red, #D63B3B)" }}>You&apos;ve used your 5 free questions this week.</div>
        <div style={{ fontSize: 11, color: "var(--lg-sub, #475569)", marginTop: 2 }}>
          Resets {quota?.resetsAt ? new Date(quota.resetsAt).toLocaleDateString() : "soon"}.
        </div>
      </div>
      <Link
        href="/settings?section=billing"
        style={{
          padding: "8px 14px",
          borderRadius: 10,
          background: "var(--lg-ink, #0F1923)",
          color: "var(--lg-card, #FFFFFF)",
          textDecoration: "none",
          fontWeight: 800,
          fontSize: 12,
        }}
      >
        Go Premium
      </Link>
    </div>
  );
}
