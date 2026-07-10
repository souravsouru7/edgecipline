"use client";

import Link from "next/link";
import { useActiveMissions, useMissionStats } from "@/features/missions/hooks/useMissions";
import MissionCard from "./MissionCard";

export default function MissionWidget() {
  const { data: missions, isLoading, isError } = useActiveMissions();
  const { data: stats } = useMissionStats();

  const activeMissions = (missions?.data || []).filter(m => m.status === "active");
  const availableMissions = (missions?.data || []).filter(m => m.status === "available");
  const completed = stats?.data?.completed || 0;

  if (isLoading) {
    return (
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: "20px 24px",
          border: "1px solid #E2E8F0",
        }}
      >
        <div style={{ fontSize: 14, color: "#94A3B8" }}>Loading missions…</div>
      </div>
    );
  }

  if (isError) return null;

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 12,
        border: "1px solid #E2E8F0",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 20px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid #F1F5F9",
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0F1923" }}>
            Discipline Missions
          </div>
          {completed > 0 && (
            <div style={{ fontSize: 12, color: "#0D9E6E", marginTop: 2 }}>
              {completed} completed
            </div>
          )}
        </div>
        <Link
          href="/missions"
          style={{
            fontSize: 12,
            color: "#3B82F6",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          View All →
        </Link>
      </div>

      {/* Active missions */}
      <div style={{ padding: "12px 16px" }}>
        {activeMissions.length === 0 && availableMissions.length === 0 ? (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 13, color: "#64748B", marginBottom: 10 }}>
              No active missions yet.
            </div>
            <Link
              href="/missions"
              style={{
                display: "inline-block",
                padding: "8px 18px",
                background: "#0F1923",
                color: "#fff",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Get Recommendations
            </Link>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {activeMissions.slice(0, 3).map(m => (
              <MissionCard key={m.id} mission={m} showActions={false} />
            ))}
            {activeMissions.length === 0 && availableMissions.length > 0 && (
              <div style={{ fontSize: 13, color: "#64748B", textAlign: "center", padding: "8px 0" }}>
                You have {availableMissions.length} recommended mission{availableMissions.length !== 1 ? "s" : ""}.{" "}
                <Link href="/missions" style={{ color: "#3B82F6", fontWeight: 600 }}>
                  View &amp; Accept
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
