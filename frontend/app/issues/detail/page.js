"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, CheckCircle2, Circle } from "lucide-react";
import { getMyIssue, categoryLabel } from "@/services/issueApi";
import PageHeader from "@/features/shared/components/PageHeader";

const theme = {
  bg: "#F0EEE9",
  card: "#FFFFFF",
  text: "#0F1923",
  textMuted: "#64748B",
  textDisabled: "#94A3B8",
  border: "#E2E8F0",
  primary: "#0D9E6E",
  primaryBg: "rgba(13,158,110,0.08)",
  error: "#D63B3B",
  errorBg: "rgba(214,59,59,0.06)",
  errorBorder: "rgba(214,59,59,0.3)",
};

const STATUS_STEPS = ["OPEN", "INVESTIGATING", "FIXED", "CLOSED"];
const STATUS_LABEL = {
  OPEN: "Submitted",
  INVESTIGATING: "Investigating",
  FIXED: "Fixed",
  CLOSED: "Closed",
};

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString();
}

function IssueDetailInner() {
  const search = useSearchParams();
  const router = useRouter();
  const id = search.get("id");
  const [issue, setIssue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError("Missing issue id.");
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await getMyIssue(id);
        const loaded = resp?.issue || resp || null;
        if (cancelled) return;
        // Every report opened since the two systems were joined has a support
        // ticket — that thread is where the conversation and screenshots are,
        // so land there. Only pre-migration reports render this page.
        const ticketId = loaded?.linkedTicket?._id || loaded?.linkedTicket;
        if (ticketId) {
          router.replace(`/support/tickets/detail?id=${encodeURIComponent(String(ticketId))}`);
          return;
        }
        setIssue(loaded);
      } catch (e) {
        if (!cancelled) setError(e?.data?.message || e?.message || "Could not load issue.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  const currentStepIndex = issue ? STATUS_STEPS.indexOf(issue.status) : -1;

  return (
    <div style={{ minHeight: "100vh", background: theme.bg, fontFamily: "'Plus Jakarta Sans',sans-serif", color: theme.text }}>
      <PageHeader />
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "28px 20px 48px" }}>
        <button
          onClick={() => router.push("/support/tickets")}
          style={{
            background: "#FFFFFF",
            border: `1px solid ${theme.border}`,
            color: theme.textMuted,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            fontWeight: 700,
            marginBottom: 20,
            padding: "10px 14px",
            borderRadius: 10,
          }}
        >
          <ArrowLeft size={14} /> My tickets
        </button>

        {loading && (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Loader2 className="spin" size={28} color={theme.primary} />
          </div>
        )}

        {error && (
          <div
            style={{
              background: theme.errorBg,
              border: `1px solid ${theme.errorBorder}`,
              color: theme.error,
              padding: 14,
              borderRadius: 12,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        )}

        {issue && (
          <>
            <div
              style={{
                background: theme.card,
                border: `1px solid ${theme.border}`,
                borderRadius: 16,
                padding: 20,
                marginBottom: 16,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, color: theme.text, fontWeight: 700 }}>
                  {issue.issueCode}
                </span>
                <span style={{ color: theme.textDisabled, fontSize: 12 }}>·</span>
                <span style={{ color: theme.textMuted, fontSize: 12 }}>{categoryLabel(issue.issueCategory)}</span>
              </div>
              <p style={{ margin: 0, lineHeight: 1.6, fontSize: 14, color: theme.text, whiteSpace: "pre-wrap" }}>
                {issue.description}
              </p>
              <div style={{ marginTop: 14, color: theme.textDisabled, fontSize: 11 }}>
                Reported {formatDate(issue.createdAt)}
                {issue.marketType && issue.marketType !== "Unknown" ? ` · ${issue.marketType}` : ""}
                {issue.platform && issue.platform !== "unknown" ? ` · ${issue.platform}` : ""}
              </div>
            </div>

            <div
              style={{
                background: theme.card,
                border: `1px solid ${theme.border}`,
                borderRadius: 16,
                padding: 20,
                marginBottom: 16,
              }}
            >
              <h2 style={{ margin: "0 0 14px", fontSize: 13, fontWeight: 800, color: theme.text, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Timeline
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {STATUS_STEPS.map((step, idx) => {
                  const reached = idx <= currentStepIndex;
                  const isCurrent = idx === currentStepIndex;
                  const timelineEntry = [...(issue.timeline || [])].reverse().find((t) => t.status === step);
                  return (
                    <div key={step} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      {reached ? (
                        <CheckCircle2 size={18} color={isCurrent ? "#2563EB" : theme.primary} />
                      ) : (
                        <Circle size={18} color={theme.border} />
                      )}
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: reached ? 700 : 500,
                            color: reached ? theme.text : theme.textDisabled,
                          }}
                        >
                          {STATUS_LABEL[step]}
                        </div>
                        {timelineEntry?.at && (
                          <div style={{ fontSize: 11, color: theme.textDisabled, marginTop: 2 }}>
                            {formatDate(timelineEntry.at)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {issue.fixSummary && (
              <div
                style={{
                  background: theme.primaryBg,
                  border: "1px solid rgba(13,158,110,0.3)",
                  borderRadius: 16,
                  padding: 18,
                  marginBottom: 16,
                }}
              >
                <h3 style={{ margin: "0 0 8px", color: theme.primary, fontSize: 13, fontWeight: 800 }}>
                  ✓ Fix Summary
                  {issue.fixedVersion && (
                    <span style={{ color: theme.textMuted, fontWeight: 500, fontSize: 12 }}>
                      {" "}
                      · v{issue.fixedVersion}
                    </span>
                  )}
                </h3>
                <p style={{ margin: 0, color: theme.text, fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                  {issue.fixSummary}
                </p>
              </div>
            )}

            {issue.screenshots?.length > 0 && (
              <div
                style={{
                  background: theme.card,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 16,
                  padding: 18,
                }}
              >
                <h3 style={{ margin: "0 0 12px", color: theme.text, fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Screenshots
                </h3>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                    gap: 10,
                  }}
                >
                  {issue.screenshots.map((s) => (
                    <a
                      key={s.url}
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "block",
                        aspectRatio: "1 / 1",
                        borderRadius: 10,
                        overflow: "hidden",
                        border: `1px solid ${theme.border}`,
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={s.url}
                        alt="Issue screenshot"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        .spin { animation: spin 0.9s linear infinite; }
      `}</style>
    </div>
  );
}

export default function IssueDetailPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#F0EEE9" }} />}>
      <IssueDetailInner />
    </Suspense>
  );
}
