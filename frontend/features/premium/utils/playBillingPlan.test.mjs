import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
import {
  BASE_PLAN_ORDER,
  PURCHASE_STATE_PURCHASED,
  PURCHASE_STATE_PENDING,
  resolveReplacementMode,
  selectSellableOffers,
  fingerprintPurchaseToken,
  findCurrentDevicePurchase,
} from "./playBillingPlan.mjs";

const PRODUCT = "edgecipline_pro";
const TOKEN_A = "edgecipline-test-purchase-token-A-000000000000000000";
const TOKEN_B = "edgecipline-test-purchase-token-B-000000000000000000";
const subtle = webcrypto.subtle;

// The backend's fingerprint (utils/playAccountIdentity.fingerprintPurchaseToken).
const backendRef = (token) => createHash("sha256").update(token).digest("hex").slice(0, 16);

test("resolveReplacementMode: upgrade → CHARGE_FULL_PRICE, downgrade → WITH_TIME_PRORATION, unknown → throws", () => {
  assert.equal(resolveReplacementMode("edgecipline-pro-monthly", "edgecipline-pro-6month"), "CHARGE_FULL_PRICE");
  assert.equal(resolveReplacementMode("edgecipline-pro-monthly", "edgecipline-pro-3month"), "CHARGE_FULL_PRICE");
  assert.equal(resolveReplacementMode("edgecipline-pro-6month", "edgecipline-pro-monthly"), "WITH_TIME_PRORATION");
  assert.equal(resolveReplacementMode("edgecipline-pro-6month", "edgecipline-pro-3month"), "WITH_TIME_PRORATION");
  assert.throws(() => resolveReplacementMode("edgecipline-pro-lifetime", "edgecipline-pro-monthly"), /Unknown base plan/);
  assert.throws(() => resolveReplacementMode("edgecipline-pro-monthly", "edgecipline-pro-weekly"), /Unknown base plan/);
  assert.throws(() => resolveReplacementMode(null, "edgecipline-pro-monthly"), /Unknown base plan/);
});

test("paywall filters offers to BASE_PLAN_ORDER, drops promotional offers, and orders cheapest first", () => {
  const offers = [
    { basePlanId: "edgecipline-pro-6month", offerId: null, formattedPrice: "₹1,499" },
    { basePlanId: "edgecipline-pro-weekly", offerId: null, formattedPrice: "₹99" }, // not ours
    { basePlanId: "edgecipline-pro-monthly", offerId: "intro-7d", formattedPrice: "₹1" }, // promo variant
    { basePlanId: "edgecipline-pro-monthly", offerId: null, formattedPrice: "₹349" },
    { basePlanId: "edgecipline-pro-3month", offerId: null, formattedPrice: "₹899" },
    null,
  ];

  const sellable = selectSellableOffers(offers);

  assert.deepEqual(
    sellable.map((o) => o.basePlanId),
    ["edgecipline-pro-monthly", "edgecipline-pro-3month", "edgecipline-pro-6month"]
  );
  assert.deepEqual([...BASE_PLAN_ORDER], sellable.map((o) => o.basePlanId));
  assert.ok(sellable.every((o) => !o.offerId));
});

test("the client fingerprint equals the backend fingerprint", async () => {
  assert.equal(await fingerprintPurchaseToken(TOKEN_A, subtle), backendRef(TOKEN_A));
  assert.equal((await fingerprintPurchaseToken(TOKEN_A, subtle)).length, 16);
  assert.equal(await fingerprintPurchaseToken("", subtle), null);
  assert.equal(await fingerprintPurchaseToken(TOKEN_A, null), null);
});

test("paywall treats a tap as a switch only when the device token matches the server's purchaseRef", async () => {
  const devicePurchases = [
    { purchaseToken: TOKEN_A, purchaseState: PURCHASE_STATE_PURCHASED, products: [PRODUCT] },
  ];

  // Same subscription the server knows → switch.
  const match = await findCurrentDevicePurchase(devicePurchases, PRODUCT, backendRef(TOKEN_A), subtle);
  assert.equal(match?.purchaseToken, TOKEN_A);

  // Shared phone: the device holds someone ELSE's subscription → not a switch.
  const other = await findCurrentDevicePurchase(devicePurchases, PRODUCT, backendRef(TOKEN_B), subtle);
  assert.equal(other, null);

  // No server ref at all → never a switch.
  assert.equal(await findCurrentDevicePurchase(devicePurchases, PRODUCT, null, subtle), null);
});

test("a pending or foreign-product purchase is never the replacement target", async () => {
  const devicePurchases = [
    { purchaseToken: TOKEN_A, purchaseState: PURCHASE_STATE_PENDING, products: [PRODUCT] },
    { purchaseToken: TOKEN_B, purchaseState: PURCHASE_STATE_PURCHASED, products: ["com.other.pro"] },
  ];
  assert.equal(await findCurrentDevicePurchase(devicePurchases, PRODUCT, backendRef(TOKEN_A), subtle), null);
  assert.equal(await findCurrentDevicePurchase(devicePurchases, PRODUCT, backendRef(TOKEN_B), subtle), null);
});
