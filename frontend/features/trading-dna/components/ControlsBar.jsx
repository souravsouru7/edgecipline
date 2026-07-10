"use client";

import { C, FONT } from "./tokens";
import RegenerateButton from "./RegenerateButton";
import ShareButton from "./ShareButton";

const PERIODS = [
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "365d", label: "1Y" },
];

const MARKETS = [
  { value: "Forex", label: "Forex" },
  { value: "Indian_Market", label: "Indian" },
];

function Pill({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 12px",
        borderRadius: 8,
        border: `1px solid ${active ? C.primary : C.border}`,
        background: active ? C.primary : C.surface,
        color: active ? "#F8FAFC" : C.primary,
        fontSize: 11,
        fontWeight: 700,
        fontFamily: FONT.body,
        cursor: "pointer",
        letterSpacing: "0.02em",
        transition: "background 0.15s, color 0.15s",
      }}
    >
      {label}
    </button>
  );
}

export default function ControlsBar({
  marketType,
  period,
  onMarketChange,
  onPeriodChange,
  onRegenerate,
  onShare,
  isRegenerating,
  canShare = false,
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        padding: "14px 18px",
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
      }}
    >
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span
          style={{
            fontSize: 9,
            color: C.muted,
            fontWeight: 800,
            letterSpacing: "0.1em",
            marginRight: 4,
          }}
        >
          MARKET
        </span>
        {MARKETS.map((m) => (
          <Pill
            key={m.value}
            label={m.label}
            active={marketType === m.value}
            onClick={() => onMarketChange?.(m.value)}
          />
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span
          style={{
            fontSize: 9,
            color: C.muted,
            fontWeight: 800,
            letterSpacing: "0.1em",
            marginRight: 4,
          }}
        >
          WINDOW
        </span>
        {PERIODS.map((p) => (
          <Pill
            key={p.value}
            label={p.label}
            active={period === p.value}
            onClick={() => onPeriodChange?.(p.value)}
          />
        ))}
      </div>

      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        {canShare ? (
          <ShareButton onClick={onShare} disabled={isRegenerating} />
        ) : null}
        <RegenerateButton
          onClick={onRegenerate}
          isRegenerating={isRegenerating}
        />
      </div>
    </div>
  );
}
