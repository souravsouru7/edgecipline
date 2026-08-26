const mongoose = require("mongoose");

const MESSAGE_ROLES = ["user", "assistant", "system"];
const MESSAGE_STATUS = ["pending", "streaming", "complete", "error"];

// A single chat turn. We persist both sides of the conversation so the next
// request can reconstruct context, and so the user can revisit threads.
//
// `contextDigest` stores the keys that fed the model on this turn (trade
// count, snapshot version, etc.) — not the raw context — so we can debug
// "why did the AI say X" without bloating the collection.
const coachMessageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CoachConversation",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    role: {
      type: String,
      enum: MESSAGE_ROLES,
      required: true,
    },

    content: {
      type: String,
      default: "",
      maxlength: 16_000,
    },

    status: {
      type: String,
      enum: MESSAGE_STATUS,
      default: "complete",
    },
    error: {
      type: String,
      default: "",
    },

    model: { type: String, default: "" },
    tokensIn:  { type: Number, default: 0 },
    tokensOut: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    streamed:  { type: Boolean, default: false },

    contextDigest: {
      contextVersion: { type: String, default: "" },
      tradeCount:     { type: Number, default: 0 },
      reflectionDays: { type: Number, default: 0 },
      hasWeeklyReport:{ type: Boolean, default: false },
      market:         { type: String, default: "" },
      sourceHash:     { type: String, default: "" }, // sha1 of the snapshot JSON we sent
    },
  },
  { timestamps: true }
);

coachMessageSchema.index({ conversation: 1, createdAt: 1, _id: 1 });
coachMessageSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("CoachMessage", coachMessageSchema);
module.exports.MESSAGE_ROLES = MESSAGE_ROLES;
module.exports.MESSAGE_STATUS = MESSAGE_STATUS;
