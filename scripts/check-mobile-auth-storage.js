#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = process.cwd();

const files = [
  "frontend/utils/auth.js",
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
if (!authSource.includes("EdgeAuthStorage")) {
  failures.push("frontend/utils/auth.js: native auth storage adapter is not wired to EdgeAuthStorage");
}
if (/localStorage\.setItem\(\s*LEGACY_TOKEN_KEY/.test(authSource)) {
  failures.push("frontend/utils/auth.js: legacy token key must never be written back to localStorage");
}

const mainActivity = fs.readFileSync(
  path.join(root, "frontend/android/app/src/main/java/com/edgecpline/MainActivity.java"),
  "utf8"
);
if (!mainActivity.includes("registerPlugin(EdgeAuthStoragePlugin.class)")) {
  failures.push("MainActivity.java: EdgeAuthStoragePlugin is not registered");
}

const nativePlugin = fs.readFileSync(
  path.join(root, "frontend/android/app/src/main/java/com/edgecpline/EdgeAuthStoragePlugin.java"),
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

if (failures.length) {
  console.error("Mobile auth storage check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Mobile auth storage check passed.");
