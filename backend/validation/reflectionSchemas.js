"use strict";

const { z } = require("zod");

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const dayKey = z.string().regex(dayPattern, "day must be a YYYY-MM-DD string").optional();

const followedPlan = z.enum(["yes", "partly", "no", "no_trades"]).optional();
const wouldRepeat = z.enum(["yes", "no", "partly"]).optional();
const slider = z.coerce.number().int().min(1).max(5).optional();
const improvement = z.string().trim().max(280).optional();
const market = z.enum(["Forex", "Indian_Market", "any"]).optional();
const source = z.enum(["manual", "notification"]).optional();

const reflectionBody = z.object({
  followedPlan,
  mood:        slider,
  confidence:  slider,
  wouldRepeat,
  improvement,
  market,
  source,
  day:         dayKey,
}).refine(
  (value) =>
    value.followedPlan !== undefined ||
    value.mood !== undefined ||
    value.confidence !== undefined ||
    value.wouldRepeat !== undefined ||
    (value.improvement && value.improvement.length > 0),
  { message: "Provide at least one reflection field" }
);

const skipBody = z.object({
  market,
  source,
  day:    dayKey,
}).partial();

const emptyObj = z.preprocess((value) => value ?? {}, z.object({}).passthrough());

const reflectionSchemas = {
  submit:  z.object({ body: reflectionBody, query: emptyObj, params: emptyObj }),
  skip:    z.object({ body: skipBody,       query: emptyObj, params: emptyObj }),
  history: z.object({
    body:   emptyObj,
    query:  z.object({
      days: z.coerce.number().int().min(1).max(90).default(14),
    }),
    params: emptyObj,
  }),
};

module.exports = { reflectionSchemas };
