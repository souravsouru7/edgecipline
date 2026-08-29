"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");

const KnowledgeBaseArticle = require("../models/KnowledgeBaseArticle");
const ArticleFeedback = require("../models/ArticleFeedback");
const ApiError = require("../utils/ApiError");
const { logger } = require("../utils/logger");
const { appConfig } = require("../config");
const { buildPagination } = require("../utils/apiResponse");
const {
  serializeArticleSummary,
  serializeArticleDetail,
  serializeArticleForAdmin,
} = require("../utils/supportSerializers");
const {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_VALUES,
  ARTICLE_STATUSES,
  LIMITS,
} = require("../constants/support");

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

// Fuzzy matching scans published article titles in memory. That is only sane
// while the knowledge base is small — which it is, and is meant to be. Past
// this many articles the scan is skipped rather than allowed to get slow, and
// the search degrades to exact + partial matching.
const FUZZY_SCAN_LIMIT = 500;
// How close two words must be to count as the same word. 0.72 accepts
// "analitics"/"analytics" and "screenshoot"/"screenshot" while rejecting
// "trade"/"trends", which are genuinely different questions.
const FUZZY_MIN_SIMILARITY = 0.72;
const MIN_TOKEN_LENGTH = 4;

/** Levenshtein distance, capped — we only care about near-misses. */
function editDistance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 99;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }

  return previous[b.length];
}

function similarity(a, b) {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - editDistance(a, b) / longest;
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH);
}

/**
 * Last-resort match for a misspelled query.
 *
 * The text index stems but does not correct spelling, and a substring match
 * cannot help someone who typed "analitics" — the letters simply are not
 * there. Without this, a single typo returns an empty page, and an empty
 * search result is the moment a customer stops trying to help themselves and
 * opens a ticket.
 */
async function fuzzySearch(term, baseFilter) {
  const queryTokens = tokenize(term);
  if (!queryTokens.length) return [];

  const total = await KnowledgeBaseArticle.countDocuments(baseFilter);
  if (total > FUZZY_SCAN_LIMIT) return [];

  const candidates = await KnowledgeBaseArticle.find(baseFilter)
    .select("slug title excerpt category tags helpfulCount updatedAt")
    .limit(FUZZY_SCAN_LIMIT)
    .lean();

  const scored = candidates
    .map((article) => {
      const articleTokens = tokenize(`${article.title} ${(article.tags || []).join(" ")}`);
      let score = 0;

      for (const queryToken of queryTokens) {
        let best = 0;
        for (const articleToken of articleTokens) {
          // A prefix match is scored by how much of the longer word it covers,
          // NOT as a flat win. Scoring it 1.0 made "screenshoot" match the
          // "blank screen" tag exactly as strongly as it matched "screenshot",
          // so the crash article outranked the screenshot article.
          const isPrefix =
            articleToken.startsWith(queryToken) || queryToken.startsWith(articleToken);
          const score = isPrefix
            ? Math.min(queryToken.length, articleToken.length) /
              Math.max(queryToken.length, articleToken.length)
            : similarity(queryToken, articleToken);

          best = Math.max(best, score);
          if (best === 1) break;
        }
        if (best >= FUZZY_MIN_SIMILARITY) score += best;
      }

      return { article, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || (b.article.helpfulCount || 0) - (a.article.helpfulCount || 0));

  return scored.map((row) => row.article);
}

function toObjectId(value) {
  return value instanceof mongoose.Types.ObjectId
    ? value
    : new mongoose.Types.ObjectId(String(value));
}

/**
 * Stable, non-reversible identifier for an anonymous reader.
 *
 * The Help Center is public — Apple requires the support URL to work with no
 * session — so "one vote per person" cannot be keyed on a user id. This is a
 * salted hash of IP + user agent: good enough to stop a refresh loop inflating
 * a counter, useless for identifying anybody, and never stored in a form that
 * can be turned back into an IP address.
 */
function fingerprintFor(req) {
  const material = `${req.ip || ""}|${req.get?.("user-agent") || ""}`;
  return crypto
    .createHmac("sha256", appConfig.support.feedbackFingerprintSalt)
    .update(material)
    .digest("hex")
    .slice(0, 32);
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LIMITS.articleSlugMax);
}

// ─── Public reads ────────────────────────────────────────────────────────────

/**
 * Help Center search.
 *
 * Two passes. The text index handles ordinary queries with stemming and field
 * weighting. When it returns nothing — a typo, a partial word, a product name
 * the stemmer mangles — a bounded prefix/contains match on title and tags runs
 * instead. Without that fallback, "analitics" or "subscri" returns an empty
 * page, and an empty search result is the moment a customer gives up on
 * self-service and opens a ticket.
 */
async function searchArticles({ q, category, page = 1, limit = DEFAULT_PAGE_SIZE } = {}) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const base = { status: "published" };

  if (SUPPORT_CATEGORY_VALUES.includes(category)) base.category = category;

  const term = String(q || "").trim().slice(0, 120);

  if (!term) {
    const [items, total] = await Promise.all([
      KnowledgeBaseArticle.find(base)
        .select("-bodyMarkdown")
        .sort({ order: 1, helpfulCount: -1, title: 1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      KnowledgeBaseArticle.countDocuments(base),
    ]);

    return {
      items: items.map(serializeArticleSummary),
      pagination: buildPagination({ page: safePage, limit: safeLimit, total }),
      matchedBy: "browse",
    };
  }

  const textFilter = { ...base, $text: { $search: term } };
  const [items, total] = await Promise.all([
    KnowledgeBaseArticle.find(textFilter, { score: { $meta: "textScore" }, bodyMarkdown: 0 })
      .sort({ score: { $meta: "textScore" } })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    KnowledgeBaseArticle.countDocuments(textFilter),
  ]);

  if (total > 0) {
    return {
      items: items.map(serializeArticleSummary),
      pagination: buildPagination({ page: safePage, limit: safeLimit, total }),
      matchedBy: "text",
    };
  }

  // Second pass: substring match. Catches deliberate abbreviations the stemmer
  // misses — "subscri", "analyt". Escaped, so a query of "c++" or "(" is a
  // search rather than a regex injection or a catastrophic backtrack.
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const partialFilter = {
    ...base,
    $or: [
      { title: { $regex: escaped, $options: "i" } },
      { excerpt: { $regex: escaped, $options: "i" } },
      { tags: { $regex: escaped, $options: "i" } },
    ],
  };

  const [partialItems, partialTotal] = await Promise.all([
    KnowledgeBaseArticle.find(partialFilter)
      .select("-bodyMarkdown")
      .sort({ helpfulCount: -1, order: 1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    KnowledgeBaseArticle.countDocuments(partialFilter),
  ]);

  if (partialTotal > 0) {
    return {
      items: partialItems.map(serializeArticleSummary),
      pagination: buildPagination({ page: safePage, limit: safeLimit, total: partialTotal }),
      matchedBy: "partial",
    };
  }

  // Third pass: spelling. Neither of the passes above can help someone who
  // typed "analitics" — the letters are not there to match. This one compares
  // word by word.
  const fuzzyItems = await fuzzySearch(term, base);
  const paged = fuzzyItems.slice((safePage - 1) * safeLimit, safePage * safeLimit);

  return {
    items: paged.map(serializeArticleSummary),
    pagination: buildPagination({ page: safePage, limit: safeLimit, total: fuzzyItems.length }),
    matchedBy: fuzzyItems.length > 0 ? "fuzzy" : "none",
  };
}

/**
 * One article, by slug.
 *
 * Only published articles resolve. A draft or archived slug 404s for the
 * public reader exactly like a slug that never existed — an editor's unfinished
 * work is not something a customer should be able to read by guessing a URL.
 */
async function getArticle(slug) {
  const article = await KnowledgeBaseArticle.findOne({
    slug: String(slug || "").toLowerCase().trim(),
    status: "published",
  }).lean();

  if (!article) throw new ApiError(404, "Article not found", "NOT_FOUND");

  // Related articles are resolved to whatever currently exists and is
  // published. A slug that has since been archived or renamed simply does not
  // appear, rather than rendering a link that 404s the reader.
  const related = article.relatedSlugs?.length
    ? await KnowledgeBaseArticle.find({
        slug: { $in: article.relatedSlugs },
        status: "published",
      })
        .select("-bodyMarkdown")
        .limit(6)
        .lean()
    : [];

  // If the editor listed no related reading, fall back to the same category.
  const fallback =
    related.length === 0
      ? await KnowledgeBaseArticle.find({
          category: article.category,
          status: "published",
          _id: { $ne: article._id },
        })
          .select("-bodyMarkdown")
          .sort({ helpfulCount: -1, order: 1 })
          .limit(3)
          .lean()
      : [];

  // Popularity signal. Fire-and-forget: a failed counter must never turn a
  // readable article into an error. Inflation is bounded by the search rate
  // limiter rather than by per-reader deduplication, which would cost a Redis
  // round-trip on every article view for a cosmetic number.
  KnowledgeBaseArticle.updateOne({ _id: article._id }, { $inc: { viewCount: 1 } }).catch(() => {});

  return serializeArticleDetail(article, { related: related.length ? related : fallback });
}

/** Category tiles on the Help Center home, with live published counts. */
async function listCategories() {
  const counts = await KnowledgeBaseArticle.aggregate([
    { $match: { status: "published" } },
    { $group: { _id: "$category", count: { $sum: 1 } } },
  ]);

  const countMap = counts.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {});

  // Every category is returned, including empty ones, so the ticket form and
  // the Help Center always agree on the vocabulary. The UI hides zero-count
  // tiles; the ticket form still needs the full list.
  return SUPPORT_CATEGORIES.map((category) => ({
    ...category,
    articleCount: countMap[category.value] || 0,
  }));
}

async function listPopularArticles(limit = 6) {
  const items = await KnowledgeBaseArticle.find({ status: "published" })
    .select("-bodyMarkdown")
    .sort({ viewCount: -1, helpfulCount: -1 })
    .limit(Math.min(Number(limit) || 6, 20))
    .lean();

  return items.map(serializeArticleSummary);
}

/**
 * Articles suggested while a customer is filling in a ticket. This is the
 * deflection surface — the last chance to answer the question before it
 * becomes a conversation someone has to staff.
 */
async function suggestForTicket({ category, subject }) {
  const term = String(subject || "").trim().slice(0, 120);
  if (term.length >= 4) {
    const result = await searchArticles({ q: term, category, limit: 3 });
    if (result.items.length) return result.items;
    // Retry without the category filter — the customer's guess at a category
    // is often the reason a good article did not surface.
    const broad = await searchArticles({ q: term, limit: 3 });
    if (broad.items.length) return broad.items;
  }

  const result = await searchArticles({ category, limit: 3 });
  return result.items;
}

// ─── Feedback ────────────────────────────────────────────────────────────────

/**
 * "Was this helpful?"
 *
 * One vote per reader per article, enforced by a unique index rather than an
 * application check — under concurrency a check-then-insert lets a double-click
 * through, and the whole point of the feature is a number people trust.
 */
async function submitFeedback({ slug, user, fingerprint, helpful, comment }) {
  const article = await KnowledgeBaseArticle.findOne({
    slug: String(slug || "").toLowerCase().trim(),
    status: "published",
  })
    .select("_id")
    .lean();

  if (!article) throw new ApiError(404, "Article not found", "NOT_FOUND");

  const doc = {
    article: article._id,
    user: user?._id ? toObjectId(user._id) : null,
    // Signed-in readers are keyed on their user id, so voting from a phone and
    // a laptop still counts once. Only anonymous readers need a fingerprint.
    fingerprint: user?._id ? null : fingerprint || null,
    helpful: Boolean(helpful),
    comment: String(comment || "").trim().slice(0, LIMITS.feedbackCommentMax),
  };

  try {
    await ArticleFeedback.create(doc);
  } catch (error) {
    if (error?.code === 11000) {
      // Already voted. Treated as success: the reader's intent is recorded,
      // and an error here would only invite them to try again.
      return { counted: false, reason: "already_voted" };
    }
    throw error;
  }

  // Denormalised counters, kept as a cache of the rows above. `$inc` rather
  // than a recount, so two simultaneous votes both land.
  await KnowledgeBaseArticle.updateOne(
    { _id: article._id },
    { $inc: helpful ? { helpfulCount: 1 } : { notHelpfulCount: 1 } }
  );

  return { counted: true };
}

// ─── Admin ───────────────────────────────────────────────────────────────────

async function listArticlesForAdmin(query = {}) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const filter = {};

  if (ARTICLE_STATUSES.includes(query.status)) filter.status = query.status;
  if (SUPPORT_CATEGORY_VALUES.includes(query.category)) filter.category = query.category;

  if (query.q) {
    const escaped = String(query.q).trim().slice(0, 120).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { title: { $regex: escaped, $options: "i" } },
      { slug: { $regex: escaped, $options: "i" } },
    ];
  }

  const [items, total] = await Promise.all([
    KnowledgeBaseArticle.find(filter)
      .select("-bodyMarkdown")
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    KnowledgeBaseArticle.countDocuments(filter),
  ]);

  return {
    items: items.map(serializeArticleForAdmin),
    pagination: buildPagination({ page, limit, total }),
  };
}

async function getArticleForAdmin(id) {
  const article = await KnowledgeBaseArticle.findById(id).lean();
  if (!article) throw new ApiError(404, "Article not found", "NOT_FOUND");
  return serializeArticleForAdmin(article);
}

async function createArticle({ author, body }) {
  const slug = slugify(body.slug || body.title);
  if (!slug) {
    throw new ApiError(400, "A title or slug is required", "VALIDATION_ERROR");
  }

  try {
    const article = await KnowledgeBaseArticle.create({
      slug,
      title: String(body.title || "").trim(),
      excerpt: String(body.excerpt || "").trim(),
      bodyMarkdown: String(body.bodyMarkdown || ""),
      category: SUPPORT_CATEGORY_VALUES.includes(body.category) ? body.category : "other",
      tags: (body.tags || []).map((t) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 10),
      status: ARTICLE_STATUSES.includes(body.status) ? body.status : "draft",
      order: Number(body.order) || 0,
      relatedSlugs: (body.relatedSlugs || []).map(slugify).filter(Boolean).slice(0, 6),
      author: author?._id ? toObjectId(author._id) : null,
      lastEditedBy: author?._id ? toObjectId(author._id) : null,
      publishedAt: body.status === "published" ? new Date() : null,
    });

    logger.info("SUPPORT_ARTICLE_CREATED", { slug, by: String(author?._id) });
    return serializeArticleForAdmin(article.toObject());
  } catch (error) {
    if (error?.code === 11000) {
      throw new ApiError(409, `An article with the slug "${slug}" already exists.`, "DUPLICATE_RESOURCE");
    }
    throw error;
  }
}

async function updateArticle({ id, editor, body }) {
  const existing = await KnowledgeBaseArticle.findById(id).lean();
  if (!existing) throw new ApiError(404, "Article not found", "NOT_FOUND");

  const set = { lastEditedBy: editor?._id ? toObjectId(editor._id) : null };

  if (body.title !== undefined) set.title = String(body.title).trim();
  if (body.excerpt !== undefined) set.excerpt = String(body.excerpt).trim();
  if (body.bodyMarkdown !== undefined) set.bodyMarkdown = String(body.bodyMarkdown);
  if (body.category !== undefined && SUPPORT_CATEGORY_VALUES.includes(body.category)) {
    set.category = body.category;
  }
  if (body.tags !== undefined) {
    set.tags = (body.tags || []).map((t) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 10);
  }
  if (body.order !== undefined) set.order = Number(body.order) || 0;
  if (body.relatedSlugs !== undefined) {
    set.relatedSlugs = (body.relatedSlugs || []).map(slugify).filter(Boolean).slice(0, 6);
  }

  // The slug is the article's public identity. Changing it after publication
  // breaks every link a customer has bookmarked and every cross-reference from
  // another article, so it is only editable while the article is still a draft.
  if (body.slug !== undefined && existing.status === "draft") {
    const nextSlug = slugify(body.slug);
    if (nextSlug) set.slug = nextSlug;
  }

  try {
    const updated = await KnowledgeBaseArticle.findByIdAndUpdate(id, { $set: set }, { returnDocument: "after" }).lean();
    return serializeArticleForAdmin(updated);
  } catch (error) {
    if (error?.code === 11000) {
      throw new ApiError(409, "Another article already uses that slug.", "DUPLICATE_RESOURCE");
    }
    throw error;
  }
}

async function changeArticleStatus({ id, status, editor }) {
  if (!ARTICLE_STATUSES.includes(status)) {
    throw new ApiError(400, "Invalid article status", "VALIDATION_ERROR");
  }

  const existing = await KnowledgeBaseArticle.findById(id).select("status publishedAt").lean();
  if (!existing) throw new ApiError(404, "Article not found", "NOT_FOUND");

  const set = { status, lastEditedBy: editor?._id ? toObjectId(editor._id) : null };
  // publishedAt records the FIRST publication and is not reset by an
  // unpublish/republish cycle — otherwise fixing a typo would make a
  // year-old article look brand new.
  if (status === "published" && !existing.publishedAt) set.publishedAt = new Date();

  const updated = await KnowledgeBaseArticle.findByIdAndUpdate(id, { $set: set }, { returnDocument: "after" }).lean();

  logger.info("SUPPORT_ARTICLE_STATUS_CHANGED", {
    slug: updated.slug,
    from: existing.status,
    to: status,
    by: String(editor?._id),
  });

  return serializeArticleForAdmin(updated);
}

/**
 * Hard delete. Archiving is the normal path and is what the UI offers; this
 * exists for genuine mistakes (a duplicate, a test article). Feedback rows go
 * with it, since they are meaningless without the article.
 */
async function deleteArticle(id) {
  const article = await KnowledgeBaseArticle.findById(id).select("slug").lean();
  if (!article) throw new ApiError(404, "Article not found", "NOT_FOUND");

  await ArticleFeedback.deleteMany({ article: article._id });
  await KnowledgeBaseArticle.deleteOne({ _id: article._id });

  logger.info("SUPPORT_ARTICLE_DELETED", { slug: article.slug });
  return { deleted: true, slug: article.slug };
}

/**
 * Usefulness report. The "not helpful" comments are the valuable half — they
 * say precisely which question the article failed to answer.
 */
async function getArticleFeedback(id, { limit = 25 } = {}) {
  const article = await KnowledgeBaseArticle.findById(id).select("helpfulCount notHelpfulCount slug title").lean();
  if (!article) throw new ApiError(404, "Article not found", "NOT_FOUND");

  const comments = await ArticleFeedback.find({
    article: article._id,
    comment: { $ne: "" },
  })
    .select("helpful comment createdAt")
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 25, 100))
    .lean();

  const total = (article.helpfulCount || 0) + (article.notHelpfulCount || 0);

  return {
    slug: article.slug,
    title: article.title,
    helpfulCount: article.helpfulCount || 0,
    notHelpfulCount: article.notHelpfulCount || 0,
    helpfulRate: total > 0 ? Number(((article.helpfulCount || 0) / total).toFixed(2)) : null,
    comments: comments.map((c) => ({
      helpful: c.helpful,
      comment: c.comment,
      at: c.createdAt,
    })),
  };
}

module.exports = {
  fingerprintFor,
  slugify,
  searchArticles,
  getArticle,
  listCategories,
  listPopularArticles,
  suggestForTicket,
  submitFeedback,
  listArticlesForAdmin,
  getArticleForAdmin,
  createArticle,
  updateArticle,
  changeArticleStatus,
  deleteArticle,
  getArticleFeedback,
};
