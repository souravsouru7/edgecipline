"use strict";

const { z } = require("zod");
const {
  SUPPORT_CATEGORY_VALUES,
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  USER_SELECTABLE_PRIORITIES,
  TICKET_TAGS,
  ARTICLE_STATUSES,
  SUPPORT_ROLES,
  LIMITS,
} = require("../constants/support");

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Must be a valid ObjectId");
const optionalText = (max) => z.string().trim().max(max).optional();
const emptyBody = z.preprocess((v) => v ?? {}, z.object({}).passthrough());
const emptyQuery = z.preprocess((v) => v ?? {}, z.object({}).passthrough());
const idParams = z.object({ id: objectId });

const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const optionalDate = z
  .string()
  .trim()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), "Must be a valid date")
  .optional();

/**
 * A message body that is meaningful once trimmed.
 *
 * `.trim()` runs before `.min(1)`, so "   \n  " is rejected rather than saved
 * as a blank bubble that fires a push notification saying nothing.
 */
const messageBody = z
  .string()
  .trim()
  .min(1, "Message cannot be empty")
  .max(LIMITS.messageMax, `Message cannot exceed ${LIMITS.messageMax} characters`);

/**
 * Multipart bodies arrive as strings, so booleans and numbers need coercing.
 * Anything absent stays absent rather than becoming `false`/`0`, which would
 * silently overwrite a stored value on a PATCH.
 */
const multipartBoolean = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((v) => v === true || v === "true" || v === "1")
  .optional();

// ─── Public ──────────────────────────────────────────────────────────────────

const articleListQuery = paginationQuery.extend({
  q: optionalText(120),
  category: z.enum(SUPPORT_CATEGORY_VALUES).optional(),
});

const publicSchemas = {
  assistant: z.object({
    body: z.object({
      text: z.string().trim().min(1, "Ask a question first").max(500),
    }),
    query: emptyQuery,
    params: emptyQuery,
  }),
  listArticles: z.object({ body: emptyBody, query: articleListQuery, params: emptyQuery }),
  getArticle: z.object({
    body: emptyBody,
    query: emptyQuery,
    params: z.object({
      slug: z.string().trim().min(1).max(LIMITS.articleSlugMax),
    }),
  }),
  articleFeedback: z.object({
    body: z.object({
      helpful: z.union([z.boolean(), z.enum(["true", "false"])]).transform((v) => v === true || v === "true"),
      comment: optionalText(LIMITS.feedbackCommentMax),
    }),
    query: emptyQuery,
    params: z.object({
      slug: z.string().trim().min(1).max(LIMITS.articleSlugMax),
    }),
  }),
};

// ─── Customer tickets ────────────────────────────────────────────────────────

const userTicketSchemas = {
  create: z
    .object({
      body: z
        .object({
          subject: z
            .string()
            .trim()
            .min(LIMITS.subjectMin, `Subject must be at least ${LIMITS.subjectMin} characters`)
            .max(LIMITS.subjectMax),
          description: messageBody,
          category: z.enum(SUPPORT_CATEGORY_VALUES),
          subcategory: optionalText(100),
          // "urgent" is absent from this enum on purpose. A customer cannot
          // self-declare urgency; the service floors money-related categories
          // at "high" instead, which is a rule rather than a request.
          priority: z.enum(USER_SELECTABLE_PRIORITIES).default("normal"),
          platform: optionalText(20),
          appVersion: optionalText(30),
          marketType: optionalText(30),
          linkedIssue: objectId.optional().or(z.literal("")),
          clientRequestId: optionalText(100),
        })
        // Multipart form fields arrive alongside files; passthrough keeps the
        // parse from failing on the framework's own extras. Every field the
        // service reads is declared above, so nothing extra reaches the model.
        .passthrough(),
      query: emptyQuery,
      params: emptyQuery,
    }),

  list: z.object({
    body: emptyBody,
    query: paginationQuery.extend({
      status: z.enum([...TICKET_STATUSES, "open"]).optional(),
      category: z.enum(SUPPORT_CATEGORY_VALUES).optional(),
      q: optionalText(100),
    }),
    params: emptyQuery,
  }),

  getById: z.object({ body: emptyBody, query: emptyQuery, params: idParams }),

  listMessages: z.object({
    body: emptyBody,
    query: paginationQuery,
    params: idParams,
  }),

  reply: z.object({
    body: z
      .object({
        body: messageBody,
        clientMessageId: optionalText(100),
      })
      .passthrough(),
    query: emptyQuery,
    params: idParams,
  }),

  reopen: z.object({ body: emptyBody, query: emptyQuery, params: idParams }),

  satisfaction: z.object({
    body: z.object({
      rating: z.coerce.number().int().min(1).max(5),
      comment: optionalText(LIMITS.satisfactionCommentMax),
    }),
    query: emptyQuery,
    params: idParams,
  }),

  duplicates: z.object({
    body: emptyBody,
    query: z.object({ category: z.enum(SUPPORT_CATEGORY_VALUES).optional() }),
    params: emptyQuery,
  }),

  suggestArticles: z.object({
    body: emptyBody,
    query: z.object({
      category: z.enum(SUPPORT_CATEGORY_VALUES).optional(),
      subject: optionalText(120),
    }),
    params: emptyQuery,
  }),

  attachment: z.object({
    body: emptyBody,
    query: z.object({
      download: z.enum(["true", "1"]).optional(),
    }),
    params: z.object({
      messageId: objectId,
      index: z.coerce.number().int().min(0).max(9),
    }),
  }),
};

// ─── Staff ───────────────────────────────────────────────────────────────────

const staffTicketSchemas = {
  list: z.object({
    body: emptyBody,
    query: paginationQuery.extend({
      queue: z.enum(["all", "mine", "unassigned", "waiting_on_user", "resolved"]).optional(),
      status: z.enum(TICKET_STATUSES).optional(),
      priority: z.enum(TICKET_PRIORITIES).optional(),
      category: z.enum(SUPPORT_CATEGORY_VALUES).optional(),
      tag: z.enum(TICKET_TAGS).optional(),
      assignedTo: z.union([z.literal("none"), objectId]).optional(),
      email: optionalText(200),
      q: optionalText(200),
      messageQuery: optionalText(200),
      sort: z.enum(["activity", "created", "priority", "oldest"]).optional(),
      from: optionalDate,
      to: optionalDate,
    }),
    params: emptyQuery,
  }),

  getById: z.object({ body: emptyBody, query: emptyQuery, params: idParams }),

  listMessages: z.object({
    body: emptyBody,
    query: paginationQuery,
    params: idParams,
  }),

  reply: z.object({
    body: z
      .object({
        body: messageBody,
        clientMessageId: optionalText(100),
        // Drives whether the message is an internal note. Never trusted as a
        // `visibility` value directly — the service derives visibility from
        // the message type so a crafted body cannot request a "public
        // internal note".
        internal: multipartBoolean,
        nextStatus: z.enum(TICKET_STATUSES).optional(),
      })
      .passthrough(),
    query: emptyQuery,
    params: idParams,
  }),

  assign: z.object({
    // null / "" means unassign.
    body: z.object({
      assigneeId: z.union([objectId, z.literal(""), z.null()]).optional(),
      expectedVersion: z.coerce.number().int().min(0).optional(),
    }),
    query: emptyQuery,
    params: idParams,
  }),

  status: z.object({
    body: z.object({
      status: z.enum(TICKET_STATUSES),
      resolutionSummary: optionalText(LIMITS.resolutionMax),
      expectedVersion: z.coerce.number().int().min(0).optional(),
    }),
    query: emptyQuery,
    params: idParams,
  }),

  priority: z.object({
    body: z.object({
      priority: z.enum(TICKET_PRIORITIES),
      expectedVersion: z.coerce.number().int().min(0).optional(),
    }),
    query: emptyQuery,
    params: idParams,
  }),

  tags: z.object({
    body: z.object({
      tags: z.array(z.enum(TICKET_TAGS)).max(10),
    }),
    query: emptyQuery,
    params: idParams,
  }),

  auditTrail: z.object({
    body: emptyBody,
    query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
    params: idParams,
  }),
};

// ─── Knowledge base administration ───────────────────────────────────────────

const articleBody = z.object({
  title: z.string().trim().min(3).max(LIMITS.articleTitleMax),
  slug: optionalText(LIMITS.articleSlugMax),
  excerpt: optionalText(LIMITS.articleExcerptMax),
  bodyMarkdown: z.string().min(1).max(LIMITS.articleBodyMax),
  category: z.enum(SUPPORT_CATEGORY_VALUES),
  tags: z.array(z.string().trim().max(40)).max(10).optional(),
  status: z.enum(ARTICLE_STATUSES).optional(),
  order: z.coerce.number().int().optional(),
  relatedSlugs: z.array(z.string().trim().max(LIMITS.articleSlugMax)).max(6).optional(),
});

const adminArticleSchemas = {
  list: z.object({
    body: emptyBody,
    query: paginationQuery.extend({
      status: z.enum(ARTICLE_STATUSES).optional(),
      category: z.enum(SUPPORT_CATEGORY_VALUES).optional(),
      q: optionalText(120),
    }),
    params: emptyQuery,
  }),
  getById: z.object({ body: emptyBody, query: emptyQuery, params: idParams }),
  create: z.object({ body: articleBody, query: emptyQuery, params: emptyQuery }),
  update: z.object({ body: articleBody.partial(), query: emptyQuery, params: idParams }),
  changeStatus: z.object({
    body: z.object({ status: z.enum(ARTICLE_STATUSES) }),
    query: emptyQuery,
    params: idParams,
  }),
  remove: z.object({ body: emptyBody, query: emptyQuery, params: idParams }),
  feedback: z.object({
    body: emptyBody,
    query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }),
    params: idParams,
  }),
};

// ─── Agent administration ────────────────────────────────────────────────────

const adminAgentSchemas = {
  setRole: z.object({
    body: z.object({
      // null revokes support access entirely.
      supportRole: z.union([z.enum(SUPPORT_ROLES), z.null(), z.literal("")]),
    }),
    query: emptyQuery,
    params: z.object({ userId: objectId }),
  }),
};

module.exports = {
  publicSchemas,
  userTicketSchemas,
  staffTicketSchemas,
  adminArticleSchemas,
  adminAgentSchemas,
};
