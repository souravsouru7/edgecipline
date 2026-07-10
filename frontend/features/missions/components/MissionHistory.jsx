"use client";

import { useState } from "react";
import { useMissionHistory } from "@/features/missions/hooks/useMissions";
import MissionCard from "./MissionCard";

export default function MissionHistory() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useMissionHistory({ page, limit: 10 });

  const items = data?.data || [];
  const pagination = data?.pagination || {};
  const totalPages = pagination.totalPages || 1;

  if (isLoading) {
    return <div style={{ padding: 24, color: "#94A3B8", fontSize: 14 }}>Loading history…</div>;
  }

  if (isError || items.length === 0) {
    return (
      <div style={{ padding: 24, color: "#64748B", fontSize: 14, textAlign: "center" }}>
        No completed or archived missions yet.
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map(m => (
          <MissionCard key={m.id} mission={m} showActions={false} />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 20 }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: "1px solid #CBD5E1",
              background: page <= 1 ? "#F8FAFC" : "#fff",
              color: page <= 1 ? "#CBD5E1" : "#0F1923",
              fontSize: 13,
              cursor: page <= 1 ? "default" : "pointer",
            }}
          >
            ← Prev
          </button>
          <span style={{ fontSize: 13, color: "#64748B" }}>
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: "1px solid #CBD5E1",
              background: page >= totalPages ? "#F8FAFC" : "#fff",
              color: page >= totalPages ? "#CBD5E1" : "#0F1923",
              fontSize: 13,
              cursor: page >= totalPages ? "default" : "pointer",
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
