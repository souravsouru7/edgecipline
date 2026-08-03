"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { Sparkles, Plus, Trash2, MessageSquare, ChevronLeft } from "lucide-react";
import ErrorBoundary from "@/components/ErrorBoundary";
import PageHeader from "@/features/shared/components/PageHeader";
import CoachChat from "@/features/coach-chat/components/CoachChat";
import CoachQuotaPill from "@/features/coach-chat/components/CoachQuotaPill";
import {
  useCoachConversations,
  useCoachQuota,
  useCreateConversation,
  useDeleteConversation,
} from "@/features/coach-chat/hooks/useCoach";

function Page() {
  const conversationsQuery = useCoachConversations();
  const quotaQuery = useCoachQuota();
  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();
  const [selectedId, setSelectedId] = useState(null);
  // Master-detail on one screen. Below 820px only one pane is shown at a time —
  // stacking the full conversation list on top of a 100dvh chat pushed the
  // message input a screen and a half down the page.
  const [mobilePane, setMobilePane] = useState("list");

  const conversations = useMemo(
    () => conversationsQuery.data?.conversations || [],
    [conversationsQuery.data?.conversations]
  );

  const activeId = useMemo(() => {
    if (selectedId) return selectedId;
    return conversations[0]?._id || null;
  }, [selectedId, conversations]);

  const openConversation = (id) => {
    setSelectedId(id);
    setMobilePane("chat");
  };

  const handleNew = async () => {
    const result = await createConversation.mutateAsync({
      anchor: { kind: "dashboard", label: "New coach session" },
      market: "any",
    });
    openConversation(result.conversation._id);
  };

  const handleDelete = async (id, title) => {
    if (!confirm(`Delete "${title || "this conversation"}"? This cannot be undone.`)) return;
    await deleteConversation.mutateAsync(id);
    if (selectedId === id) {
      setSelectedId(null);
      setMobilePane("list");
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#F4F2EE",
      display: "flex",
      flexDirection: "column",
      fontFamily: "'Plus Jakarta Sans',sans-serif",
      color: "#0F1923",
    }}>
      <PageHeader showClock={false} />
      <main style={{
        flex: 1,
        maxWidth: 1100,
        width: "100%",
        margin: "0 auto",
        padding: "20px 16px 100px",
        boxSizing: "border-box",
        display: "grid",
        gridTemplateColumns: "minmax(240px, 280px) minmax(0, 1fr)",
        gap: 16,
      }} className="coach-grid" data-pane={mobilePane}>
        <aside className="coach-list" style={{
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: 14,
          padding: 14,
          height: "fit-content",
          minWidth: 0,
          overflow: "hidden",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>Coach</div>
              <h1 style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 800 }}>Conversations</h1>
            </div>
            <CoachQuotaPill quota={quotaQuery.data?.quota} />
          </div>

          <button
            type="button"
            onClick={handleNew}
            disabled={createConversation.isPending}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
              width: "100%", padding: "10px", marginBottom: 12, fontWeight: 800,
              border: "none", borderRadius: 12, background: "#0D9E6E", color: "#FFFFFF",
              cursor: createConversation.isPending ? "default" : "pointer",
            }}
          >
            <Plus size={14} /> New conversation
          </button>

          {conversationsQuery.isLoading && (
            <div style={{ height: 72, borderRadius: 10, background: "#F1F5F9" }} />
          )}

          {!conversationsQuery.isLoading && conversations.length === 0 && (
            <div style={{ padding: "18px 12px", textAlign: "center", color: "#94A3B8", fontSize: 12, border: "1px dashed #CBD5E1", borderRadius: 10 }}>
              No conversations yet. Tap &quot;New conversation&quot; to start.
            </div>
          )}

          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6, minWidth: 0 }}>
            {conversations.map((c) => {
              const active = c._id === activeId;
              return (
                /* Row and delete are siblings, not nested buttons — a <button>
                   inside role="button" is invalid and confuses screen readers. */
                <li
                  key={c._id}
                  style={{
                    display: "flex",
                    alignItems: "stretch",
                    minWidth: 0,
                    overflow: "hidden",
                    border: active ? "1px solid rgba(139,92,246,0.5)" : "1px solid #E2E8F0",
                    borderRadius: 10,
                    background: active ? "rgba(139,92,246,0.06)" : "#FFFFFF",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => openConversation(c._id)}
                    aria-current={active ? "true" : undefined}
                    className="coach-row"
                  >
                    <MessageSquare size={15} color={active ? "#7C3AED" : "#94A3B8"} style={{ marginTop: 2, flexShrink: 0 }} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="coach-title">{c.title || "Coach session"}</span>
                      <span className="coach-preview">{c.lastMessagePreview || "—"}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(c._id, c.title)}
                    aria-label={`Delete conversation: ${c.title || "Coach session"}`}
                    className="coach-del"
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* dvh, not vh: mobile browser chrome makes 100vh taller than the
            visible viewport, which pushed the composer under the bottom nav. */}
        <section className="coach-detail" style={{ minHeight: 540, height: "calc(100dvh - 160px)", minWidth: 0, display: "flex", flexDirection: "column" }}>
          <button type="button" className="coach-back" onClick={() => setMobilePane("list")}>
            <ChevronLeft size={17} /> Conversations
          </button>
          {activeId ? (
            <div style={{ flex: 1, minHeight: 0 }}>
              <CoachChat
                mode="inline"
                open
                conversationId={activeId}
                anchor={{ kind: "dashboard" }}
              />
            </div>
          ) : (
            <div style={{
              flex: 1, minHeight: 0,
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              border: "1px dashed #CBD5E1", borderRadius: 14,
              background: "rgba(255,255,255,0.6)",
              color: "#64748B",
              padding: 24,
              textAlign: "center",
            }}>
              <Sparkles size={28} color="#7C3AED" />
              <h2 style={{ margin: "10px 0 4px", fontSize: 16, fontWeight: 800, color: "#0F1923" }}>Ask your coach anything.</h2>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, maxWidth: 440 }}>
                Every reply is grounded in your last 20 trades, your reflections, your discipline streak, and your most recent weekly report.
                Nothing generic.
              </p>
              <button
                type="button"
                onClick={handleNew}
                style={{
                  marginTop: 14,
                  padding: "10px 16px",
                  background: "#0D9E6E",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: 12,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Start a conversation
              </button>
              <Link href="/intelligence" style={{ marginTop: 8, fontSize: 11, color: "#7C3AED", fontWeight: 700, textDecoration: "none" }}>
                Or browse insights first →
              </Link>
            </div>
          )}
        </section>
      </main>

      <style jsx global>{`
        /* Conversation row: fills the card, leaves the delete button its own
           hit area beside it rather than nested inside. */
        .coach-row {
          flex: 1;
          min-width: 0;
          min-height: 56px;
          display: flex;
          gap: 9px;
          align-items: flex-start;
          text-align: left;
          padding: 11px 6px 11px 12px;
          background: none;
          border: none;
          font: inherit;
          color: inherit;
          cursor: pointer;
          touch-action: manipulation;
        }
        .coach-row:active { background: rgba(15,25,35,0.04); }

        .coach-title {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
          font-size: 13px;
          font-weight: 800;
          color: #0F1923;
          line-height: 1.35;
        }
        .coach-preview {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 1;
          overflow: hidden;
          font-size: 11.5px;
          color: #64748B;
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
          border-left: 1px solid rgba(15,25,35,0.06);
          color: #94A3B8;
          cursor: pointer;
          touch-action: manipulation;
        }
        .coach-del:active { background: rgba(214,59,59,0.09); color: #D63B3B; }

        .coach-back { display: none; }

        @media (max-width: 820px) {
          .coach-grid { grid-template-columns: 1fr !important; }

          /* One pane at a time. Both panes stacked meant scrolling past the
             whole list to reach the composer. */
          .coach-grid[data-pane="list"] .coach-detail { display: none; }
          .coach-grid[data-pane="chat"] .coach-list   { display: none; }

          .coach-back {
            display: inline-flex;
            align-items: center;
            gap: 3px;
            align-self: flex-start;
            min-height: 44px;
            padding: 0 12px 0 4px;
            margin-bottom: 6px;
            background: none;
            border: none;
            color: #7C3AED;
            font-family: inherit;
            font-size: 13.5px;
            font-weight: 800;
            cursor: pointer;
            touch-action: manipulation;
          }

          .coach-detail {
            height: calc(100dvh - 210px) !important;
            min-height: 380px !important;
          }
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
