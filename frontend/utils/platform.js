/**
 * Which platform is this code running on?
 *
 * `Capacitor.isNativePlatform()` is true on BOTH Android and iOS, so it is the
 * wrong question to ask about a plugin that only one of them implements. Calling
 * an Android-only plugin on iOS rejects with "… plugin is not implemented on
 * ios", which surfaces to the user as a broken feature and to App Review as an
 * incomplete app.
 *
 * So: use `isNativeApp()` only for behaviour both native platforms share
 * (haptics, status bar, network, push). Use `isAndroidNative()` for anything
 * backed by a plugin under `android/app/src/main/java/com/edgecipline/` that has
 * no Swift counterpart.
 *
 * Current Android-only plugins: ChecklistNotification, EdgeBilling.
 * (EdgeAuthStorage is implemented on both — see utils/authStorage.js.)
 *
 * Every helper here is SSR-safe, returns a plain value, and never throws, so it
 * can be called during render, in a `useEffect`, or at module scope.
 */

/**
 * The Capacitor platform string, or null during SSR.
 *
 * @returns {"android"|"ios"|"web"|null} null means "no browser yet" (server
 * render), which is deliberately distinct from "web" so a caller can tell a
 * prerender apart from an actual browser if it needs to.
 */
export function getNativePlatform() {
  if (typeof window === "undefined") return null;
  try {
    const capacitor = window.Capacitor;
    // No Capacitor at all, or a Capacitor web build: this is a browser.
    if (!capacitor?.isNativePlatform?.()) return "web";
    return capacitor.getPlatform?.() || "web";
  } catch {
    // A getter that throws is not a native platform worth trusting.
    return "web";
  }
}

/**
 * True inside either native shell. Correct for plugins that both platforms
 * implement; wrong for anything Android-only.
 */
export function isNativeApp() {
  const platform = getNativePlatform();
  return platform === "android" || platform === "ios";
}

/** True only inside the native Android app. The gate for Android-only plugins. */
export function isAndroidNative() {
  return getNativePlatform() === "android";
}

/** True only inside the native iOS app. */
export function isIOSNative() {
  return getNativePlatform() === "ios";
}
