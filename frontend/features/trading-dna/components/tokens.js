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
  fontSize: "var(--fs-2xs)",
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

// Accent per archetype, shared by the report hero and the public share page.
// Unknown archetypes fall back to purple; the low-sample (null) case is muted.
export const ARCHETYPE_ACCENTS = {
  "Patient Sniper": "#A855F7",
  "Momentum Rider": "#F97316",
  "Disciplined Grinder": "#0D9E6E",
  "Volatility Surfer": "#06B6D4",
  "Reactive Improviser": "#F43F5E",
  "Range Hunter": "#10B981",
  "Breakout Hunter": "#F59E0B",
  "Risk Curator": "#3B82F6",
  "Mean Reversion Specialist": "#8B5CF6",
  "Trend Follower": "#0EA5E9",
  Scalper: "#EC4899",
  "Swing Builder": "#22C55E",
};

export function archetypeAccent(archetype) {
  if (!archetype) return "#94A3B8";
  return ARCHETYPE_ACCENTS[archetype] || C.purple;
}

export function formatReportDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
