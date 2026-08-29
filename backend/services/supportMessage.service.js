"use strict";

const mongoose = require("mongoose");
const SupportTicket = require("../models/SupportTicket");
const SupportMessage = require("../models/SupportMessage");
const ApiError = require("../utils/ApiError");
const { logger } = require("../utils/logger");
const { buildPagination } = require("../utils/apiResponse");
const { destroySupportAttachments } = require("../utils/supportAttachments");
const {
  serializeMessageForUser,
  serializeMessageForStaff,
} = require("../utils/supportSerializers");

/**
 * The conversation layer.
 *
 * Messages are appended as independent documents and the ticket is updated
 * with atomic operators only — never read-modify-write. That is what makes the
 * "user and agent reply at the same instant" case safe: two inserts into
 * different documents cannot collide, and the counter bumps are `$inc`/`$max`,
 * which commute.
 */

const MAX_MESSAGE_PAGE = 50;
const DEFAULT_MESSAGE_PAGE = 30;

function toObjectId(value) {
  return value instanceof mongoose.Types.ObjectId
    ? value
    : new mongoose.Types.ObjectId(String(value));
}

/**
 * Reject a message that is empty once trimmed.
 *
 * A body of "   \n\n  " passes a naive `if (!body)` check, saves a blank
 * bubble into a customer's conversation, fires a push notification that says
 * nothing, and looks to the customer like the agent sent them an empty reply.
 */
function normalizeBody(raw, { max = 10000 } = {}) {
  const body = String(raw ?? "").trim();
  if (!body) {
    throw new ApiError(400, "Message cannot be empty", "VALIDATION_ERROR");
  }
  if (body.length > max) {
    throw new ApiError(
      400,
      `Message is too long (${body.length} characters). The limit is ${max}.`,
      "VALIDATION_ERROR"
    );
  }
  return body;
}

function mapUploadsToAttachments(uploadedImages = []) {
  return uploadedImages.map((image) => ({
    publicId: image.publicId,
    originalName: image.originalName || "",
    mimeType: image.mimeType || "",
    bytes: image.bytes || 0,
    width: image.width || 0,
    height: image.height || 0,
  }));
}

/**
 * Append a message and move the ticket's activity clocks forward.
 *
 * @param {object} params
 * @param {object} params.ticket        Ticket document/lean object.
 * @param {object|null} params.author   The writer; null for system events.
 * @param {"user"|"agent"|"system"} params.authorRole
 * @param {"message"|"internal_note"|"system_event"} [params.type]
 * @param {string} params.body
 * @param {Array}  [params.uploadedImages] From the upload middleware.
 * @param {string} [params.clientMessageId] Idempotency key from the client.
 */
async function appendMessage({
  ticket,
  author = null,
  authorRole,
  type = "message",
  body,
  uploadedImages = [],
  clientMessageId = null,
  systemEvent = null,
}) {
  const ticketId = toObjectId(ticket._id);
  // Internal notes are the only message type staff can write that the customer
  // never sees. Visibility is derived from the type rather than accepted from
  // the caller, so a request body cannot ask for a "public internal note".
  const visibility = type === "internal_note" ? "internal" : "public";
  const normalizedBody = normalizeBody(body);
  const attachments = mapUploadsToAttachments(uploadedImages);

  let message;
  try {
    message = await SupportMessage.create({
      ticket: ticketId,
      ticketUser: toObjectId(ticket.user),
      author: author?._id ? toObjectId(author._id) : null,
      authorRole,
      authorName: author?.name || (authorRole === "system" ? "System" : ""),
      type,
      visibility,
      body: normalizedBody,
      attachments,
      ...(systemEvent ? { systemEvent } : {}),
      clientMessageId: clientMessageId || null,
    });
  } catch (error) {
    // Duplicate clientMessageId — the client retried after a timeout that the
    // server had actually processed. Return the message it already wrote
    // instead of posting the same reply twice.
    if (error?.code === 11000 && clientMessageId) {
      const existing = await SupportMessage.findOne({
        ticket: ticketId,
        author: author?._id ? toObjectId(author._id) : null,
        clientMessageId,
      });

      if (existing) {
        // The retry uploaded its attachments again before reaching this point.
        // They are now orphaned, because the stored message points at the
        // first attempt's copies.
        await destroySupportAttachments(attachments);
        logger.info("SUPPORT_MESSAGE_DEDUPED", {
          ticketCode: ticket.ticketCode,
          messageId: String(existing._id),
        });
        return { message: existing, deduped: true };
      }
    }

    await destroySupportAttachments(attachments);
    throw error;
  }

  // Ticket bookkeeping, entirely with atomic operators.
  //
  // `$max` on lastActivityAt rather than `$set`: if a user reply and an agent
  // reply land microseconds apart in either order, the ticket must end up
  // holding the LATER timestamp. `$set` would let the slower writer stamp an
  // older time over a newer one.
  const now = new Date();
  const update = {
    $inc: { messageCount: 1 },
    $max: { lastActivityAt: now },
  };

  if (authorRole === "user") {
    update.$max.lastUserReplyAt = now;
  } else if (authorRole === "agent" && visibility === "public") {
    update.$max.lastAgentReplyAt = now;
  }

  await SupportTicket.updateOne({ _id: ticketId }, update);

  // First-response SLA. Set exactly once, and only by a PUBLIC agent reply —
  // an internal note is not a response to the customer, and letting one stop
  // the clock is the single most commonly fudged support metric. The
  // `firstResponseAt: null` predicate makes this idempotent under concurrency.
  if (authorRole === "agent" && visibility === "public") {
    await SupportTicket.updateOne(
      { _id: ticketId, firstResponseAt: null },
      { $set: { firstResponseAt: now } }
    );
  }

  return { message, deduped: false };
}

/**
 * Record a status/assignment/priority change as a visible timeline entry.
 *
 * Internal so it never notifies and never counts toward the SLA clocks; it is
 * rendered inline in the thread so the conversation reads as a history rather
 * than a set of disconnected replies.
 */
async function recordSystemEvent({ ticket, action, from = "", to = "", actorName = "", visibility = "public" }) {
  try {
    const label = {
      status_changed: `Status changed from ${from} to ${to}`,
      priority_changed: `Priority changed from ${from} to ${to}`,
      assigned: `Assigned to ${to}`,
      unassigned: "Returned to the unassigned queue",
      reassigned: `Reassigned from ${from} to ${to}`,
      reopened: "Ticket reopened",
      tags_changed: "Tags updated",
      created: "Ticket created",
    }[action] || action;

    return await SupportMessage.create({
      ticket: toObjectId(ticket._id),
      ticketUser: toObjectId(ticket.user),
      author: null,
      authorRole: "system",
      authorName: actorName || "System",
      type: "system_event",
      // Assignment moves are staff bookkeeping — the customer sees "someone is
      // on this", not the internal handoffs. Status changes are public.
      visibility,
      body: label,
      systemEvent: { action, from: String(from || ""), to: String(to || "") },
    });
  } catch (error) {
    // A missing timeline entry is cosmetic. It must never fail the state
    // change that produced it.
    logger.warn("SUPPORT_SYSTEM_EVENT_FAILED", {
      ticketCode: ticket?.ticketCode,
      action,
      error: error.message,
    });
    return null;
  }
}

/**
 * Customer-facing thread.
 *
 * The `visibility: "public"` filter lives in the QUERY. An internal note is
 * never loaded, so no downstream mistake — a changed response shape, a stray
 * log line, an email template — can leak one.
 */
async function listMessagesForUser(ticketId, { page = 1, limit = DEFAULT_MESSAGE_PAGE } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_MESSAGE_PAGE, 1), MAX_MESSAGE_PAGE);
  const safePage = Math.max(Number(page) || 1, 1);
  const filter = { ticket: toObjectId(ticketId), visibility: "public" };

  const [items, total] = await Promise.all([
    SupportMessage.find(filter)
      .sort({ createdAt: 1, _id: 1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    SupportMessage.countDocuments(filter),
  ]);

  return {
    items: items.map(serializeMessageForUser).filter(Boolean),
    pagination: buildPagination({ page: safePage, limit: safeLimit, total }),
  };
}

async function listMessagesForStaff(ticketId, { page = 1, limit = DEFAULT_MESSAGE_PAGE, includeInternal = true } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_MESSAGE_PAGE, 1), MAX_MESSAGE_PAGE);
  const safePage = Math.max(Number(page) || 1, 1);
  const filter = { ticket: toObjectId(ticketId) };
  if (!includeInternal) filter.visibility = "public";

  const [items, total] = await Promise.all([
    SupportMessage.find(filter)
      .sort({ createdAt: 1, _id: 1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    SupportMessage.countDocuments(filter),
  ]);

  return {
    items: items.map(serializeMessageForStaff),
    pagination: buildPagination({ page: safePage, limit: safeLimit, total }),
  };
}

/**
 * Most recent public agent reply on a ticket.
 *
 * Notification callers use this rather than the message they just wrote, so
 * the body that reaches a push notification or an email is one the database
 * confirms is public.
 */
async function getLatestPublicAgentMessage(ticketId) {
  return SupportMessage.findOne({
    ticket: toObjectId(ticketId),
    visibility: "public",
    authorRole: "agent",
    type: "message",
  })
    .sort({ createdAt: -1 })
    .lean();
}

/**
 * Load one attachment for the download endpoint.
 *
 * Returns the raw subdocument plus the owning ticket id so the caller can run
 * its authorisation check. This function performs NO authorisation of its own —
 * that is the controller's job, and keeping it there means there is exactly one
 * place to audit.
 */
async function getAttachmentRecord(messageId, index) {
  const message = await SupportMessage.findById(messageId)
    .select("ticket ticketUser visibility attachments")
    .lean();

  if (!message) return null;

  const attachment = message.attachments?.[Number(index)];
  if (!attachment) return null;

  return { message, attachment };
}

module.exports = {
  appendMessage,
  recordSystemEvent,
  listMessagesForUser,
  listMessagesForStaff,
  getLatestPublicAgentMessage,
  getAttachmentRecord,
  normalizeBody,
  mapUploadsToAttachments,
  MAX_MESSAGE_PAGE,
  DEFAULT_MESSAGE_PAGE,
};
