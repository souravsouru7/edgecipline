
/**
 * Custom metrics + per-endpoint-class trend tracking.
 *
 * k6's built-in http_req_duration mixes every endpoint together, which hides
 * the fact that a 40 ms /auth/me and a 900 ms /analytics/advanced have very
 * different health signatures. Each class gets its own Trend so thresholds can
 * be set independently.
 */

import { Trend, Rate, Counter } from "k6/metrics";
import { ENDPOINT_CLASS } from "./config.js";

export const errorRate = new Rate("business_errors");
export const rateLimited = new Counter("rate_limited_429");
export const serverErrors = new Counter("server_errors_5xx");
export const timeouts = new Counter("request_timeouts");
export const authFailures = new Counter("auth_failures_401_403");

export const journeyDuration = new Trend("user_journey_duration", true);
export const journeysCompleted = new Counter("user_journeys_completed");
export const journeysFailed = new Counter("user_journeys_failed");

export const classTrends = {
  [ENDPOINT_CLASS.AUTH_LIGHT]: new Trend("lat_auth_light", true),
  [ENDPOINT_CLASS.SIMPLE_READ]: new Trend("lat_simple_read", true),
  [ENDPOINT_CLASS.LIST_READ]: new Trend("lat_list_read", true),
  [ENDPOINT_CLASS.DASHBOARD]: new Trend("lat_dashboard", true),
  [ENDPOINT_CLASS.ANALYTICS]: new Trend("lat_analytics", true),
  [ENDPOINT_CLASS.WRITE]: new Trend("lat_write", true),
  [ENDPOINT_CLASS.LOGIN]: new Trend("lat_login", true),
};

export const classErrorRates = {
  [ENDPOINT_CLASS.AUTH_LIGHT]: new Rate("err_auth_light"),
  [ENDPOINT_CLASS.SIMPLE_READ]: new Rate("err_simple_read"),
  [ENDPOINT_CLASS.LIST_READ]: new Rate("err_list_read"),
  [ENDPOINT_CLASS.DASHBOARD]: new Rate("err_dashboard"),
  [ENDPOINT_CLASS.ANALYTICS]: new Rate("err_analytics"),
  [ENDPOINT_CLASS.WRITE]: new Rate("err_write"),
  [ENDPOINT_CLASS.LOGIN]: new Rate("err_login"),
};

/**
 * Records one response against its endpoint class and the global counters.
 * Returns true when the response is a business success.
 *
 * 429 is counted separately and NOT treated as a server error: under production
 * rate limits it is the app behaving correctly, and folding it into the failure
 * rate would make a healthy server look broken.
 */
export function record(res, endpointClass) {
  const status = res.status;
  const ok = status >= 200 && status < 400;

  classTrends[endpointClass].add(res.timings.duration);

  if (status === 0) timeouts.add(1);
  if (status === 429) rateLimited.add(1);
  if (status === 401 || status === 403) authFailures.add(1);
  if (status >= 500) serverErrors.add(1);

  // Error accounting excludes 429 — see note above.
  const isError = !ok && status !== 429;
  classErrorRates[endpointClass].add(isError);
  errorRate.add(isError);

  return ok;
}
