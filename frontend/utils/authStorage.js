/**
 * Platform-aware persistence for the access token.
 *
 * This module answers exactly one question — "where does this platform put the
 * access token?" — and nothing else. It holds no token state, enforces no
 * policy, and never decides whether the user is signed in. `utils/auth.js` owns
 * all of that; it just asks here for a place to write.
 *
 *   Web      → nothing. The access token lives in module memory only and the
 *              httpOnly refresh cookie restores the session on reload. This is
 *              the pre-existing web behaviour and is deliberately unchanged.
 *   Android  → EdgeAuthStorage, the first-party native plugin. AES-GCM through
 *              Android Keystore. Live in production; do not substitute.
 *   iOS      → EdgeAuthStorage, the first-party native plugin. iOS Keychain,
 *              kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly.
 *
 * Both native platforms expose the SAME plugin name and the same
 * get/set/remove shape, so the shared auth code has one code path. The platform
 * branch exists so that a platform whose native plugin is missing degrades on
 * its own terms instead of borrowing another platform's storage.
 *
 * No software fallback, on purpose
 * --------------------------------
 * If a native plugin is missing, this returns null and the session becomes
 * memory-only: sign-in still works, it just will not outlive a process kill,
 * and the next cold start restores it from the httpOnly refresh cookie.
 *
 * The tempting fallback is @capacitor/preferences, which is already a
 * dependency. It is deliberately NOT used here:
 *
 *   - It is not in the iOS Podfile, so on iOS its JS would resolve to the *web*
 *     implementation and write the access token into WKWebView localStorage.
 *     A bearer token in web storage is the thing this module exists to avoid.
 *   - Even with the native pod installed, Preferences is NSUserDefaults — a
 *     plist in the app sandbox. That is persistence, not secure storage: not
 *     Keychain-encrypted and included in unencrypted device backups.
 *
 * So the Keychain plugin is the only iOS answer, and
 * `scripts/check-mobile-auth-storage.js` fails the build if it or its Xcode
 * registration goes missing — the alternative to secure storage is no storage,
 * never weaker storage.
 *
 * Nothing in here touches localStorage: the access token is never written to
 * web storage on any platform.
 */

import { getNativePlatform } from "./platform.js";

export const AUTH_STORAGE_KIND = {
  /** No persistence — memory only (web, SSR, or a build missing its plugin). */
  NONE: "none",
  /** Android Keystore via the native EdgeAuthStorage plugin. */
  ANDROID_KEYSTORE: "android_keystore",
  /** iOS Keychain via the native EdgeAuthStorage plugin. */
  IOS_KEYCHAIN: "ios_keychain",
};

const NATIVE_PLUGIN_NAME = "EdgeAuthStorage";

/** The native EdgeAuthStorage plugin, or null when it is not on this build. */
function getNativePlugin() {
  if (typeof window === "undefined") return null;
  try {
    const plugin = window.Capacitor?.Plugins?.[NATIVE_PLUGIN_NAME];
    // A half-registered plugin is as useless as a missing one, and `set`
    // without `get` would persist a token nothing can ever read back.
    if (plugin?.set && plugin?.get && plugin?.remove) return plugin;
    return null;
  } catch {
    return null;
  }
}

function nativeAdapter(plugin, kind) {
  return {
    kind,
    get: (options) => plugin.get(options),
    set: (options) => plugin.set(options),
    remove: (options) => plugin.remove(options),
  };
}

/**
 * The storage adapter for the current platform, or null when this platform
 * persists nothing (web, SSR, or a native build whose plugin is absent).
 *
 * Adapters mirror the native plugin's own signature — `get({ key })` resolving
 * to `{ value }`, `set({ key, value })`, `remove({ key })` — so the caller has
 * a single shape to drive. They may reject; the caller is responsible for
 * treating a rejection as "not persisted" rather than as an auth failure.
 *
 * Resolved fresh on every call rather than cached, so a plugin that registers
 * late (native bridge still settling on a cold start) is picked up instead of
 * being remembered as missing for the life of the page.
 */
export function getAuthStorage() {
  const platform = getNativePlatform();

  // Both native platforms use the same first-party plugin; the branch is here so
  // each one's absence is a fact about that platform, not a shared assumption.
  if (platform === "android") {
    const plugin = getNativePlugin();
    return plugin ? nativeAdapter(plugin, AUTH_STORAGE_KIND.ANDROID_KEYSTORE) : null;
  }

  if (platform === "ios") {
    const plugin = getNativePlugin();
    return plugin ? nativeAdapter(plugin, AUTH_STORAGE_KIND.IOS_KEYCHAIN) : null;
  }

  // Web and SSR: memory only.
  return null;
}
