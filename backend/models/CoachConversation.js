const mongoose = require("mongoose");

// A coaching thread. A conversation is anchored to *zero or one* upstream
// objects so the AI knows where the user came from — an insight from the AI
// Coach Feed, a specific trade, a reflection, a weekly report, or a free-form
// chat with no anchor.
//
// Anchor stays light on purpose: { kind, refId?, label }. We don't try to
// shape the upstream snapshot here — coachContextService rebuilds it at chat
// time using the latest data.
const ANCHOR_KINDS = ["insight", "trade", "reflection", "weekly-report", "dashboard", "freeform"];

const coachConversationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    title: {
      type: String,
      default: "",
      maxlength: 200,
    },

    anchor: {
      kind:  { type: String, enum: ANCHOR_KINDS, default: "freeform" },
      refId: { type: String, default: "" },
      label: { type: String, default: "", maxlength: 200 },
    },

    market: {
      type: String,
      enum: ["Forex", "Indian_Market", "any"],
      default: "any",
    },

    // Denormalised counters for the conversation list view; avoid a
    // countDocuments per row at list time.
    messageCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: null },
    lastMessagePreview: { type: String, default: "", maxlength: 280 },

    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

coachConversationSchema.index({ user: 1, deletedAt: 1, lastMessageAt: -1, _id: -1 });

module.exports = mongoose.model("CoachConversation", coachConversationSchema);
module.exports.ANCHOR_KINDS = ANCHOR_KINDS;
