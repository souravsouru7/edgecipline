import * as Sentry from "@sentry/nextjs";

export function captureApiFailure(error) {
  const status = Number(error?.response?.status || error?.status || 0);
  if (status > 0 && status < 500) return;

  const method = String(error?.config?.method || "unknown").toUpperCase();
  const route = String(error?.config?.url || "unknown").split("?")[0];
  const kind = status >= 500 ? "server" : "network";
  const sanitizedError = new Error(
    status >= 500 ? `API request failed with ${status}` : "API network request failed"
  );

  Sentry.captureException(sanitizedError, {
    level: status >= 500 ? "error" : "warning",
    tags: { subsystem: "api", kind, method, route },
    extra: { status },
  });
}
