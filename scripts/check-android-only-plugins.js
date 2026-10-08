#!/usr/bin/env node

// Android-only Capacitor plugins must never be reachable on iOS.
//
// Capacitor.isNativePlatform() is true on Android AND iOS, so using it to gate a
// plugin that only Android implements means iOS calls the bridge and gets
// "<Plugin> plugin is not implemented on ios". That surfaces as a broken feature
// and, if it reaches the UI, as an App Review rejection for completeness.
//
// This check reads the native source tree to decide which plugins are
// Android-only — so a plugin that gains a Swift implementation stops being
// flagged automatically — then verifies each one's JS wrapper gates on Android.

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const LF = String.fromCharCode(10);
const ANDROID_NATIVE_DIR = "frontend/android/app/src/main/java/com/edgecipline";
const IOS_NATIVE_DIR = "frontend/ios/App/App";

const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

// Comments here explain *why* isNativePlatform() is the wrong check, so they name
// it. Only executable code counts.
function stripComments(source) {
  let out = "";
  let rest = source;
  for (;;) {
    const open = rest.indexOf("/*");
    if (open === -1) break;
    const close = rest.indexOf("*/", open + 2);
    if (close === -1) break;
    out += rest.slice(0, open);
    rest = rest.slice(close + 2);
  }
  out += rest;

  return out
    .split(LF)
    .map((line) => {
      const comment = line.indexOf("//");
      return comment === -1 ? line : line.slice(0, comment);
    })
    .join(LF);
}

/** Source from `opener` to the first line that closes it at column 0. */
function blockAfter(source, opener) {
  const start = source.indexOf(opener);
  if (start === -1) return null;
  const closer = LF + "}";
  const end = source.indexOf(closer, start + opener.length);
  if (end === -1) return null;
  return source.slice(start, end + closer.length);
}

function listPluginClasses(dir, extension) {
  const suffix = `Plugin${extension}`;
  return fs
    .readdirSync(path.join(root, dir))
    .filter((name) => name.endsWith(suffix))
    .map((name) => name.slice(0, -suffix.length));
}

// "EdgeAuthStorage" from EdgeAuthStoragePlugin.java / .swift.
const androidPlugins = listPluginClasses(ANDROID_NATIVE_DIR, ".java");
const iosPlugins = listPluginClasses(IOS_NATIVE_DIR, ".swift");
const androidOnly = androidPlugins.filter((name) => !iosPlugins.includes(name));

// Each Android-only plugin's JS wrapper. A plugin with no entry here is a plugin
// nobody vetted — that is a failure, not something to skip.
const WRAPPERS = {
  ChecklistNotification: "frontend/plugins/ChecklistNotificationPlugin.js",
  EdgeBilling: "frontend/plugins/EdgeBillingPlugin.js",
};

const ANDROID_GATES = ["isAndroidNative", "isAndroidApp"];

for (const plugin of androidOnly) {
  const wrapperPath = WRAPPERS[plugin];
  if (!wrapperPath) {
    failures.push(
      `${plugin} is implemented on Android only but has no vetted JS wrapper in ` +
      "this check — add it to WRAPPERS and confirm its platform gate"
    );
    continue;
  }

  // The gate that decides whether to hand out the real bridge proxy.
  const gate = blockAfter(stripComments(read(wrapperPath)), "function getPlugin()");
  if (!gate) {
    failures.push(`${wrapperPath}: no getPlugin() to check`);
    continue;
  }
  if (!ANDROID_GATES.some((name) => gate.includes(`${name}()`))) {
    failures.push(
      `${wrapperPath}: getPlugin() must gate on ${ANDROID_GATES.join("() or ")}() — ` +
      `${plugin} has no iOS implementation, and isNativePlatform() is true on iOS too`
    );
  }
  if (gate.includes("isNativePlatform")) {
    failures.push(
      `${wrapperPath}: getPlugin() still references isNativePlatform(), which does ` +
      "not distinguish iOS from Android"
    );
  }
  // registerPlugin must only ever run behind that gate.
  if (!gate.includes("registerPlugin(")) {
    failures.push(
      `${wrapperPath}: registerPlugin() must live inside getPlugin() so it cannot ` +
      "run before the Android gate"
    );
  }
}

// Callers of an Android-only plugin must not gate on isNativePlatform() either.
// The wrapper would absorb it, but a broad check here still puts iOS on the
// Android code path — extra round trips, and UI that promises a missing feature.
const CALLERS = [
  "frontend/services/checklistNotificationSync.js",
  "frontend/app/checklist/notification-settings/page.js",
  "frontend/app/checklist/page.js",
  "frontend/components/PlayBillingPaywall.js",
  "frontend/features/premium/hooks/usePlayBillingReconcile.js",
];

for (const caller of CALLERS) {
  if (stripComments(read(caller)).includes("isNativePlatform")) {
    failures.push(
      `${caller}: gates an Android-only plugin on isNativePlatform(), which is also ` +
      "true on iOS — use isAndroidNative()"
    );
  }
}

// The shared helper must stay SSR-safe: no browser global without a guard.
if (!read("frontend/utils/platform.js").includes('typeof window === "undefined"')) {
  failures.push(
    "frontend/utils/platform.js: platform detection must guard `window` so it is " +
    "safe during server rendering"
  );
}

if (failures.length) {
  console.error("Android-only plugin isolation check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(
  `Android-only plugin isolation check passed (Android-only: ` +
  `${androidOnly.join(", ") || "none"}; implemented on iOS: ` +
  `${iosPlugins.join(", ") || "none"}).`
);
