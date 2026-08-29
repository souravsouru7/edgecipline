import { API_URL as BASE_URL } from "@/config/api";

/**
 * Staff-side support API.
 *
 * Deliberately NOT built on `apiClient`. The agent console runs inside the
 * admin workspace, which authenticates with the httpOnly `admin_sid` cookie and
 * a dedicated ADMIN_JWT_SECRET — a user access token is signed with a different
 * secret and is rejected outright by supportAuth. So this mirrors the fetch +
 * `credentials: "include"` pattern every other /admin screen already uses
 * (services/adminApi.js) rather than inventing a third auth path.
 */

const qs = (params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    search.set(key, String(value));
  });
  const out = search.toString();
  return out ? `?${out}` : "";
};

async function handle(res) {
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));

    if (res.status === 401 || res.status === 403) {
      // Mirrors adminApi: drop the local session marker so the console stops
      // pretending to be signed in. Covers the case where support access was
      // revoked mid-session — supportAuth re-checks the database on every
      // request, so the very next call after a revoke lands here.
      if (typeof window !== "undefined") localStorage.removeItem("adminName");
    }

    const error = new Error(
      payload?.error?.message || payload?.message || `Request failed with status ${res.status}`
    );
    error.status = res.status;
    error.data = payload?.error || payload;
    throw error;
  }

  const payload = await res.json();
  return payload?.success === true && Object.prototype.hasOwnProperty.call(payload, "data")
    ? payload.data
    : payload;
}

function adminFetch(path, { method = "GET", body, signal, multipart = false } = {}) {
  return fetch(`${BASE_URL}${path}`, {
    method,
    credentials: "include",
    signal,
    // FormData must set its own multipart boundary — supplying Content-Type
    // manually produces a body the server cannot parse.
    headers: multipart ? undefined : { "Content-Type": "application/json" },
    body: multipart ? body : body ? JSON.stringify(body) : undefined,
  }).then(handle);
}

function buildForm(fields, attachments = []) {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    form.append(key, String(value));
  });
  Array.from(attachments || [])
    .filter(Boolean)
    .forEach((file) => form.append("attachments", file));
  return form;
}

// ─── Console ─────────────────────────────────────────────────────────────────

export const getMySupportCapabilities = (signal) => adminFetch("/admin/support/me", { signal });

export const getSupportMetrics = (signal) => adminFetch("/admin/support/metrics", { signal });

export const listSupportAgents = (signal) => adminFetch("/admin/support/agents", { signal });

// ─── Queue ───────────────────────────────────────────────────────────────────

export const listStaffTickets = (params = {}, signal) =>
  adminFetch(`/admin/support/tickets${qs(params)}`, { signal });

export const getStaffTicket = (id, signal) => adminFetch(`/admin/support/tickets/${id}`, { signal });

export const listStaffTicketMessages = (id, { page = 1, limit = 50 } = {}, signal) =>
  adminFetch(`/admin/support/tickets/${id}/messages${qs({ page, limit })}`, { signal });

export const getTicketContext = (id, signal) =>
  adminFetch(`/admin/support/tickets/${id}/context`, { signal });

export const getTicketAudit = (id, signal) =>
  adminFetch(`/admin/support/tickets/${id}/audit`, { signal });

// ─── Ticket actions ──────────────────────────────────────────────────────────

export const staffReply = (id, { body, attachments = [], internal = false, nextStatus, clientMessageId }) =>
  adminFetch(`/admin/support/tickets/${id}/messages`, {
    method: "POST",
    multipart: true,
    body: buildForm(
      { body, internal: internal ? "true" : "false", nextStatus, clientMessageId },
      attachments
    ),
  });

export const assignTicket = (id, { assigneeId, expectedVersion }) =>
  adminFetch(`/admin/support/tickets/${id}/assign`, {
    method: "PATCH",
    body: { assigneeId: assigneeId || "", expectedVersion },
  });

export const changeTicketStatus = (id, { status, resolutionSummary, expectedVersion }) =>
  adminFetch(`/admin/support/tickets/${id}/status`, {
    method: "PATCH",
    body: { status, resolutionSummary, expectedVersion },
  });

export const changeTicketPriority = (id, { priority, expectedVersion }) =>
  adminFetch(`/admin/support/tickets/${id}/priority`, {
    method: "PATCH",
    body: { priority, expectedVersion },
  });

export const updateTicketTags = (id, tags) =>
  adminFetch(`/admin/support/tickets/${id}/tags`, { method: "PATCH", body: { tags } });

/**
 * Attachment URL for the staff console.
 *
 * Points at our authorising endpoint, never at Cloudinary. The browser sends
 * the admin cookie with the navigation, the server re-checks staff access, and
 * only then mints a signed URL to redirect to.
 */
export const staffAttachmentUrl = (messageId, index, { download = false } = {}) =>
  `${BASE_URL}/admin/support/attachments/${messageId}/${index}${download ? "?download=true" : ""}`;

// ─── Knowledge base ──────────────────────────────────────────────────────────

export const listAdminArticles = (params = {}, signal) =>
  adminFetch(`/admin/support/articles${qs(params)}`, { signal });

export const getAdminArticle = (id, signal) => adminFetch(`/admin/support/articles/${id}`, { signal });

export const createArticle = (payload) =>
  adminFetch("/admin/support/articles", { method: "POST", body: payload });

export const updateArticle = (id, payload) =>
  adminFetch(`/admin/support/articles/${id}`, { method: "PATCH", body: payload });

export const changeArticleStatus = (id, status) =>
  adminFetch(`/admin/support/articles/${id}/status`, { method: "PATCH", body: { status } });

export const deleteArticle = (id) =>
  adminFetch(`/admin/support/articles/${id}`, { method: "DELETE" });

export const getArticleFeedbackReport = (id, signal) =>
  adminFetch(`/admin/support/articles/${id}/feedback`, { signal });

export const setAgentRole = (userId, supportRole) =>
  adminFetch(`/admin/support/agents/${userId}`, { method: "PATCH", body: { supportRole } });
