"use strict";

const { serializeAttachment } = require("./supportAttachments");
const {
  SUPPORT_CATEGORIES,
  TICKET_STATUS_LABELS,
  REOPEN_WINDOW_DAYS,
} = require("../constants/support");

/**
 * Response shaping for support payloads.
 *
 * There are deliberately TWO serializers per resource — one for the customer,
 * one for staff — instead of one function with an `isStaff` flag. A flag is a
 * single boolean standing between a customer and another person's internal
 * commentary, and every future edit to a shared function is a chance to get it
 * backwards. Separate functions cannot leak by omission: the customer
 * serializer has no code path that reads an internal note or an agent's email,
 * because those fields are never referenced in it.
 */

const CATEGORY_LABELS = SUPPORT_CATEGORIES.reduce(
  (acc, item) => ({ ...acc, [item.value]: item.label }),
  {}
);

function categoryLabel(value) {
  return CATEGORY_LABELS[value] || "Other";
}

/**
 * Can the customer still reopen this? Computed server-side so the button and
 * the API agree — a UI that offers "Reopen" on a ticket the server will refuse
 * is worse than no button at all.
 */
function canUserReopen(ticket) {
  if (!ticket || ticket.status !== "resolved" || !ticket.resolvedAt) return false;
  const deadline = new Date(ticket.resolvedAt).getTime() + REOPEN_WINDOW_DAYS * 86400000;
  return Date.now() < deadline;
}

// ─── Tickets ─────────────────────────────────────────────────────────────────

function serializeTicketForUser(ticket) {
  if (!ticket) return null;

  return {
    id: String(ticket._id),
    ticketCode: ticket.ticketCode,
    subject: ticket.subject,
    category: ticket.category,
    categoryLabel: categoryLabel(ticket.category),
    subcategory: ticket.subcategory || "",
    priority: ticket.priority,
    status: ticket.status,
    statusLabel: TICKET_STATUS_LABELS[ticket.status] || ticket.status,
    channel: ticket.channel,
    messageCount: ticket.messageCount || 0,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    lastActivityAt: ticket.lastActivityAt,
    resolvedAt: ticket.resolvedAt || null,
    closedAt: ticket.closedAt || null,
    // The customer sees THAT someone is handling it, never who. Exposing agent
    // identities invites customers to chase individuals off-channel, and an
    // agent's name is staff data, not the customer's.
    isAssigned: Boolean(ticket.assignedTo),
    resolution: ticket.resolution?.summary || "",
    satisfaction: ticket.satisfaction?.rating
      ? {
          rating: ticket.satisfaction.rating,
          submittedAt: ticket.satisfaction.submittedAt,
        }
      : null,
    canReopen: canUserReopen(ticket),
    canReply: ticket.status !== "closed",
    canRate: ticket.status === "resolved" && !ticket.satisfaction?.rating,
    // Absent on purpose: tags, internal notes, assignedTo, source, version,
    // linkedIssue, firstResponseAt. All of those are queue metadata.
  };
}

function serializeTicketForStaff(ticket) {
  if (!ticket) return null;

  // `assignedTo` may be a raw id or a populated document depending on the query.
  const assignee =
    ticket.assignedTo && typeof ticket.assignedTo === "object"
      ? {
          id: String(ticket.assignedTo._id),
          name: ticket.assignedTo.name || "",
          supportRole: ticket.assignedTo.supportRole || null,
          // A disabled assignee should show as unassigned work in the queue
          // rather than silently sitting in someone's bucket forever.
          active: !ticket.assignedTo.accountStatus || ticket.assignedTo.accountStatus === "active",
        }
      : ticket.assignedTo
        ? { id: String(ticket.assignedTo), name: "", supportRole: null, active: true }
        : null;

  const owner =
    ticket.user && typeof ticket.user === "object" && ticket.user._id
      ? { id: String(ticket.user._id), name: ticket.user.name || "", email: ticket.user.email || "" }
      : { id: String(ticket.user || ""), name: ticket.userName || "", email: ticket.userEmail || "" };

  return {
    id: String(ticket._id),
    ticketCode: ticket.ticketCode,
    subject: ticket.subject,
    category: ticket.category,
    categoryLabel: categoryLabel(ticket.category),
    subcategory: ticket.subcategory || "",
    priority: ticket.priority,
    status: ticket.status,
    statusLabel: TICKET_STATUS_LABELS[ticket.status] || ticket.status,
    channel: ticket.channel,
    tags: ticket.tags || [],
    user: owner,
    assignee,
    assignedAt: ticket.assignedAt || null,
    source: ticket.source || null,
    linkedIssue: ticket.linkedIssue ? String(ticket.linkedIssue) : null,
    messageCount: ticket.messageCount || 0,
    reopenCount: ticket.reopenCount || 0,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    lastActivityAt: ticket.lastActivityAt,
    lastUserReplyAt: ticket.lastUserReplyAt || null,
    lastAgentReplyAt: ticket.lastAgentReplyAt || null,
    firstResponseAt: ticket.firstResponseAt || null,
    resolvedAt: ticket.resolvedAt || null,
    closedAt: ticket.closedAt || null,
    resolution: {
      summary: ticket.resolution?.summary || "",
      resolvedBy: ticket.resolution?.resolvedBy ? String(ticket.resolution.resolvedBy) : null,
    },
    satisfaction: ticket.satisfaction?.rating
      ? {
          rating: ticket.satisfaction.rating,
          comment: ticket.satisfaction.comment || "",
          submittedAt: ticket.satisfaction.submittedAt,
        }
      : null,
    // Needed by the client so a staff mutation can be sent with the version it
    // was read at, and rejected if someone else moved first.
    version: ticket.version || 0,
  };
}

// ─── Messages ────────────────────────────────────────────────────────────────

/**
 * Customer-facing message.
 *
 * This function assumes it is only ever handed PUBLIC messages, because the
 * query that produced them filtered on `visibility: "public"`. It nonetheless
 * refuses to emit an internal one — belt and braces on the single field where
 * a mistake is unrecoverable, since an internal note reaching a customer
 * cannot be un-sent.
 */
function serializeMessageForUser(message) {
  if (!message) return null;
  if (message.visibility === "internal" || message.type === "internal_note") return null;

  return {
    id: String(message._id),
    type: message.type,
    // The customer sees "You" or "Support" — never an agent's real name or
    // email. Individual agents are not the customer's counterparty; the
    // support team is.
    author: message.authorRole === "user" ? "you" : message.authorRole === "system" ? "system" : "support",
    body: message.body,
    attachments: (message.attachments || []).map((a, i) => ({
      ...serializeAttachment(a, i),
      messageId: String(message._id),
    })),
    systemEvent: message.type === "system_event" ? message.systemEvent || null : null,
    createdAt: message.createdAt,
  };
}

function serializeMessageForStaff(message) {
  if (!message) return null;

  return {
    id: String(message._id),
    type: message.type,
    visibility: message.visibility,
    authorRole: message.authorRole,
    authorName: message.authorName || "",
    authorId: message.author ? String(message.author) : null,
    body: message.body,
    attachments: (message.attachments || []).map((a, i) => ({
      ...serializeAttachment(a, i),
      messageId: String(message._id),
    })),
    systemEvent: message.type === "system_event" ? message.systemEvent || null : null,
    createdAt: message.createdAt,
  };
}

// ─── Knowledge base ──────────────────────────────────────────────────────────

function serializeArticleSummary(article) {
  if (!article) return null;
  return {
    slug: article.slug,
    title: article.title,
    excerpt: article.excerpt || "",
    category: article.category,
    categoryLabel: categoryLabel(article.category),
    tags: article.tags || [],
    helpfulCount: article.helpfulCount || 0,
    updatedAt: article.updatedAt,
  };
}

function serializeArticleDetail(article, { related = [] } = {}) {
  if (!article) return null;
  return {
    ...serializeArticleSummary(article),
    bodyMarkdown: article.bodyMarkdown,
    notHelpfulCount: article.notHelpfulCount || 0,
    viewCount: article.viewCount || 0,
    publishedAt: article.publishedAt,
    related: related.map(serializeArticleSummary),
  };
}

function serializeArticleForAdmin(article) {
  if (!article) return null;
  return {
    id: String(article._id),
    ...serializeArticleSummary(article),
    bodyMarkdown: article.bodyMarkdown,
    status: article.status,
    order: article.order || 0,
    relatedSlugs: article.relatedSlugs || [],
    viewCount: article.viewCount || 0,
    notHelpfulCount: article.notHelpfulCount || 0,
    publishedAt: article.publishedAt,
    createdAt: article.createdAt,
  };
}

module.exports = {
  categoryLabel,
  canUserReopen,
  serializeTicketForUser,
  serializeTicketForStaff,
  serializeMessageForUser,
  serializeMessageForStaff,
  serializeArticleSummary,
  serializeArticleDetail,
  serializeArticleForAdmin,
};
