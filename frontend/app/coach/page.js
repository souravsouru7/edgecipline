"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { Sparkles, Plus, Trash2, MessageSquare } from "lucide-react";
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

  const conversations = useMemo(
    () => conversationsQuery.data?.conversations || [],
    [conversationsQuery.data?.conversations]
  );

  const activeId = useMemo(() => {
    if (selectedId) return selectedId;
    return conversations[0]?._id || null;
  }, [selectedId, conversations]);

  const handleNew = async () => {
    const result = await createConversation.mutateAsync({
      anchor: { kind: "dashboard", label: "New coach session" },
      market: "any",
    });
    setSelectedId(result.conversation._id);
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this conversation?")) return;
    await deleteConversation.mutateAsync(id);
    if (selectedId === id) setSelectedId(null);
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
      }} className="coach-grid">
        <aside style={{
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
                <li key={c._id} style={{ minWidth: 0 }}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(c._id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(c._id);
                      }
                    }}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      textAlign: "left",
                      padding: "10px 12px",
                      border: active ? "1px solid rgba(139,92,246,0.5)" : "1px solid #E2E8F0",
                      borderRadius: 10,
                      background: active ? "rgba(139,92,246,0.06)" : "#FFFFFF",
                      cursor: "pointer",
                      display: "flex",
                      gap: 8,
                      alignItems: "flex-start",
                      minWidth: 0,
                      overflow: "hidden",
                    }}
                  >
                    <MessageSquare size={14} color={active ? "#7C3AED" : "#94A3B8"} style={{ marginTop: 1, flexShrink: 0 }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{
                        fontSize: 12, fontWeight: 800, color: "#0F1923",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{c.title || "Coach session"}</div>
                      <div style={{
                        fontSize: 11, color: "#64748B", marginTop: 2,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{c.lastMessagePreview || "—"}</div>
                    </div>
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); handleDelete(c._id); }}
                      aria-label="Delete"
                      style={{ background: "none", border: "none", padding: 4, color: "#94A3B8", cursor: "pointer", flexShrink: 0 }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </aside>

        <section style={{ minHeight: 540, height: "calc(100vh - 160px)", minWidth: 0 }}>
          {activeId ? (
            <CoachChat
              mode="inline"
              open
              conversationId={activeId}
              anchor={{ kind: "dashboard" }}
            />
          ) : (
            <div style={{
              height: "100%",
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
        @media (max-width: 820px) {
          .coach-grid {
            grid-template-columns: 1fr !important;
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
