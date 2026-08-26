// Removes the internal admin console from the static export before it is
// copied into the Android/iOS app.
//
// Why this exists
// ---------------
// `out/` is built once and serves two very different targets: the public web
// deployment (which NEEDS /admin) and the Capacitor mobile bundle (which must
// not contain it). Shipping the admin console inside the consumer app is:
//
//   * an App Store rejection under Guideline 2.3.1 (hidden or undocumented
//     features) — a reviewer can navigate to /admin/login inside the app;
//   * an unnecessary attack surface. The admin auth check lives in
//     app/admin/layout.js and runs client-side, so the UI for user management,
//     payments and monitoring is present on every user's device.
//
// This runs after `next build` and before `cap sync`, so the web build is
// untouched. It only deletes generated output — never source.
//
// Usage:  node scripts/prune-mobile-bundle.mjs

import { rm, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(frontendRoot, "out");

// Route prefixes that must never reach a mobile artifact.
const EXCLUDED_ROUTES = ["admin"];

async function dirSize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? await dirSize(full) : (await stat(full)).size;
  }
  return total;
}

async function main() {
  if (!existsSync(outDir)) {
    console.error(
      `[prune-mobile] ${outDir} does not exist. Run \`next build\` before this script.`
    );
    process.exit(1);
  }

  let removed = 0;

  for (const route of EXCLUDED_ROUTES) {
    // The App Router emits a route as a directory, a sibling .html entry point
    // and a .txt RSC payload. All three have to go, or the client router can
    // still resolve the page.
    const targets = [
      path.join(outDir, route),
      path.join(outDir, `${route}.html`),
      path.join(outDir, `${route}.txt`),
    ];

    for (const target of targets) {
      if (!existsSync(target)) continue;

      const info = await stat(target);
      const bytes = info.isDirectory() ? await dirSize(target) : info.size;

      await rm(target, { recursive: true, force: true });
      removed += bytes;
      console.log(`[prune-mobile] removed ${path.relative(outDir, target)} (${(bytes / 1024).toFixed(0)} KB)`);
    }
  }

  // Fail loudly rather than silently shipping the admin console: if the export
  // layout changes and these paths stop matching, we want a red build, not a
  // quiet pass.
  const leftovers = (await readdir(outDir)).filter((name) =>
    EXCLUDED_ROUTES.some((route) => name === route || name.startsWith(`${route}.`))
  );
  if (leftovers.length > 0) {
    console.error(`[prune-mobile] FAILED — still present in out/: ${leftovers.join(", ")}`);
    process.exit(1);
  }

  console.log(
    `[prune-mobile] mobile bundle clean — ${(removed / 1024).toFixed(0)} KB of admin routes removed`
  );
}

main().catch((err) => {
  console.error("[prune-mobile] unexpected failure:", err);
  process.exit(1);
});
