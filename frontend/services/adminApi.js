import { API_URL as BASE_URL } from "@/config/api";

// A hung request is worse than a failed one: the admin UI spins forever with
// no way back. Every call gets a deadline.
const DEFAULT_TIMEOUT_MS = 20_000;
// Logout is awaited on the login path, so a stalled one must not hold the
// operator hostage before they can even sign in.
const LOGOUT_TIMEOUT_MS = 5_000;

/**
 * localStorage throws — not returns null — in Safari private mode, when a
 * quota is exhausted, and when a browser policy blocks third-party storage.
 * An admin panel must not white-screen because of a storage preference.
 */
const storage = {
  get(key) {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Non-fatal: the session lives in the httpOnly cookie, not here. This
      // key only drives the "try restoring a session" hint on the login page.
    }
  },
  remove(key) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Non-fatal — see set().
    }
  },
};

export const hasAdminSession = () => Boolean(storage.get("adminName"));

export const getAdminSessionName = (fallback = "Admin") => storage.get("adminName") || fallback;

export const setAdminSessionName = (name) => {
  if (name) storage.set("adminName", name);
};

/** Carries the HTTP status and API error code so callers can branch on them. */
export class AdminApiError extends Error {
  constructor(message, { status = 0, code = "UNKNOWN", retryAfterSeconds = null, cause } = {}) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    // Keep the original error reachable — the friendly message above
    // deliberately hides the detail a developer still needs in the console.
    if (cause) this.cause = cause;
  }
}

/** Host shown in connectivity errors — never the full URL, which can carry a query. */
const apiHost = () => {
  try {
    return new URL(BASE_URL).host;
  } catch {
    return BASE_URL || "the API";
  }
};

/**
 * An API error body is attacker-adjacent data: it reaches the DOM. Anything
 * that is not a non-empty string is discarded so a nested object cannot
 * render as "[object Object]" in the admin's error banner.
 */
const asMessage = (value) => (typeof value === "string" && value.trim() ? value.trim() : "");

/**
 * Path segments are interpolated into the URL, so an id carrying "/" or "?"
 * would silently retarget the request — deleteAdminUser("x/../payments/y")
 * must not become a call to the payments route. Encoding also turns an
 * undefined id into a loud error rather than a request to ".../undefined".
 */
const pathParam = (value, name) => {
  if (value === undefined || value === null || value === "") {
    throw new AdminApiError(`Cannot build the request: ${name} is missing.`, {
      code: "INVALID_ARGUMENT",
    });
  }
  return encodeURIComponent(String(value));
};

/**
 * Retry-After is defined as either a seconds count or an HTTP-date. Reading
 * only the numeric form silently drops the delay whenever a proxy rewrites it.
 */
const parseRetryAfter = (headers) => {
  const raw = headers?.get?.("retry-after");
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);

  const when = Date.parse(raw);
  if (Number.isNaN(when)) return null;
  return Math.max(0, Math.ceil((when - Date.now()) / 1000));
};

/**
 * Reads a body that may legitimately be absent (204/205, or a DELETE that
 * returns nothing). Calling res.json() on those throws a bare SyntaxError
 * that would surface to the admin as "Unexpected end of JSON input".
 */
const readBody = async (res) => {
  if (res.status === 204 || res.status === 205) return { json: null, text: "" };

  let text = "";
  try {
    text = await res.text();
  } catch (error) {
    // The connection dropped mid-body. Treat it as an empty body; the status
    // line already tells us how to report it.
    return { json: null, text: "", truncated: true, cause: error };
  }

  if (!text.trim()) return { json: null, text: "" };

  try {
    return { json: JSON.parse(text), text };
  } catch {
    // Not JSON — almost always an HTML error page from a proxy or a dev
    // server answering the wrong origin.
    return { json: null, text };
  }
};

const handleResponse = async (res) => {
  const { json, text, truncated, cause } = await readBody(res);

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      storage.remove("adminName");
    }

    // errorHandler sends { message, errorCode, details } — not { error: { ... } }.
    const details = json?.error?.details || json?.details;
    const detailText = Array.isArray(details) && details[0]?.message
      ? details
          .slice(0, 3)
          .map((item) => `${item.field ? `${item.field}: ` : ""}${item.message}`)
          .join("; ")
      : "";
    const apiMessage =
      [asMessage(json?.error?.message) || asMessage(json?.message), detailText]
        .filter(Boolean)
        .join(" — ") || "";
    const code =
      asMessage(json?.error?.code) || asMessage(json?.errorCode) || "UNKNOWN";

    // The server's own message is the most specific thing available, so it
    // wins. The fallbacks only cover responses with no usable JSON body —
    // a proxy 502, an HTML error page, a stray 404 from the wrong origin.
    const fallback =
      {
        400: "The server rejected that request as invalid.",
        401: "Invalid email or password.",
        403: "That account is not an admin.",
        404: `Endpoint not found on ${apiHost()} — check NEXT_PUBLIC_API_URL.`,
        409: "That conflicts with the current state. Reload and try again.",
        413: "That upload is too large.",
        429: "Too many attempts. Wait a minute and try again.",
        500: "The server hit an error. Check the backend logs.",
        502: `Cannot reach the API behind ${apiHost()}.`,
        503: "The server is starting up or unavailable. Try again shortly.",
        504: "The server took too long to respond.",
      }[res.status] || `Request failed (HTTP ${res.status}).`;

    throw new AdminApiError(apiMessage || fallback, {
      status: res.status,
      code,
      retryAfterSeconds: parseRetryAfter(res.headers),
      cause,
    });
  }

  // A 2xx that is not JSON means something between us and the API answered
  // instead of the API — surfacing the raw HTML would be meaningless.
  if (json === null && text.trim()) {
    throw new AdminApiError(
      `${apiHost()} returned a non-JSON response. Check that NEXT_PUBLIC_API_URL points at the API, not the web app.`,
      { status: res.status, code: "INVALID_RESPONSE" }
    );
  }
  if (truncated) {
    throw new AdminApiError("The response was cut off in transit. Try again.", {
      status: res.status,
      code: "TRUNCATED_RESPONSE",
      cause,
    });
  }

  if (json === null) return null; // 204 / empty body — a successful no-content write

  return json?.success === true && Object.prototype.hasOwnProperty.call(json, "data")
    ? json.data
    : json;
};

/** Shared fetch wrapper for the httpOnly admin cookie session. */
const adminFetch = async (url, { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...options } = {}) => {
  // config/api.js falls back to an empty base URL when env validation fails.
  // Without this guard every call silently becomes a same-origin request to
  // the Next app, which answers 404 HTML and looks like a broken API.
  if (!BASE_URL) {
    throw new AdminApiError(
      "The API base URL is not configured. Set NEXT_PUBLIC_API_URL and restart the dev server.",
      { code: "CONFIG_ERROR" }
    );
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  // Compose the caller's signal with our deadline by hand rather than using
  // AbortSignal.any(), which is too new to rely on across the browsers an
  // admin might open this panel in.
  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", forwardAbort, { once: true });
  }

  const hasBody = options.body !== undefined && options.body !== null;

  try {
    return await fetch(`${BASE_URL}${url}`, {
      ...options,
      credentials: "include",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        // Only on requests that actually carry one. Sending Content-Type on a
        // bodiless GET forces a CORS preflight, doubling the round trips on
        // every read in the panel for nothing.
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    if (timedOut) {
      throw new AdminApiError(
        `${apiHost()} did not respond within ${Math.max(1, Math.round(timeoutMs / 1000))}s.`,
        { code: "TIMEOUT", cause: error }
      );
    }
    if (signal?.aborted) {
      throw new AdminApiError("Request cancelled.", { code: "ABORTED", cause: error });
    }
    // fetch() rejects only when the request never completed — backend down,
    // DNS/CORS refusal, offline, mixed content. The browser deliberately
    // gives JS no detail ("Failed to fetch"), and surfacing that raw string
    // reads as "your password is wrong" to whoever is staring at the login
    // form. Say what actually happened instead.
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    throw new AdminApiError(
      offline
        ? "You appear to be offline."
        : `Cannot reach the API at ${apiHost()}. Is the backend running?`,
      { code: "NETWORK_ERROR", cause: error }
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", forwardAbort);
  }
};

/** Every endpoint below funnels through this so no call can skip the guards. */
const request = async (url, options) => handleResponse(await adminFetch(url, options));

export const clearAdminSession = async () => {
  storage.remove("adminName");
  try {
    await adminFetch("/admin/auth/logout", { method: "POST", timeoutMs: LOGOUT_TIMEOUT_MS });
  } catch {
    // Best-effort. The local key is already gone and the server drops the
    // cookie on its own schedule; a failure here must never block the caller.
  }
};

/**
 * Admin Login
 * POST /api/admin/auth/login
 * The server establishes the session in an httpOnly cookie.
 */
export const adminLogin = async ({ email, password } = {}, options) =>
  request("/admin/auth/login", {
    ...options,
    method: "POST",
    // Trimming here rather than at the call site: a trailing space pasted into
    // the email field is otherwise an unexplainable "Invalid credentials".
    body: JSON.stringify({ email: String(email ?? "").trim(), password: String(password ?? "") }),
  });

/**
 * Get Admin Profile
 * GET /api/admin/auth/me
 */
export const getAdminProfile = async (options) => request("/admin/auth/me", options);

export const getAdminStats = async (options) => request("/admin/analytics/stats", options);

export const getAdminGrowth = async (options) => request("/admin/analytics/growth", options);

export const getAllAdminUsers = async (options) => request("/admin/users", options);

export const deleteAdminUser = async (id, options) =>
  request(`/admin/users/${pathParam(id, "user id")}`, { ...options, method: "DELETE" });

export const toggleAdminUserStatus = async (id, options) =>
  request(`/admin/users/${pathParam(id, "user id")}/status`, { ...options, method: "PATCH" });

export const extendAdminUserPlan = async (id, days, options) =>
  request(`/admin/users/${pathParam(id, "user id")}/extend`, {
    ...options,
    method: "PATCH",
    body: JSON.stringify({ days }),
  });

export const getAdminPayments = async (options) => request("/admin/payments", options);

export const updateAdminPaymentStatus = async (id, status, options) =>
  request(`/admin/payments/${pathParam(id, "payment id")}/status`, {
    ...options,
    method: "PATCH",
    body: JSON.stringify({ status }),
  });

export const addManualPayment = async (paymentData, options) =>
  request("/admin/payments/manual", {
    ...options,
    method: "POST",
    body: JSON.stringify(paymentData),
  });

export const getExpiredAdminUsers = async (options) => request("/admin/users/expired", options);

export const sendAdminRenewalReminder = async (id, options) =>
  request(`/admin/users/${pathParam(id, "user id")}/remind`, { ...options, method: "POST" });

export const getAdminAllTrades = async (options) => request("/admin/trades", options);

export const getAdminExtractionLogs = async (options) => request("/admin/trades/logs", options);

export const getAdminFeedback = async (options) => request("/admin/feedback", options);

export const updateAdminFeedbackStatus = async (id, updateData, options) =>
  request(`/admin/feedback/${pathParam(id, "feedback id")}`, {
    ...options,
    method: "PATCH",
    body: JSON.stringify(updateData),
  });

export const deleteAdminFeedback = async (id, options) =>
  request(`/admin/feedback/${pathParam(id, "feedback id")}`, { ...options, method: "DELETE" });

export const getAdminNotifications = async (options) => request("/admin/notifications", options);

export const markAdminNotificationAsRead = async (id, options) =>
  request(`/admin/notifications/${pathParam(id, "notification id")}/read`, {
    ...options,
    method: "PATCH",
  });

export const markAllAdminNotificationsAsRead = async (options) =>
  request("/admin/notifications/read-all", { ...options, method: "POST" });

export const sendAdminCustomNotification = async (payload, options) =>
  request("/admin/notifications/custom", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });

export const getPromotionOverview = async (options) =>
  request("/admin/promotions/overview", options);

export const getPromotionCampaigns = async (options) =>
  request("/admin/promotions/campaigns", options);

export const createPromotionCampaign = async (body, options) =>
  request("/admin/promotions/campaigns", { ...options, method: "POST", body: JSON.stringify(body) });

export const updatePromotionCampaign = async (id, body, options) =>
  request(`/admin/promotions/campaigns/${pathParam(id, "campaign id")}`, {
    ...options,
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const getPromotionCampaignDetail = async (id, options) =>
  request(`/admin/promotions/campaigns/${pathParam(id, "campaign id")}`, options);

export const getPromotionCoupons = async (campaignId, options) =>
  request(`/admin/promotions/coupons${campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : ""}`, options);

export const createPromotionCoupon = async (body, options) =>
  request("/admin/promotions/coupons", { ...options, method: "POST", body: JSON.stringify(body) });

export const updatePromotionCoupon = async (id, body, options) =>
  request(`/admin/promotions/coupons/${pathParam(id, "coupon id")}`, {
    ...options,
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const getPromotionInfluencers = async (options) =>
  request("/admin/promotions/influencers", options);

export const createPromotionInfluencer = async (body, options) =>
  request("/admin/promotions/influencers", { ...options, method: "POST", body: JSON.stringify(body) });

export const updatePromotionInfluencer = async (id, body, options) =>
  request(`/admin/promotions/influencers/${pathParam(id, "influencer id")}`, {
    ...options,
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const getPromotionInfluencerDetail = async (id, options) =>
  request(`/admin/promotions/influencers/${pathParam(id, "influencer id")}`, options);

export const getPromotionRedemptions = async (options) =>
  request("/admin/promotions/redemptions", options);
