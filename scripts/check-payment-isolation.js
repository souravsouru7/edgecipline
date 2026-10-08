#!/usr/bin/env node

// Purchase surfaces must stay on their own platform.
//
//   web      Razorpay              (NEXT_PUBLIC_PAYMENTS_ENABLED)
//   Android  Google Play Billing   (NEXT_PUBLIC_PLAY_BILLING_ENABLED)
//   iOS      nothing               (both flags false; no StoreKit yet)
//
// Getting this wrong is not a UI bug. A third-party checkout inside the iOS app
// is an automatic rejection under App Store Guideline 3.1.1, and a non-Play
// checkout for digital goods inside the Android app is a Play payments
// violation. The flags decide whether the code is in the artifact at all, so the
// checks below cover both the routing and the build wiring that sets them.

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const LF = String.fromCharCode(10);
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

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

function walk(dir, onFile) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(relative, onFile);
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
      onFile(relative);
    }
  }
}

// ── 1. Only PaywallGate may reach a processor-specific paywall ──────────────
// TradeLimitDialog imported SmartPaywall directly. That was right when Razorpay
// was the only processor, but once Play Billing shipped, canShowPurchaseUI()
// became true on Android too — where SmartPaywall is aliased to its inert stub,
// so Android users who hit the free limit got an empty dialog. Going through
// PaywallGate is what keeps processor choice in one place.
const PROCESSOR_MODULES = ["@/components/SmartPaywall", "@/components/PlayBillingPaywall"];
const MAY_IMPORT_PROCESSOR = new Set([
  "frontend/components/PaywallGate.js",
  "frontend/components/SmartPaywall.js",
  "frontend/components/SmartPaywall.disabled.js",
  "frontend/components/PlayBillingPaywall.js",
  "frontend/components/PlayBillingPaywall.disabled.js",
]);

for (const dir of ["frontend/app", "frontend/components", "frontend/features"]) {
  walk(dir, (file) => {
    if (MAY_IMPORT_PROCESSOR.has(file)) return;
    const code = stripComments(read(file));
    for (const moduleName of PROCESSOR_MODULES) {
      if (code.includes(`"${moduleName}"`) || code.includes(`'${moduleName}'`)) {
        failures.push(
          `${file}: imports ${moduleName} directly — route through ` +
          "@/components/PaywallGate so the processor is chosen per platform"
        );
      }
    }
  });
}

// ── 2. PaywallGate must route explicitly, with no fallthrough ──────────────
// The rule lives in paywallRouting.mjs (allowlist, unit-tested); PaywallGate
// only maps its answer onto a component. Both halves are checked so neither can
// quietly grow a default.
const routing = stripComments(read("frontend/features/premium/utils/paywallRouting.mjs"));
for (const required of ['=== "android"', '=== "web"']) {
  if (!routing.includes(required)) {
    failures.push(
      `frontend/features/premium/utils/paywallRouting.mjs: no explicit ${required} ` +
      "branch — provider routing must be an allowlist, never \"Android else Razorpay\""
    );
  }
}
const routingReturns = routing
  .split(LF)
  .map((l) => l.trim())
  .filter((l) => l.startsWith("return "));
if (routingReturns[routingReturns.length - 1] !== "return null;") {
  failures.push(
    "frontend/features/premium/utils/paywallRouting.mjs: choosePaywallProvider() must " +
    "end in `return null;` so an unrecognised platform inherits no processor"
  );
}

const gate = stripComments(read("frontend/components/PaywallGate.js"));
if (!gate.includes("choosePaywallProvider(")) {
  failures.push(
    "frontend/components/PaywallGate.js: must route via choosePaywallProvider() rather " +
    "than deciding the processor inline"
  );
}
if (gate.includes("detectNativeAndroid")) {
  failures.push(
    "frontend/components/PaywallGate.js: still uses the Android-or-else check, " +
    "which sent iOS to the Razorpay branch"
  );
}
// The last thing it does must be to render nothing.
const gateReturns = gate.split(LF).map((l) => l.trim()).filter((l) => l.startsWith("return "));
if (gateReturns[gateReturns.length - 1] !== "return null;") {
  failures.push(
    "frontend/components/PaywallGate.js: the final return must be `return null;` so " +
    "iOS and any unrecognised platform get no purchase surface"
  );
}

// ── 3. Both paywalls must be aliased out when their flag is off ────────────
const nextConfig = read("frontend/next.config.ts");
for (const [flag, stub] of [
  ["paymentsEnabled", "./components/SmartPaywall.disabled.js"],
  ["playBillingEnabled", "./components/PlayBillingPaywall.disabled.js"],
]) {
  if (!nextConfig.includes(stub)) {
    failures.push(
      `frontend/next.config.ts: no resolveAlias to ${stub} — without it the ` +
      "bundler still emits that paywall chunk into every build, flag or not"
    );
  }
  if (!nextConfig.includes(flag)) {
    failures.push(`frontend/next.config.ts: ${flag} is not read, so its alias cannot be conditional`);
  }
}

// ── 4. Mobile builds must pin their flags ──────────────────────────────────
// A shell prefix the operator has to remember is not a last line of defence,
// and frontend/.env carries the web value NEXT_PUBLIC_PAYMENTS_ENABLED=true.
const scripts = JSON.parse(read("frontend/package.json")).scripts || {};
for (const [name, target] of [
  ["android", "android"],
  ["android:sync", "android"],
  ["android:build", "android"],
  ["ios", "ios"],
  ["ios:sync", "ios"],
]) {
  const script = scripts[name];
  if (!script) {
    failures.push(`frontend/package.json: script "${name}" is missing`);
    continue;
  }
  if (!script.includes(`build:mobile:${target}`)) {
    failures.push(
      `frontend/package.json: "${name}" must build via build:mobile:${target}, which pins ` +
      "that target's payment flags, not a bare build:mobile"
    );
  }
}
for (const target of ["android", "ios"]) {
  const script = scripts[`build:mobile:${target}`];
  if (!script || !script.includes(`build-mobile.mjs ${target}`)) {
    failures.push(
      `frontend/package.json: "build:mobile:${target}" must run scripts/build-mobile.mjs ${target}`
    );
  }
}

// ── 5. The Play Store management link needs a platform vote ───────────────
// PLAY_MANAGE_URL opens play.google.com. A Play subscriber opens the same
// account on iOS, so provider alone must not decide whether to offer it.
const subscriptionCard = stripComments(read("frontend/features/premium/utils/subscriptionCard.mjs"));
if (!subscriptionCard.includes("platformAllowsPlayActions")) {
  failures.push(
    "frontend/features/premium/utils/subscriptionCard.mjs: showsPlayActions must take a " +
    "platform argument — provider === \"google_play\" alone would offer an external " +
    "purchase-management link on iOS"
  );
}
const settings = stripComments(read("frontend/app/settings/page.js"));
if (!settings.includes("showsPlayActions(subscription, profile?.isPremium, isAndroidNative())")) {
  failures.push(
    "frontend/app/settings/page.js: showsPlayActions must be passed isAndroidNative()"
  );
}

// ── 6. Razorpay stays off every native platform ───────────────────────────
const payments = stripComments(read("frontend/config/payments.js"));
if (!payments.includes("PAYMENTS_ENABLED && !isNativePlatform()")) {
  failures.push(
    "frontend/config/payments.js: canShowRazorpayCheckout() must require BOTH the web " +
    "payment flag AND a non-native platform"
  );
}
if (!payments.includes("PLAY_BILLING_ENABLED && isNativeAndroid()")) {
  failures.push(
    "frontend/config/payments.js: canShowPlayBilling() must require BOTH the Play flag " +
    "AND native Android"
  );
}

if (failures.length) {
  console.error("Payment isolation check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(
  "Payment isolation check passed (web -> Razorpay, Android -> Play Billing, iOS -> none)."
);
