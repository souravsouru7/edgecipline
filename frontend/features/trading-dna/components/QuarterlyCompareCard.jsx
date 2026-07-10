"use client";

import { C, FONT, cardSurface, fmtMoney, pnlColor } from "./tokens";
import SectionTitle from "./SectionTitle";

const METRICS = [
  { key: "winRate", label: "Win rate", suffix: "%" },
  { key: "netPnL", label: "Net P&L", money: true },
  { key: "expectancy", label: "Expectancy", money: true },
  { key: "planAdherencePct", label: "Plan adherence", suffix: "%" },
  { key: "avgSetupScore", label: "Avg setup score" },
  { key: "trades", label: "Trade count" },
];

function formatValue(metric, value, market) {
  if (value === null || value === undefined) return "—";
  if (metric.money) return fmtMoney(value, market).replace(/^\+/, "");
  return `${value}${metric.suffix || ""}`;
}

function Delta({ metric, value }) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) {
    return (
      <span style={{ color: C.muted, fontSize: 11, fontFamily: FONT.mono }}>
        ±0
      </span>
    );
  }
  const positive = num > 0;
  const color = positive ? C.bull : C.bear;
  const sign = positive ? "+" : "";
  const suffix = metric.suffix || "";
  return (
    <span
      style={{
        color,
        fontSize: 11,
        fontFamily: FONT.mono,
        fontWeight: 700,
      }}
    >
      {sign}
      {num}
      {metric.money ? "" : suffix}
    </span>
  );
}

export default function QuarterlyCompareCard({ comparison, market = "Forex" }) {
  if (!comparison) return null;
  const { current, previous, deltas } = comparison;
  if (!current && !previous) return null;

  return (
    <div style={cardSurface}>
      <SectionTitle>QUARTERLY COMPARISON</SectionTitle>

      {!previous ? (
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
          Not enough history yet for a prior-window comparison. Once you have
          two full windows logged, this section will track quarter-over-quarter
          drift.
        </div>
      ) : null}

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: FONT.body,
          }}
        >
          <thead>
            <tr>
              <th style={th}>METRIC</th>
              <th style={th}>CURRENT</th>
              <th style={th}>PREVIOUS</th>
              <th style={th}>DELTA</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map((metric) => {
              const cur = current?.[metric.key] ?? null;
              const prev = previous?.[metric.key] ?? null;
              const delta = deltas?.[metric.key] ?? null;
              return (
                <tr key={metric.key}>
                  <td style={td}>
                    <span style={{ color: C.primary, fontWeight: 700 }}>
                      {metric.label}
                    </span>
                  </td>
                  <td
                    style={{
                      ...td,
                      color: metric.money ? pnlColor(cur) : C.primary,
                      fontFamily: FONT.mono,
                      fontWeight: 800,
                    }}
                  >
                    {formatValue(metric, cur, market)}
                  </td>
                  <td
                    style={{
                      ...td,
                      color: C.muted,
                      fontFamily: FONT.mono,
                    }}
                  >
                    {formatValue(metric, prev, market)}
                  </td>
                  <td style={td}>
                    <Delta metric={metric} value={delta} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: `1px solid ${C.border}`,
  fontSize: 9,
  color: C.muted,
  fontWeight: 800,
  letterSpacing: "0.1em",
};

const td = {
  padding: "10px",
  borderBottom: `1px solid ${C.rowDivider}`,
  fontSize: 12,
};
