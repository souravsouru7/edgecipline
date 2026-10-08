import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateEnvironment } from "./config/environment";

// Static Capacitor bundles cannot be repaired after compilation.
validateEnvironment(undefined, { mode: process.env.NODE_ENV });

const frontendRoot = dirname(fileURLToPath(import.meta.url));

// Mobile builds must stay false until Play Billing / StoreKit are implemented.
const paymentsEnabled =
  String(process.env.NEXT_PUBLIC_PAYMENTS_ENABLED || "").trim() === "true";

const playBillingEnabled =
  String(process.env.NEXT_PUBLIC_PLAY_BILLING_ENABLED || "").trim() === "true";

// M30: Security headers — applied by the dev server and any SSR deployment.
// For the static export (output: "export") these must also be set at the CDN/Nginx layer.
const securityHeaders = [
  { key: "X-Content-Type-Options",    value: "nosniff" },
  { key: "X-Frame-Options",           value: "DENY" },
  { key: "X-XSS-Protection",          value: "1; mode=block" },
  { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy",        value: "camera=(), microphone=(), geolocation=()" },
];

const noStoreHeaders = [
  { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
  { key: "Pragma",        value: "no-cache" },
  { key: "Expires",       value: "0" },
];

const protectedRoutePatterns = [
  "/accept-terms/:path*",
  "/add-trade/:path*",
  "/admin/:path*",
  "/analytics/:path*",
  "/checklist/:path*",
  "/dashboard/:path*",
  "/indian-market/:path*",
  "/intelligence/:path*",
  "/profile/:path*",
  "/psychology-timeline/:path*",
  "/setups/:path*",
  "/trades/:path*",
  "/trading-dna/:path*",
  "/upload/:path*",
  "/upload-trade/:path*",
  "/weekly-reports/:path*",
];

const nextConfig: NextConfig = {
  output: "export",
  env: {
    // Cache buster for the persisted React Query cache (utils/persistedQueryCache).
    NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION || process.env.npm_package_version || "0.0.0",
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      ...protectedRoutePatterns.map((source) => ({
        source,
        headers: noStoreHeaders,
      })),
    ];
  },
  // Turbopack is the default bundler in Next.js 16. Empty config signals we
  // are intentionally using Turbopack and silences the webpack-config warning.
  turbopack: {
    root: frontendRoot,
    // Each purchase surface off -> resolve it to an inert stub so the real
    // component never enters the module graph. A runtime guard is not
    // sufficient: the bundler still emits the chunk, leaving payment code in a
    // store artifact.
    //
    //   Razorpay      stubbed unless NEXT_PUBLIC_PAYMENTS_ENABLED=true
    //                 (so: absent from Android and iOS builds)
    //   Play Billing  stubbed unless NEXT_PUBLIC_PLAY_BILLING_ENABLED=true
    //                 (so: absent from web and iOS builds)
    //
    // An iOS build has both flags false, which is what leaves it with no
    // purchase mechanism compiled in at all — the condition Apple 3.1.1 cares
    // about, as distinct from a purchase surface that is merely hidden.
    resolveAlias: {
      ...(paymentsEnabled
        ? {}
        : { "@/components/SmartPaywall": "./components/SmartPaywall.disabled.js" }),
      ...(playBillingEnabled
        ? {}
        : { "@/components/PlayBillingPaywall": "./components/PlayBillingPaywall.disabled.js" }),
    },
  },
};

// L11: Validate Sentry env vars at build time so misconfigurations surface early.
const sentryOrg     = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;

if (!sentryOrg || !sentryProject) {
  const missing = [
    !sentryOrg     && 'SENTRY_ORG',
    !sentryProject && 'SENTRY_PROJECT',
  ].filter(Boolean).join(', ');
  console.warn(
    `[next.config] Sentry source-map upload disabled — missing env var(s): ${missing}. ` +
    'Set them in CI/CD to enable release tracking.'
  );
}

export default (sentryOrg && sentryProject)
  ? withSentryConfig(nextConfig, {
      org:     sentryOrg,
      project: sentryProject,
      silent: !process.env.CI,
      webpack: {
        autoInstrumentServerFunctions: false,
        autoInstrumentMiddleware:      false,
        autoInstrumentAppDirectory:    false,
      },
    })
  : nextConfig;
