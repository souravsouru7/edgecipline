const mongoose = require("mongoose");

/**
 * Immutable record of staff actions on a ticket.
 *
 * Answers "who changed this, when, from what, to what" — the questions that
 * come up in a billing dispute or a complaint about how a case was handled.
 * The conversation itself is in SupportMessage; this is the metadata trail.
 *
 * What is deliberately NOT here: message bodies, internal-note text, customer
 * personal data, tokens, payment identifiers. An audit log that accumulates
 * sensitive content becomes the thing you have to protect hardest.
 */
const supportAuditLogSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportTicket",
      required: true,
    },
    // The CUSTOMER the ticket belongs to, not the staff member acting.
    // Present so that deleting an account removes their whole support trail:
    // once the ticket and its messages are gone, staff actions on them have
    // nothing left to explain. accountDeletionService purges on this field.
    ticketUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Snapshot so the trail stays readable after a staff account is removed.
    actorName: { type: String, default: "", maxlength: 120 },
    actorRole: {
      type: String,
      enum: ["user", "agent", "lead", "admin", "system"],
      default: "system",
    },

    action: {
      type: String,
      required: true,
      maxlength: 60,
    },
    // Short scalar descriptions only — "open" -> "resolved", "normal" -> "high",
    // an agent name. Never a document, never free text from the customer.
    from: { type: String, default: "", maxlength: 200 },
    to: { type: String, default: "", maxlength: 200 },

    // Correlates an audit row with the request that produced it, so a support
    // action can be traced to its API log line.
    requestId: { type: String, default: "", maxlength: 100 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Ticket history panel, newest first.
supportAuditLogSchema.index({ ticket: 1, createdAt: -1 });
// "What did this agent do" review.
supportAuditLogSchema.index({ actor: 1, createdAt: -1 });
// Account-deletion purge.
supportAuditLogSchema.index({ ticketUser: 1 });

module.exports = mongoose.model("SupportAuditLog", supportAuditLogSchema);
