// Shared design tokens for the Trading DNA report.
// Mirrors the palette already in use across analytics and weekly reports.

export const C = {
  bull: "#0D9E6E",
  bear: "#D63B3B",
  gold: "#B8860B",
  purple: "#8B5CF6",
  blue: "#3B82F6",
  primary: "#0F1923",
  muted: "#94A3B8",
  border: "#E2E8F0",
  surface: "#FFFFFF",
  surfaceAlt: "#F8FAFC",
  rowDivider: "#F1F5F9",
  bgPage: "#F4F2EE",
  bgDeep: "#0F1923",
};

export const FONT = {
  body: "'Plus Jakarta Sans',sans-serif",
  mono: "'JetBrains Mono',monospace",
};

export const cardSurface = {
  background: C.surface,
  borderRadius: 14,
  border: `1px solid ${C.border}`,
  padding: "20px 22px",
};

export const sectionLabel = {
  fontSize: 9,
  fontWeight: 800,
  color: C.muted,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  marginBottom: 12,
};

// Currency formatter used in this feature. `$` is hard-coded for Forex —
// Indian_Market reports use `₹`. Mirrors getCurrencySymbol() from MarketContext
// without taking a runtime dep on the provider (this report renders one market
// at a time anyway).
export function fmtMoney(value, market = "Forex") {
  const sym = market === "Indian_Market" ? "₹" : "$";
  const n = Number(value || 0);
  return `${n >= 0 ? "+" : "-"}${sym}${Math.abs(n).toFixed(2)}`;
}

export function pnlColor(value) {
  const n = Number(value || 0);
  if (n > 0) return C.bull;
  if (n < 0) return C.bear;
  return C.muted;
}
