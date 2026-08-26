"use client";

import { useState, useCallback } from "react";
import AskCoachButton from "@/features/coach-chat/components/AskCoachButton";

// ── Category config ──────────────────────────────────────────────────────────

const CATEGORY_CONFIG = {
  Psychology:     { color: "#7C3AED", bg: "#F5F3FF", label: "Psychology",     icon: "🧠" },
  Confidence:     { color: "#2563EB", bg: "#EFF6FF", label: "Confidence",     icon: "💡" },
  Discipline:     { color: "#DC2626", bg: "#FEF2F2", label: "Discipline",     icon: "🎯" },
  Pattern:        { color: "#D97706", bg: "#FFFBEB", label: "Pattern",        icon: "📊" },
  TradingDNA:     { color: "#059669", bg: "#ECFDF5", label: "Trading DNA",    icon: "🧬" },
  SelfAwareness:  { color: "#6366F1", bg: "#EEF2FF", label: "Self Awareness", icon: "🔍" },
  Improvement:    { color: "#0D9E6E", bg: "#F0FDF4", label: "Improvement",    icon: "📈" },
};

const DISMISSED_KEY = "aiCoachFeed:dismissed";
const DISMISSED_TTL_DAYS = 7;

// ── localStorage deduplication helpers ──────────────────────────────────────

function getDismissedMap() {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveDismissedMap(map) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(map));
  } catch {
    // storage full or unavailable — fail silently
  }
}

function isDismissed(id) {
  const map = getDismissedMap();
  const ts = map[id];
  if (!ts) return false;
  const ageMs = Date.now() - ts;
  const ttlMs = DISMISSED_TTL_DAYS * 24 * 60 * 60 * 1000;
  return ageMs < ttlMs;
}

function getActiveDismissedSet() {
  const map = getDismissedMap();
  const ttlMs = DISMISSED_TTL_DAYS * 24 * 60 * 60 * 1000;
  return new Set(
    Object.entries(map)
      .filter(([, ts]) => Date.now() - ts < ttlMs)
      .map(([id]) => id)
  );
}

function dismissInsight(id) {
  const map = getDismissedMap();
  // Prune stale entries
  const ttlMs = DISMISSED_TTL_DAYS * 24 * 60 * 60 * 1000;
  const pruned = Object.fromEntries(
    Object.entries(map).filter(([, ts]) => Date.now() - ts < ttlMs)
  );
  pruned[id] = Date.now();
  saveDismissedMap(pruned);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CategoryBadge({ category }) {
  const cfg = CATEGORY_CONFIG[category] || { color: "#64748B", bg: "#F8FAFC", label: category, icon: "📌" };
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      background: cfg.bg,
      color: cfg.color,
      fontSize: 10,
      fontWeight: 800,
      padding: "3px 8px",
      borderRadius: 999,
      border: `1px solid ${cfg.color}33`,
      letterSpacing: "0.05em",
      textTransform: "uppercase",
      flexShrink: 0,
    }}>
      <span style={{ fontSize: 11 }}>{cfg.icon}</span>
      {cfg.label}
    </span>
  );
}

function PriorityDot({ priority }) {
  const colorMap = { high: "#DC2626", medium: "#D97706", low: "#94A3B8" };
  const color = colorMap[priority] || "#94A3B8";
  return (
    <span style={{
      display: "inline-block",
      width: 8,
      height: 8,
      borderRadius: "50%",
      background: color,
      boxShadow: priority === "high" ? `0 0 0 2px ${color}33` : "none",
      flexShrink: 0,
    }} title={`${priority} priority`} />
  );
}

function InsightCard({ insight, currency, market, onDismiss }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = CATEGORY_CONFIG[insight.category] || { color: "#64748B", bg: "#F8FAFC" };
  const isNegative = insight.type === "negative";
  const accentColor = isNegative ? "#DC2626" : cfg.color;
  const observation = insight.observation || insight.insight || insight.title;
  const evidence = insight.evidence || "Based on the trade sample and category shown in this card.";
  const whyItMatters = insight.whyItMatters || insight.why || (
    isNegative
      ? "This behavior can quietly compound losses because it repeats before the trader notices the pattern."
      : "This is a repeatable strength worth protecting because it is already visible in your trade data."
  );
  const action = insight.action || insight.recommendation || "Review the next matching trade before entry and compare it with this evidence.";
  const expectedOutcome = insight.expectedOutcome || insight.outcome || (
    isNegative
      ? "Reducing this behavior should lower avoidable losses and improve consistency."
      : "Repeating this condition should make profitable behavior easier to identify and protect."
  );

  return (
    <div style={{
      background: "#FFFFFF",
      borderRadius: 12,
      border: `1px solid #E2E8F0`,
      borderLeft: `3px solid ${accentColor}`,
      padding: "14px 16px",
      position: "relative",
      transition: "box-shadow 0.15s",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
        <PriorityDot priority={insight.priority} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
            <CategoryBadge category={insight.category} />
            {insight.type === "positive" && (
              <span style={{ fontSize: 10, color: "#059669", fontWeight: 700 }}>✓ Strength</span>
            )}
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#0F172A", lineHeight: 1.4, marginBottom: 4 }}>
            {insight.title}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(insight.id)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#CBD5E1",
            fontSize: 16,
            lineHeight: 1,
            padding: "2px 4px",
            borderRadius: 4,
            flexShrink: 0,
          }}
          title="Dismiss for 7 days"
          aria-label="Dismiss insight"
        >
          ×
        </button>
      </div>

      {/* Insight text */}
      <p style={{ fontSize: 13, color: "#334155", lineHeight: 1.6, margin: "0 0 8px 0" }}>
        {insight.insight}
      </p>

      {/* Ask Coach — opens chat anchored to this specific insight */}
      <div style={{ marginBottom: 8 }}>
        <AskCoachButton
          variant="ghost"
          market={market}
          anchor={{ kind: "insight", refId: insight.id, label: insight.title }}
          defaultPrompt={`Tell me more about this insight: "${insight.title}". Why does it apply to me right now?`}
        />
      </div>

      {/* Expandable section */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          fontSize: 11,
          color: "#94A3B8",
          fontWeight: 700,
          letterSpacing: "0.04em",
        }}
      >
        {expanded ? "▲ HIDE DETAILS" : "▼ SHOW DETAILS"}
      </button>

      {expanded && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Observation */}
          <div style={{
            background: "#F8FAFC",
            border: "1px solid #E2E8F0",
            borderRadius: 8,
            padding: "8px 12px",
          }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "#64748B", letterSpacing: "0.06em", marginBottom: 3 }}>
              OBSERVATION
            </div>
            <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.5 }}>{observation}</div>
          </div>

          {/* Evidence */}
          <div style={{
            background: "#F8FAFC",
            border: "1px solid #E2E8F0",
            borderRadius: 8,
            padding: "8px 12px",
          }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "#64748B", letterSpacing: "0.06em", marginBottom: 3 }}>
              EVIDENCE
            </div>
            <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.5 }}>{evidence}</div>
          </div>

          {/* Why it matters */}
          <div style={{
            background: "#F8FAFC",
            border: "1px solid #E2E8F0",
            borderRadius: 8,
            padding: "8px 12px",
          }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "#64748B", letterSpacing: "0.06em", marginBottom: 3 }}>
              WHY IT MATTERS
            </div>
            <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.5 }}>{whyItMatters}</div>
          </div>

          {/* Recommendation */}
          <div style={{
            background: isNegative ? "#FEF2F2" : "#F0FDF4",
            border: `1px solid ${isNegative ? "#FCA5A533" : "#86EFAC33"}`,
            borderRadius: 8,
            padding: "8px 12px",
          }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: isNegative ? "#DC2626" : "#059669", letterSpacing: "0.06em", marginBottom: 3 }}>
              ACTION
            </div>
            <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.5 }}>{action}</div>
          </div>

          {/* Expected outcome */}
          <div style={{
            background: "#F8FAFC",
            border: "1px solid #E2E8F0",
            borderRadius: 8,
            padding: "8px 12px",
          }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "#64748B", letterSpacing: "0.06em", marginBottom: 3 }}>
              EXPECTED OUTCOME
            </div>
            <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.5 }}>{expectedOutcome}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ message, reason }) {
  const isNoTrades = reason === "no_trades";
  return (
    <div style={{
      textAlign: "center",
      padding: "32px 20px",
      color: "#94A3B8",
    }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>{isNoTrades ? "📓" : "📊"}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#64748B", marginBottom: 4 }}>
        {isNoTrades ? "No Trading Data Yet" : "Building Your Coach Profile"}
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 280, margin: "0 auto" }}>
        {message || (isNoTrades
          ? "Start logging trades to receive personalized coaching insights."
          : "Keep logging trades — your personal coaching insights will appear here."
        )}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  const bars = [180, 140, 160, 130];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {bars.map((w, i) => (
        <div key={i} style={{
          background: "#F8FAFC",
          borderRadius: 12,
          border: "1px solid #E2E8F0",
          borderLeft: "3px solid #E2E8F0",
          padding: "14px 16px",
        }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#E2E8F0", marginTop: 3 }} />
            <div>
              <div style={{ width: 70, height: 16, background: "#E2E8F0", borderRadius: 4, marginBottom: 6 }} />
              <div style={{ width: w, height: 14, background: "#E2E8F0", borderRadius: 4 }} />
            </div>
          </div>
          <div style={{ width: "90%", height: 12, background: "#E2E8F0", borderRadius: 4, marginBottom: 4 }} />
          <div style={{ width: "70%", height: 12, background: "#E2E8F0", borderRadius: 4 }} />
        </div>
      ))}
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 5;

export default function AICoachFeedWidget({
  feed,
  loading = false,
  currency = "$",
  // Which book these insights were computed from. Passed to the coach so the
  // chat reads the same trades the card was built from.
  market = "Forex",
  delay = 0,
  style = {},
}) {
  const [dismissed, setDismissed] = useState(() => getActiveDismissedSet());
  const [showAll, setShowAll] = useState(false);

  const handleDismiss = useCallback((id) => {
    dismissInsight(id);
    setDismissed(prev => new Set([...prev, id]));
  }, []);

  // Filter dismissed from visible insights
  const visibleInsights = feed?.insights
    ? feed.insights.filter(i => !dismissed.has(i.id))
    : [];

  const displayedInsights = showAll ? visibleInsights : visibleInsights.slice(0, DEFAULT_PAGE_SIZE);
  const hasMore = visibleInsights.length > DEFAULT_PAGE_SIZE;
  const isInsufficient = feed?.insufficient ?? false;

  return (
    <div style={{
      background: "#FFFFFF",
      borderRadius: 16,
      border: "1px solid #E2E8F0",
      padding: 24,
      boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.05)",
      marginBottom: 24,
      ...style,
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 18 }}>🤖</span>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#0F172A" }}>AI Coach Feed</div>
            <div style={{
              background: "#EFF6FF",
              color: "#2563EB",
              fontSize: 10,
              fontWeight: 800,
              padding: "2px 7px",
              borderRadius: 999,
              letterSpacing: "0.05em",
            }}>
              PERSONALIZED
            </div>
          </div>
          <div style={{ fontSize: 11, color: "#94A3B8" }}>
            Insights generated from your actual trading data — no generic advice.
          </div>
        </div>
        {feed && !isInsufficient && feed.stats && (
          <div style={{
            display: "flex",
            gap: 8,
            fontSize: 11,
            color: "#64748B",
            fontWeight: 700,
            alignItems: "center",
          }}>
            <span style={{ color: "#DC2626" }}>↓ {feed.stats.negative}</span>
            <span>·</span>
            <span style={{ color: "#059669" }}>↑ {feed.stats.positive}</span>
          </div>
        )}
      </div>

      {/* Body */}
      {loading && !feed ? (
        <LoadingSkeleton />
      ) : isInsufficient ? (
        <EmptyState message={feed?.message} reason={feed?.reason} />
      ) : visibleInsights.length === 0 && feed ? (
        <div style={{ textAlign: "center", padding: "24px 0", color: "#94A3B8", fontSize: 13 }}>
          All insights reviewed. Check back tomorrow for new coaching.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {displayedInsights.map(insight => (
              <InsightCard
                key={insight.id}
                insight={insight}
                currency={currency}
                market={market}
                onDismiss={handleDismiss}
              />
            ))}
          </div>

          {/* View more / collapse */}
          {hasMore && (
            <button
              type="button"
              onClick={() => setShowAll(v => !v)}
              style={{
                display: "block",
                width: "100%",
                marginTop: 14,
                padding: "10px 0",
                background: "none",
                border: "1px solid #E2E8F0",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                color: "#64748B",
                textAlign: "center",
                transition: "background 0.15s",
                fontFamily: "inherit",
              }}
            >
              {showAll
                ? "Show Less"
                : `View ${visibleInsights.length - DEFAULT_PAGE_SIZE} More Insights`}
            </button>
          )}

          {/* Generated at */}
          {feed?.generatedAt && (
            <div style={{ marginTop: 12, fontSize: 10, color: "#CBD5E1", textAlign: "right" }}>
              Updated: {new Date(feed.generatedAt).toLocaleString()}
            </div>
          )}
        </>
      )}
    </div>
  );
}
