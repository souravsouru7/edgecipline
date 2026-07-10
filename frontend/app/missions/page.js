"use client";

import { Suspense, useState } from "react";
import { useActiveMissions, useMissionStats, useGetRecommendations, useMissionTemplates } from "@/features/missions/hooks/useMissions";
import MissionCard from "@/features/missions/components/MissionCard";
import MissionHistory from "@/features/missions/components/MissionHistory";

const CATEGORIES = [
  { value: null,              label: "All" },
  { value: "risk_management", label: "Risk" },
  { value: "discipline",      label: "Discipline" },
  { value: "psychology",      label: "Psychology" },
  { value: "journal",         label: "Journal" },
  { value: "strategy",        label: "Strategy" },
];

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "7px 16px",
        borderRadius: 8,
        border: "none",
        background: active ? "#0F1923" : "transparent",
        color: active ? "#fff" : "#64748B",
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        cursor: "pointer",
        transition: "all 0.15s ease",
      }}
    >
      {children}
    </button>
  );
}

function CategoryFilter({ selected, onChange }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {CATEGORIES.map(c => (
        <button
          key={c.value || "all"}
          onClick={() => onChange(c.value)}
          style={{
            padding: "5px 14px",
            borderRadius: 20,
            border: `1px solid ${selected === c.value ? "#0F1923" : "#E2E8F0"}`,
            background: selected === c.value ? "#0F1923" : "#fff",
            color: selected === c.value ? "#fff" : "#64748B",
            fontSize: 12,
            fontWeight: selected === c.value ? 700 : 400,
            cursor: "pointer",
          }}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

function StatsBar({ stats }) {
  if (!stats?.data) return null;
  const { completed, active, archived } = stats.data;
  const items = [
    { label: "Completed", value: completed, color: "#0D9E6E" },
    { label: "Active",    value: active,    color: "#F59E0B" },
    { label: "Archived",  value: archived,  color: "#94A3B8" },
  ];
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
      {items.map(({ label, value, color }) => (
        <div
          key={label}
          style={{
            flex: "1 1 80px",
            background: "#fff",
            border: "1px solid #E2E8F0",
            borderRadius: 12,
            padding: "14px 16px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 26, fontWeight: 800, color }}>{value ?? 0}</div>
          <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

export default function MissionsPage() {
  const [tab, setTab] = useState("active");
  const [category, setCategory] = useState(null);

  const { data: activeMissionsData, isLoading: loadingActive } = useActiveMissions();
  const { data: stats } = useMissionStats();
  const { data: templatesData, isLoading: loadingTemplates } = useMissionTemplates({ category });
  const getRecommendations = useGetRecommendations();

  const allMissions = activeMissionsData?.data || [];
  const activeMissions = allMissions.filter(m => m.status === "active");
  const availableMissions = allMissions.filter(m => m.status === "available");
  const templates = (templatesData?.data || []).filter(t =>
    !category || t.category === category
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F8FAFC",
        padding: "24px 16px 80px",
        maxWidth: 640,
        margin: "0 auto",
        boxSizing: "border-box",
      }}
    >
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0F1923", margin: 0 }}>
          Discipline Missions
        </h1>
        <p style={{ fontSize: 14, color: "#64748B", margin: "6px 0 0" }}>
          Build habits. Not streaks. Reinforce what matters.
        </p>
      </div>

      {/* Stats */}
      <div style={{ marginBottom: 20 }}>
        <StatsBar stats={stats} />
      </div>

      {/* AI Recommendation CTA */}
      {availableMissions.length === 0 && activeMissions.length < 3 && (
        <div
          style={{
            background: "#EFF6FF",
            border: "1px solid #BFDBFE",
            borderRadius: 12,
            padding: "14px 18px",
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1D4ED8" }}>
              Get AI Mission Recommendations
            </div>
            <div style={{ fontSize: 12, color: "#3B82F6", marginTop: 3 }}>
              Your coach will analyze your behavior and suggest the right missions.
            </div>
          </div>
          <button
            onClick={() => getRecommendations.mutate({})}
            disabled={getRecommendations.isPending}
            style={{
              padding: "8px 16px",
              background: "#1D4ED8",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              cursor: getRecommendations.isPending ? "wait" : "pointer",
              flexShrink: 0,
              opacity: getRecommendations.isPending ? 0.7 : 1,
            }}
          >
            {getRecommendations.isPending ? "Analyzing…" : "Analyze"}
          </button>
        </div>
      )}

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 20,
          background: "#F1F5F9",
          padding: 4,
          borderRadius: 10,
        }}
      >
        <TabButton active={tab === "active"} onClick={() => setTab("active")}>
          Active {activeMissions.length > 0 && `(${activeMissions.length})`}
        </TabButton>
        <TabButton active={tab === "recommended"} onClick={() => setTab("recommended")}>
          Recommended {availableMissions.length > 0 && `(${availableMissions.length})`}
        </TabButton>
        <TabButton active={tab === "browse"} onClick={() => setTab("browse")}>
          Browse
        </TabButton>
        <TabButton active={tab === "history"} onClick={() => setTab("history")}>
          History
        </TabButton>
      </div>

      {/* Category filter for browse/recommended tabs */}
      {(tab === "browse" || tab === "recommended") && (
        <div style={{ marginBottom: 16 }}>
          <CategoryFilter selected={category} onChange={setCategory} />
        </div>
      )}

      {/* Content */}
      {tab === "active" && (
        <div>
          {loadingActive ? (
            <div style={{ color: "#94A3B8", fontSize: 14, padding: "20px 0", textAlign: "center" }}>
              Loading…
            </div>
          ) : activeMissions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🎯</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#0F1923", marginBottom: 8 }}>
                No active missions
              </div>
              <div style={{ fontSize: 13, color: "#64748B", marginBottom: 16 }}>
                Accept a recommended mission or browse all missions.
              </div>
              <button
                onClick={() => setTab("recommended")}
                style={{
                  padding: "10px 20px",
                  background: "#0F1923",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                View Recommendations
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {activeMissions.map(m => (
                <MissionCard key={m.id} mission={m} showActions />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "recommended" && (
        <div>
          {availableMissions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✨</div>
              <div style={{ fontSize: 14, color: "#64748B" }}>
                No recommendations yet. Click &quot;Analyze&quot; to get personalized missions.
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {availableMissions
                .filter(m => !category || m.category === category)
                .map(m => (
                  <MissionCard key={m.id} mission={m} showActions />
                ))}
            </div>
          )}
        </div>
      )}

      {tab === "browse" && (
        <div>
          {loadingTemplates ? (
            <div style={{ color: "#94A3B8", fontSize: 14, padding: "20px 0", textAlign: "center" }}>
              Loading templates…
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {templates.map(t => (
                <div
                  key={t._id}
                  style={{
                    background: "#fff",
                    border: "1px solid #E2E8F0",
                    borderRadius: 12,
                    padding: "14px 18px",
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0F1923", marginBottom: 5 }}>
                    {t.name}
                  </div>
                  <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.5 }}>
                    {t.description}
                  </div>
                  <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 8 }}>
                    {t.target} {t.unit} · {t.difficulty}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "history" && (
        <Suspense fallback={<div style={{ color: "#94A3B8", fontSize: 14, padding: 20 }}>Loading…</div>}>
          <MissionHistory />
        </Suspense>
      )}
    </div>
  );
}
