"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, CheckCircle2, Circle } from "lucide-react";
import { getMyIssue, ISSUE_CATEGORIES } from "@/services/issueApi";

const STATUS_STEPS = ["OPEN", "INVESTIGATING", "FIXED", "CLOSED"];
const STATUS_LABEL = {
  OPEN: "Submitted",
  INVESTIGATING: "Investigating",
  FIXED: "Fixed",
  CLOSED: "Closed",
};

function categoryLabel(value) {
  return ISSUE_CATEGORIES.find((c) => c.value === value)?.label || value;
}

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
        if (!cancelled) setIssue(resp?.issue || null);
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.message || e?.message || "Could not load issue.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const currentStepIndex = issue ? STATUS_STEPS.indexOf(issue.status) : -1;

  return (
    <div style={{ minHeight: "100vh", background: "#070b14", color: "#e6edf7", padding: "20px 16px 48px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <button
          onClick={() => router.back()}
          style={{
            background: "transparent",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            marginBottom: 16,
            padding: 0,
          }}
        >
          <ArrowLeft size={14} /> Back
        </button>

        {loading && (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Loader2 className="spin" size={28} color="#60a5fa" />
          </div>
        )}

        {error && (
          <div
            style={{
              background: "rgba(239, 68, 68, 0.08)",
              border: "1px solid rgba(239, 68, 68, 0.35)",
              color: "#fca5a5",
              padding: 14,
              borderRadius: 10,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {issue && (
          <>
            <div
              style={{
                background: "linear-gradient(180deg, #0f172a 0%, #0b1224 100%)",
                border: "1px solid rgba(120, 140, 180, 0.22)",
                borderRadius: 12,
                padding: 18,
                marginBottom: 16,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ fontFamily: "monospace", fontSize: 13, color: "#cbd5e1" }}>
                  {issue.issueCode}
                </span>
                <span style={{ color: "#64748b", fontSize: 12 }}>·</span>
                <span style={{ color: "#94a3b8", fontSize: 12 }}>{categoryLabel(issue.issueCategory)}</span>
              </div>
              <p style={{ margin: 0, lineHeight: 1.55, fontSize: 14, color: "#e6edf7", whiteSpace: "pre-wrap" }}>
                {issue.description}
              </p>
              <div style={{ marginTop: 12, color: "#64748b", fontSize: 11 }}>
                Reported {formatDate(issue.createdAt)}
                {issue.marketType && issue.marketType !== "Unknown" ? ` · ${issue.marketType}` : ""}
                {issue.platform && issue.platform !== "unknown" ? ` · ${issue.platform}` : ""}
              </div>
            </div>

            <div
              style={{
                background: "linear-gradient(180deg, #0f172a 0%, #0b1224 100%)",
                border: "1px solid rgba(120, 140, 180, 0.22)",
                borderRadius: 12,
                padding: 18,
                marginBottom: 16,
              }}
            >
              <h2 style={{ margin: "0 0 12px", fontSize: 14, color: "#cbd5e1" }}>Timeline</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {STATUS_STEPS.map((step, idx) => {
                  const reached = idx <= currentStepIndex;
                  const isCurrent = idx === currentStepIndex;
                  const timelineEntry = [...(issue.timeline || [])].reverse().find((t) => t.status === step);
                  return (
                    <div key={step} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      {reached ? (
                        <CheckCircle2 size={18} color={isCurrent ? "#60a5fa" : "#22c55e"} />
                      ) : (
                        <Circle size={18} color="#475569" />
                      )}
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: reached ? 600 : 400,
                            color: reached ? "#e6edf7" : "#64748b",
                          }}
                        >
                          {STATUS_LABEL[step]}
                        </div>
                        {timelineEntry?.at && (
                          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
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
                  background: "rgba(34, 197, 94, 0.06)",
                  border: "1px solid rgba(34, 197, 94, 0.30)",
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 16,
                }}
              >
                <h3 style={{ margin: "0 0 8px", color: "#86efac", fontSize: 13, fontWeight: 700 }}>
                  ✓ Fix Summary
                  {issue.fixedVersion && (
                    <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: 12 }}>
                      {" "}
                      · v{issue.fixedVersion}
                    </span>
                  )}
                </h3>
                <p style={{ margin: 0, color: "#cbd5e1", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                  {issue.fixSummary}
                </p>
              </div>
            )}

            {issue.screenshots?.length > 0 && (
              <div
                style={{
                  background: "linear-gradient(180deg, #0f172a 0%, #0b1224 100%)",
                  border: "1px solid rgba(120, 140, 180, 0.22)",
                  borderRadius: 12,
                  padding: 16,
                }}
              >
                <h3 style={{ margin: "0 0 12px", color: "#cbd5e1", fontSize: 13 }}>Screenshots</h3>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                    gap: 8,
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
                        borderRadius: 8,
                        overflow: "hidden",
                        border: "1px solid rgba(120, 140, 180, 0.22)",
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
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#070b14" }} />}>
      <IssueDetailInner />
    </Suspense>
  );
}
