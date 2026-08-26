import * as CapacitorSentry from "@sentry/capacitor";
import * as NextSentry from "@sentry/nextjs";
import type { ErrorEvent, EventHint } from "@sentry/core";
import { Capacitor } from "@capacitor/core";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const environment = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development";
const release = process.env.NEXT_PUBLIC_SENTRY_RELEASE;
const tracesSampleRate = Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || 0.2);

const options = {
  dsn,
  environment,
  release,
  enabled: Boolean(dsn),
  sendDefaultPii: false,
  tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0.2,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0.1,
  // Untyped here on purpose: @sentry/nextjs's Event and @sentry/capacitor's
  // ErrorEvent don't structurally align (transaction events vs. error-only),
  // even though both SDKs accept this same object shape at runtime.
  beforeSend(event: ErrorEvent, _hint: EventHint) {
    if (event.request) {
      event.request.cookies = undefined;
      event.request.data = undefined;
      event.request.query_string = undefined;
      if (event.request.url) event.request.url = event.request.url.split("?")[0];
      if (event.request.headers) {
        delete event.request.headers.Authorization;
        delete event.request.headers.authorization;
        delete event.request.headers.Cookie;
        delete event.request.headers.cookie;
      }
    }
    if (event.user?.id) event.user = { id: String(event.user.id) };
    else event.user = undefined;
    return event;
  },
};

if (Capacitor.isNativePlatform()) {
  CapacitorSentry.init(options, NextSentry.init);
} else {
  NextSentry.init(options);
}

export const onRouterTransitionStart = NextSentry.captureRouterTransitionStart;
