const mongoose = require("mongoose");
const {
  SUPPORT_CATEGORY_VALUES,
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  TICKET_CHANNELS,
  TICKET_TAGS,
  MAX_TAGS_PER_TICKET,
  LIMITS,
} = require("../constants/support");

/**
 * A customer support case.
 *
 * The ticket is the durable record; the conversation lives in SupportMessage
 * as separate documents (see that model for why). Everything here is either
 * queue metadata, SLA timestamps, or state the workflow transitions depend on.
 */
const supportTicketSchema = new mongoose.Schema(
  {
    // Human-quotable identifier: "EC-4K2P9M". Customers read this out over
    // WhatsApp and put it in email subjects, so it has to be short, uppercase,
    // and unambiguous. Random rather than sequential so it leaks no volume
    // information and cannot be walked.
    ticketCode: {
      type: String,
      required: true,
      unique: true,
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Denormalised at creation so the agent queue can render and search by
    // email without populating every row, and so the record stays meaningful
    // if the account is later deleted mid-investigation.
    userEmail: { type: String, default: "", lowercase: true, trim: true },
    userName: { type: String, default: "", maxlength: 120 },

    subject: {
      type: String,
      required: true,
      trim: true,
      minlength: LIMITS.subjectMin,
      maxlength: LIMITS.subjectMax,
    },

    category: {
      type: String,
      enum: SUPPORT_CATEGORY_VALUES,
      required: true,
    },
    // Optional free-form refinement chosen by the user in the create form.
    // Deliberately not an enum — subcategories change far more often than
    // categories and are not used for routing.
    subcategory: { type: String, default: "", maxlength: 100 },

    priority: {
      type: String,
      enum: TICKET_PRIORITIES,
      default: "normal",
    },

    status: {
      type: String,
      enum: TICKET_STATUSES,
      default: "open",
    },

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    assignedAt: { type: Date, default: null },

    tags: {
      type: [String],
      default: [],
      validate: [
        {
          validator: (arr) => arr.length <= MAX_TAGS_PER_TICKET,
          message: `tags cannot exceed ${MAX_TAGS_PER_TICKET} items`,
        },
        {
          validator: (arr) => arr.every((tag) => TICKET_TAGS.includes(tag)),
          message: "tags must come from the supported tag list",
        },
      ],
    },

    // Where the conversation started. Only "portal" is produced today; the
    // others exist so an inbound email or WhatsApp integration can attach to a
    // ticket later without a migration.
    channel: {
      type: String,
      enum: TICKET_CHANNELS,
      default: "portal",
    },

    // Client environment, captured once at creation. Same sanitised shape the
    // issue reporter already collects — enough to reproduce a bug, nothing
    // that identifies a device beyond what the user agent already reveals.
    source: {
      platform: { type: String, default: "unknown", maxlength: 20 },
      appVersion: { type: String, default: "", maxlength: 30 },
      marketType: { type: String, default: "Unknown", maxlength: 30 },
    },

    // A ticket can reference the structured bug report that triggered it.
    // IssueReport stays the telemetry record (OCR snapshots, device info, fix
    // version); the ticket is the conversation about it.
    linkedIssue: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "IssueReport",
      default: null,
    },

    // ── SLA / activity timestamps ───────────────────────────────────────────
    // firstResponseAt is set exactly once, by the first PUBLIC agent reply. An
    // internal note is not a response to the customer and must not stop the
    // clock — that is the single most commonly faked support metric.
    firstResponseAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    lastActivityAt: { type: Date, default: Date.now },
    lastUserReplyAt: { type: Date, default: null },
    lastAgentReplyAt: { type: Date, default: null },

    messageCount: { type: Number, default: 0, min: 0 },
    reopenCount: { type: Number, default: 0, min: 0 },

    resolution: {
      summary: { type: String, default: "", maxlength: LIMITS.resolutionMax },
      resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    },

    satisfaction: {
      rating: { type: Number, default: null, min: 1, max: 5 },
      comment: { type: String, default: "", maxlength: LIMITS.satisfactionCommentMax },
      submittedAt: { type: Date, default: null },
    },

    // Optimistic-concurrency guard. Every staff mutation matches on the
    // version it read and increments it, so two agents editing the same ticket
    // from stale views cannot silently overwrite each other.
    version: { type: Number, default: 0, min: 0 },

    // Idempotency key for creation. A retried POST (mobile network drop, user
    // double-tap) returns the original ticket instead of opening a second one.
    clientRequestId: { type: String, default: null },
  },
  { timestamps: true }
);

// ── Indexes ──────────────────────────────────────────────────────────────────
// Each one is tied to a specific query in supportTicket.service; nothing here
// is speculative.

// "My tickets", newest first.
supportTicketSchema.index({ user: 1, createdAt: -1 });
// Duplicate detection on create + the "you already have an open ticket" prompt.
supportTicketSchema.index({ user: 1, status: 1, createdAt: -1 });
// Agent queue default sort (All / Waiting on User / Resolved tabs).
supportTicketSchema.index({ status: 1, lastActivityAt: -1 });
// "My Tickets" tab for an agent.
supportTicketSchema.index({ assignedTo: 1, status: 1, lastActivityAt: -1 });
// Unassigned queue. Partial index — it only ever answers "assignedTo is null",
// so indexing the assigned rows too would be pure write cost.
supportTicketSchema.index(
  { createdAt: -1 },
  {
    name: "unassigned_queue",
    partialFilterExpression: { assignedTo: null },
  }
);
// Triage by urgency.
supportTicketSchema.index({ priority: 1, status: 1, lastActivityAt: -1 });
// Category breakdown + category-filtered queue.
supportTicketSchema.index({ category: 1, status: 1, createdAt: -1 });
// Auto-close cron: find resolved tickets past the reopen window.
supportTicketSchema.index(
  { resolvedAt: 1 },
  { name: "auto_close_sweep", partialFilterExpression: { status: "resolved" } }
);
// Agent free-text search across the two fields worth matching. Message bodies
// are searched separately against SupportMessage so a private internal note
// can never surface a ticket to someone who should not see it.
supportTicketSchema.index(
  { subject: "text", ticketCode: "text" },
  { name: "ticket_search", weights: { ticketCode: 10, subject: 5 } }
);
// Idempotent creation. Sparse + unique per user: two different customers may
// legitimately send the same generated id, one customer may not.
supportTicketSchema.index(
  { user: 1, clientRequestId: 1 },
  {
    unique: true,
    partialFilterExpression: { clientRequestId: { $type: "string" } },
  }
);

module.exports = mongoose.model("SupportTicket", supportTicketSchema);
