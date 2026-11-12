import { test } from "node:test";
import assert from "node:assert/strict";
import { groupTradesByDay, getTradeMoment, dayLabel } from "./groupByDay.js";

const NOW = new Date(2026, 10, 9, 15, 0, 0); // Mon 9 Nov 2026, 15:00 local
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).toISOString();
const days = (items) => items.filter((i) => i.kind === "day");

test("groups by local day, newest first, with net and W/L", () => {
  const items = groupTradesByDay([
    { _id: "a", tradeDate: at(9, 10), profit: 120 },
    { _id: "b", tradeDate: at(9, 9), profit: -35.8 },
    { _id: "c", tradeDate: at(6, 14), profit: -40 },
  ], { now: NOW });
  assert.deepEqual(items.map((i) => i.key), ["day-2026-11-09", "trade-a", "trade-b", "day-2026-11-06", "trade-c"]);
  const [today, fri] = days(items);
  assert.equal(today.label, "Today");
  assert.equal(today.isToday, true);
  assert.equal(today.net, 84.2);
  assert.equal(today.wins, 1);
  assert.equal(today.losses, 1);
  assert.equal(today.count, 2);
  assert.equal(fri.net, -40);
  assert.equal(fri.isToday, false);
});

test("a date-only trade (UTC midnight) stays on its own date in any timezone", () => {
  const m = getTradeMoment({ tradeDate: "2026-11-06T00:00:00.000Z" });
  assert.equal(m.dayKey, "2026-11-06");
  assert.equal(m.hasTime, false);
});

test("falls back to effectiveTradeDate, then createdAt", () => {
  assert.equal(getTradeMoment({ effectiveTradeDate: at(5, 10) }).dayKey, "2026-11-05");
  assert.equal(getTradeMoment({ createdAt: at(4, 10) }).dayKey, "2026-11-04");
});

test("trades without a usable date go in a last 'No date' group", () => {
  const items = groupTradesByDay([
    { _id: "x", tradeDate: "garbage", createdAt: null, profit: 5 },
    { _id: "a", tradeDate: at(9, 10), profit: 1 },
  ], { now: NOW });
  const d = days(items);
  assert.equal(d.at(-1).label, "No date");
  assert.equal(items.at(-1).trade._id, "x");
});

test("null profit counts as a trade but not toward P&L or W/L", () => {
  const [day] = days(groupTradesByDay([
    { _id: "a", tradeDate: at(9, 10), profit: null },
    { _id: "b", tradeDate: at(9, 11), profit: 0 },
  ], { now: NOW }));
  assert.equal(day.count, 2);
  assert.equal(day.wins, 0);
  assert.equal(day.losses, 0);
  assert.equal(day.net, 0);
});

test("a day with only pending P&L has net null (shown as no amount)", () => {
  const [day] = days(groupTradesByDay([{ _id: "a", tradeDate: at(9, 10), profit: null }], { now: NOW }));
  assert.equal(day.net, null);
});

test("a day split across two loaded pages merges into one header", () => {
  const page1 = [{ _id: "a", tradeDate: at(8, 15), profit: 10 }];
  const page2 = [{ _id: "b", tradeDate: at(8, 9), profit: -4 }, { _id: "c", tradeDate: at(7, 9), profit: 3 }];
  const d = days(groupTradesByDay([...page1, ...page2], { now: NOW }));
  assert.equal(d.length, 2);
  assert.equal(d[0].label, "Yesterday");
  assert.equal(d[0].count, 2);
  assert.equal(d[0].net, 6);
});

test("float noise is rounded off the day total", () => {
  const [day] = days(groupTradesByDay([
    { _id: "a", tradeDate: at(9, 10), profit: 0.1 },
    { _id: "b", tradeDate: at(9, 11), profit: 0.2 },
  ], { now: NOW }));
  assert.equal(day.net, 0.3);
});

test("labels: other years show the year", () => {
  assert.match(dayLabel("2025-12-31", NOW), /2025/);
  assert.doesNotMatch(dayLabel("2026-11-02", NOW), /2026/);
});

test("empty and missing input", () => {
  assert.deepEqual(groupTradesByDay([], { now: NOW }), []);
  assert.deepEqual(groupTradesByDay(undefined, { now: NOW }), []);
});
