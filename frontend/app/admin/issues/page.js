"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AdminHeader from "@/components/AdminHeader";
import {
  adminListIssues,
  adminGetIssueAnalytics,
  ISSUE_CATEGORIES,
  ISSUE_STATUSES,
} from "@/services/issueApi";

const STATUS_COLORS = {
  OPEN: "#f59e0b",
  INVESTIGATING: "#3b82f6",
  FIXED: "#10b981",
  CLOSED: "#6b7280",
};

const MARKETS = ["Forex", "Indian_Market", "Both", "Unknown"];

function categoryLabel(value) {
  return ISSUE_CATEGORIES.find((c) => c.value === value)?.label || value;
}

export default function AdminIssuesPage() {
  const router = useRouter();
  const [issues, setIssues] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ status: "", category: "", market: "" });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [list, summary] = await Promise.all([
        adminListIssues({
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.category ? { category: filters.category } : {}),
          ...(filters.market ? { market: filters.market } : {}),
          limit: 100,
        }),
        adminGetIssueAnalytics(),
      ]);
      setIssues(list?.issues || []);
      setAnalytics(summary || null);
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || "Failed to load issues.");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return (
    <div style={{ minHeight: "100vh", background: "#f7f8fa" }}>
      <AdminHeader />
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 18px 48px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
          <h1 style={{ margin: 0, color: "#0f172a", fontSize: 22 }}>User Issues</h1>
          <button
            onClick={fetchAll}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: "#fff",
              cursor: "pointer",
              fontSize: 13,
              color: "#334155",
            }}
          >
            Refresh
          </button>
        </div>

        {/* Analytics summary */}
        {analytics && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 10,
              marginBottom: 18,
            }}
          >
            <StatCard label="Open" value={analytics.byStatus?.OPEN || 0} color={STATUS_COLORS.OPEN} />
            <StatCard label="Investigating" value={analytics.byStatus?.INVESTIGATING || 0} color={STATUS_COLORS.INVESTIGATING} />
            <StatCard label="Fixed" value={analytics.byStatus?.FIXED || 0} color={STATUS_COLORS.FIXED} />
            <StatCard label="Last 7 days" value={analytics.last7Days || 0} color="#0ea5e9" />
            <StatCard
              label="Avg resolution"
              value={analytics.avgResolutionHours == null ? "—" : `${analytics.avgResolutionHours}h`}
              color="#a855f7"
            />
          </div>
        )}

        {/* Filters */}
        <div
          style={{
            display: "flex",
            gap: 10,
            marginBottom: 14,
            flexWrap: "wrap",
            background: "#fff",
            padding: 12,
            borderRadius: 10,
            border: "1px solid #e2e8f0",
          }}
        >
          <Select
            label="Status"
            value={filters.status}
            onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
            options={[{ value: "", label: "All" }, ...ISSUE_STATUSES.map((s) => ({ value: s, label: s }))]}
          />
          <Select
            label="Category"
            value={filters.category}
            onChange={(v) => setFilters((f) => ({ ...f, category: v }))}
            options={[{ value: "", label: "All" }, ...ISSUE_CATEGORIES]}
          />
          <Select
            label="Market"
            value={filters.market}
            onChange={(v) => setFilters((f) => ({ ...f, market: v }))}
            options={[{ value: "", label: "All" }, ...MARKETS.map((m) => ({ value: m, label: m }))]}
          />
        </div>

        {error && (
          <div
            style={{
              background: "#fef2f2",
              color: "#991b1b",
              border: "1px solid #fecaca",
              padding: 12,
              borderRadius: 8,
              marginBottom: 14,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Loading…</div>
        ) : issues.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#64748b", background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0" }}>
            No issues match the current filters.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {issues.map((iss) => (
              <div
                key={iss._id}
                onClick={() => router.push(`/admin/issues/detail?id=${iss._id}`)}
                style={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: 14,
                  cursor: "pointer",
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                    <strong style={{ color: "#0f172a", fontFamily: "monospace", fontSize: 12 }}>{iss.issueCode}</strong>
                    <span style={{ color: "#94a3b8", fontSize: 12 }}>·</span>
                    <span style={{ color: "#475569", fontSize: 12 }}>{categoryLabel(iss.issueCategory)}</span>
                    <span style={{ color: "#94a3b8", fontSize: 12 }}>·</span>
                    <span style={{ color: "#475569", fontSize: 12 }}>{iss.marketType}</span>
                    <span style={{ color: "#94a3b8", fontSize: 12 }}>·</span>
                    <span style={{ color: "#475569", fontSize: 12 }}>{iss.platform}</span>
                  </div>
                  <div style={{ color: "#1e293b", fontSize: 13, lineHeight: 1.5, marginBottom: 6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {iss.description}
                  </div>
                  <div style={{ color: "#64748b", fontSize: 11 }}>
                    {iss.user?.name || iss.email || "Unknown"} · {new Date(iss.createdAt).toLocaleString()}
                  </div>
                </div>
                <span
                  style={{
                    background: `${STATUS_COLORS[iss.status]}20`,
                    color: STATUS_COLORS[iss.status],
                    border: `1px solid ${STATUS_COLORS[iss.status]}55`,
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "3px 9px",
                    borderRadius: 999,
                    whiteSpace: "nowrap",
                  }}
                >
                  {iss.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 10,
        padding: 14,
      }}
    >
      <div style={{ color: "#64748b", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ color, fontSize: 22, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 160 }}>
      <span style={{ color: "#64748b", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "7px 10px",
          border: "1px solid #cbd5e1",
          borderRadius: 8,
          background: "#fff",
          color: "#0f172a",
          fontSize: 13,
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
