"use client";

import { ArrowLeftRight } from "lucide-react";
import { Card, CardHeader } from "@/features/shared/components/ui";
import { fmtMoney } from "./tokens";

// `better` says which direction is an improvement; trade count has none.
const METRICS = [
  { key: "winRate", label: "Win rate", suffix: "%", better: "up" },
  { key: "netPnL", label: "Net P&L", money: true, better: "up" },
  { key: "expectancy", label: "Expectancy", money: true, better: "up" },
  { key: "planAdherencePct", label: "Plan followed", suffix: "%", better: "up" },
  { key: "avgSetupScore", label: "Avg setup score", better: "up" },
  { key: "trades", label: "Trades", better: null },
];

function round(n) {
  return Math.round(n * 100) / 100;
}

function formatValue(metric, value, market) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (metric.money) return fmtMoney(n, market).replace(/^\+/, "");
  return `${round(n)}${metric.suffix || ""}`;
}

function Delta({ metric, value, market }) {
  if (value === null || value === undefined) return <span className="ec-tone--muted">—</span>;
  const num = Number(value);
  if (!Number.isFinite(num) || round(num) === 0) return <span className="ec-tone--muted">No change</span>;
  const tone = !metric.better ? "muted" : (num > 0) === (metric.better === "up") ? "good" : "bad";
  const text = metric.money
    ? fmtMoney(num, market)
    : `${num > 0 ? "+" : ""}${round(num)}${metric.suffix === "%" ? " pts" : ""}`;
  return <span className={`ec-tone--${tone}`}>{text}</span>;
}

export default function QuarterlyCompareCard({ comparison, market = "Forex" }) {
  if (!comparison) return null;
  const { current, previous, deltas } = comparison;
  if (!current && !previous) return null;

  return (
    <Card>
      <CardHeader
        title={<span className="ec-dna__title-icon"><ArrowLeftRight size={16} aria-hidden="true" className="ec-tone--info" /> This window vs the one before</span>}
        subtitle={previous ? "Same length of time, compared side by side" : null}
      />
      {!previous ? (
        <p className="ec-dna__empty">
          Not enough history for a comparison yet. Once you&apos;ve traded through two full windows, this shows what changed.
        </p>
      ) : null}
      <div className="ec-dna__table-wrap">
        <table className="ec-dna__table">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">Now</th>
              <th scope="col">Before</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map((metric) => {
              const cur = current?.[metric.key] ?? null;
              const prev = previous?.[metric.key] ?? null;
              const delta = deltas?.[metric.key] ?? null;
              const curTone = metric.money && cur != null ? (Number(cur) > 0 ? "good" : Number(cur) < 0 ? "bad" : null) : null;
              return (
                <tr key={metric.key}>
                  <th scope="row">{metric.label}</th>
                  <td className={curTone ? `ec-tone--${curTone}` : undefined}><strong>{formatValue(metric, cur, market)}</strong></td>
                  <td className="ec-tone--muted">{formatValue(metric, prev, market)}</td>
                  <td><Delta metric={metric} value={delta} market={market} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
