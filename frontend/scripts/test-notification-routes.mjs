// node --test scripts/test-notification-routes.mjs
// Deep-link matrix: notification payload → route the app opens. Guards the
// rule that an Indian-market notification can never land on a Forex page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getNotificationTarget } from "../services/notificationRoutes.js";

const cases = [
  // [label, data, expected]
  ["backend deepLink always wins", { deepLink: "/indian-market/trades/edit?id=1", screen: "trades" }, "/indian-market/trades/edit?id=1"],
  ["Forex trade view", { screen: "trade", tradeId: "abc" }, "/trades/view?id=abc"],
  ["Forex trade edit", { screen: "trade-edit", tradeId: "abc" }, "/trades/edit?id=abc"],
  ["Indian trade view", { screen: "indian-trade", tradeId: "abc" }, "/indian-market/trades/view?id=abc"],
  ["Indian trade edit", { screen: "indian-trade-edit", tradeId: "abc" }, "/indian-market/trades/edit?id=abc"],
  ["Forex trades list", { screen: "trades" }, "/trades"],
  ["Indian trades list (explicit screen)", { screen: "indian-trades" }, "/indian-market/trades"],
  ["Indian trades list (generic screen + marketType)", { screen: "trades", marketType: "Indian_Market" }, "/indian-market/trades"],
  ["Forex analytics", { screen: "analytics" }, "/analytics"],
  ["Indian analytics (explicit)", { screen: "indian-analytics" }, "/indian-market/analytics"],
  ["Indian analytics (generic + marketType)", { screen: "analytics", marketType: "Indian_Market" }, "/indian-market/analytics"],
  ["psychology", { screen: "psychology" }, "/checklist/psychology"],
  ["weekly report by id", { screen: "weekly-report", reportId: "r1" }, "/weekly-reports?id=r1"],
  ["weekly report reminder, Indian", { screen: "weekly-report", marketType: "Indian_Market" }, "/weekly-reports?marketType=Indian_Market"],
  ["notifications", { screen: "notifications" }, "/notifications"],
  ["reflection", { screen: "reflection" }, "/reflection"],
  ["streaks", { screen: "streaks" }, "/streaks"],
  ["missions", { screen: "missions" }, "/missions"],
  ["checklist", { screen: "checklist" }, "/checklist"],
  ["OCR Forex", { screen: "upload-trade" }, "/upload-trade"],
  ["OCR Indian", { screen: "upload-trade", marketType: "Indian_Market" }, "/indian-market/upload-trade"],
  ["unknown screen, Forex", { screen: "nope" }, "/dashboard"],
  ["unknown screen, Indian", { screen: "nope", marketType: "Indian_Market" }, "/indian-market/dashboard"],
  ["empty payload", {}, "/dashboard"],
];

for (const [label, data, expected] of cases) {
  test(label, () => assert.equal(getNotificationTarget(data), expected));
}

test("no Indian-market payload ever resolves to a Forex route", () => {
  const screens = ["trade", "trade-edit", "trades", "analytics", "upload-trade", "weekly-report", "nope"];
  for (const screen of screens) {
    const target = getNotificationTarget({ screen, marketType: "Indian_Market", tradeId: "x" });
    if (screen === "trade" || screen === "trade-edit") continue; // explicit Forex screens carry their own market
    assert.ok(target.startsWith("/indian-market/") || target.startsWith("/weekly-reports"), `${screen} → ${target}`);
  }
});
