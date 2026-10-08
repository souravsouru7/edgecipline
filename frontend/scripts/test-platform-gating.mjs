// node --test scripts/test-platform-gating.mjs
//
// Android-only plugins must be unreachable on iOS, web and during SSR.
//
// Capacitor.isNativePlatform() is true on both Android and iOS, so it cannot
// gate a plugin only Android implements. These tests drive the real wrappers
// against a fake Capacitor and assert that the bridge is touched on Android and
// on nothing else — and that an unsupported platform is a VALUE, not a throw.
import { test } from "node:test";
import assert from "node:assert/strict";

// ─── Fake Capacitor host ─────────────────────────────────────────────────────

globalThis.window = globalThis;
globalThis.document = { visibilityState: "visible" };

// `window === globalThis` in this harness, so SSR is modelled by deleting the
// self-reference: `typeof window` then really is "undefined", exactly as it is
// during a Next prerender.
function setHost(platform) {
  if (platform === null) {
    delete globalThis.window;
    return;
  }
  globalThis.window = globalThis;
  globalThis.window.Capacitor = {
    isNativePlatform: () => platform !== "web",
    getPlatform: () => platform,
    Plugins: {},
  };
}

let instance = 0;

/**
 * Loads a wrapper with `platform` installed. `null` platform models SSR: no
 * window.Capacitor at all.
 */
async function loadWrapper(modulePath, platform) {
  setHost(platform);
  const realConsole = globalThis.console;
  globalThis.console = { log() {}, info() {}, warn() {}, error() {} };
  try {
    return await import(`${modulePath}?instance=${instance++}`);
  } finally {
    globalThis.console = realConsole;
  }
}

const CHECKLIST = "../plugins/ChecklistNotificationPlugin.js";
const BILLING = "../plugins/EdgeBillingPlugin.js";

// ─── utils/platform.js ───────────────────────────────────────────────────────

test("platform helpers answer per platform and are SSR-safe", async () => {
  const cases = [
    [null, { platform: null, native: false, android: false, ios: false }],
    ["web", { platform: "web", native: false, android: false, ios: false }],
    ["android", { platform: "android", native: true, android: true, ios: false }],
    ["ios", { platform: "ios", native: true, android: false, ios: true }],
  ];

  for (const [host, expected] of cases) {
    const p = await loadWrapper("../utils/platform.js", host);
    assert.equal(p.getNativePlatform(), expected.platform, String(host));
    assert.equal(p.isNativeApp(), expected.native, String(host));
    assert.equal(p.isAndroidNative(), expected.android, String(host));
    assert.equal(p.isIOSNative(), expected.ios, String(host));
  }
});

test("platform helpers never throw on a hostile Capacitor object", async () => {
  setHost("web");
  globalThis.window.Capacitor = {
    isNativePlatform() { throw new Error("bridge exploded"); },
  };
  const p = await import(`../utils/platform.js?instance=${instance++}`);
  assert.equal(p.getNativePlatform(), "web");
  assert.equal(p.isAndroidNative(), false);
  assert.equal(p.isIOSNative(), false);
});

// ─── ChecklistNotification: Android only ─────────────────────────────────────

for (const platform of ["ios", "web", null]) {
  const label = platform === null ? "ssr" : platform;

  test(`ChecklistNotification is inert on ${label}`, async () => {
    const m = await loadWrapper(CHECKLIST, platform);

    // Every call resolves to the unsupported shape instead of rejecting with
    // "ChecklistNotification plugin is not implemented on ios".
    assert.deepEqual(
      await m.requestChecklistNotificationPermission(),
      { supported: false, granted: false },
      "permission must not be reported as granted where there is no plugin"
    );
    assert.deepEqual(await m.configureChecklistNotification({}), { supported: false });
    assert.deepEqual(await m.syncChecklistItems([], "Forex"), { supported: false });
    assert.deepEqual(await m.cancelChecklistNotification("Forex"), { supported: false });
    assert.deepEqual(await m.getChecklistNotificationState("Forex"), {
      supported: false,
      enabled: false,
      items: [],
    });

    // The checklist page registers this listener on mount with no platform check,
    // so it must hand back a removable no-op rather than throwing into the effect.
    const listener = m.addChecklistToggleListener(() => {});
    assert.equal(typeof listener.remove, "function");
    assert.doesNotThrow(() => listener.remove());
  });
}

// ─── EdgeBilling: Android only ───────────────────────────────────────────────

for (const platform of ["ios", "web", null]) {
  const label = platform === null ? "ssr" : platform;

  test(`Google Play billing is unavailable on ${label}`, async () => {
    const m = await loadWrapper(BILLING, platform);

    assert.equal(m.isAndroidApp(), false, "Play-specific UI must stay hidden");
    assert.deepEqual(await m.isBillingAvailable(), {
      available: false,
      reason: "not_android",
    });
    assert.deepEqual(await m.getBillingProducts("prod"), { offers: [] });
    assert.deepEqual(await m.getDevicePurchases(), { purchases: [] });

    // A purchase attempt off Android is a programming error, so it rejects — but
    // with a sentence a user could read, never a bridge message.
    await assert.rejects(
      () => m.startPurchase({ productId: "prod" }),
      (error) => {
        assert.match(error.message, /only available in the Android app/);
        assert.doesNotMatch(error.message, /not implemented|bridge/i);
        return true;
      }
    );

    const subscription = m.onPurchaseUpdated(() => {});
    assert.equal(typeof subscription.remove, "function");
  });
}

// ─── Android keeps its access ────────────────────────────────────────────────

// What the gate controls is whether registerPlugin() is reached at all; that it
// IS reached on Android is enforced statically by
// scripts/check-android-only-plugins.js, which checks registerPlugin() sits
// inside getPlugin() behind the Android gate. Asserting the native proxy here
// would mean reimplementing Capacitor's own native routing in the harness —
// testing Capacitor rather than this code. What is worth pinning at runtime is
// that Android is not swept up by the new gate.

test("android keeps Play billing and its UI enabled", async () => {
  const m = await loadWrapper(BILLING, "android");
  assert.equal(m.isAndroidApp(), true, "Play-specific UI must render on Android");
});

test("android keeps the checklist notification enabled", async () => {
  const platform = await loadWrapper("../utils/platform.js", "android");
  assert.equal(platform.isAndroidNative(), true, "the gate every checklist call passes");
  assert.equal(platform.isNativeApp(), true);
  assert.equal(platform.isIOSNative(), false);
});
