"use client";

import Card from "./Card";
import Money from "./Money";

/**
 * The one KPI tile. Replaces the five local StatCard copies as screens are
 * migrated. Pass a number + `kind` to get formatted mono figures, or any
 * node as `value` for custom content.
 */
export default function StatCard({ label, value, kind, currency, signed = false, hint, loading = false, animate = false, onClick }) {
  const isNumber = typeof value === "number" || (typeof value === "string" && value !== "" && !Number.isNaN(Number(value)));
  return (
    <Card onClick={onClick} className="ec-stat" aria-busy={loading || undefined}>
      <span className="ec-stat__label">{label}</span>
      {loading ? (
        <span className="ec-skeleton" style={{ height: 32, width: "60%" }} />
      ) : (
        <span className="ec-stat__value">
          {isNumber && kind ? (
            <Money value={value} kind={kind} currency={currency} signed={signed} animate={animate} />
          ) : isNumber && animate && Number.isInteger(Number(value)) ? (
            <Money value={value} kind="number" decimals={0} animate />
          ) : (
            <span className="ec-num">{value ?? "—"}</span>
          )}
        </span>
      )}
      {hint && <span className="ec-stat__hint">{hint}</span>}
    </Card>
  );
}
