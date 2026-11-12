import { test } from "node:test";
import assert from "node:assert/strict";
import { getNextAction } from "./nextAction.js";

const at = (hour) => new Date(2026, 10, 8, hour, 0, 0);

test("streak at risk with nothing logged today → protect the streak", () => {
  const a = getNextAction({
    streaks: { journal: { current: 12, atRisk: true } },
    reflection: { today: { tradeCount: 0, completed: false } },
    now: at(20),
  });
  assert.equal(a.id, "protect-streak");
  assert.match(a.title, /12-day streak/);
  assert.equal(a.action.kind, "logTrade");
});

test("at-risk flag is ignored once a trade is logged today", () => {
  const a = getNextAction({
    streaks: { journal: { current: 5, atRisk: true } },
    reflection: { today: { tradeCount: 2, completed: false } },
    now: at(10),
  });
  assert.equal(a.id, "checklist");
});

test("evening without a reflection → close the day", () => {
  const a = getNextAction({
    streaks: { journal: { current: 3, atRisk: false } },
    reflection: { today: { tradeCount: 1, completed: false } },
    now: at(18),
  });
  assert.equal(a.id, "reflect");
  assert.equal(a.action.kind, "reflect");
});

test("evening after reflecting → back to the checklist", () => {
  const a = getNextAction({
    reflection: { today: { tradeCount: 1, completed: true } },
    now: at(21),
  });
  assert.equal(a.id, "checklist");
});

test("default is the checklist link, honouring the market href", () => {
  const a = getNextAction({ now: at(9), checklistHref: "/checklist?market=Indian_Market" });
  assert.equal(a.id, "checklist");
  assert.deepEqual(a.action, { kind: "link", href: "/checklist?market=Indian_Market" });
});

test("no data at all does not throw", () => {
  assert.equal(getNextAction().id, getNextAction({}).id);
});

test("empty market (trades only in the other market) → first trade here, ahead of everything", () => {
  const a = getNextAction({
    emptyMarketLabel: "Indian Market",
    streaks: { journal: { current: 9, atRisk: true } },
    now: at(20),
  });
  assert.equal(a.id, "first-trade-in-market");
  assert.match(a.title, /first Indian Market trade/);
  assert.equal(a.action.kind, "logTrade");
});
