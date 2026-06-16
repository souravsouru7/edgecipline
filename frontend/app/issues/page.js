"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Loader2, Clock, ExternalLink } from "lucide-react";
import { listMyIssues, ISSUE_CATEGORIES } from "@/services/issueApi";
import IssueReporterButton from "@/features/issues/IssueReporterButton";

const STATUS_STYLES = {
  OPEN:          { color: "#f59e0b", bg: "rgba(245, 158, 11, 0.12)", label: "Open" },
  INVESTIGATING: { color: "#60a5fa", bg: "rgba(96, 165, 250, 0.12)", label: "Investigating" },
  FIXED:         { color: "#22c55e", bg: "rgba(34, 197, 94, 0.12)",  label: "Fixed" },
  CLOSED:        { color: "#94a3b8", bg: "rgba(148, 163, 184, 0.12)",label: "Closed" },
};

function categoryLabel(value) {
  return ISSUE_CATEGORIES.find((c) => c.value === value)?.label || value;
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString();
}

export default function MyIssuesPage() {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await listMyIssues();
      setIssues(resp?.issues || []);
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || "Could not load issues.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div style={{ minHeight: "100vh", background: "#070b14", color: "#e6edf7", padding: "20px 16px 48px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 18,
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>My Reported Issues</h1>
            <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: 13 }}>
              Track what you reported and get notified when it&apos;s fixed.
            </p>
          </div>
          <IssueReporterButton variant="primary" label="Report New Issue" defaultModule="my-issues" />
        </div>

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
              marginBottom: 16,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && issues.length === 0 && (
          <div
            style={{
              border: "1px dashed rgba(120, 140, 180, 0.22)",
              borderRadius: 12,
              padding: 32,
              textAlign: "center",
              color: "#94a3b8",
              fontSize: 13,
            }}
          >
            You have not reported any issues yet. Use the button above whenever something doesn&apos;t feel right.
          </div>
        )}

        {!loading && issues.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {issues.map((iss) => {
              const s = STATUS_STYLES[iss.status] || STATUS_STYLES.OPEN;
              return (
                <Link
                  key={iss._id}
                  href={`/issues/detail?id=${iss._id}`}
                  style={{
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div
                    style={{
                      background: "linear-gradient(180deg, #0f172a 0%, #0b1224 100%)",
                      border: "1px solid rgba(120, 140, 180, 0.22)",
                      borderRadius: 12,
                      padding: 14,
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <strong style={{ color: "#cbd5e1", fontSize: 12, fontFamily: "monospace" }}>
                          {iss.issueCode}
                        </strong>
                        <span style={{ color: "#64748b", fontSize: 11 }}>·</span>
                        <span style={{ color: "#94a3b8", fontSize: 12 }}>{categoryLabel(iss.issueCategory)}</span>
                      </div>
                      <div
                        style={{
                          color: "#e6edf7",
                          fontSize: 13,
                          lineHeight: 1.45,
                          marginBottom: 6,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {iss.description}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#64748b", fontSize: 11 }}>
                        <Clock size={12} />
                        {formatDate(iss.createdAt)}
                        {iss.fixedVersion && (
                          <>
                            <span>·</span>
                            <span>Fixed in v{iss.fixedVersion}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: 4,
                      }}
                    >
                      <span
                        style={{
                          color: s.color,
                          background: s.bg,
                          border: `1px solid ${s.color}40`,
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "3px 8px",
                          borderRadius: 999,
                        }}
                      >
                        {s.label}
                      </span>
                      <ExternalLink size={12} color="#64748b" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        .spin { animation: spin 0.9s linear infinite; }
      `}</style>
    </div>
  );
}
