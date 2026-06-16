"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import AdminHeader from "@/components/AdminHeader";
import { adminGetIssue, adminUpdateIssueStatus, ISSUE_CATEGORIES } from "@/services/issueApi";

const STATUS_FLOW = ["OPEN", "INVESTIGATING", "FIXED", "CLOSED"];

function categoryLabel(value) {
  return ISSUE_CATEGORIES.find((c) => c.value === value)?.label || value;
}

function Inner() {
  const search = useSearchParams();
  const router = useRouter();
  const id = search.get("id");
  const [issue, setIssue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingStatus, setSavingStatus] = useState(null);
  const [fixSummary, setFixSummary] = useState("");
  const [fixedVersion, setFixedVersion] = useState("");
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => {
    if (!id) {
      setLoading(false);
      setError("Missing issue id.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const resp = await adminGetIssue(id);
      setIssue(resp?.issue || null);
      setFixSummary(resp?.issue?.fixSummary || "");
      setFixedVersion(resp?.issue?.fixedVersion || "");
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || "Could not load issue.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updateStatus = async (status) => {
    if (savingStatus) return;
    setSavingStatus(status);
    try {
      await adminUpdateIssueStatus(id, {
        status,
        fixSummary: status === "FIXED" ? fixSummary : undefined,
        fixedVersion: status === "FIXED" ? fixedVersion : undefined,
        note,
      });
      setNote("");
      await refresh();
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || "Update failed.");
    } finally {
      setSavingStatus(null);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f7f8fa" }}>
      <AdminHeader />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 18px 48px" }}>
        <button
          onClick={() => router.back()}
          style={{
            background: "transparent",
            border: "none",
            color: "#475569",
            cursor: "pointer",
            fontSize: 13,
            marginBottom: 14,
          }}
        >
          ← Back to issues
        </button>

        {loading && <div style={{ padding: 30, textAlign: "center", color: "#64748b" }}>Loading…</div>}

        {error && (
          <div style={{ background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
            {error}
          </div>
        )}

        {issue && (
          <>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 18, marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <strong style={{ fontFamily: "monospace", color: "#0f172a" }}>{issue.issueCode}</strong>
                <span style={{ color: "#94a3b8" }}>·</span>
                <span style={{ color: "#475569", fontSize: 13 }}>{categoryLabel(issue.issueCategory)}</span>
                <span style={{ color: "#94a3b8" }}>·</span>
                <span style={{ color: "#475569", fontSize: 13 }}>{issue.marketType}</span>
                <span style={{ color: "#94a3b8" }}>·</span>
                <span style={{ color: "#475569", fontSize: 13 }}>{issue.platform}</span>
                <span style={{ color: "#94a3b8" }}>·</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: "#2563eb", padding: "3px 8px", borderRadius: 999 }}>
                  {issue.status}
                </span>
              </div>
              <p style={{ margin: "8px 0 12px", whiteSpace: "pre-wrap", color: "#0f172a", lineHeight: 1.55 }}>
                {issue.description}
              </p>
              <div style={{ color: "#64748b", fontSize: 12 }}>
                Reporter: <strong>{issue.user?.name || "Unknown"}</strong> ({issue.user?.email || issue.email})
              </div>
              <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>
                Reported: {new Date(issue.createdAt).toLocaleString()} · Module: {issue.module || "—"} · App v{issue.appVersion || "?"}
              </div>
            </div>

            {issue.ocrDataSnapshot && (
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, marginBottom: 14 }}>
                <h3 style={{ margin: "0 0 8px", fontSize: 13, color: "#0f172a" }}>OCR Snapshot</h3>
                <pre style={{ margin: 0, fontSize: 12, color: "#334155", background: "#f8fafc", padding: 10, borderRadius: 8, overflow: "auto" }}>
                  {JSON.stringify(issue.ocrDataSnapshot, null, 2)}
                </pre>
              </div>
            )}

            {issue.screenshots?.length > 0 && (
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, marginBottom: 14 }}>
                <h3 style={{ margin: "0 0 10px", fontSize: 13, color: "#0f172a" }}>Screenshots ({issue.screenshots.length})</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
                  {issue.screenshots.map((s) => (
                    <a key={s.url} href={s.url} target="_blank" rel="noreferrer" style={{ aspectRatio: "1 / 1", borderRadius: 8, overflow: "hidden", border: "1px solid #e2e8f0", display: "block" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, marginBottom: 14 }}>
              <h3 style={{ margin: "0 0 10px", fontSize: 14, color: "#0f172a" }}>Update Status</h3>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Fix Summary (for FIXED)</span>
                  <textarea
                    value={fixSummary}
                    onChange={(e) => setFixSummary(e.target.value)}
                    rows={4}
                    placeholder="Short description of what was fixed and how."
                    style={{ padding: 9, border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13, fontFamily: "inherit", resize: "vertical" }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Fixed Version</span>
                  <input
                    value={fixedVersion}
                    onChange={(e) => setFixedVersion(e.target.value)}
                    placeholder="e.g. 1.4.2"
                    style={{ padding: 9, border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13 }}
                  />
                  <span style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 6 }}>Internal note</span>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Optional internal note for timeline."
                    style={{ padding: 9, border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13 }}
                  />
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                {STATUS_FLOW.map((s) => (
                  <button
                    key={s}
                    onClick={() => updateStatus(s)}
                    disabled={!!savingStatus || issue.status === s}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 8,
                      border: "1px solid #cbd5e1",
                      background: issue.status === s ? "#e2e8f0" : "#fff",
                      cursor: savingStatus || issue.status === s ? "not-allowed" : "pointer",
                      fontSize: 13,
                      color: "#0f172a",
                      fontWeight: 600,
                      opacity: savingStatus && savingStatus !== s ? 0.5 : 1,
                    }}
                  >
                    {savingStatus === s ? "Saving…" : `Mark ${s}`}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 }}>
              <h3 style={{ margin: "0 0 10px", fontSize: 14, color: "#0f172a" }}>Timeline</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(issue.timeline || []).map((t, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13 }}>
                    <strong style={{ color: "#0f172a", minWidth: 110 }}>{t.status}</strong>
                    <span style={{ color: "#64748b", minWidth: 160 }}>{new Date(t.at).toLocaleString()}</span>
                    <span style={{ color: "#334155", flex: 1 }}>{t.note}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminIssueDetailPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#f7f8fa" }} />}>
      <Inner />
    </Suspense>
  );
}
