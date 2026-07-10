"use client";

// 12-week (≈84-day) heatmap. Each day is a cell colored by whether the user
// qualified for the journal streak that day. Mirrors the GitHub contributions
// grid — instantly readable, no legend needed.
//
// Columns = weeks (oldest left, newest right). Rows = weekdays (Sun → Sat).

function weekdayOf(dayKey) {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function colorFor({ qualifiesJournal, tradeCount, noTradeToday, isFuture, isToday }) {
  if (isFuture) return "transparent";
  if (qualifiesJournal && tradeCount > 0) return "#F59E0B";  // traded — amber
  if (qualifiesJournal && noTradeToday)   return "#FDE68A";  // sat out — soft amber
  if (isToday)                            return "#E2E8F0";  // today, not yet logged
  return "#F1F5F9";                                          // missed
}

function borderFor(isToday) {
  return isToday ? "1.5px solid #0F1923" : "1px solid transparent";
}

export default function StreakCalendar({ calendar = [] }) {
  if (!calendar.length) return null;

  // Truncate to the last 84 days. The backend may return up to 366, but the
  // detail page card only shows ~3 months.
  const window = calendar.slice(-84);
  const todayKey = window[window.length - 1]?.day;

  // Bucket into weeks (columns). Each column has up to 7 cells indexed by
  // weekday so cells line up consistently across columns.
  const columns = [];
  let currentColumn = Array(7).fill(null);
  for (const cell of window) {
    const wd = weekdayOf(cell.day);
    if (wd === 0 && currentColumn.some(Boolean)) {
      columns.push(currentColumn);
      currentColumn = Array(7).fill(null);
    }
    currentColumn[wd] = cell;
  }
  if (currentColumn.some(Boolean)) columns.push(currentColumn);

  const CELL = 14;
  const GAP = 3;

  return (
    <div>
      <div style={{ display: "flex", gap: GAP, alignItems: "flex-start", overflowX: "auto", paddingBottom: 6 }}>
        {columns.map((col, ci) => (
          <div key={ci} style={{ display: "flex", flexDirection: "column", gap: GAP }}>
            {col.map((cell, ri) => {
              if (!cell) {
                return <div key={ri} style={{ width: CELL, height: CELL }} />;
              }
              const isToday = cell.day === todayKey;
              return (
                <div
                  key={cell.day}
                  title={tooltipFor(cell)}
                  style={{
                    width: CELL, height: CELL,
                    borderRadius: 3,
                    background: colorFor({ ...cell, isToday }),
                    border: borderFor(isToday),
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <Legend />
    </div>
  );
}

function tooltipFor(cell) {
  const dateLabel = new Date(cell.day).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
  if (cell.tradeCount > 0) return `${dateLabel} — ${cell.tradeCount} trade${cell.tradeCount === 1 ? "" : "s"}`;
  if (cell.noTradeToday)   return `${dateLabel} — Sat out`;
  return `${dateLabel} — No activity`;
}

function Legend() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 10, fontSize: 11, color: "#64748B" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
        <span style={{ width: 10, height: 10, background: "#F59E0B", borderRadius: 2 }} /> Traded
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
        <span style={{ width: 10, height: 10, background: "#FDE68A", borderRadius: 2 }} /> Sat out
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
        <span style={{ width: 10, height: 10, background: "#F1F5F9", borderRadius: 2 }} /> No activity
      </span>
    </div>
  );
}
