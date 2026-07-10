"use client";

import { useState } from "react";
import { useAcceptMission, useArchiveMission } from "@/features/missions/hooks/useMissions";
import {
  CategoryBadge,
  DifficultyDot,
  ProgressBar,
  ProgressLabel,
} from "./MissionProgress";

const CATEGORY_COLOR = {
  risk_management: "#E53935",
  discipline:      "#F59E0B",
  psychology:      "#3B82F6",
  journal:         "#0D9E6E",
  strategy:        "#8B5CF6",
};

function StatusChip({ status }) {
  const map = {
    available: { label: "Recommended", bg: "#EFF6FF", color: "#1D4ED8" },
    active:    { label: "Active",       bg: "#F0FDF4", color: "#15803D" },
    completed: { label: "Complete",     bg: "#ECFDF5", color: "#059669" },
    archived:  { label: "Archived",     bg: "#F8FAFC", color: "#64748B" },
    expired:   { label: "Expired",      bg: "#FFF7ED", color: "#C2410C" },
  };
  const { label, bg, color } = map[status] || map.archived;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        background: bg,
        color,
      }}
    >
      {label}
    </span>
  );
}

export default function MissionCard({ mission, showActions = true }) {
  const [expanded, setExpanded] = useState(false);
  const accept = useAcceptMission();
  const archive = useArchiveMission();

  if (!mission) return null;

  const {
    id,
    status,
    name,
    description,
    category,
    difficulty,
    progressMode,
    unit,
    currentProgress,
    target,
    progressPercent,
    coachMessage,
    reward,
    recommendationReason,
    completedAt,
  } = mission;

  const accentColor = CATEGORY_COLOR[category] || "#64748B";
  const isActive = status === "active";
  const isAvailable = status === "available";
  const isComplete = status === "completed";

  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${isActive ? accentColor + "33" : "#E2E8F0"}`,
        borderRadius: 12,
        padding: "16px 20px",
        cursor: "pointer",
        transition: "box-shadow 0.15s ease",
        boxShadow: expanded ? "0 4px 16px rgba(0,0,0,0.08)" : "none",
      }}
      onClick={() => setExpanded(e => !e)}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6, alignItems: "center" }}>
            <CategoryBadge category={category} />
            <DifficultyDot difficulty={difficulty} />
            <StatusChip status={status} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0F1923", lineHeight: 1.35 }}>
            {name}
          </div>
        </div>
        <span style={{ color: "#94A3B8", fontSize: 18, flexShrink: 0 }}>
          {expanded ? "▲" : "▼"}
        </span>
      </div>

      {/* Progress (active missions) */}
      {isActive && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
            <ProgressLabel
              current={currentProgress}
              target={target}
              unit={unit}
              progressMode={progressMode}
            />
            <span style={{ fontSize: 12, fontWeight: 700, color: accentColor }}>
              {progressPercent}%
            </span>
          </div>
          <ProgressBar percent={progressPercent} color={accentColor} />
        </div>
      )}

      {/* Completed reward */}
      {isComplete && reward && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 14px",
            background: "#F0FDF4",
            borderRadius: 8,
            border: "1px solid #BBF7D0",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 20 }}>🏅</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#15803D" }}>{reward.badgeLabel}</div>
            <div style={{ fontSize: 12, color: "#166534", marginTop: 2 }}>
              {reward.completionMessage}
            </div>
          </div>
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #F1F5F9" }}>
          <p style={{ fontSize: 13, color: "#475569", margin: 0, lineHeight: 1.6 }}>
            {description}
          </p>

          {coachMessage && (
            <div
              style={{
                marginTop: 12,
                padding: "10px 14px",
                background: "#EFF6FF",
                borderRadius: 8,
                borderLeft: `3px solid #3B82F6`,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "#1D4ED8", marginBottom: 3 }}>
                COACH
              </div>
              <div style={{ fontSize: 13, color: "#1E40AF", lineHeight: 1.55 }}>
                {coachMessage}
              </div>
            </div>
          )}

          {recommendationReason && isAvailable && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#64748B", fontStyle: "italic" }}>
              {recommendationReason}
            </div>
          )}

          {/* Actions */}
          {showActions && (
            <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
              {isAvailable && (
                <button
                  style={{
                    padding: "8px 20px",
                    background: accentColor,
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: accept.isPending ? "wait" : "pointer",
                    opacity: accept.isPending ? 0.7 : 1,
                  }}
                  onClick={(e) => { e.stopPropagation(); accept.mutate(id); }}
                  disabled={accept.isPending}
                >
                  {accept.isPending ? "Accepting…" : "Accept Mission"}
                </button>
              )}
              {(isAvailable || isActive) && (
                <button
                  style={{
                    padding: "8px 20px",
                    background: "transparent",
                    color: "#94A3B8",
                    border: "1px solid #CBD5E1",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: archive.isPending ? "wait" : "pointer",
                  }}
                  onClick={(e) => { e.stopPropagation(); archive.mutate(id); }}
                  disabled={archive.isPending}
                >
                  {archive.isPending ? "Archiving…" : "Skip"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
