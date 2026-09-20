"use client";

import { useRef } from "react";

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatMonth(date) {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function fmtProfit(profit, currency) {
  const abs = Math.abs(profit);
  const sign = profit >= 0 ? "+" : "-";
  if (abs >= 10000) return `${sign}${currency}${(abs / 1000).toFixed(0)}k`;
  if (abs >= 1000)  return `${sign}${currency}${(abs / 1000).toFixed(1)}k`;
  if (abs >= 100)   return `${sign}${currency}${abs.toFixed(0)}`;
  return `${sign}${currency}${abs.toFixed(0)}`;
}

function buildCalendar(byDate = {}, activeMonth = new Date()) {
  const firstDay    = new Date(activeMonth.getFullYear(), activeMonth.getMonth(), 1);
  const lastDay     = new Date(activeMonth.getFullYear(), activeMonth.getMonth() + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = lastDay.getDate();
  const cells       = [];
  const monthEntries = [];

  for (let i = 0; i < startOffset; i++) cells.push({ type: "empty", key: `es-${i}` });

  for (let day = 1; day <= daysInMonth; day++) {
    const key   = `${activeMonth.getFullYear()}-${String(activeMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const entry = byDate?.[key] || null;
    if (entry) monthEntries.push(entry);
    cells.push({ type: "day", key, day, entry });
  }

  while (cells.length % 7 !== 0) cells.push({ type: "empty", key: `ee-${cells.length}` });

  const maxAbsProfit = monthEntries.length > 0
    ? Math.max(...monthEntries.map(e => Math.abs(Number(e.profit) || 0)), 1)
    : 1;
  const totalProfit = monthEntries.reduce((s, e) => s + (Number(e.profit) || 0), 0);
  const totalTrades = monthEntries.reduce((s, e) => s + (Number(e.total)  || 0), 0);

  return { cells, maxAbsProfit, totalProfit, totalTrades };
}

export default function CalendarPnL({ byDate, activeMonth, onPrevMonth, onNextMonth, currency = "$" }) {
  const { cells, maxAbsProfit, totalProfit, totalTrades } = buildCalendar(byDate, activeMonth);
  const positive = totalProfit >= 0;
  const lastNavAtRef = useRef(0);

  const guardedNavigate = (direction) => {
    const now = Date.now();
    if (now - lastNavAtRef.current < 180) return;
    lastNavAtRef.current = now;
    if (direction === "prev") onPrevMonth?.();
    if (direction === "next") onNextMonth?.();
  };

  return (
    <div className="cal-wrapper">
      <style>{`
        .cal-wrapper { width: 100%; }

        /* ── Header ─────────────────────────────────── */
        .cal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          gap: 10px;
        }
        .cal-month-title {
          font-size: 18px;
          font-weight: 800;
          color: #0F1923;
          line-height: 1.1;
        }
        .cal-month-sub {
          font-size: 11px;
          color: #94A3B8;
          font-family: 'JetBrains Mono', monospace;
          margin-top: 4px;
        }
        .cal-nav-btn {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          border: 1px solid #E2E8F0;
          background: #FFFFFF;
          color: #0F1923;
          cursor: pointer;
          font-size: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: background 0.15s;
        }
        .cal-nav-btn:hover { background: #F8FAFC; }

        /* ── Grid ───────────────────────────────────── */
        .cal-grid {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 6px;
        }
        .cal-day-label {
          font-size: var(--fs-2xs);
          font-weight: 700;
          letter-spacing: 0.06em;
          color: #94A3B8;
          text-align: center;
          font-family: 'JetBrains Mono', monospace;
          padding-bottom: 6px;
        }
        .cal-empty {
          border-radius: 10px;
          background: rgba(148,163,184,0.05);
          aspect-ratio: 1 / 1.15;
        }
        .cal-cell {
          border-radius: 10px;
          padding: 8px 6px 6px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          box-shadow: 0 2px 8px rgba(15,25,35,0.04);
          min-height: 80px;
          transition: transform 0.15s;
          cursor: default;
          position: relative;
          overflow: hidden;
        }
        .cal-cell:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(15,25,35,0.09); }
        .cal-cell-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }
        .cal-cell-day-num {
          font-size: 12px;
          font-weight: 800;
          line-height: 1;
        }
        .cal-cell-badge {
          font-size: var(--fs-2xs);
          font-family: 'JetBrains Mono', monospace;
          font-weight: 700;
          padding: 1px 4px;
          border-radius: 4px;
          line-height: 1.4;
        }
        .cal-cell-bottom { }
        .cal-cell-profit {
          font-size: 11px;
          font-weight: 800;
          font-family: 'JetBrains Mono', monospace;
          line-height: 1.2;
          white-space: nowrap;
        }
        .cal-cell-wr {
          font-size: var(--fs-2xs);
          margin-top: 2px;
          font-family: 'JetBrains Mono', monospace;
          font-weight: 600;
        }
        .cal-cell-empty-label {
          font-size: var(--fs-2xs);
          margin-top: 2px;
          opacity: 0.5;
        }

        /* ── Legend ─────────────────────────────────── */
        .cal-legend {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-top: 14px;
          justify-content: flex-end;
          flex-wrap: wrap;
        }
        .cal-legend-item {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: var(--fs-2xs);
          color: #94A3B8;
          font-family: 'JetBrains Mono', monospace;
        }
        .cal-legend-dot {
          width: 10px;
          height: 10px;
          border-radius: 3px;
        }

        /* ── Mobile ─────────────────────────────────── */
        @media (max-width: 480px) {
          .cal-month-title { font-size: 16px; }
          .cal-month-sub   { font-size: var(--fs-2xs); }
          .cal-nav-btn     { width: 32px; height: 32px; font-size: 16px; }
          .cal-grid        { gap: 4px; }
          .cal-day-label   { font-size: var(--fs-2xs); padding-bottom: 4px; }
          .cal-cell        { min-height: 62px; padding: 5px 4px 4px; border-radius: 8px; }
          .cal-cell-day-num { font-size: var(--fs-2xs); }
          .cal-cell-badge   { font-size: var(--fs-2xs); padding: 1px 3px; }
          .cal-cell-profit  { font-size: var(--fs-2xs); }
          .cal-cell-wr      { font-size: var(--fs-2xs); }
          .cal-cell-empty-label { font-size: var(--fs-2xs); }
          .cal-empty        { border-radius: 8px; }
        }

        @media (max-width: 360px) {
          .cal-grid        { gap: 3px; }
          .cal-cell        { min-height: 54px; padding: 4px 3px 3px; border-radius: 7px; }
          .cal-cell-day-num { font-size: var(--fs-2xs); }
          .cal-cell-badge   { display: none; }
          .cal-cell-profit  { font-size: var(--fs-2xs); }
          .cal-cell-wr      { display: none; }
          .cal-cell-empty-label { display: none; }
          .cal-day-label    { font-size: var(--fs-2xs); letter-spacing: 0; }
        }
      `}</style>

      {/* Header */}
      <div className="cal-header">
        <div>
          <div className="cal-month-title">{formatMonth(activeMonth)}</div>
          <div className="cal-month-sub">
            {positive ? "+" : "-"}{currency}{Math.abs(totalProfit).toFixed(2)} · {totalTrades} trades
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className="cal-nav-btn" onClick={() => guardedNavigate("prev")}>‹</button>
          <button type="button" className="cal-nav-btn" onClick={() => guardedNavigate("next")}>›</button>
        </div>
      </div>

      {/* Grid */}
      <div className="cal-grid">
        {/* Day headers */}
        {WEEK_DAYS.map(d => (
          <div key={d} className="cal-day-label">{d}</div>
        ))}

        {/* Cells */}
        {cells.map(cell => {
          if (cell.type === "empty") {
            return <div key={cell.key} className="cal-empty" />;
          }

          const profit    = Number(cell.entry?.profit || 0);
          const trades    = Number(cell.entry?.total  || 0);
          const winRate   = cell.entry?.winRate ?? "0.0";
          const intensity = cell.entry ? Math.max(0.14, Math.abs(profit) / maxAbsProfit) : 0;

          const bg = !cell.entry
            ? "#FFFFFF"
            : profit >= 0
              ? `rgba(13,158,110,${Math.min(0.85, intensity * 0.92)})`
              : `rgba(214,59,59,${Math.min(0.85, intensity * 0.92)})`;

          const border = !cell.entry
            ? "1px solid #E8ECF0"
            : `1px solid ${profit >= 0 ? "rgba(13,158,110,0.2)" : "rgba(214,59,59,0.2)"}`;

          const isLight    = !cell.entry || intensity < 0.42;
          const textColor  = isLight ? "#0F1923" : "#FFFFFF";
          const mutedColor = isLight ? "#94A3B8" : "rgba(255,255,255,0.75)";
          const badgeBg    = isLight
            ? (profit >= 0 ? "rgba(13,158,110,0.1)" : "rgba(214,59,59,0.1)")
            : "rgba(255,255,255,0.2)";
          const badgeColor = isLight
            ? (profit >= 0 ? "#0D9E6E" : "#D63B3B")
            : "#FFFFFF";

          return (
            <div key={cell.key} className="cal-cell" style={{ background: bg, border }}>
              <div className="cal-cell-top">
                <span className="cal-cell-day-num" style={{ color: textColor }}>{cell.day}</span>
                {trades > 0 && (
                  <span className="cal-cell-badge" style={{ background: badgeBg, color: badgeColor }}>
                    {trades}T
                  </span>
                )}
              </div>
              <div className="cal-cell-bottom">
                <div className="cal-cell-profit" style={{ color: textColor }}>
                  {cell.entry ? fmtProfit(profit, currency) : "—"}
                </div>
                {cell.entry ? (
                  <div className="cal-cell-wr" style={{ color: mutedColor }}>{winRate}% WR</div>
                ) : (
                  <div className="cal-cell-empty-label" style={{ color: mutedColor }}>No trades</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="cal-legend">
        <div className="cal-legend-item">
          <div className="cal-legend-dot" style={{ background: "rgba(13,158,110,0.7)" }} />
          Profit
        </div>
        <div className="cal-legend-item">
          <div className="cal-legend-dot" style={{ background: "rgba(214,59,59,0.7)" }} />
          Loss
        </div>
        <div className="cal-legend-item">
          <div className="cal-legend-dot" style={{ background: "#FFFFFF", border: "1px solid #E2E8F0" }} />
          No trades
        </div>
      </div>
    </div>
  );
}
