import apiClient from "@/services/apiClient";
import { compressImages } from "@/utils/imageCompression";

/**
 * Support API surface.
 *
 * Two things worth knowing before editing:
 *
 * 1. `apiClient` unwraps the `{success, data}` envelope, so every function
 *    here resolves to the payload directly. List endpoints return
 *    `{ items, pagination }` because the server nests pagination inside data —
 *    the interceptor discards sibling envelope keys.
 *
 * 2. The public endpoints (config/home/articles) work with no session. They
 *    must keep working with no session: /support is the support URL submitted
 *    to Google Play and App Store Connect, and both open it cold in a browser.
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

// ─── Public ──────────────────────────────────────────────────────────────────

export const getSupportConfig = (signal) =>
  apiClient.get("/support/config", signal ? { signal } : undefined);

export const getSupportHome = (signal) =>
  apiClient.get("/support/home", signal ? { signal } : undefined);

/**
 * Ask the support assistant.
 *
 * Stateless — the server keeps no conversation, so each call is independent and
 * there is no transcript stored anywhere. The reply is always either a fixed
 * string or a list of published articles; nothing is generated.
 *
 * The timeout is deliberately far below the client's 10s default. This is a
 * chat box: the work behind it is a single indexed text search that normally
 * answers in well under a second, so anything past a few seconds means the
 * backend is unreachable. Waiting the full 10s just to admit that leaves
 * someone staring at a spinner in a help widget, which reads as broken —
 * showing them WhatsApp and the ticket form sooner is strictly more useful.
 */
const ASSISTANT_TIMEOUT_MS = 6000;

export const askAssistant = (text) =>
  apiClient.post("/support/assistant", { text }, { timeout: ASSISTANT_TIMEOUT_MS });

export const searchArticles = ({ q, category, page = 1, limit = 20 } = {}, signal) =>
  apiClient.get(`/support/articles${qs({ q, category, page, limit })}`, signal ? { signal } : undefined);

export const getArticle = (slug, signal) =>
  apiClient.get(`/support/articles/${encodeURIComponent(slug)}`, signal ? { signal } : undefined);

export const rateArticle = (slug, { helpful, comment } = {}) =>
  apiClient.post(`/support/articles/${encodeURIComponent(slug)}/feedback`, { helpful, comment });

// ─── Customer tickets ────────────────────────────────────────────────────────

export const listMyTickets = ({ status, category, q, page = 1, limit = 20 } = {}, signal) =>
  apiClient.get(`/support/tickets${qs({ status, category, q, page, limit })}`, signal ? { signal } : undefined);

export const getMyTicket = (id, signal) =>
  apiClient.get(`/support/tickets/${id}`, signal ? { signal } : undefined);

export const listMyTicketMessages = (id, { page = 1, limit = 30 } = {}, signal) =>
  apiClient.get(`/support/tickets/${id}/messages${qs({ page, limit })}`, signal ? { signal } : undefined);

export const getDuplicateCandidates = (category, signal) =>
  apiClient.get(`/support/tickets/duplicates${qs({ category })}`, signal ? { signal } : undefined);

export const getArticleSuggestions = ({ category, subject } = {}, signal) =>
  apiClient.get(`/support/tickets/suggestions${qs({ category, subject })}`, signal ? { signal } : undefined);

/**
 * Build the multipart body shared by ticket creation and replies.
 *
 * Attachments are compressed client-side first — the same treatment trade
 * screenshots get. This is a convenience, not a control: the server re-checks
 * type, magic bytes, decodability, dimensions and size regardless of what the
 * browser sends.
 */
async function buildAttachmentForm(fields, attachments) {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    form.append(key, String(value));
  });

  const files = Array.from(attachments || []).filter(Boolean);
  if (files.length) {
    const compressed = await compressImages(files);
    compressed.forEach((file) => form.append("attachments", file));
  }

  return form;
}

export const createTicket = async ({
  subject,
  description,
  category,
  subcategory,
  priority = "normal",
  attachments = [],
  clientRequestId,
  platform,
  appVersion,
  marketType,
}) => {
  const form = await buildAttachmentForm(
    { subject, description, category, subcategory, priority, clientRequestId, platform, appVersion, marketType },
    attachments
  );

  return apiClient.post("/support/tickets", form, {
    timeout: 120000,
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const replyToTicket = async (id, { body, attachments = [], clientMessageId }) => {
  const form = await buildAttachmentForm({ body, clientMessageId }, attachments);

  return apiClient.post(`/support/tickets/${id}/messages`, form, {
    timeout: 120000,
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const reopenTicket = (id) => apiClient.post(`/support/tickets/${id}/reopen`, {});

export const rateTicket = (id, { rating, comment }) =>
  apiClient.post(`/support/tickets/${id}/satisfaction`, { rating, comment });

/**
 * Attachment URL.
 *
 * Points at OUR endpoint, not at Cloudinary. That endpoint re-authorises on
 * every fetch and then redirects to a short-lived signed URL, so nothing
 * long-lived or guessable is ever handed to the browser.
 */
export const attachmentUrl = (messageId, index, { download = false } = {}) => {
  const base = apiClient.defaults.baseURL?.replace(/\/+$/, "") || "";
  return `${base}/support/attachments/${messageId}/${index}${download ? "?download=true" : ""}`;
};

/*
 * Staff-side endpoints deliberately live in ./adminSupportApi.js.
 *
 * The agent console authenticates with the httpOnly admin cookie and a
 * separate signing secret; apiClient sends the USER bearer token, which
 * supportAuth rejects. Keeping the two clients apart makes it impossible to
 * call a staff endpoint with customer credentials by accident.
 */
