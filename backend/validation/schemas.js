"use strict";

const { z } = require("zod");
const IssueReport = require("../models/IssueReport");

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Must be a valid ObjectId");
const finiteNumber = z.coerce.number().finite();
const optionalText = (max) => z.string().trim().max(max).optional();
const optionalDate = z.string().trim().min(1).refine(
  (value) => !Number.isNaN(Date.parse(value)),
  "Must be a valid date"
).optional();
const optionalJsonText = z.string().max(50_000).refine((value) => {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}, "Must contain valid JSON");

const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");
const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const imageSchema = z.object({
  url: z.string().url(),
  publicId: optionalText(300),
  fileName: optionalText(200),
  uploadedAt: z.union([z.string(), z.date()]).optional(),
  order: finiteNumber.optional(),
  size: finiteNumber.nonnegative().optional(),
  thumbnailUrl: z.string().url().or(z.literal("")).optional(),
  mediumUrl: z.string().url().or(z.literal("")).optional(),
}).passthrough();

const setupRuleSchema = z.object({
  label: z.string().trim().min(1).max(100),
  followed: z.boolean().default(false),
});

const tradeBody = z.object({
  pair: z.string().trim().min(1).max(50).optional(),
  type: z.string().trim().toUpperCase().pipe(z.enum(["BUY", "SELL"])).optional(),
  tradeDate: optionalDate,
  quantity: finiteNumber.optional(),
  lotSize: finiteNumber.optional(),
  entryPrice: finiteNumber.optional(),
  exitPrice: finiteNumber.optional(),
  stopLoss: finiteNumber.optional(),
  takeProfit: finiteNumber.optional(),
  profit: finiteNumber.optional(),
  commission: finiteNumber.optional(),
  swap: finiteNumber.optional(),
  balance: finiteNumber.optional(),
  strategy: optionalText(100),
  session: optionalText(50),
  notes: optionalText(2000),
  riskRewardRatio: optionalText(50),
  riskRewardCustom: optionalText(50),
  screenshot: optionalText(2000),
  imageUrl: optionalText(2000),
  tradeImages: z.array(imageSchema).max(20).optional(),
  broker: optionalText(100),
  entryBasis: z.enum(["Plan", "Emotion", "Impulsive", "Custom", ""]).optional(),
  entryBasisCustom: optionalText(200),
  mood: finiteNumber.int().min(1).max(5).nullable().optional(),
  confidence: z.enum(["Low", "Medium", "High", "Overconfident", ""]).optional(),
  emotionalTags: z.array(z.string().trim().max(50)).max(10).optional(),
  mistakeTag: optionalText(100),
  lesson: optionalText(2000),
  wouldRetake: z.enum(["Yes", "No", ""]).optional(),
  tradeQuality: z.enum(["Great", "Average", "Poor", ""]).optional(),
  setupRules: z.array(setupRuleSchema).max(20).optional(),
  setupScore: finiteNumber.min(0).max(100).nullable().optional(),
  ocrJobId: optionalText(100),
}).passthrough();

const requiredTradeBody = tradeBody.extend({
  pair: z.string().trim().min(1).max(50),
  type: z.string().trim().toUpperCase().pipe(z.enum(["BUY", "SELL"])),
  tradeDate: z.string().trim().min(1).refine(
    (value) => !Number.isNaN(Date.parse(value)),
    "Must be a valid date"
  ),
});

const idParams = z.object({ id: objectId });
const emptyBody = z.preprocess((value) => value ?? {}, z.object({}).passthrough());
const emptyQuery = z.preprocess((value) => value ?? {}, z.object({}).passthrough());

const tradeSchemas = {
  create: z.object({ body: requiredTradeBody, query: emptyQuery, params: emptyQuery }),
  batchCreate: z.object({
    body: z.object({
      trades: z.array(requiredTradeBody).min(1).max(100),
      ocrJobId: optionalText(100),
    }),
    query: emptyQuery,
    params: emptyQuery,
  }),
  list: z.object({
    body: emptyBody,
    query: paginationQuery.extend({
      period: z.enum(["all", "1w", "1m", "3m", "1y"]).default("all"),
    }),
    params: emptyQuery,
  }),
  getById: z.object({ body: emptyBody, query: emptyQuery, params: idParams }),
  update: z.object({
    body: tradeBody.refine(
      (value) => Object.keys(value).length > 0,
      "At least one editable field is required"
    ),
    query: emptyQuery,
    params: idParams,
  }),
};

const notificationSchemas = {
  list: z.object({
    body: emptyBody,
    query: paginationQuery.extend({
      unreadOnly: booleanQuery.default("false"),
    }),
    params: emptyQuery,
  }),
  id: z.object({ body: emptyBody, query: emptyQuery, params: idParams }),
  action: z.object({
    body: z.object({ actionType: z.string().trim().min(1).max(100).optional() }),
    query: emptyQuery,
    params: idParams,
  }),
};

const issueListQuery = paginationQuery.extend({
  status: z.enum(IssueReport.ISSUE_STATUSES).optional(),
  category: z.enum(IssueReport.ISSUE_CATEGORIES).optional(),
});

const issueSchemas = {
  create: z.object({
    body: z.object({
      issueCategory: z.enum(IssueReport.ISSUE_CATEGORIES),
      description: z.string().trim().min(5).max(4000),
      marketType: z.enum(IssueReport.MARKET_TYPES).default("Unknown"),
      module: optionalText(100),
      tradeId: objectId.optional().or(z.literal("")),
      ocrDataSnapshot: optionalJsonText.optional(),
      appVersion: optionalText(30),
      platform: z.enum(IssueReport.PLATFORMS).default("unknown"),
      deviceInfo: optionalJsonText.optional(),
      submissionId: optionalText(100),
    }).passthrough(),
    query: emptyQuery,
    params: emptyQuery,
  }),
  list: z.object({ body: emptyBody, query: issueListQuery, params: emptyQuery }),
  getById: z.object({ body: emptyBody, query: emptyQuery, params: idParams }),
  adminList: z.object({
    body: emptyBody,
    query: issueListQuery.extend({
      market: z.enum(IssueReport.MARKET_TYPES).optional(),
      platform: z.enum(IssueReport.PLATFORMS).optional(),
      from: optionalDate,
      to: optionalDate,
    }),
    params: emptyQuery,
  }),
  adminUpdate: z.object({
    body: z.object({
      status: z.enum(IssueReport.ISSUE_STATUSES),
      fixSummary: optionalText(2000),
      fixedVersion: optionalText(30),
      note: optionalText(500),
    }),
    query: emptyQuery,
    params: idParams,
  }),
};

module.exports = {
  issueSchemas,
  notificationSchemas,
  tradeSchemas,
};
