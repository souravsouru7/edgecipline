"use client";

import { memo } from "react";
import { Sparkles, User, AlertTriangle, RotateCw } from "lucide-react";

// Lightweight bubble. We treat double-newlines as paragraph breaks and single
// newlines as soft line breaks — enough structure for streaming Markdown-ish
// output without pulling in a Markdown parser.
// The model sometimes answers in light markdown. Show **bold** as bold and
// "- " / "* " list lines as bullets instead of raw asterisks. Built from
// React nodes only — never injected as HTML.
function renderInline(line, key) {
  const parts = String(line).split(/\*\*([^*\n]+)\*\*/g);
  return parts.map((part, i) => (i % 2 === 1 ? <strong key={`${key}-${i}`}>{part}</strong> : part));
}

function renderContent(text) {
  if (!text) return null;
  return String(text)
    .split(/\n{2,}/)
    .map((paragraph, pi) => {
      const lines = paragraph.split("\n").map((line) => line.replace(/^\s*[-*]\s+(?=\S)/, "• "));
      return (
        <p key={pi} className="cm-p">
          {lines.map((line, li) => (
            <span key={li}>
              {li > 0 && "\n"}
              {renderInline(line, `${pi}-${li}`)}
            </span>
          ))}
        </p>
      );
    });
}

// Layout lives in classes, not inline styles, so phones can restyle it: on a
// 360px screen two 30px avatars and an 82% bubble left ~240px for text. Below
// 600px the coach reply runs full width without a bubble (the ChatGPT/Claude
// pattern) and the user's own message stays a right-aligned bubble.
function CoachMessage({ message, streaming, onRetry }) {
  const isAssistant = message.role === "assistant";
  const isError = message.status === "error";
  const isStreaming = streaming && message.status === "streaming";
  // `retryable` is set by the server. Retrying is pointless for a blocked
  // question or an exhausted quota, so those get no button.
  const canRetry =
    isError &&
    message.retryable &&
    Boolean(message.retryPrompt) &&
    Boolean(onRetry) &&
    !["COACH_QUOTA_EXHAUSTED", "COACH_BLOCKED"].includes(message.errorCode);

  const variant = isError ? "error" : isAssistant ? "assistant" : "user";

  return (
    <article className={`cm cm-${isAssistant ? "assistant" : "user"}`}>
      <div aria-hidden className="cm-avatar">
        {isAssistant ? <Sparkles size={15} /> : <User size={15} />}
      </div>

      <div className={`cm-bubble cm-bubble-${variant}`}>
        {isAssistant && (
          <div className="cm-label" aria-hidden>
            <Sparkles size={12} /> Coach
          </div>
        )}
        {isError ? (
          <div className="cm-error">
            <AlertTriangle size={14} color="#D63B3B" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
            <div role="alert">{message.content || "Coach couldn't reply."}</div>
          </div>
        ) : (
          renderContent(message.content) || <span className="cm-typing" aria-label="Coach is typing"><i /><i /><i /></span>
        )}

        {/* Only our own failures are worth re-asking. A blocked question or an
            exhausted quota will fail again the same way, so no button. */}
        {isError && canRetry && (
          <button type="button" className="cm-retry" onClick={() => onRetry?.(message)}>
            <RotateCw size={14} /> Try again
          </button>
        )}
        {isStreaming && message.content && <span aria-hidden className="cm-caret" />}
      </div>

      <style jsx>{`
        .cm {
          display: flex;
          gap: 10px;
          align-items: flex-start;
        }
        .cm-user { flex-direction: row-reverse; }

        .cm-avatar {
          width: 30px;
          height: 30px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .cm-assistant .cm-avatar { background: rgba(139, 92, 246, 0.14); color: #7C3AED; }
        .cm-user .cm-avatar { background: rgba(13, 158, 110, 0.12); color: var(--lg-green, #0D9E6E); }

        .cm-bubble {
          max-width: 82%;
          min-width: 60px;
          padding: 10px 14px;
          border-radius: 14px;
          color: var(--lg-ink, #0F1923);
          font-size: 13.5px;
          overflow-wrap: anywhere;
        }
        .cm-bubble-assistant {
          background: var(--lg-card, #FFFFFF);
          border: 1px solid var(--lg-line, #E2E8F0);
          border-top-left-radius: 4px;
          box-shadow: 0 1px 3px rgba(15, 25, 35, 0.04);
        }
        .cm-bubble-user {
          background: rgba(13, 158, 110, 0.1);
          border: 1px solid rgba(13, 158, 110, 0.2);
          border-top-right-radius: 4px;
        }
        .cm-bubble-error {
          background: rgba(214, 59, 59, 0.06);
          border: 1px solid rgba(214, 59, 59, 0.25);
          border-top-left-radius: 4px;
        }

        .cm-label { display: none; }

        .cm-bubble :global(.cm-p) {
          margin: 0;
          line-height: 1.6;
          white-space: pre-wrap;
        }
        .cm-bubble :global(.cm-p + .cm-p) { margin-top: 8px; }

        .cm-error {
          display: flex;
          gap: 8px;
          align-items: flex-start;
          color: var(--lg-red, #B23030);
          line-height: 1.5;
        }

        .cm-retry {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          margin-top: 10px;
          min-height: 44px;
          padding: 0 16px;
          width: 100%;
          border-radius: 10px;
          border: 1px solid rgba(214, 59, 59, 0.3);
          background: var(--lg-card, #FFFFFF);
          color: var(--lg-red, #B23030);
          font: inherit;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          touch-action: manipulation;
        }

        .cm-caret {
          display: inline-block;
          width: 6px;
          height: 13px;
          margin-left: 4px;
          background: #7C3AED;
          vertical-align: -2px;
          animation: coachblink 0.9s infinite;
        }
        .cm-typing { display: inline-flex; gap: 4px; padding: 6px 0; }
        .cm-typing i {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #A78BFA;
          animation: coachdot 1.2s infinite ease-in-out;
        }
        .cm-typing i:nth-child(2) { animation-delay: 0.15s; }
        .cm-typing i:nth-child(3) { animation-delay: 0.3s; }

        @keyframes coachblink {
          0%, 60% { opacity: 1; }
          61%, 100% { opacity: 0.15; }
        }
        @keyframes coachdot {
          0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-3px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .cm-caret, .cm-typing i { animation: none; }
        }

        @media (max-width: 600px) {
          .cm-avatar { display: none; }
          .cm-bubble { font-size: 15px; }

          .cm-bubble-assistant {
            max-width: 100%;
            width: 100%;
            padding: 0 2px;
            background: none;
            border: none;
            box-shadow: none;
          }
          .cm-label {
            display: flex;
            align-items: center;
            gap: 5px;
            margin-bottom: 4px;
            font-size: 12px;
            font-weight: 800;
            color: #7C3AED;
          }
          .cm-bubble-user {
            max-width: 85%;
            border-radius: 18px;
            border-bottom-right-radius: 6px;
            border-top-right-radius: 18px;
            padding: 10px 14px;
          }
          .cm-bubble-error { max-width: 100%; width: 100%; }
        }
      `}</style>
    </article>
  );
}

export default memo(CoachMessage);
