const mongoose = require("mongoose");
const {
  SUPPORT_CATEGORY_VALUES,
  ARTICLE_STATUSES,
  LIMITS,
} = require("../constants/support");

/**
 * A help-centre article.
 *
 * Shares its category vocabulary with SupportTicket on purpose: the whole
 * point of the knowledge base is to deflect tickets, so "articles in the
 * category this customer is about to file under" has to be a single lookup.
 */
const knowledgeBaseArticleSchema = new mongoose.Schema(
  {
    // URL identity. The reader is /support/article?slug=..., so this is what
    // gets shared, bookmarked and linked from other articles — it must be
    // stable once published.
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: LIMITS.articleSlugMax,
      match: [/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase kebab-case"],
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: LIMITS.articleTitleMax,
    },

    // Shown in search results and category listings. Kept separate from the
    // body so a listing never has to load or truncate 50 KB of markdown.
    excerpt: {
      type: String,
      default: "",
      trim: true,
      maxlength: LIMITS.articleExcerptMax,
    },

    // Markdown, rendered through a strict sanitising allowlist on the client.
    // Never injected as raw HTML — see supportMarkdown on the frontend.
    bodyMarkdown: {
      type: String,
      required: true,
      maxlength: LIMITS.articleBodyMax,
    },

    category: {
      type: String,
      enum: SUPPORT_CATEGORY_VALUES,
      required: true,
    },

    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (arr) => arr.length <= 10 && arr.every((t) => typeof t === "string" && t.length <= 40),
        message: "tags must be at most 10 entries of 40 characters",
      },
    },

    status: {
      type: String,
      enum: ARTICLE_STATUSES,
      default: "draft",
    },

    // Manual ordering within a category. Lower sorts first; ties fall back to
    // helpfulness so the genuinely useful article wins by default.
    order: { type: Number, default: 0 },

    // Referenced by slug rather than ObjectId so an editor can wire up related
    // reading without looking up ids, and so a deleted target degrades to
    // "link not rendered" instead of a dangling reference the reader sees.
    relatedSlugs: {
      type: [String],
      default: [],
      validate: {
        validator: (arr) => arr.length <= 6,
        message: "relatedSlugs cannot exceed 6 items",
      },
    },

    // Surfaced on the Help Center home as "Popular". Counted server-side on
    // article reads, throttled per fingerprint so a refresh loop cannot
    // manufacture popularity.
    viewCount: { type: Number, default: 0, min: 0 },
    helpfulCount: { type: Number, default: 0, min: 0 },
    notHelpfulCount: { type: Number, default: 0, min: 0 },

    // Provenance for scripts/seedKnowledgeBase.js: a fingerprint of exactly
    // what the seeder last wrote. Re-running the seeder compares this against
    // the article's current content to tell "nobody has touched this since we
    // wrote it" from "a human has since edited it", and refuses to overwrite
    // the latter. Null means the article was written by hand.
    //
    // A timestamp cannot answer that question — the seeder's own updates move
    // updatedAt, so after one refresh every article looks hand-edited and the
    // seeder stops being able to update anything.
    seedHash: {
      type: String,
      default: null,
      select: false,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    lastEditedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// ── Indexes ──────────────────────────────────────────────────────────────────

// Reader lookup by slug is already covered by the unique index on `slug`.

// Category browse on the Help Center, published only.
knowledgeBaseArticleSchema.index({ status: 1, category: 1, order: 1 });
// "Popular help" on the home screen.
knowledgeBaseArticleSchema.index({ status: 1, viewCount: -1 });
// Admin KB manager listing (includes drafts and archived).
knowledgeBaseArticleSchema.index({ status: 1, updatedAt: -1 });
// Help Center search. Weighted so a title match beats a body match — without
// weights, a long article that mentions a term in passing outranks the article
// actually named after it.
knowledgeBaseArticleSchema.index(
  { title: "text", excerpt: "text", bodyMarkdown: "text", tags: "text" },
  {
    name: "article_search",
    weights: { title: 10, tags: 6, excerpt: 4, bodyMarkdown: 1 },
  }
);

module.exports = mongoose.model("KnowledgeBaseArticle", knowledgeBaseArticleSchema);
