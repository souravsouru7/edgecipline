// node --test scripts/test-auth-storage.mjs
//
// The contract that keeps a sign-in from dying on a storage error:
//
//   - the access token is in memory synchronously, before persistence runs
//   - setAuthToken / clearAuthToken NEVER reject, whatever storage does
//   - a rejected persistence attempt cannot poison later auth operations
//   - Android keeps using EdgeAuthStorage; iOS uses it too; web persists nothing
//   - "nothing stored" hydrates as a plain logged-out state, not an error
//
// Each platform gets a fresh module instance (cache-busted import) because
// utils/auth.js holds the token in module scope on purpose.
import { test } from "node:test";
import assert from "node:assert/strict";

// ─── Minimal browser + Capacitor host ────────────────────────────────────────

const store = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.document = { visibilityState: "visible" };
globalThis.atob = (b64) => Buffer.from(b64, "base64").toString("binary");

/** A JWT that is valid well past the module's 90s refresh buffer. */
function makeToken(expiresInMs = 60 * 60 * 1000) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub: "u1", exp: Math.floor((Date.now() + expiresInMs) / 1000) })
  ).toString("base64url");
  return header + "." + payload + ".sig";
}

/** An EdgeAuthStorage that works, recording what it was asked to do. */
function workingPlugin() {
  const values = new Map();
  const calls = [];
  return {
    calls,
    values,
    async set({ key, value }) { calls.push(["set", key]); values.set(key, value); },
    async get({ key }) { calls.push(["get", key]); return { value: values.get(key) ?? null }; },
    async remove({ key }) { calls.push(["remove", key]); values.delete(key); },
  };
}

/** The mutating calls a plugin received, ignoring reads. */
function writes(plugin) {
  return plugin.calls.filter(([op]) => op !== "get");
}

/** An EdgeAuthStorage whose every operation fails, as a locked Keychain would. */
function failingPlugin() {
  const calls = [];
  const fail = async () => { throw new Error("storage unavailable"); };
  return { calls, set: fail, get: fail, remove: fail };
}

/**
 * Installs a fake platform and returns a fresh copy of utils/auth.js bound to it.
 * `plugin` is the EdgeAuthStorage stand-in; pass null to model a platform where
 * the plugin was never registered — which is exactly the iOS bug being fixed.
 *
 * `seedLegacyToken` is written to localStorage before the module is imported,
 * because auth.js starts hydrating at parse time.
 */
let instance = 0;
async function loadAuth({ platform, plugin, seedLegacyToken = null }) {
  store.clear();
  if (seedLegacyToken) store.set("token", seedLegacyToken);
  globalThis.window.Capacitor = {
    isNativePlatform: () => platform !== "web",
    getPlatform: () => platform,
    Plugins: plugin ? { EdgeAuthStorage: plugin } : {},
  };
  // Silence the module's own console reporting for the failure paths.
  const realConsole = globalThis.console;
  globalThis.console = { log() {}, info() {}, warn() {}, error() {} };
  try {
    return await import("../utils/auth.js?instance=" + instance++);
  } finally {
    globalThis.console = realConsole;
  }
}

// ─── Critical fix #1 / #4: storage failure is not a login failure ────────────

test("ios login succeeds when the native plugin is missing", async () => {
  // The exact pre-fix scenario: iOS, no EdgeAuthStorage registered at all.
  // setAuthToken() used to reject here, which stopped the login handler before
  // it ever reached router.push().
  const auth = await loadAuth({ platform: "ios", plugin: null });
  const token = makeToken();

  await assert.doesNotReject(() => auth.setAuthToken(token));
  assert.equal(await auth.setAuthToken(token), false, "nothing was persisted");
  assert.equal(auth.getValidToken(), token, "memory token must still be set");
  assert.equal(auth.hasValidAuthToken(), true, "the app must consider the user signed in");
  assert.deepEqual([...store.keys()], [], "and no token was written to web storage");
});

test("android does not fall back to weaker storage when the plugin is missing", async () => {
  // Android ships EdgeAuthStorage; its absence means a broken build, and must
  // not be papered over by silently downgrading a live platform. The session
  // still works — it just will not outlive a process kill.
  const auth = await loadAuth({ platform: "android", plugin: null });
  const token = makeToken();

  assert.equal(await auth.setAuthToken(token), false, "nothing was persisted");
  assert.equal(auth.getValidToken(), token, "and the user is still signed in");
  assert.deepEqual([...store.keys()], [], "no web-storage fallback was used");
});

test("setAuthToken puts the token in memory before persistence resolves", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const auth = await loadAuth({
    platform: "ios",
    plugin: { set: () => gate, get: async () => ({ value: null }), remove: async () => {} },
  });
  const token = makeToken();

  const pending = auth.setAuthToken(token);

  // Persistence has not settled, yet the token is already usable — this is what
  // lets the login handler navigate and the API client attach a header.
  assert.equal(auth.getValidToken(), token);
  release();
  assert.equal(await pending, true);
});

test("a rejecting storage layer never rejects setAuthToken or clearAuthToken", async () => {
  const auth = await loadAuth({ platform: "ios", plugin: failingPlugin() });
  const token = makeToken();

  assert.equal(await auth.setAuthToken(token), false);
  assert.equal(auth.getValidToken(), token);
  assert.equal(await auth.clearAuthToken(), false);
  assert.equal(auth.getValidToken(), null, "logout still ends the session");
});

test("a failed persistence attempt does not poison later auth operations", async () => {
  const auth = await loadAuth({ platform: "ios", plugin: failingPlugin() });

  // The first write fails and its result is retained as _persistPromise. If that
  // promise stayed rejected, every later await in the auth lifecycle would
  // throw — which is how one Keychain hiccup used to break all of login.
  await auth.setAuthToken(makeToken());
  await assert.doesNotReject(() => auth.flushAuthTokenStorage());
  await assert.doesNotReject(() => auth.setAuthToken(makeToken()));
  await assert.doesNotReject(() => auth.clearAuthToken());
  await assert.doesNotReject(() => auth.hydrateAuthToken());
});

// ─── Critical fix #2 / #3: the right storage per platform ────────────────────

test("android persists through EdgeAuthStorage", async () => {
  const plugin = workingPlugin();
  const auth = await loadAuth({ platform: "android", plugin });
  const token = makeToken();

  assert.equal(await auth.setAuthToken(token), true);
  // auth.js starts hydrating at parse time, so a `get` precedes the write.
  assert.deepEqual(writes(plugin), [["set", "accessToken"]]);
  assert.equal(plugin.values.get("accessToken"), token);
});

test("ios persists through EdgeAuthStorage with the same key and contract", async () => {
  const plugin = workingPlugin();
  const auth = await loadAuth({ platform: "ios", plugin });
  const token = makeToken();

  assert.equal(await auth.setAuthToken(token), true);
  assert.deepEqual(writes(plugin), [["set", "accessToken"]]);
  assert.equal(plugin.values.get("accessToken"), token);
});

test("web persists nothing and never calls a native plugin", async () => {
  const plugin = workingPlugin();
  const auth = await loadAuth({ platform: "web", plugin });
  const token = makeToken();

  assert.equal(await auth.setAuthToken(token), false, "web keeps the token in memory only");
  assert.equal(auth.getValidToken(), token, "which is still a signed-in state");
  assert.equal(await auth.clearAuthToken(), true, "and logout has nothing left to remove");

  assert.deepEqual(plugin.calls, [], "web must not touch native storage");
  assert.equal(store.has("token"), false, "and must not write the token to localStorage");
});

// ─── Critical fix #8: hydration ──────────────────────────────────────────────

test("ios restores a persisted token on cold start", async () => {
  const plugin = workingPlugin();
  const stored = makeToken();
  plugin.values.set("accessToken", stored);
  const auth = await loadAuth({ platform: "ios", plugin });

  assert.equal(await auth.hydrateAuthToken(), stored);
  assert.ok(plugin.calls.some(([op, key]) => op === "get" && key === "accessToken"));
});

test("no stored token hydrates as a logged-out state, not an error", async () => {
  const auth = await loadAuth({ platform: "ios", plugin: workingPlugin() });
  assert.equal(await auth.hydrateAuthToken(), null);
});

test("unreadable storage hydrates as logged-out rather than throwing", async () => {
  const auth = await loadAuth({ platform: "ios", plugin: failingPlugin() });
  assert.equal(await auth.hydrateAuthToken(), null);
});

// ─── Critical fix #10: logout ───────────────────────────────────────────────

test("logout removes the persisted token on both native platforms", async () => {
  for (const platform of ["android", "ios"]) {
    const plugin = workingPlugin();
    const auth = await loadAuth({ platform, plugin });

    await auth.setAuthToken(makeToken());
    assert.equal(await auth.clearAuthToken(), true, platform);

    assert.equal(plugin.values.has("accessToken"), false, platform);
    assert.equal(auth.getValidToken(), null, platform);
  }
});

// ─── Legacy migration must not lose a valid token ────────────────────────────

test("a legacy localStorage token survives migration even if the write fails", async () => {
  const token = makeToken();
  const auth = await loadAuth({
    platform: "ios",
    plugin: failingPlugin(),
    seedLegacyToken: token,
  });

  assert.equal(await auth.hydrateAuthToken(), token, "memory keeps it");
  assert.equal(store.has("token"), false, "and localStorage is cleared either way");
});
