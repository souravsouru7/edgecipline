// Where a tapped push lands. `deepLink` from the backend always wins; the
// `screen` map is the fallback for legacy payloads and for pushes whose
// deepLink got stripped by the OS. Indian-market screens must never resolve
// to a Forex route — the matrix in scripts/test-notification-routes.mjs
// enforces this.
export function getNotificationTarget(data = {}) {
  if (data.deepLink) return data.deepLink;
  const indian = data.marketType === "Indian_Market";
  const routes = {
    "trade":             `/trades/view?id=${data.tradeId || ""}`,
    "trade-edit":        `/trades/edit?id=${data.tradeId || ""}`,
    "indian-trade":      `/indian-market/trades/view?id=${data.tradeId || ""}`,
    "indian-trade-edit": `/indian-market/trades/edit?id=${data.tradeId || ""}`,
    "indian-trades":     "/indian-market/trades",
    "trades":            indian ? "/indian-market/trades" : "/trades",
    "weekly-report":     data.reportId
      ? `/weekly-reports?id=${data.reportId}`
      : `/weekly-reports${data.marketType ? `?marketType=${encodeURIComponent(data.marketType)}` : ""}`,
    "analytics":         indian ? "/indian-market/analytics" : "/analytics",
    "indian-analytics":  "/indian-market/analytics",
    "psychology":        "/checklist/psychology",
    "notifications":     "/notifications",
    "reflection":        "/reflection",
    "streaks":           "/streaks",
    "missions":          "/missions",
    "checklist":         "/checklist",
    "upload-trade":      indian ? "/indian-market/upload-trade" : "/upload-trade",
  };
  return routes[data.screen] || (indian ? "/indian-market/dashboard" : "/dashboard");
}
