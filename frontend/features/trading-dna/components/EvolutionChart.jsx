"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { C, FONT, cardSurface } from "./tokens";
import SectionTitle from "./SectionTitle";

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: C.bgDeep,
        color: "#F8FAFC",
        padding: "10px 12px",
        borderRadius: 10,
        border: `1px solid ${C.border}33`,
        fontSize: 11,
        fontFamily: FONT.body,
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: 6 }}>{label}</div>
      {payload.map((entry) => (
        <div
          key={entry.dataKey}
          style={{
            color: entry.color,
            fontFamily: FONT.mono,
            marginBottom: 2,
          }}
        >
          {entry.name}: {entry.value}
        </div>
      ))}
    </div>
  );
}

export default function EvolutionChart({ data = [] }) {
  if (!data?.length) return null;

  return (
    <div style={cardSurface}>
      <SectionTitle>MONTHLY EVOLUTION</SectionTitle>

      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 16, left: -10, bottom: 4 }}
          >
            <CartesianGrid stroke={C.rowDivider} strokeDasharray="3 3" />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 10, fill: C.muted, fontFamily: FONT.mono }}
              tickLine={false}
              axisLine={{ stroke: C.border }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: C.muted, fontFamily: FONT.mono }}
              tickLine={false}
              axisLine={{ stroke: C.border }}
              domain={[0, 100]}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="winRate"
              name="Win rate %"
              stroke={C.bull}
              strokeWidth={2}
              dot={{ r: 3, fill: C.bull }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="planAdherencePct"
              name="Plan adherence %"
              stroke={C.purple}
              strokeWidth={2}
              dot={{ r: 3, fill: C.purple }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="avgSetupScore"
              name="Avg setup score"
              stroke={C.blue}
              strokeWidth={2}
              dot={{ r: 3, fill: C.blue }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          marginTop: 10,
          fontSize: 10,
          color: C.muted,
          fontFamily: FONT.mono,
          letterSpacing: "0.04em",
        }}
      >
        <LegendDot color={C.bull} label="Win rate" />
        <LegendDot color={C.purple} label="Plan adherence" />
        <LegendDot color={C.blue} label="Avg setup score" />
      </div>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 8,
          height: 8,
          background: color,
          borderRadius: 99,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}
