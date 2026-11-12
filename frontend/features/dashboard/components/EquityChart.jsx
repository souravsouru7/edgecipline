"use client";

import { useId, useMemo } from "react";
import LazyRecharts from "@/features/shared/components/charts/LazyRecharts";
import { formatValue } from "@/features/shared/components/ui/Money";

// Cumulative equity from the snapshot timeline. Buckets carry `netPnL`
// (utils/disciplineAnalytics.js on the backend); the previous sparkline read
// `net`/`pnl`, never found them and always drew a canned sample curve.
export function toEquitySeries(buckets = []) {
  let running = 0;
  return (buckets || [])
    .map((b) => ({ key: b?.key, pnl: Number(b?.netPnL ?? b?.net ?? b?.pnl) }))
    .filter((b) => Number.isFinite(b.pnl))
    .map((b) => {
      running += b.pnl;
      return { key: String(b.key ?? ""), pnl: b.pnl, equity: Number(running.toFixed(2)) };
    });
}

function ChartTooltip({ active, payload, currency }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="ec-chart-tip">
      <div className="ec-chart-tip__label">{row.key}</div>
      <div className="ec-num">{formatValue(row.equity, { currency, signed: true })}</div>
      <div className={`ec-num ${row.pnl >= 0 ? "ec-pnl--up" : "ec-pnl--down"}`} style={{ fontSize: "var(--ec-fs-1)" }}>
        {formatValue(row.pnl, { currency, signed: true })} this period
      </div>
    </div>
  );
}

export default function EquityChart({ buckets, currency = "USD", height = 180 }) {
  const gradientId = useId().replace(/:/g, "");
  const series = useMemo(() => toEquitySeries(buckets), [buckets]);

  if (series.length < 2) {
    return (
      <div className="ec-chart-empty" style={{ height }}>
        Your equity curve draws once you have trades on two or more days.
      </div>
    );
  }

  const up = series.at(-1).equity >= 0;
  const stroke = up ? "var(--ec-profit)" : "var(--ec-loss)";

  return (
    <LazyRecharts height={height}>
      {(R) => (
        <R.ResponsiveContainer width="100%" height="100%">
          <R.AreaChart data={series} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <R.XAxis dataKey="key" hide />
            <R.YAxis hide domain={["dataMin", "dataMax"]} />
            <R.ReferenceLine y={0} stroke="var(--ec-border-strong)" strokeDasharray="3 4" />
            <R.Tooltip
              content={<ChartTooltip currency={currency} />}
              cursor={{ stroke: "var(--ec-border-strong)", strokeWidth: 1 }}
            />
            <R.Area
              type="monotone"
              dataKey="equity"
              stroke={stroke}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              activeDot={{ r: 4, strokeWidth: 0, fill: stroke }}
              isAnimationActive
              animationDuration={700}
            />
          </R.AreaChart>
        </R.ResponsiveContainer>
      )}
    </LazyRecharts>
  );
}
