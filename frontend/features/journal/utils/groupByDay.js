// Journal rows grouped under day headers. Pure, so it can be unit-tested.
//
// Input: trades already sorted newest first (the API's order).
// Output: a flat list the virtualised list can render in one pass:
//   [{ kind: "day", key, label, count, wins, losses, net, isToday },
//    { kind: "trade", key, trade, dayKey }, …]

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

// A date-only entry is stored as UTC midnight. Read it in UTC, or a trader
// west of UTC would see it on the previous day.
function isUtcMidnight(d) {
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
}

const pad = (n) => String(n).padStart(2, "0");

/**
 * When the trade happened, for grouping and display.
 * { date, dayKey: "YYYY-MM-DD", hasTime } or null when there's no usable date.
 */
export function getTradeMoment(trade) {
  const chosen = toDate(trade?.tradeDate) || toDate(trade?.effectiveTradeDate) || toDate(trade?.createdAt);
  if (!chosen) return null;
  if (isUtcMidnight(chosen)) {
    return {
      date: chosen,
      dayKey: `${chosen.getUTCFullYear()}-${pad(chosen.getUTCMonth() + 1)}-${pad(chosen.getUTCDate())}`,
      hasTime: false,
    };
  }
  return {
    date: chosen,
    dayKey: `${chosen.getFullYear()}-${pad(chosen.getMonth() + 1)}-${pad(chosen.getDate())}`,
    hasTime: true,
  };
}

function localDayKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dayLabel(dayKey, now = new Date()) {
  if (dayKey === "undated") return "No date";
  const today = localDayKey(now);
  const yesterday = localDayKey(new Date(now.getTime() - DAY_MS));
  if (dayKey === today) return "Today";
  if (dayKey === yesterday) return "Yesterday";
  const [y, m, d] = dayKey.split("-").map(Number);
  // Noon avoids DST edges when turning the key back into a date.
  const date = new Date(y, m - 1, d, 12);
  const opts = { weekday: "short", day: "numeric", month: "short" };
  if (y !== now.getFullYear()) opts.year = "numeric";
  return date.toLocaleDateString("en-GB", opts);
}

const round2 = (n) => Math.round(n * 100) / 100;

export function groupTradesByDay(trades, { now = new Date() } = {}) {
  const groups = new Map();
  const undated = [];

  for (const trade of trades || []) {
    if (!trade) continue;
    const moment = getTradeMoment(trade);
    if (!moment) { undated.push(trade); continue; }
    if (!groups.has(moment.dayKey)) groups.set(moment.dayKey, []);
    groups.get(moment.dayKey).push(trade);
  }

  // Newest day first, regardless of how the pages arrived.
  const keys = [...groups.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  if (undated.length) { keys.push("undated"); groups.set("undated", undated); }

  const today = localDayKey(now);
  const items = [];
  for (const key of keys) {
    const list = groups.get(key);
    let net = 0, wins = 0, losses = 0, withPnl = 0;
    for (const t of list) {
      const p = t.profit === null || t.profit === undefined || t.profit === "" ? NaN : Number(t.profit);
      if (!Number.isFinite(p)) continue;
      withPnl += 1;
      net += p;
      if (p > 0) wins += 1;
      else if (p < 0) losses += 1;
    }
    items.push({
      kind: "day",
      key: `day-${key}`,
      dayKey: key,
      label: dayLabel(key, now),
      count: list.length,
      wins,
      losses,
      net: withPnl ? round2(net) : null,
      isToday: key === today,
    });
    for (const trade of list) {
      items.push({ kind: "trade", key: `trade-${trade._id}`, trade, dayKey: key });
    }
  }
  return items;
}
