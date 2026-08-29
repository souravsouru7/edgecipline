const mongoose = require("mongoose");
const { LIMITS } = require("../constants/support");

/**
 * One "was this helpful?" vote on a knowledge-base article.
 *
 * Stored as rows rather than just incrementing counters on the article,
 * because the requirement is "an article cannot be marked helpful repeatedly"
 * and the only reliable way to enforce that is a unique index. Counters on the
 * article are a denormalised cache maintained alongside these rows.
 *
 * The Help Center is public, so a vote may arrive with no session. Anonymous
 * votes are keyed on a salted hash of IP + user-agent: enough to stop a
 * refresh loop inflating a count, not enough to identify anybody, and never
 * reversible to an IP address.
 */
const articleFeedbackSchema = new mongoose.Schema(
  {
    article: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "KnowledgeBaseArticle",
      required: true,
    },
    // Null for anonymous visitors — the Help Center does not require login.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Salted SHA-256 of IP + user-agent, truncated. Only ever compared for
    // equality; never logged, never returned by an API.
    fingerprint: {
      type: String,
      default: null,
      maxlength: 64,
    },
    helpful: {
      type: Boolean,
      required: true,
    },
    // Optional free text shown only when the answer is "no" — the moment a
    // reader tells you why an article failed is the most useful signal the
    // knowledge base ever gets.
    comment: {
      type: String,
      default: "",
      trim: true,
      maxlength: LIMITS.feedbackCommentMax,
    },
  },
  { timestamps: true }
);

// One vote per signed-in reader per article. Partial rather than sparse so the
// anonymous rows (user: null) do not all collide with each other.
articleFeedbackSchema.index(
  { article: 1, user: 1 },
  {
    unique: true,
    name: "one_vote_per_user",
    partialFilterExpression: { user: { $type: "objectId" } },
  }
);

// One vote per anonymous visitor per article.
articleFeedbackSchema.index(
  { article: 1, fingerprint: 1 },
  {
    unique: true,
    name: "one_vote_per_fingerprint",
    partialFilterExpression: { fingerprint: { $type: "string" } },
  }
);

// Admin "article usefulness" view.
articleFeedbackSchema.index({ article: 1, helpful: 1, createdAt: -1 });

module.exports = mongoose.model("ArticleFeedback", articleFeedbackSchema);
