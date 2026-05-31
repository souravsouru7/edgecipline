import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// M30: Security headers — applied by the dev server and any SSR deployment.
// For the static export (output: "export") these must also be set at the CDN/Nginx layer.
const securityHeaders = [
  { key: "X-Content-Type-Options",    value: "nosniff" },
  { key: "X-Frame-Options",           value: "DENY" },
  { key: "X-XSS-Protection",          value: "1; mode=block" },
  { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy",        value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
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
