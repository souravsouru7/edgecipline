"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X, SendHorizonal, Sparkles, Loader2, RefreshCw } from "lucide-react";
import CoachMessage from "./CoachMessage";
import CoachQuickPrompts from "./CoachQuickPrompts";
import CoachQuotaPill from "./CoachQuotaPill";
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
export default function CoachChat({
  open = true,
  onClose,
  mode = "modal",
  conversationId,
  anchor,
  market,
  defaultPrompt = "",
  title,
}) {
  const isModal = mode === "modal";
  const inputRef = useRef(null);
  const scrollerRef = useRef(null);
  const [draft, setDraft] = useState(defaultPrompt || "");

  const quotaQuery = useCoachQuota();
  const promptsQuery = useQuickPrompts(anchor?.kind || "freeform");
  const existing = useCoachConversation(conversationId);
  const refreshContextMutation = useRefreshCoachContext();

  const initial = existing.data || null;
  const stream = useCoachStream(initial);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [stream.messages.length, stream.streaming]);

  const quota = stream.quota || quotaQuery.data?.quota || null;
  const exhausted = quota && !quota.premium && quota.remaining <= 0;

  const handleSend = async (textOverride) => {
    const value = (textOverride ?? draft).trim();
    if (!value || stream.streaming || exhausted) return;
    setDraft("");
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
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12, padding: "14px 18px", borderBottom: "1px solid #E2E8F0",
        background: "#FFFFFF",
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 8, background: "rgba(139,92,246,0.14)", color: "#7C3AED" }}>
              <Sparkles size={13} />
            </span>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#0F1923", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {headerTitle}
            </div>
            <CoachQuotaPill quota={quota} />
          </div>
          {anchor?.kind && anchor.kind !== "freeform" && (
            <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>
              Anchored to {anchor.kind}{anchor.label ? ` · ${anchor.label}` : ""}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            type="button"
            title="Refresh trader context"
            aria-label="Refresh context"
            onClick={() => refreshContextMutation.mutate()}
            disabled={refreshContextMutation.isPending}
            style={iconBtnStyle}
          >
            <RefreshCw size={14} />
          </button>
          {isModal && (
            <button type="button" aria-label="Close" onClick={onClose} style={iconBtnStyle}>
              <X size={16} />
            </button>
          )}
        </div>
      </header>

      <div
        ref={scrollerRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "18px 18px 8px",
          background: "#F8F9FB",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {stream.messages.length === 0 && (
          <EmptyState anchor={anchor} />
        )}
        {stream.messages.map((m) => (
          <CoachMessage key={m._id} message={m} streaming={stream.streaming} />
        ))}
        {stream.error && stream.error.code !== "COACH_QUOTA_EXHAUSTED" && (
          <div style={{ fontSize: 11, color: "#D63B3B", textAlign: "center" }}>
            {stream.error.message}
          </div>
        )}
      </div>

      <footer style={{ borderTop: "1px solid #E2E8F0", background: "#FFFFFF" }}>
        <div style={{ padding: "10px 14px 6px" }}>
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
            onSubmit={(event) => { event.preventDefault(); handleSend(); }}
            style={{ display: "flex", gap: 8, padding: "8px 14px 14px" }}
          >
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, 1200))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              placeholder={stream.streaming ? "Coach is replying…" : "Ask about a trade, a leak, the week…"}
              rows={1}
              disabled={stream.streaming}
              style={{
                flex: 1,
                resize: "none",
                border: "1px solid #CBD5E1",
                borderRadius: 12,
                padding: "10px 12px",
                fontFamily: "inherit",
                fontSize: 13,
                outline: "none",
                color: "#0F1923",
                background: "#FFFFFF",
                minHeight: 42,
                maxHeight: 120,
                lineHeight: 1.5,
              }}
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={!draft.trim() || stream.streaming}
              style={{
                width: 42, height: 42,
                borderRadius: 12,
                border: "none",
                background: !draft.trim() || stream.streaming ? "#CBD5E1" : "#0D9E6E",
                color: "#FFFFFF",
                cursor: !draft.trim() || stream.streaming ? "default" : "pointer",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
                boxShadow: !draft.trim() || stream.streaming ? "none" : "0 6px 14px rgba(13,158,110,0.25)",
              }}
            >
              {stream.streaming ? <Loader2 size={16} className="spin" /> : <SendHorizonal size={16} />}
            </button>
          </form>
        )}
      </footer>

      <style jsx>{`
        @keyframes spinkey { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spinkey 0.9s linear infinite; }
      `}</style>
    </Container>
  );
}

const iconBtnStyle = {
  width: 32, height: 32, borderRadius: 8, border: "none",
  background: "transparent", color: "#64748B", cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};

function ModalShell({ children, onClose }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Coach chat"
      style={{
        position: "fixed", inset: 0, zIndex: 1100,
        background: "rgba(15, 25, 35, 0.55)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose?.(); }}
    >
      <div style={{
        width: "100%", maxWidth: 640,
        height: "min(86vh, 720px)",
        background: "#FFFFFF",
        borderTopLeftRadius: 18, borderTopRightRadius: 18,
        boxShadow: "0 -16px 40px rgba(15,25,35,0.18)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        {children}
      </div>
    </div>
  );
}

function InlineShell({ children }) {
  return (
    <div style={{
      height: "100%", display: "flex", flexDirection: "column",
      minWidth: 0,
      width: "100%",
      background: "#FFFFFF",
      border: "1px solid #E2E8F0",
      borderRadius: 14,
      overflow: "hidden",
      boxShadow: "0 2px 12px rgba(15,25,35,0.05)",
    }}>
      {children}
    </div>
  );
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
      margin: "auto 0", textAlign: "center", color: "#94A3B8",
      fontSize: 13, lineHeight: 1.6, padding: "30px 12px",
    }}>
      <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 42, height: 42, borderRadius: 14, background: "rgba(139,92,246,0.12)", color: "#7C3AED", marginBottom: 10 }}>
        <Sparkles size={20} />
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#0F1923", marginBottom: 4 }}>Edgecipline Coach</div>
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
      color: "#0F1923",
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
    }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#D63B3B" }}>You&apos;ve used your 5 free questions this week.</div>
        <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
          Resets {quota?.resetsAt ? new Date(quota.resetsAt).toLocaleDateString() : "soon"}.
        </div>
      </div>
      <Link
        href="/profile?section=billing"
        style={{
          padding: "8px 14px",
          borderRadius: 10,
          background: "#0F1923",
          color: "#FFFFFF",
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
