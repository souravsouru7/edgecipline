"use strict";

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { success } = require("../utils/apiResponse");

const { appConfig } = require("../config");
const { logger } = require("../utils/logger");

const ticketService = require("../services/supportTicket.service");
const messageService = require("../services/supportMessage.service");
const kbService = require("../services/knowledgeBase.service");
const assistantService = require("../services/supportAssistant.service");
const {
  buildInlineAttachmentUrl,
  buildDownloadAttachmentUrl,
  formatFromMimeType,
} = require("../utils/supportAttachments");
const {
  serializeTicketForUser,
  serializeMessageForUser,
} = require("../utils/supportSerializers");
const {
  SUPPORT_CATEGORIES,
  USER_SELECTABLE_PRIORITIES,
  TICKET_STATUS_LABELS,
  REOPEN_WINDOW_DAYS,
} = require("../constants/support");

/**
 * Paginated support responses nest `pagination` INSIDE `data` rather than
 * using the apiResponse `paginated()` helper.
 *
 * The frontend's axios interceptor unwraps `{success, data}` and returns only
 * `data` to the caller — a sibling `pagination` key on the envelope is
 * discarded before any component sees it. Support screens need real page
 * counts (the whole point of server-side paging is that the client never holds
 * the full set), so the pagination has to travel where the client can reach it.
 */
function page(res, result, options = {}) {
  return success(res, { items: result.items, pagination: result.pagination }, options);
}

// ─── Public: configuration ───────────────────────────────────────────────────

/**
 * @desc    Support contact details, categories, and limits
 * @route   GET /api/support/config
 * @access  Public
 *
 * Served from the API rather than baked into the frontend bundle. The web
 * build is a static export whose /support page is submitted to Google Play and
 * App Store Connect — a WhatsApp number compiled into a released AAB cannot be
 * corrected without shipping a new build to both stores and waiting for review.
 */
exports.getConfig = asyncHandler(async (_req, res) => {
  success(res, {
    whatsapp: appConfig.support.whatsappEnabled
      ? {
          enabled: true,
          number: appConfig.support.whatsappNumber,
          display: `+${appConfig.support.whatsappNumber}`,
        }
      : { enabled: false, number: "", display: "" },
    email: appConfig.support.email,
    ticketsEnabled: appConfig.support.ticketsEnabled,
    categories: SUPPORT_CATEGORIES,
    priorities: USER_SELECTABLE_PRIORITIES,
    statusLabels: TICKET_STATUS_LABELS,
    limits: {
      maxAttachments: appConfig.support.maxAttachmentsPerMessage,
      maxAttachmentBytes: appConfig.support.maxAttachmentBytes,
      reopenWindowDays: REOPEN_WINDOW_DAYS,
    },
  });
});

// ─── Public: knowledge base ──────────────────────────────────────────────────

/**
 * @desc    Help Center home — categories and popular articles in one call
 * @route   GET /api/support/home
 * @access  Public
 */
exports.getHome = asyncHandler(async (_req, res) => {
  const [categories, popular] = await Promise.all([
    kbService.listCategories(),
    kbService.listPopularArticles(6),
  ]);

  success(res, { categories, popular });
});

/**
 * @desc    Search or browse published articles
 * @route   GET /api/support/articles
 * @access  Public
 */
exports.listArticles = asyncHandler(async (req, res) => {
  const result = await kbService.searchArticles(req.validated.query);

  // `matchedBy` rides INSIDE data, not as an envelope message — the client
  // interceptor returns `data` and drops its siblings, so a message here would
  // never reach the component. It tells the UI whether these were a real match
  // or a spelling-corrected guess, so it can say "no exact matches" rather
  // than presenting a loose result as the answer.
  success(res, {
    items: result.items,
    pagination: result.pagination,
    matchedBy: result.matchedBy,
  });
});

/**
 * @desc    Read one published article
 * @route   GET /api/support/articles/:slug
 * @access  Public
 */
exports.getArticle = asyncHandler(async (req, res) => {
  const article = await kbService.getArticle(req.validated.params.slug);
  success(res, article);
});

/**
 * @desc    Was this article helpful?
 * @route   POST /api/support/articles/:slug/feedback
 * @access  Public (signed-in readers are keyed by user id)
 */
exports.submitArticleFeedback = asyncHandler(async (req, res) => {
  const result = await kbService.submitFeedback({
    slug: req.validated.params.slug,
    user: req.user || null,
    fingerprint: kbService.fingerprintFor(req),
    helpful: req.body.helpful,
    comment: req.body.comment,
  });

  // A repeat vote is not an error to show a reader — their opinion is already
  // recorded, and an error only invites them to click again.
  success(res, result, {
    message: result.counted ? "Thanks for the feedback" : "You have already rated this article",
  });
});

/**
 * @desc    Support assistant — answer from the knowledge base, or route to a human
 * @route   POST /api/support/assistant
 * @access  Public
 *
 * Retrieval only. Every sentence the customer reads is either a fixed string
 * from this codebase or an article a human published — nothing is generated,
 * so the assistant cannot invent a refund policy or a billing rule.
 */
exports.askAssistant = asyncHandler(async (req, res) => {
  const result = await assistantService.answer({ text: req.body.text });
  success(res, result);
});

// ─── Customer: tickets ───────────────────────────────────────────────────────

/**
 * @desc    Open tickets that might already cover this problem
 * @route   GET /api/support/tickets/duplicates
 * @access  Private
 */
exports.getDuplicateCandidates = asyncHandler(async (req, res) => {
  const candidates = await ticketService.findDuplicateCandidates(
    req.user._id,
    req.validated.query.category
  );

  success(
    res,
    candidates.map((t) => ({
      id: String(t._id),
      ticketCode: t.ticketCode,
      subject: t.subject,
      status: t.status,
      statusLabel: TICKET_STATUS_LABELS[t.status] || t.status,
      category: t.category,
      lastActivityAt: t.lastActivityAt,
    }))
  );
});

/**
 * @desc    Articles that might answer the question being typed
 * @route   GET /api/support/tickets/suggestions
 * @access  Private
 */
exports.getArticleSuggestions = asyncHandler(async (req, res) => {
  const items = await kbService.suggestForTicket(req.validated.query);
  success(res, items);
});

/**
 * @desc    Create a ticket
 * @route   POST /api/support/tickets
 * @access  Private
 */
exports.createTicket = asyncHandler(async (req, res) => {
  const { ticket, deduped } = await ticketService.createTicket({
    user: req.user,
    body: req.body,
    uploadedImages: req.uploadedImages || [],
    requestId: req.requestId,
  });

  success(res, serializeTicketForUser(ticket), {
    // 200 rather than 201 on a deduplicated retry: nothing new was created,
    // and a client that treats 201 as "success, clear the form" would be
    // telling the truth either way, but the status should not lie.
    statusCode: deduped ? 200 : 201,
    message: deduped
      ? "This ticket was already submitted"
      : "Ticket created — we'll be in touch shortly",
  });
});

/**
 * @desc    List the caller's own tickets
 * @route   GET /api/support/tickets
 * @access  Private
 */
exports.listMyTickets = asyncHandler(async (req, res) => {
  const result = await ticketService.listUserTickets(req.user._id, req.validated.query);
  page(res, result);
});

/**
 * @desc    Read one of the caller's own tickets
 * @route   GET /api/support/tickets/:id
 * @access  Private
 *
 * The lookup is scoped by owner in the query. Someone else's ticket id returns
 * the same 404 as a nonexistent one — a distinct 403 would confirm the id is
 * real, which is precisely the signal an enumeration attempt is after.
 */
exports.getMyTicket = asyncHandler(async (req, res) => {
  const ticket = await ticketService.getUserTicket(req.user._id, req.validated.params.id);
  success(res, ticket);
});

/**
 * @desc    Conversation thread (public messages only)
 * @route   GET /api/support/tickets/:id/messages
 * @access  Private
 */
exports.listMyTicketMessages = asyncHandler(async (req, res) => {
  // Ownership first — without this, any authenticated user could read any
  // ticket's thread by passing someone else's id straight to the message list.
  await ticketService.loadOwnedTicket(req.user._id, req.validated.params.id);

  const result = await messageService.listMessagesForUser(
    req.validated.params.id,
    req.validated.query
  );
  page(res, result);
});

/**
 * @desc    Reply on the caller's own ticket
 * @route   POST /api/support/tickets/:id/messages
 * @access  Private
 */
exports.replyToMyTicket = asyncHandler(async (req, res) => {
  const { message, ticket, deduped } = await ticketService.replyAsUser({
    user: req.user,
    ticketId: req.validated.params.id,
    body: req.body.body,
    uploadedImages: req.uploadedImages || [],
    clientMessageId: req.body.clientMessageId,
    requestId: req.requestId,
  });

  success(
    res,
    { message: serializeMessageForUser(message), ticket: serializeTicketForUser(ticket) },
    { statusCode: deduped ? 200 : 201 }
  );
});

/**
 * @desc    Reopen a resolved ticket
 * @route   POST /api/support/tickets/:id/reopen
 * @access  Private
 */
exports.reopenMyTicket = asyncHandler(async (req, res) => {
  const ticket = await ticketService.reopenTicket({
    user: req.user,
    ticketId: req.validated.params.id,
    requestId: req.requestId,
  });
  success(res, ticket, { message: "Ticket reopened" });
});

/**
 * @desc    Rate the resolution
 * @route   POST /api/support/tickets/:id/satisfaction
 * @access  Private
 */
exports.rateMyTicket = asyncHandler(async (req, res) => {
  const ticket = await ticketService.submitSatisfaction({
    user: req.user,
    ticketId: req.validated.params.id,
    rating: req.body.rating,
    comment: req.body.comment,
  });
  success(res, ticket, { message: "Thanks for the feedback" });
});

/**
 * @desc    Download an attachment from the caller's own ticket
 * @route   GET /api/support/attachments/:messageId/:index
 * @access  Private
 *
 * The authorisation that matters for attachments happens HERE, on every single
 * fetch — not once when the ticket was read. Two independent checks:
 *
 *   1. The message must belong to a ticket this user owns.
 *   2. The message must be PUBLIC. An internal note can carry a screenshot an
 *      agent pasted for colleagues; the customer owns the ticket but must
 *      never be able to pull a file off a note they cannot see.
 *
 * Only then is a signed Cloudinary URL minted, and it is never stored.
 */
exports.getMyAttachment = asyncHandler(async (req, res) => {
  const { messageId, index } = req.validated.params;
  const record = await messageService.getAttachmentRecord(messageId, index);

  if (!record) {
    throw new ApiError(404, "Attachment not found", "NOT_FOUND");
  }

  const { message, attachment } = record;

  if (String(message.ticketUser) !== String(req.user._id)) {
    logger.warn("SUPPORT_ATTACHMENT_FORBIDDEN", {
      messageId: String(messageId),
      requestedBy: String(req.user._id),
      requestId: req.requestId,
    });
    throw new ApiError(404, "Attachment not found", "NOT_FOUND");
  }

  if (message.visibility !== "public") {
    logger.warn("SUPPORT_ATTACHMENT_INTERNAL_BLOCKED", {
      messageId: String(messageId),
      requestedBy: String(req.user._id),
      requestId: req.requestId,
    });
    throw new ApiError(404, "Attachment not found", "NOT_FOUND");
  }

  const wantsDownload = Boolean(req.validated.query.download);
  const url = wantsDownload
    ? buildDownloadAttachmentUrl(attachment.publicId, formatFromMimeType(attachment.mimeType))
    : buildInlineAttachmentUrl(attachment.publicId, { width: 1200 });

  // A redirect rather than a JSON body holding the URL: the browser follows it
  // straight into an <img>, and the signed URL never lands in a response the
  // client might cache, log, or hand to a third party.
  res.redirect(302, url);
});
