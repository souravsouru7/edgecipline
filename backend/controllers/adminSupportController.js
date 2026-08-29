"use strict";

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { success } = require("../utils/apiResponse");

const { logger } = require("../utils/logger");
const User = require("../models/Users");
const { invalidateAuthCache } = require("../services/authCacheService");

const ticketService = require("../services/supportTicket.service");
const messageService = require("../services/supportMessage.service");
const kbService = require("../services/knowledgeBase.service");
const {
  buildInlineAttachmentUrl,
  buildDownloadAttachmentUrl,
  formatFromMimeType,
} = require("../utils/supportAttachments");
const {
  serializeMessageForStaff,
  serializeTicketForStaff,
} = require("../utils/supportSerializers");
const { SUPPORT_ROLES, resolveCapabilities } = require("../constants/support");

// See supportController.page — pagination must sit inside `data`, because the
// frontend interceptor discards sibling envelope keys before the caller sees them.
function page(res, result, options = {}) {
  return success(res, { items: result.items, pagination: result.pagination }, options);
}

// ─── Queue ───────────────────────────────────────────────────────────────────

/**
 * @desc    Ticket queue with server-side search, filter, sort and pagination
 * @route   GET /api/admin/support/tickets
 * @access  Support staff
 *
 * One page of results, always. Nothing here can return the whole collection —
 * the page size is clamped in the service regardless of what the client asks.
 */
exports.listTickets = asyncHandler(async (req, res) => {
  const result = await ticketService.listStaffTickets(req.validated.query, req.user);
  page(res, result);
});

/**
 * @desc    Support dashboard metrics
 * @route   GET /api/admin/support/metrics
 * @access  Support staff
 */
exports.getMetrics = asyncHandler(async (req, res) => {
  const metrics = await ticketService.getMetrics(req.user);
  success(res, metrics);
});

/**
 * @desc    Capabilities of the signed-in staff member
 * @route   GET /api/admin/support/me
 * @access  Support staff
 *
 * The UI uses this to decide which controls to render. It is a convenience,
 * not a control: every mutating route re-checks the capability server-side, so
 * a client that renders a button it should not have still gets a 403.
 */
exports.getMyCapabilities = asyncHandler(async (req, res) => {
  success(res, {
    id: String(req.user._id),
    name: req.user.name,
    role: req.user.role,
    supportRole: req.user.supportRole || null,
    capabilities: resolveCapabilities(req.user),
  });
});

/**
 * @desc    Agents available for assignment
 * @route   GET /api/admin/support/agents
 * @access  Support staff
 */
exports.listAgents = asyncHandler(async (_req, res) => {
  const agents = await ticketService.listAgents();
  success(res, agents);
});

// ─── One ticket ──────────────────────────────────────────────────────────────

/**
 * @desc    Full ticket for the agent view
 * @route   GET /api/admin/support/tickets/:id
 * @access  Support staff
 */
exports.getTicket = asyncHandler(async (req, res) => {
  const ticket = await ticketService.getStaffTicket(req.validated.params.id);
  success(res, ticket);
});

/**
 * @desc    Conversation including internal notes
 * @route   GET /api/admin/support/tickets/:id/messages
 * @access  Support staff
 */
exports.listMessages = asyncHandler(async (req, res) => {
  const result = await messageService.listMessagesForStaff(req.validated.params.id, {
    ...req.validated.query,
    includeInternal: true,
  });
  page(res, result);
});

/**
 * @desc    Customer context panel
 * @route   GET /api/admin/support/tickets/:id/context
 * @access  Support staff (billing figures gated by VIEW_BILLING)
 */
exports.getTicketContext = asyncHandler(async (req, res) => {
  const context = await ticketService.getUserContext(req.validated.params.id, req.user);
  success(res, context);
});

/**
 * @desc    Staff action history for a ticket
 * @route   GET /api/admin/support/tickets/:id/audit
 * @access  Support staff
 */
exports.getAuditTrail = asyncHandler(async (req, res) => {
  const rows = await ticketService.listTicketAuditTrail(
    req.validated.params.id,
    req.validated.query
  );
  success(res, rows);
});

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * @desc    Reply to the customer, or add an internal note
 * @route   POST /api/admin/support/tickets/:id/messages
 * @access  Support staff
 */
exports.reply = asyncHandler(async (req, res) => {
  const { message, ticket, deduped } = await ticketService.replyAsAgent({
    staffUser: req.user,
    actorRole: req.supportActorRole,
    ticketId: req.validated.params.id,
    body: req.body.body,
    uploadedImages: req.uploadedImages || [],
    clientMessageId: req.body.clientMessageId,
    internal: Boolean(req.body.internal),
    nextStatus: req.body.nextStatus,
    requestId: req.requestId,
  });

  success(
    res,
    {
      message: serializeMessageForStaff(message),
      ticket: serializeTicketForStaff(ticket),
    },
    { statusCode: deduped ? 200 : 201 }
  );
});

/**
 * @desc    Assign, reassign, or unassign
 * @route   PATCH /api/admin/support/tickets/:id/assign
 * @access  Support staff (reassignment requires REASSIGN)
 */
exports.assign = asyncHandler(async (req, res) => {
  const { ticket, changed } = await ticketService.assignTicket({
    staffUser: req.user,
    actorRole: req.supportActorRole,
    ticketId: req.validated.params.id,
    assigneeId: req.body.assigneeId || null,
    expectedVersion: req.body.expectedVersion,
    requestId: req.requestId,
  });

  success(res, ticket, { message: changed ? "Assignment updated" : "No change" });
});

/**
 * @desc    Move the ticket through the workflow
 * @route   PATCH /api/admin/support/tickets/:id/status
 * @access  Support staff
 */
exports.changeStatus = asyncHandler(async (req, res) => {
  const { ticket, changed } = await ticketService.changeStatus({
    staffUser: req.user,
    actorRole: req.supportActorRole,
    ticketId: req.validated.params.id,
    status: req.body.status,
    resolutionSummary: req.body.resolutionSummary,
    expectedVersion: req.body.expectedVersion,
    requestId: req.requestId,
  });

  success(res, ticket, { message: changed ? "Status updated" : "No change" });
});

/**
 * @desc    Change priority
 * @route   PATCH /api/admin/support/tickets/:id/priority
 * @access  Support staff
 */
exports.changePriority = asyncHandler(async (req, res) => {
  const { ticket, changed } = await ticketService.changePriority({
    staffUser: req.user,
    actorRole: req.supportActorRole,
    ticketId: req.validated.params.id,
    priority: req.body.priority,
    expectedVersion: req.body.expectedVersion,
    requestId: req.requestId,
  });

  success(res, ticket, { message: changed ? "Priority updated" : "No change" });
});

/**
 * @desc    Replace the tag set
 * @route   PATCH /api/admin/support/tickets/:id/tags
 * @access  Support staff
 */
exports.updateTags = asyncHandler(async (req, res) => {
  const ticket = await ticketService.updateTags({
    staffUser: req.user,
    actorRole: req.supportActorRole,
    ticketId: req.validated.params.id,
    tags: req.body.tags,
    requestId: req.requestId,
  });

  success(res, ticket, { message: "Tags updated" });
});

/**
 * @desc    Fetch any attachment on any ticket
 * @route   GET /api/admin/support/attachments/:messageId/:index
 * @access  Support staff
 *
 * Separate from the customer endpoint on purpose. Staff may read attachments on
 * internal notes; customers may not. Two routes with two authorisation rules
 * beats one route with a branch, because there is no shared path where the
 * wrong branch can be taken.
 */
exports.getAttachment = asyncHandler(async (req, res) => {
  const { messageId, index } = req.validated.params;
  const record = await messageService.getAttachmentRecord(messageId, index);

  if (!record) {
    throw new ApiError(404, "Attachment not found", "NOT_FOUND");
  }

  const wantsDownload = Boolean(req.validated.query.download);
  const url = wantsDownload
    ? buildDownloadAttachmentUrl(
        record.attachment.publicId,
        formatFromMimeType(record.attachment.mimeType)
      )
    : buildInlineAttachmentUrl(record.attachment.publicId, { width: 1200 });

  res.redirect(302, url);
});

// ─── Knowledge base management ───────────────────────────────────────────────

exports.listArticles = asyncHandler(async (req, res) => {
  const result = await kbService.listArticlesForAdmin(req.validated.query);
  page(res, result);
});

exports.getArticle = asyncHandler(async (req, res) => {
  const article = await kbService.getArticleForAdmin(req.validated.params.id);
  success(res, article);
});

exports.createArticle = asyncHandler(async (req, res) => {
  const article = await kbService.createArticle({ author: req.user, body: req.body });
  success(res, article, { statusCode: 201, message: "Article created" });
});

exports.updateArticle = asyncHandler(async (req, res) => {
  const article = await kbService.updateArticle({
    id: req.validated.params.id,
    editor: req.user,
    body: req.body,
  });
  success(res, article, { message: "Article updated" });
});

exports.changeArticleStatus = asyncHandler(async (req, res) => {
  const article = await kbService.changeArticleStatus({
    id: req.validated.params.id,
    status: req.body.status,
    editor: req.user,
  });
  success(res, article, { message: `Article ${req.body.status}` });
});

exports.deleteArticle = asyncHandler(async (req, res) => {
  const result = await kbService.deleteArticle(req.validated.params.id);
  success(res, result, { message: "Article deleted" });
});

exports.getArticleFeedback = asyncHandler(async (req, res) => {
  const report = await kbService.getArticleFeedback(
    req.validated.params.id,
    req.validated.query
  );
  success(res, report);
});

// ─── Agent administration ────────────────────────────────────────────────────

/**
 * @desc    Grant or revoke support access
 * @route   PATCH /api/admin/support/agents/:userId
 * @access  Admin (MANAGE_AGENTS)
 */
exports.setAgentRole = asyncHandler(async (req, res) => {
  const { userId } = req.validated.params;
  const requested = req.body.supportRole;
  const supportRole = SUPPORT_ROLES.includes(requested) ? requested : null;

  const user = await User.findById(userId).select("name email role supportRole").lean();
  if (!user) throw new ApiError(404, "User not found", "NOT_FOUND");

  await User.updateOne({ _id: userId }, { $set: { supportRole } });

  // The auth cache serves a lean copy of the user for the duration of its TTL.
  // Without this, a revoked agent keeps their capabilities until it expires —
  // which is exactly the window an access revocation is supposed to close.
  await invalidateAuthCache(userId).catch(() => {});

  logger.info("SUPPORT_AGENT_ROLE_CHANGED", {
    targetUserId: String(userId),
    from: user.supportRole || null,
    to: supportRole,
    by: String(req.user._id),
    requestId: req.requestId,
  });

  success(
    res,
    { id: String(userId), name: user.name, email: user.email, supportRole },
    { message: supportRole ? `Granted ${supportRole} access` : "Support access revoked" }
  );
});
