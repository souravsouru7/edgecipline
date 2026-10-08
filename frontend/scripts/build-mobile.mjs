// Builds the static export for a specific mobile target, with that target's
// payment flags pinned.
//
// Usage:  node scripts/build-mobile.mjs <android|ios>
//
// Why this exists
// ---------------
// The payment flags are build-time literals: next.config.ts aliases each
// paywall to an inert stub when its flag is off, so the flags decide whether a
// purchase mechanism exists in the artifact at all. Until now the only thing
// keeping Razorpay out of the Android AAB was the operator remembering to type
//
//   NEXT_PUBLIC_PAYMENTS_ENABLED=false NEXT_PUBLIC_PLAY_BILLING_ENABLED=true npm run android:build
//
// and frontend/.env ships PAYMENTS_ENABLED=true for the web deployment. Forget
// the prefix and you get a store artifact containing a third-party checkout:
// Apple 3.1.1 is an automatic rejection, Play's payments policy a suspension
// risk. A forgotten shell prefix is not an acceptable last line of defence.
//
// So the target names the flags, this script sets them, and a conflicting
// explicit value fails the build instead of being silently overwritten — if
// someone deliberately asked for payments on an iOS build, they have a wrong
// mental model and should hear about it rather than get a quietly fixed build.
//
// After the build it greps the export for a purchase mechanism, which is the
// only check of this that can be done without a Mac.

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Mirrors docs/google-play-billing.md and the matrix in config/payments.js.
const TARGETS = {
  android: {
    // Play Billing only. Razorpay must not be in the AAB.
    NEXT_PUBLIC_PAYMENTS_ENABLED: "false",
    NEXT_PUBLIC_PLAY_BILLING_ENABLED: "true",
  },
  ios: {
    // No purchase mechanism at all until StoreKit is implemented.
    NEXT_PUBLIC_PAYMENTS_ENABLED: "false",
    NEXT_PUBLIC_PLAY_BILLING_ENABLED: "false",
  },
};

// Strings that only exist if a purchase mechanism was compiled in. Each is a
// mechanism, not a mention: see ALLOWED_RESIDUE below for what is expected to
// survive and why.
const FORBIDDEN_IN_EXPORT = {
  // Razorpay is forbidden in BOTH mobile targets — the web build is the only
  // one that may carry it.
  shared: [
    { needle: "checkout.razorpay.com", what: "the Razorpay Checkout SDK URL" },
    { needle: "Razorpay", what: "a Razorpay SDK reference (window.Razorpay / new Razorpay)" },
    { needle: "mockRazorpay", what: "the sandbox checkout mock" },
    { needle: "Sandbox demo", what: "the sandbox checkout mock" },
  ],
  android: [],
  ios: [
    // Play Billing must be absent from iOS too; it is a purchase sheet for a
    // store the device cannot transact with.
    { needle: "Google Play billing isn't available", what: "the Play Billing paywall" },
    { needle: "obfuscatedAccountId", what: "a Play Billing purchase call" },
  ],
};

// Known, harmless leftovers. Kept explicit so a reviewer can see exactly what
// is expected to remain, rather than trusting a silent pass.
const ALLOWED_RESIDUE = [
  'the string "EdgeBilling" in the plugin wrapper — a bridge name, guarded by',
  "  isAndroidNative(); the plugin itself is not in the iOS binary",
  'the string "NEXT_PUBLIC_RAZORPAY_KEY_ID" in environment validation messages,',
  "  and razorpayKeyId:\"\" — validator text and an empty value, no key, no URL",
  "PLAY_MANAGE_URL, imported alongside the renewal-date helpers; its button is",
  "  gated on isAndroidNative() so it renders nowhere else",
];

function fail(message) {
  console.error(`[build-mobile] ${message}`);
  process.exit(1);
}

/**
 * The value `next build` would see: an explicit environment variable wins over
 * .env, which is how Next resolves it too. Parsed rather than imported so this
 * check sees the same thing the bundler will.
 */
function envFileValues() {
  const envPath = path.join(frontendRoot, ".env");
  if (!existsSync(envPath)) return {};
  const values = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    values[trimmed.slice(0, eq).trim()] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return values;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const SCANNABLE = new Set([".js", ".mjs", ".html", ".txt", ".json", ".css", ".map"]);

function scanExport(target) {
  const outDir = path.join(frontendRoot, "out");
  if (!existsSync(outDir)) fail(`${outDir} does not exist — the build did not produce an export.`);

  const rules = [...FORBIDDEN_IN_EXPORT.shared, ...FORBIDDEN_IN_EXPORT[target]];
  const hits = [];

  for (const file of walk(outDir)) {
    if (!SCANNABLE.has(path.extname(file))) continue;
    if (statSync(file).size > 32 * 1024 * 1024) continue;
    const text = readFileSync(file, "utf8");
    for (const rule of rules) {
      if (text.includes(rule.needle)) {
        hits.push(`${path.relative(outDir, file)} contains ${rule.what} ("${rule.needle}")`);
      }
    }
  }

  if (hits.length) {
    console.error(`[build-mobile] ${target} export contains a purchase mechanism it must not ship:`);
    hits.forEach((hit) => console.error(`  - ${hit}`));
    fail("refusing to hand this export to Capacitor.");
  }

  // Phrased per target: an Android export SHOULD contain Play Billing. What is
  // being asserted is the absence of the processors this target must not carry.
  const allowed = target === "android" ? "Google Play Billing only" : "no purchase processor";
  console.log(`[build-mobile] ${target} export checked: ${allowed}, as required.`);
  console.log("[build-mobile] expected remaining references (not mechanisms):");
  ALLOWED_RESIDUE.forEach((note) => console.log(`  - ${note}`));
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: frontendRoot,
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) fail(`\`${command} ${args.join(" ")}\` failed with ${result.status}.`);
}

function main() {
  const target = process.argv[2];
  if (!TARGETS[target]) {
    fail(`unknown target "${target ?? ""}". Use one of: ${Object.keys(TARGETS).join(", ")}.`);
  }

  const required = TARGETS[target];
  const fromEnvFile = envFileValues();
  const env = { ...process.env };

  for (const [name, value] of Object.entries(required)) {
    // An explicit shell value that contradicts the target is a mistake worth
    // surfacing. .env is not: it belongs to the web deployment, and pinning
    // over it is this script's whole job.
    const explicit = process.env[name];
    if (explicit !== undefined && explicit.trim() !== value) {
      fail(
        `${target} build blocked: ${name} is set to "${explicit}" but a ${target} build ` +
        `requires "${value}". ` +
        (value === "false"
          ? "Shipping that purchase surface in this artifact violates store policy."
          : "This target needs that purchase surface compiled in.")
      );
    }
    if (fromEnvFile[name] !== undefined && fromEnvFile[name].trim() !== value) {
      console.log(
        `[build-mobile] pinning ${name}=${value} for ${target} ` +
        `(.env says "${fromEnvFile[name]}", which is the web value)`
      );
    }
    env[name] = value;
  }

  console.log(
    `[build-mobile] target=${target} ` +
    Object.entries(required).map(([k, v]) => `${k}=${v}`).join(" ")
  );

  run("npx", ["next", "build"], env);
  run("node", ["scripts/prune-mobile-bundle.mjs"], env);
  scanExport(target);

  console.log(`[build-mobile] ${target} export ready in out/`);
}

main();
