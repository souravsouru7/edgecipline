"use client";

import { memo } from "react";
import { Sparkles, User, AlertTriangle } from "lucide-react";

// Lightweight bubble. We treat double-newlines as paragraph breaks and single
// newlines as soft line breaks — enough structure for streaming Markdown-ish
// output without pulling in a Markdown parser.
function renderContent(text) {
  if (!text) return null;
  return String(text)
    .split(/\n{2,}/)
    .map((paragraph, pi) => (
      <p key={pi} style={{ margin: pi === 0 ? 0 : "8px 0 0", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
        {paragraph}
      </p>
    ));
}

function CoachMessage({ message, streaming }) {
  const isAssistant = message.role === "assistant";
  const isError = message.status === "error";
  const isStreaming = streaming && message.status === "streaming";

  return (
    <article
      style={{
        display: "flex",
        gap: 10,
        flexDirection: isAssistant ? "row" : "row-reverse",
        alignItems: "flex-start",
      }}
    >
      <div
        aria-hidden
        style={{
          width: 30,
          height: 30,
          borderRadius: 10,
          background: isAssistant ? "rgba(139, 92, 246, 0.14)" : "rgba(13, 158, 110, 0.12)",
          color: isAssistant ? "#7C3AED" : "#0D9E6E",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {isAssistant ? <Sparkles size={15} /> : <User size={15} />}
      </div>

      <div style={{
        maxWidth: "82%",
        padding: "10px 14px",
        borderRadius: 14,
        borderTopLeftRadius: isAssistant ? 4 : 14,
        borderTopRightRadius: isAssistant ? 14 : 4,
        background: isError
          ? "rgba(214, 59, 59, 0.06)"
          : isAssistant
            ? "#FFFFFF"
            : "rgba(13, 158, 110, 0.08)",
        border: isError
          ? "1px solid rgba(214, 59, 59, 0.25)"
          : isAssistant
            ? "1px solid #E2E8F0"
            : "1px solid rgba(13, 158, 110, 0.18)",
        color: "#0F1923",
        fontSize: 13,
        boxShadow: isAssistant ? "0 1px 3px rgba(15,25,35,0.04)" : "none",
        minWidth: 60,
      }}>
        {isError && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#D63B3B", fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
            <AlertTriangle size={12} /> {"Coach couldn't reply"}
          </div>
        )}
        {renderContent(message.content) || (
          <span style={{ color: "#94A3B8", fontSize: 12 }}>…</span>
        )}
        {isStreaming && (
          <span aria-hidden style={{ display: "inline-block", width: 6, height: 12, marginLeft: 4, background: "#7C3AED", verticalAlign: -1, animation: "coachblink 0.9s infinite" }} />
        )}
      </div>

      <style jsx>{`
        @keyframes coachblink {
          0%, 60% { opacity: 1; }
          61%, 100% { opacity: 0.15; }
        }
      `}</style>
    </article>
  );
}

export default memo(CoachMessage);
