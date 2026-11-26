"use client";

import { useCountUp } from "../../hooks/useCountUp";

const cx = (...parts) => parts.filter(Boolean).join(" ");

const CURRENCY = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };

/**
 * Formats a number as money / percent in mono tabular figures.
 *
 * signed: prefix + / − and colour profit/loss
 * kind:   "money" | "percent" | "number" | "r" (R-multiple)
 */
export function formatValue(value, { kind = "money", currency = "USD", decimals, signed = false, compact = false } = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  const abs = Math.abs(n);
  const d = decimals ?? (kind === "percent" || kind === "r" ? 1 : abs >= 1000 ? 0 : 2);
  const locale = currency === "INR" ? "en-IN" : "en-US";
  const body = abs.toLocaleString(locale, {
    minimumFractionDigits: compact ? 0 : d,
    maximumFractionDigits: d,
    notation: compact ? "compact" : "standard",
  });
  const sign = n > 0 ? (signed ? "+" : "") : n < 0 ? "−" : "";
  if (kind === "percent") return `${sign}${body}%`;
  if (kind === "r") return `${sign}${body}R`;
  if (kind === "number") return `${sign}${body}`;
  return `${sign}${CURRENCY[currency] ?? ""}${body}`;
}

/** animate: count up from 0 on first show (see useCountUp). */
export default function Money({ value, kind = "money", currency, decimals, signed = false, compact = false, animate = false, className, ...rest }) {
  const n = Number(value);
  const tone = !signed || !Number.isFinite(n) ? null : n > 0 ? "up" : n < 0 ? "down" : "flat";
  const counted = useCountUp(animate && value !== null && value !== "" && Number.isFinite(n) ? n : null);
  return (
    <span className={cx("ec-num", tone && `ec-pnl--${tone}`, className)} {...rest}>
      {formatValue(counted ?? value, { kind, currency, decimals, signed, compact })}
    </span>
  );
}
