import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTodayLoop, cleanLabel, makeMoney } from "./todayLoop.js";

// Wed 18 Nov 2026, 11:00 device time; IST equivalents set per test.
const WED = new Date(2026, 10, 18, 11, 0, 0);
const SAT = new Date(2026, 10, 21, 11, 0, 0);

const forexRoutes = {
  checklist: "/checklist", setups: "/setups", journal: "/trades", insights: "/intelligence",
  coach: "/coach", reports: "/weekly-reports?market=Forex",
};
const indianRoutes = {
  checklist: "/checklist", setups: "/indian-market/setups", journal: "/indian-market/trades",
  insights: "/indian-market/intelligence", coach: "/coach", reports: "/weekly-reports?market=Indian_Market",
};

const stats = (over = {}) => ({
  totalTrades: 40, pnlReadyTrades: 40, winRate: 50, winningTrades: 20, losingTrades: 20,
  avgWin: 50, avgLoss: 40, netPnL: 200, totalProfit: 200, totalCosts: 0, tradesMissingPnl: 0, ...over,
});

const base = (over = {}) => ({
  market: "Forex",
  routes: forexRoutes,
  now: WED,
  stats: stats(),
  streaks: { todayKey: "2026-11-18", checklist: { lastQualifyingDate: "2026-11-17" } },
  reflection: { today: { tradeCount: 0, completed: false } },
  onboarding: { setupCount: 2 },
  marketDay: { open: true, reason: null },
  ...over,
});

const leak = (type, name, cost, count = 6, impactPct = 30) => ({ type, name, cost, count, impactPct });

function assertWellFormed(loop) {
  assert.equal(loop.steps.length, 3, "always three rows");
  const targets = new Set();
  for (const s of loop.steps) {
    assert.ok(s.title && s.title.trim(), "title present");
    assert.ok(typeof s.sub === "string" && s.sub.length > 0, "sub present");
    const text = `${s.title} ${s.emph} ${s.sub}`;
    assert.doesNotMatch(text, /NaN|undefined|null|Infinity|\$0\b|₹0\b/, `no junk in "${text}"`);
    assert.ok(!targets.has(s.target), `duplicate target ${s.target}`);
    targets.add(s.target);
    assert.ok(["link", "logTrade", "reflect"].includes(s.action.kind));
    if (s.action.kind === "link") assert.ok(s.action.href.startsWith("/"));
  }
}

// ── Signals ────────────────────────────────────────────────────────────────

test("emotion leak → psychology guide with the trader's number", () => {
  const loop = buildTodayLoop(base({ psychologyCost: { topLeaks: [leak("emotion", "fear", -210)] } }));
  assertWellFormed(loop);
  assert.equal(loop.mode, "personal");
  assert.equal(loop.steps[0].target, "psychology");
  assert.equal(loop.steps[0].emph, "Fear cost you $210");
  assert.match(loop.steps[0].sub, /6 trades · 30% of your losses/);
});

test("rule-violation leak → checklist; discipline row moves to the log", () => {
  const loop = buildTodayLoop(base({ psychologyCost: { topLeaks: [leak("ruleViolation", "wait for confirmation", -180)] } }));
  assertWellFormed(loop);
  assert.equal(loop.steps[0].target, "checklist");
  assert.match(loop.steps[0].emph, /Breaking "Wait for confirmation" cost \$180/);
  assert.equal(loop.steps[1].key, "log");
});

test("mistake leak → coach with an encoded question", () => {
  const loop = buildTodayLoop(base({ psychologyCost: { topLeaks: [leak("mistake", "early_exit", -95)] } }));
  assertWellFormed(loop);
  const row = loop.steps[0];
  assert.equal(row.target, "coach");
  assert.match(row.action.href, /^\/coach\?ask=/);
  const q = decodeURIComponent(row.action.href.split("ask=")[1]);
  assert.match(q, /"Early exit" has cost me \$95 over 6 trades/);
  assert.ok(q.length <= 200);
});

test("the biggest leak wins", () => {
  const loop = buildTodayLoop(base({
    psychologyCost: { topLeaks: [leak("mistake", "no sl", -50, 5, 10), leak("emotion", "revenge", -400, 8, 60)] },
  }));
  assert.equal(loop.steps[0].target, "psychology");
});

test("losses bigger than wins → set stop before entry", () => {
  const loop = buildTodayLoop(base({ stats: stats({ avgWin: 45, avgLoss: -63 }) }));
  assertWellFormed(loop);
  assert.equal(loop.steps[0].key, "loss-size");
  assert.equal(loop.steps[0].emph, "Losses avg $63 vs wins $45");
});

test("the user's real profile (37% win, 117/63) → A+ setups", () => {
  const loop = buildTodayLoop(base({
    stats: stats({ totalTrades: 73, pnlReadyTrades: 73, winRate: 37, winningTrades: 27, losingTrades: 46, avgWin: 117, avgLoss: 63 }),
  }));
  assertWellFormed(loop);
  assert.equal(loop.steps[0].key, "win-rate");
  assert.equal(loop.steps[0].emph, "37% win rate");
  assert.equal(loop.steps[0].action.href, "/setups");
  assert.equal(loop.basis, "Built from your 73 Forex trades");
});

test("declining discipline → weekly feedback", () => {
  const loop = buildTodayLoop(base({ timeline: { trends: { discipline: "declining" }, buckets: [] } }));
  assertWellFormed(loop);
  assert.equal(loop.steps[0].target, "reports");
});

test("losing last period → weekly feedback (needs ≥2 buckets)", () => {
  const one = buildTodayLoop(base({ timeline: { trends: {}, buckets: [{ net: -50 }] } }));
  assert.notEqual(one.steps[0].target, "reports");
  const two = buildTodayLoop(base({ timeline: { trends: {}, buckets: [{ net: 20 }, { net: -61.7 }] } }));
  assert.equal(two.steps[0].target, "reports");
  assert.equal(two.steps[0].emph, "Last period -$62");
});

test("missing P&L → journal", () => {
  const loop = buildTodayLoop(base({ stats: stats({ tradesMissingPnl: 12 }) }));
  assertWellFormed(loop);
  assert.equal(loop.steps[0].target, "journal");
  assert.equal(loop.steps[0].emph, "12 trades have no P&L");
});

test("no setups → write first setup", () => {
  const loop = buildTodayLoop(base({ onboarding: { setupCount: 0 } }));
  assertWellFormed(loop);
  assert.equal(loop.steps[0].key, "no-setups");
});

test("nothing wrong → lean into the strength", () => {
  const loop = buildTodayLoop(base({ tradingDNA: { sessionDNA: { best: { name: "London", netPnL: 320, count: 12 } } } }));
  assertWellFormed(loop);
  assert.equal(loop.steps[0].key, "strength");
  assert.equal(loop.steps[0].emph, "London session made +$320");
});

test("nothing wrong and no strength → generic rows, still 3", () => {
  const loop = buildTodayLoop(base());
  assertWellFormed(loop);
  assert.deepEqual(loop.steps.map((s) => s.key), ["checklist", "log", "reflect"]);
});

// ── Day state ──────────────────────────────────────────────────────────────

test("checklist used today is ticked, then row 2 shows the log", () => {
  const loop = buildTodayLoop(base({
    streaks: { todayKey: "2026-11-18", checklist: { lastQualifyingDate: "2026-11-18" } },
    psychologyCost: { topLeaks: [leak("emotion", "fear", -210)] },
    reflection: { today: { tradeCount: 2, completed: false } },
  }));
  assertWellFormed(loop);
  assert.equal(loop.steps[1].key, "log");
  assert.equal(loop.steps[1].done, true);
  assert.equal(loop.steps[1].sub, "2 logged today");
});

test("reflection done with a broken plan → coach", () => {
  const loop = buildTodayLoop(base({ reflection: { today: { tradeCount: 3, completed: true, followedPlan: "no" } } }));
  assertWellFormed(loop);
  assert.equal(loop.steps[2].key, "broke-plan");
  assert.match(loop.steps[2].action.href, /^\/coach\?ask=/);
});

test("reflection done, plan followed → lesson (or a strong 2nd prescription)", () => {
  const loop = buildTodayLoop(base({ reflection: { today: { tradeCount: 1, completed: true, followedPlan: "yes" } } }));
  assertWellFormed(loop);
  assert.equal(loop.steps[2].key, "lesson");
});

test("progress counts done rows", () => {
  const loop = buildTodayLoop(base({
    streaks: { todayKey: "2026-11-18", checklist: { lastQualifyingDate: "2026-11-18" } },
    reflection: { today: { tradeCount: 1, completed: true, followedPlan: "yes" } },
  }));
  assert.equal(loop.doneCount, loop.steps.filter((s) => s.done).length);
  assert.ok(loop.doneCount >= 1);
});

// ── Closed days ────────────────────────────────────────────────────────────

test("Saturday → review mode, leak named in the coach row", () => {
  const loop = buildTodayLoop(base({
    now: SAT, marketDay: undefined,
    streaks: { todayKey: "2026-11-21", checklist: {} },
    psychologyCost: { topLeaks: [leak("emotion", "fear", -210)] },
  }));
  assertWellFormed(loop);
  assert.equal(loop.mode, "review");
  assert.deepEqual(loop.steps.map((s) => s.target), ["reports", "coach", "setups"]);
  assert.match(loop.steps[1].emph, /#1 leak: Fear cost you \$210/);
});

test("NSE holiday (server marketDay) → review mode with holiday wording", () => {
  const loop = buildTodayLoop(base({
    market: "Indian_Market", routes: indianRoutes,
    marketDay: { open: false, reason: "HOLIDAY" },
  }));
  assertWellFormed(loop);
  assert.equal(loop.mode, "review");
  assert.equal(loop.steps[0].emph, "NSE closed today (holiday)");
  assert.equal(loop.steps[0].action.href, "/weekly-reports?market=Indian_Market");
  assert.equal(loop.steps[2].action.href, "/indian-market/setups");
});

test("marketDay missing (old server) → falls back to the weekday", () => {
  const loop = buildTodayLoop(base({ marketDay: undefined }));
  assert.notEqual(loop.mode, "review");
});

test("server todayKey beats the device date around midnight", () => {
  // Device says Friday 23:30, the user's timezone is already Saturday.
  const loop = buildTodayLoop(base({
    now: new Date(2026, 10, 20, 23, 30), marketDay: undefined,
    streaks: { todayKey: "2026-11-21", checklist: {} },
  }));
  assert.equal(loop.mode, "review");
});

// ── Indian Market ──────────────────────────────────────────────────────────

test("Indian market: ₹ with Indian grouping and market routes", () => {
  const loop = buildTodayLoop(base({
    market: "Indian_Market", routes: indianRoutes,
    psychologyCost: { topLeaks: [leak("mistake", "options buying", -125000, 9, 40)] },
  }));
  assertWellFormed(loop);
  assert.equal(loop.steps[0].emph, "Options buying cost ₹1,25,000");
  const q = decodeURIComponent(loop.steps[0].action.href.split("ask=")[1]);
  assert.match(q, /^In my Indian market trades: /);
  assert.equal(loop.basis, "Built from your 40 Indian Market trades");
});

test("Indian market: wording follows the IST session clock", () => {
  const at = (h, m) => new Date(Date.UTC(2026, 10, 18, h, m) - 330 * 60000); // IST → UTC
  const pre = buildTodayLoop(base({ market: "Indian_Market", routes: indianRoutes, now: at(8, 50) }));
  assert.equal(pre.steps.find((s) => s.key === "checklist").sub, "Pre-market: before the 09:15 open");
  assert.equal(pre.steps.find((s) => s.key === "reflect").sub, "After the 15:30 close");
  const after = buildTodayLoop(base({ market: "Indian_Market", routes: indianRoutes, now: at(15, 45) }));
  assert.equal(after.steps.find((s) => s.key === "reflect").sub, "Market closed — reflect now");
});

test("charges leak: brokerage ≥25% of gross profit", () => {
  const loop = buildTodayLoop(base({
    market: "Indian_Market", routes: indianRoutes,
    stats: stats({ totalProfit: 11000, totalCosts: 4200, netPnL: 6800 }),
  }));
  assertWellFormed(loop);
  assert.equal(loop.steps[0].key, "charges");
  assert.equal(loop.steps[0].emph, "Brokerage & taxes took ₹4,200");
  assert.equal(loop.steps[0].sub, "38% of your gross profit");
});

test("charges leak skipped when costs are 0, below 25%, or too few trades", () => {
  for (const s of [
    stats({ totalCosts: 0 }),
    stats({ totalProfit: 10000, totalCosts: 1000 }),
    stats({ totalTrades: 6, pnlReadyTrades: 6, totalProfit: 1000, totalCosts: 900 }),
  ]) {
    const loop = buildTodayLoop(base({ market: "Indian_Market", routes: indianRoutes, stats: s }));
    assert.ok(!loop.steps.some((r) => r.key === "charges"));
  }
});

// ── Edge cases ─────────────────────────────────────────────────────────────

test("every input missing → generic, well-formed", () => {
  for (const input of [undefined, {}, { now: "nope" }, { stats: null, streaks: null, reflection: null }]) {
    const loop = buildTodayLoop(input);
    assertWellFormed(loop);
  }
});

test("NaN / string / Infinity numbers never leak into text", () => {
  const loop = buildTodayLoop(base({
    stats: stats({ avgWin: "abc", avgLoss: Infinity, winRate: NaN, tradesMissingPnl: "3", totalCosts: "x" }),
    psychologyCost: { topLeaks: [leak("emotion", "fear", "NaN"), leak("mistake", "", "-80", "4", "12")] },
  }));
  assertWellFormed(loop);
});

test("zero wins or zero losses → no ratio rows", () => {
  for (const s of [stats({ avgWin: 0, winningTrades: 0 }), stats({ avgLoss: 0, losingTrades: 0 })]) {
    const loop = buildTodayLoop(base({ stats: s }));
    assertWellFormed(loop);
    assert.ok(!loop.steps.some((r) => r.key === "loss-size" || r.key === "win-rate"));
  }
});

test("fewer than 5 trades → generic with a countdown", () => {
  const loop = buildTodayLoop(base({
    stats: stats({ totalTrades: 2, pnlReadyTrades: 2 }),
    psychologyCost: { topLeaks: [leak("emotion", "fear", -210)] },
  }));
  assertWellFormed(loop);
  assert.equal(loop.mode, "generic");
  assert.equal(loop.basis, "Log 3 more trades for a personal plan");
});

test("leaks with too few trades or tiny impact are ignored", () => {
  const loop = buildTodayLoop(base({
    psychologyCost: { topLeaks: [leak("emotion", "fear", -210, 2, 40), leak("mistake", "late", -5, 9, 1)] },
  }));
  assert.ok(!loop.steps.some((s) => s.key.startsWith("leak")));
});

test("unknown trend values count as stable", () => {
  const loop = buildTodayLoop(base({ timeline: { trends: { discipline: "crashing", selfAwareness: 42 } } }));
  assert.ok(!loop.steps.some((s) => s.target === "reports" && s.key === "discipline"));
});

test("two prescriptions for the same feature → only one row", () => {
  const loop = buildTodayLoop(base({
    stats: stats({ avgWin: 30, avgLoss: 90 }),
    psychologyCost: { topLeaks: [leak("ruleViolation", "wait", -500, 9, 70)] },
  }));
  assertWellFormed(loop);
  assert.equal(loop.steps.filter((s) => s.target === "checklist").length, 1);
});

test("a 300-character tag is capped", () => {
  const loop = buildTodayLoop(base({ psychologyCost: { topLeaks: [leak("emotion", "x".repeat(300), -100)] } }));
  assertWellFormed(loop);
  assert.ok(loop.steps[0].emph.length < 70);
  assert.equal(cleanLabel("   "), "this habit");
  assert.equal(cleanLabel("no_sl"), "No SL");
});

test("unreliable data (failed analytics) → generic, no diagnosis", () => {
  const loop = buildTodayLoop(base({ unreliable: true, psychologyCost: { topLeaks: [leak("emotion", "fear", -210)] } }));
  assert.equal(loop.mode, "generic");
  assert.ok(!loop.steps.some((s) => s.key.startsWith("leak")));
});

test("an exception inside the engine → generic loop and onError called", () => {
  let reported = null;
  const evil = base({ onError: (e) => { reported = e; } });
  Object.defineProperty(evil, "psychologyCost", { get() { throw new Error("boom"); }, enumerable: true });
  const loop = buildTodayLoop(evil);
  assertWellFormed(loop);
  assert.equal(loop.mode, "generic");
  assert.equal(reported?.message, "boom");
});

test("money formatting", () => {
  assert.equal(makeMoney("USD")(-1234.5), "$1,235");
  assert.equal(makeMoney("INR")(125000), "₹1,25,000");
  assert.equal(makeMoney("INR")(NaN), "₹0");
});
