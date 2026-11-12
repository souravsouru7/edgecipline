"use client";

import { LineChart as LineIcon } from "lucide-react";
import { Card, CardHeader } from "@/features/shared/components/ui";
import LazyRecharts from "@/features/shared/components/charts/LazyRecharts";

const SERIES = [
  { key: "winRate", name: "Win rate %", color: "var(--ec-profit, #0D9E6E)" },
  { key: "planAdherencePct", name: "Plan followed %", color: "var(--ec-info, #3B82F6)" },
  { key: "avgSetupScore", name: "Avg setup score", color: "var(--ec-warning, #D97706)", dashed: true },
];

const AXIS = { fontSize: 11, fill: "var(--ec-text-3, #94A3B8)" };

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="ec-chart-tip">
      <div className="ec-chart-tip__title">{label}</div>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="ec-chart-tip__row">
          <span>{entry.name}</span>
          <strong>{entry.value ?? "—"}</strong>
        </div>
      ))}
    </div>
  );
}

export default function EvolutionChart({ data = [] }) {
  if (!data?.length) return null;
  const single = data.length < 2;

  return (
    <Card>
      <CardHeader
        title={<span className="ec-dna__title-icon"><LineIcon size={16} aria-hidden="true" className="ec-tone--info" /> Month by month</span>}
        subtitle={single ? "One month so far. The trend line appears once there's a second." : "How your habits have moved over time"}
      />
      <div className="ec-dna__chart">
        <LazyRecharts>{(R) => (
          <R.ResponsiveContainer width="100%" height="100%">
            <R.LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <R.CartesianGrid stroke="var(--ec-border, #F1F5F9)" strokeDasharray="3 3" vertical={false} />
              <R.XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={false} />
              <R.YAxis domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} width={30} />
              <R.Tooltip content={<ChartTip />} cursor={{ stroke: "var(--ec-border-strong, #CBD5E1)" }} />
              {SERIES.map((s) => (
                <R.Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stroke={s.color}
                  strokeWidth={2}
                  strokeDasharray={s.dashed ? "5 3" : undefined}
                  dot={{ r: single ? 4 : 2.5, fill: s.color, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
              ))}
            </R.LineChart>
          </R.ResponsiveContainer>
        )}</LazyRecharts>
      </div>
      <div className="ec-disc__legend ec-dna__legend">
        {SERIES.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} aria-hidden="true" /> {s.name}
          </span>
        ))}
      </div>
    </Card>
  );
}
