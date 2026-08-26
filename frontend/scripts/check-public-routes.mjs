// Verifies that the store-facing URLs render for a logged-OUT visitor.
//
// Google Play and App Store Connect both take these as URLs and open them cold,
// in a browser, with no session. They are easy to break without noticing: the
// pages render fine while you are signed in, and AuthSessionBootstrap only
// redirects when session restore comes back empty. A missing entry in its
// PUBLIC_PATH_PREFIXES list silently turns a policy URL into a login screen —
// which is exactly what happened before this script existed.
//
// Usage:
//   node scripts/check-public-routes.mjs                        # dev server
//   node scripts/check-public-routes.mjs https://edgecipline.com # deployed
//
// Requires puppeteer, which lives in docs/pdf-gen3. Run from that folder's
// node_modules, or install puppeteer here.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let puppeteer;
try {
  puppeteer = require("puppeteer");
} catch {
  try {
    puppeteer = require("../../docs/pdf-gen3/node_modules/puppeteer");
  } catch {
    console.error(
      "puppeteer not found. Install it here, or run from a checkout where\n" +
      "docs/pdf-gen3/node_modules/puppeteer exists."
    );
    process.exit(2);
  }
}

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/+$/, "");

// route -> text that must be visible without signing in
const PUBLIC_ROUTES = [
  ["/delete-account", "Deleting your Edgecipline account"],
  ["/privacy-policy", "Privacy"],
  ["/terms", "Terms"],
  ["/support", "Support"],
];

const LOGIN_MARKERS = ["ACCESS DASHBOARD", "Continue with Google", "Forgot password?"];

async function main() {
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
  let failures = 0;

  console.log(`Checking public routes against ${BASE}\n`);

  for (const [route, probe] of PUBLIC_ROUTES) {
    const page = await browser.newPage();
    // A brand-new context each time — no cookies, no stored token. This is the
    // reviewer's view.
    try {
      const res = await page.goto(`${BASE}${route}`, {
        waitUntil: "networkidle0",
        timeout: 60000,
      });
      // Give the client-side auth gate time to redirect if it is going to.
      await new Promise((r) => setTimeout(r, 2500));

      const status = res?.status() ?? 0;
      const landed = new URL(page.url()).pathname;
      const text = await page.evaluate(() => document.body.innerText);

      const redirected = landed !== route;
      const showsLogin = LOGIN_MARKERS.some((m) => text.includes(m));
      const hasContent = text.includes(probe);

      if (status >= 400) {
        console.log(`FAIL ${route} — HTTP ${status}`);
        failures++;
      } else if (redirected) {
        console.log(`FAIL ${route} — redirected to ${landed} (not reachable logged out)`);
        failures++;
      } else if (showsLogin) {
        console.log(`FAIL ${route} — rendered the login screen`);
        failures++;
      } else if (!hasContent) {
        console.log(`FAIL ${route} — rendered ${text.length} chars but not "${probe}"`);
        failures++;
      } else {
        console.log(`OK   ${route} — ${text.length} chars`);
      }
    } catch (err) {
      console.log(`FAIL ${route} — ${err.message}`);
      failures++;
      
    }
    await page.close();
  }

  await browser.close();

  console.log(
    failures === 0
      ? "\nAll public routes reachable logged out."
      : `\n${failures} route(s) NOT reachable logged out — fix before submitting to either store.`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
