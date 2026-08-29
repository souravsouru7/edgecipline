const mongoose = require("mongoose");
const {
  MESSAGE_TYPES,
  MESSAGE_VISIBILITY,
  MESSAGE_AUTHOR_ROLES,
  SYSTEM_EVENT_ACTIONS,
  LIMITS,
} = require("../constants/support");

/**
 * One entry in a ticket conversation.
 *
 * Deliberately a separate collection rather than a subdocument array on
 * SupportTicket. Three reasons, all of them load-bearing:
 *
 *   1. Concurrency. A customer replying at the same moment an agent replies
 *      are two independent inserts. As subdocuments they would be two
 *      read-modify-write cycles on the same parent, and one reply would be
 *      silently lost.
 *   2. Size. A long-running billing dispute can run to hundreds of messages
 *      with attachments; a 16 MB document ceiling is not a theoretical limit.
 *   3. Pagination. Loading a ticket must not mean loading every message ever
 *      written on it.
 */

// Attachments store the Cloudinary publicId, NOT a delivery URL.
//
// Every other upload in this app lands on a public `secure_url`. That is fine
// for a user's own trade screenshot, and wrong here: a support attachment is
// another customer's private data, and a public URL stays readable forever by
// anyone it leaks to — an email forward, a log line, a screenshot of devtools.
// These are uploaded with Cloudinary delivery type "authenticated" and served
// only through GET /api/support/attachments/:messageId/:index, which checks
// authorisation and then issues a short-lived signed URL.
const attachmentSchema = new mongoose.Schema(
  {
    publicId: { type: String, required: true },
    originalName: { type: String, default: "", maxlength: 255 },
    mimeType: { type: String, default: "", maxlength: 100 },
    bytes: { type: Number, default: 0, min: 0 },
    width: { type: Number, default: 0, min: 0 },
    height: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const supportMessageSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportTicket",
      required: true,
    },
    // Denormalised so an agent search over message bodies can filter by owner
    // without a join, and so ownership checks never depend on the ticket being
    // loadable.
    ticketUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // null for system events — nobody authored "status changed to resolved".
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    authorRole: {
      type: String,
      enum: MESSAGE_AUTHOR_ROLES,
      required: true,
    },
    // Snapshot of the display name at write time. An agent who later leaves
    // must not turn every reply they wrote into "Unknown", and the customer
    // should never see the agent's email address.
    authorName: { type: String, default: "", maxlength: 120 },

    type: {
      type: String,
      enum: MESSAGE_TYPES,
      default: "message",
    },

    /**
     * The security boundary of this entire feature.
     *
     * Internal notes are filtered out in the Mongo QUERY, not by a serializer
     * and not by a boolean flag threaded through a shared function. The
     * customer-facing service literally cannot receive an internal note,
     * because it never asks for one. That means a mistake in a response
     * shape, an email template, or a log statement cannot leak one.
     */
    visibility: {
      type: String,
      enum: MESSAGE_VISIBILITY,
      default: "public",
    },

    body: {
      type: String,
      required: true,
      trim: true,
      minlength: LIMITS.messageMin,
      maxlength: LIMITS.messageMax,
    },

    attachments: {
      type: [attachmentSchema],
      default: [],
      validate: {
        validator: (arr) => arr.length <= 10,
        message: "attachments cannot exceed 10 items",
      },
    },

    // Structured payload for type === "system_event", so the UI can render
    // "Priority changed from normal to high" without parsing prose.
    systemEvent: {
      action: { type: String, enum: SYSTEM_EVENT_ACTIONS, default: undefined },
      from: { type: String, default: "" },
      to: { type: String, default: "" },
    },

    // Retry safety. A reply that times out on a flaky mobile connection gets
    // resent by the client with the same id; the unique index below turns the
    // duplicate into a no-op instead of a double post.
    clientMessageId: { type: String, default: null },
  },
  { timestamps: true }
);

// ── Indexes ──────────────────────────────────────────────────────────────────

// Thread pagination, oldest-first. _id breaks ties so the cursor is stable
// when two messages share a millisecond.
supportMessageSchema.index({ ticket: 1, createdAt: 1, _id: 1 });
// The customer-facing thread read: public messages on one ticket.
supportMessageSchema.index({ ticket: 1, visibility: 1, createdAt: 1 });
// Idempotent replies. Scoped to (ticket, author) so two people on the same
// ticket cannot collide, and sparse so the overwhelming majority of rows that
// carry no client id cost nothing.
supportMessageSchema.index(
  { ticket: 1, author: 1, clientMessageId: 1 },
  {
    unique: true,
    partialFilterExpression: { clientMessageId: { $type: "string" } },
  }
);
// Agent-side message search. Partial on public+internal is pointless — agents
// may search both — but scoping the text index to bodies keeps it small.
supportMessageSchema.index({ body: "text" }, { name: "message_search" });

module.exports = mongoose.model("SupportMessage", supportMessageSchema);
