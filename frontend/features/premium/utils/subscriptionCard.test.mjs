import test from "node:test";
import assert from "node:assert/strict";
import {
  PLAY_MANAGE_URL,
  resolveExpiryLabel,
  describePlayLifecycle,
  showsPlayActions,
} from "./subscriptionCard.mjs";

const play = (over = {}) => ({ status: "active", provider: "google_play", cancelAtPeriodEnd: false, state: "active", ...over });
const razorpay = (over = {}) => ({ status: "active", provider: "razorpay", cancelAtPeriodEnd: false, state: null, ...over });

test('settings shows "Ends" not "Renews" when cancelAtPeriodEnd', () => {
  assert.equal(resolveExpiryLabel(play()), "Renews");
  assert.equal(resolveExpiryLabel(play({ cancelAtPeriodEnd: true, state: "cancelled" })), "Ends");
  assert.equal(resolveExpiryLabel(razorpay()), "Expires");
  assert.equal(resolveExpiryLabel(play({ status: "expired" })), "Expires");
  assert.equal(resolveExpiryLabel(null), "Expires");
});

test("cancelled, grace, on-hold and pending Play states each get a notice; Razorpay never does", () => {
  assert.match(describePlayLifecycle(play({ cancelAtPeriodEnd: true, state: "cancelled" }), "12 Oct 2026").text, /ends on 12 Oct 2026/);
  assert.equal(describePlayLifecycle(play({ state: "grace_period" })).tone, "warn");
  assert.equal(describePlayLifecycle(play({ state: "on_hold", status: "expired" })).tone, "warn");
  assert.match(describePlayLifecycle(play({ state: "pending", status: "inactive" })).text, /Waiting for Google Play/);
  assert.equal(describePlayLifecycle(play()), null);
  assert.equal(describePlayLifecycle(razorpay()), null);
  assert.equal(describePlayLifecycle(null), null);
});

test("settings shows a Manage/Change plan entry for a google_play subscriber", () => {
  assert.equal(showsPlayActions(play(), true), true);
  assert.equal(showsPlayActions(razorpay(), true), false);
  assert.equal(showsPlayActions(play({ status: "expired" }), false), false);
  assert.match(PLAY_MANAGE_URL, /^https:\/\/play\.google\.com\/store\/account\/subscriptions\?sku=edgecipline_pro&package=com\.edgecipline$/);
});
