// node --test features/premium/utils/paywallRouting.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  choosePaywallProvider,
  PROVIDER_PLAY,
  PROVIDER_RAZORPAY,
} from "./paywallRouting.mjs";

test("each platform gets the processor it can actually transact with", () => {
  assert.equal(choosePaywallProvider("web"), PROVIDER_RAZORPAY);
  assert.equal(choosePaywallProvider("android"), PROVIDER_PLAY);
});

test("iOS gets no processor", () => {
  // Not Razorpay (App Store 3.1.1) and not Play Billing (a store the device
  // cannot transact with). No StoreKit in this release, so: nothing.
  assert.equal(choosePaywallProvider("ios"), null);
});

test("an unknown platform never inherits Razorpay", () => {
  // The bug this guards: "Android, else Razorpay" made every non-Android
  // platform a Razorpay platform, iOS included.
  for (const platform of ["electron", "ipados", "macos", "windows", "", "IOS", "Android"]) {
    assert.equal(choosePaywallProvider(platform), null, platform);
  }
});

test("an unresolved platform during server render gets no processor", () => {
  // getNativePlatform() returns null on the server. Rendering nothing is the
  // safe snapshot: both paywalls are ssr:false anyway, so web loses nothing.
  assert.equal(choosePaywallProvider(null), null);
  assert.equal(choosePaywallProvider(undefined), null);
});

test("the rule is total — every input returns a provider or null, never throws", () => {
  for (const input of [0, 1, {}, [], true, false, NaN, Symbol("x")]) {
    assert.equal(choosePaywallProvider(input), null, String(input));
  }
});
