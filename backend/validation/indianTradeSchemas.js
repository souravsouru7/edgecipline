"use strict";

// Indian-market trade payloads (routes/indianMarketRoutes.js). The Indian API
// previously had no schema at all: no text limits, and batch items were never
// number-checked. Business rules (R:R format, take-profit side, option
// contract, lot size) live in utils/tradeValidation + the controller; this
// layer only bounds shape and length.
//
// Lenient on purpose: known fields are checked, unknown keys pass through, and
// numbers are NOT coerced (a "" or null stays as sent, exactly as the
// controller has always received them) — so nothing a shipped app build sends
// today starts failing for a reason other than genuinely bad data.

const { z } = require("zod");

const NUMERIC = /^-?\d+(\.\d+)?$/;
const numberLike = z.union([
  z.number().finite(),
  z.string().trim().refine((v) => v === "" || NUMERIC.test(v.replace(/,/g, "")), "Must be a number"),
  z.null(),
]).optional();
const text = (max) => z.union([z.string().max(max), z.null()]).optional();
const dateLike = z.union([
  z.string().trim().refine((v) => v === "" || !Number.isNaN(Date.parse(v)), "Must be a valid date"),
  z.null(),
]).optional();

const setupRule = z.object({
  label: z.string().trim().max(100),
  followed: z.boolean().optional(),
}).passthrough();

// `scale` loosens text caps for updates: an older app resends the whole form,
// and fields had no length limit before this schema existed.
const buildBody = (scale = 1) => z.object({
  pair: text(60 * scale),
  underlying: text(40 * scale),
  stockSymbol: text(40 * scale),
  type: z.union([z.string().trim().max(10), z.null()]).optional(),
  optionType: text(5 * scale),
  instrumentType: text(10 * scale),
  entryPrice: numberLike,
  exitPrice: numberLike,
  stopLoss: numberLike,
  takeProfit: numberLike,
  profit: numberLike,
  strikePrice: numberLike,
  quantity: numberLike,
  lotSize: numberLike,
  sharesQty: numberLike,
  brokerage: numberLike,
  sttTaxes: numberLike,
  tradeDate: dateLike,
  expiryDate: dateLike,
  strategy: text(100 * scale),
  setup: text(200 * scale),
  session: text(50 * scale),
  notes: text(2000 * scale),
  lesson: text(2000 * scale),
  mistakeTag: text(100 * scale),
  riskRewardRatio: text(20 * scale),
  riskRewardCustom: text(50 * scale),
  entryBasisCustom: text(200 * scale),
  emotionalTags: z.array(z.string().max(50)).max(10).optional(),
  setupRules: z.array(setupRule).max(20).optional(),
  mood: z.union([z.number().int().min(1).max(5), z.string().regex(/^[1-5]$/), z.null()]).optional(),
}).passthrough();

const indianTradeBody = buildBody(1);
const indianTradeUpdateBody = buildBody(10);

const passQuery = z.preprocess((v) => v ?? {}, z.object({}).passthrough());

const indianTradeSchemas = {
  create: z.object({ body: indianTradeBody, query: passQuery, params: passQuery }),
  batchCreate: z.object({
    body: z.object({ trades: z.array(indianTradeBody).min(1).max(100) }).passthrough(),
    query: passQuery,
    params: passQuery,
  }),
  update: z.object({ body: indianTradeUpdateBody, query: passQuery, params: passQuery }),
};

module.exports = { indianTradeSchemas, indianTradeBody };
