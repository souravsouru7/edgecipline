"use client";

// Compact cards for the user's own recent trades, shared by the post-save
// LastFreeTradeSheet and the trade-limit paywalls. Renders exactly what the
// server sent (live trades only) — never a count the user cannot see.

const FOREX_SYMBOL = "$";
const INDIAN_SYMBOL = "₹";

export function formatTradePnl(trade) {
  if (typeof trade?.pnl !== "number" || Number.isNaN(trade.pnl)) return "—";
  const unit = trade.market === "Indian_Market" ? INDIAN_SYMBOL : FOREX_SYMBOL;
  const sign = trade.pnl < 0 ? "-" : trade.pnl > 0 ? "+" : "";
  const abs = Math.abs(trade.pnl);
  const digits = trade.market === "Indian_Market" ? 0 : 2;
  return `${sign}${unit}${abs.toLocaleString("en-IN", { maximumFractionDigits: digits })}`;
}

export function formatTradeDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function RecentTradeCards({ trades, compact = false }) {
  const list = Array.isArray(trades) ? trades.filter(Boolean) : [];
  if (list.length === 0) return null;

  return (
    <ul
      aria-label="Your recent trades"
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "grid",
        gridTemplateColumns: list.length > 1 ? "repeat(2, minmax(0, 1fr))" : "1fr",
        gap: compact ? 8 : 10,
      }}
    >
      {list.map((trade) => {
        const pnl = trade.pnl;
        const pnlColour = typeof pnl !== "number" ? "#64748B" : pnl >= 0 ? "#0D9E6E" : "#D63B3B";
        const sideColour = trade.side === "SELL" ? "#D63B3B" : "#0D9E6E";
        return (
          <li
            key={trade.id || `${trade.symbol}-${trade.date}`}
            style={{
              background: "linear-gradient(135deg, #F8FAFC 0%, #F1F5F9 100%)",
              border: "1px solid #E2E8F0",
              borderRadius: 14,
              padding: compact ? "10px 12px" : "12px 14px",
              minWidth: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span
                style={{
                  fontSize: compact ? 12 : 13,
                  fontWeight: 800,
                  color: "#0F1923",
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: "0.02em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {trade.symbol || "Trade"}
              </span>
              {trade.side && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    color: sideColour,
                    background: `${sideColour}14`,
                    borderRadius: 999,
                    padding: "2px 7px",
                    flexShrink: 0,
                  }}
                >
                  {trade.side}
                  {trade.optionType ? ` · ${trade.optionType}` : ""}
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginTop: 6 }}>
              <span style={{ fontSize: compact ? 14 : 16, fontWeight: 800, color: pnlColour, fontFamily: "'JetBrains Mono', monospace" }}>
                {formatTradePnl(trade)}
              </span>
              <span style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600, flexShrink: 0 }}>
                {formatTradeDate(trade.date)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// The locked teaser line rendered under the cards.
export function LockedInsightTeaser({ teaser, compact = false }) {
  const text = teaser?.text;
  if (!text) return null;
  return (
    <div
      role="note"
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        background: "rgba(184,134,11,0.08)",
        border: "1px dashed rgba(184,134,11,0.45)",
        borderRadius: 12,
        padding: compact ? "10px 12px" : "12px 14px",
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>🔒</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", color: "#B8860B", textTransform: "uppercase" }}>
          Your trades share a pattern
        </div>
        <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.5, marginTop: 2 }}>{text}</div>
      </div>
    </div>
  );
}
