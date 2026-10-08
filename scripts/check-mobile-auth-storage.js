#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = process.cwd();

const files = [
  "frontend/utils/auth.js",
  "frontend/utils/authStorage.js",
  "frontend/services/apiClient.js",
  "frontend/services/analyticsApi.js",
  "frontend/services/reportsApi.js",
  "frontend/services/checklistApi.js",
  "frontend/services/checklistNotificationApi.js",
  "frontend/services/pushNotifications.js",
];

const forbidden = [
  {
    pattern: /localStorage\.setItem\([^)]*(token|accessToken|Authorization)/i,
    reason: "access token written to localStorage",
  },
  {
    pattern: /sessionStorage\.setItem\([^)]*(token|accessToken|Authorization)/i,
    reason: "access token written to sessionStorage",
  },
  {
    pattern: /indexedDB/i,
    reason: "auth token path references IndexedDB",
  },
];

const failures = [];

for (const file of files) {
  const fullPath = path.join(root, file);
  const text = fs.readFileSync(fullPath, "utf8");
  for (const rule of forbidden) {
    if (rule.pattern.test(text)) {
      failures.push(`${file}: ${rule.reason}`);
    }
  }
}

const authSource = fs.readFileSync(path.join(root, "frontend/utils/auth.js"), "utf8");
const authStorageSource = fs.readFileSync(path.join(root, "frontend/utils/authStorage.js"), "utf8");
if (!authStorageSource.includes("EdgeAuthStorage")) {
  failures.push("frontend/utils/authStorage.js: native auth storage adapter is not wired to EdgeAuthStorage");
}
if (/localStorage\.setItem\(\s*LEGACY_TOKEN_KEY/.test(authSource)) {
  failures.push("frontend/utils/auth.js: legacy token key must never be written back to localStorage");
}

// Comments talk *about* throwing ("do NOT throw upstream"); only real code
// counts. Line comments are the only kind these helpers use.
function stripLineComments(source) {
  return source
    .split("\n")
    .map((line) => {
      const comment = line.indexOf("//");
      return comment === -1 ? line : line.slice(0, comment);
    })
    .join("\n");
}

// Returns the source from `opener` up to the first line that closes it at
// `closer` (a dedent marker). Enough to isolate one top-level function or one
// if-block without pulling a JS parser into a guard script.
function blockAfter(source, opener, closer) {
  const start = source.indexOf(opener);
  if (start === -1) return null;
  const end = source.indexOf(closer, start + opener.length);
  if (end === -1) return null;
  return source.slice(start, end + closer.length);
}

// Persistence failure must stay non-fatal. A `throw` inside the secure-storage
// helpers is how iOS login used to dead-end: setAuthToken() rejected, so the
// login handler stopped before router.push() and the user sat on the form.
for (const helperName of ["secureSetToken", "secureGetToken", "secureRemoveToken"]) {
  const helper = blockAfter(authSource, `async function ${helperName}(`, "\n}\n");
  if (!helper) {
    failures.push(
      `frontend/utils/auth.js: ${helperName}() not found - the non-fatal persistence check cannot run`
    );
    continue;
  }
  if (stripLineComments(helper).includes("throw ")) {
    failures.push(
      `frontend/utils/auth.js: ${helperName}() throws - storage failure must be returned as ` +
      "false/null, never thrown into the login flow"
    );
  }
}

// Each native platform must resolve to the first-party EdgeAuthStorage plugin
// and to nothing else. The alternative to secure storage is no storage: a
// fallback onto Preferences or web storage would put a bearer token in a plist
// or in localStorage, and on Android it would also downgrade a live platform.
for (const platform of ["android", "ios"]) {
  const branch = blockAfter(
    authStorageSource,
    `if (platform === "${platform}")`,
    "\n  }\n"
  );
  if (!branch) {
    failures.push(`frontend/utils/authStorage.js: no explicit ${platform} storage branch`);
    continue;
  }
  if (!branch.includes("getNativePlugin()")) {
    failures.push(
      `frontend/utils/authStorage.js: the ${platform} branch must resolve to the native ` +
      "EdgeAuthStorage plugin"
    );
  }
  if (/[Pp]references|localStorage|sessionStorage/.test(branch)) {
    failures.push(
      `frontend/utils/authStorage.js: the ${platform} branch must not fall back to ` +
      "Preferences or web storage"
    );
  }
}

const mainActivity = fs.readFileSync(
  path.join(root, "frontend/android/app/src/main/java/com/edgecipline/MainActivity.java"),
  "utf8"
);
if (!mainActivity.includes("registerPlugin(EdgeAuthStoragePlugin.class)")) {
  failures.push("MainActivity.java: EdgeAuthStoragePlugin is not registered");
}

const nativePlugin = fs.readFileSync(
  path.join(root, "frontend/android/app/src/main/java/com/edgecipline/EdgeAuthStoragePlugin.java"),
  "utf8"
);
for (const required of [
  "AndroidKeyStore",
  "AES/GCM/NoPadding",
  "KeyGenParameterSpec",
]) {
  if (!nativePlugin.includes(required)) {
    failures.push(`EdgeAuthStoragePlugin.java: missing ${required}`);
  }
}

// ── iOS ──────────────────────────────────────────────────────────────────────
// Without these four pieces the iOS build has no Keychain and silently drops to
// the @capacitor/preferences fallback, which is persistence but not secure
// storage. That must never ship unnoticed.
const iosPlugin = fs.readFileSync(
  path.join(root, "frontend/ios/App/App/EdgeAuthStoragePlugin.swift"),
  "utf8"
);
for (const required of [
  "kSecClassGenericPassword",
  "kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly",
  'jsName = "EdgeAuthStorage"',
]) {
  if (!iosPlugin.includes(required)) {
    failures.push(`EdgeAuthStoragePlugin.swift: missing ${required}`);
  }
}

const iosViewController = fs.readFileSync(
  path.join(root, "frontend/ios/App/App/MainViewController.swift"),
  "utf8"
);
if (!iosViewController.includes("registerPluginInstance(EdgeAuthStoragePlugin())")) {
  failures.push("MainViewController.swift: EdgeAuthStoragePlugin is not registered on the bridge");
}

const storyboard = fs.readFileSync(
  path.join(root, "frontend/ios/App/App/Base.lproj/Main.storyboard"),
  "utf8"
);
if (!storyboard.includes('customClass="MainViewController"')) {
  failures.push(
    "Main.storyboard: scene must use MainViewController, or capacitorDidLoad() never " +
    "runs and EdgeAuthStorage is absent on iOS"
  );
}

const pbxproj = fs.readFileSync(
  path.join(root, "frontend/ios/App/App.xcodeproj/project.pbxproj"),
  "utf8"
);
for (const swiftFile of ["EdgeAuthStoragePlugin.swift", "MainViewController.swift"]) {
  if (!pbxproj.includes(`${swiftFile} in Sources`)) {
    failures.push(`project.pbxproj: ${swiftFile} is not in the App target's Sources phase`);
  }
}

if (failures.length) {
  console.error("Mobile auth storage check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Mobile auth storage check passed.");
