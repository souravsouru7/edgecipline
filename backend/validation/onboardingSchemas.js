"use strict";

const { z } = require("zod");
const { TRADING_STYLE_IDS } = require("../services/onboardingService");

const market = z.enum(["Forex", "Indian_Market"]);
const styleId = z.enum(TRADING_STYLE_IDS);

const customSetup = z.object({
  name: z.string().trim().min(2).max(80),
  rules: z.array(z.string().trim().min(2).max(200)).min(1).max(8),
}).strict();

const emptyObj = z.preprocess((value) => value ?? {}, z.object({}).passthrough());

const onboardingSchemas = {
  selectMarket: z.object({
    body: z.object({ market }).strict(),
    query: emptyObj,
    params: emptyObj,
  }),
  selectStyle: z.object({
    body: z.object({ style: styleId }).strict(),
    query: emptyObj,
    params: emptyObj,
  }),
  seedSetup: z.object({
    body: z.object({
      style: styleId.optional(),
      market: market.optional(),
      custom: customSetup.optional(),
    }),
    query: emptyObj,
    params: emptyObj,
  }),
  insight: z.object({
    body: emptyObj,
    query: emptyObj,
    params: emptyObj,
  }),
  skipTrade: z.object({
    body: z.object({
      reason: z.enum([
        "not_traded_yet",
        "no_screenshot",
        "demo_only",
        "exploring",
        "other",
      ]).optional(),
    }),
    query: emptyObj,
    params: emptyObj,
  }),
  complete: z.object({
    body: emptyObj,
    query: emptyObj,
    params: emptyObj,
  }),
};

module.exports = { onboardingSchemas };
