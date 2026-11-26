"use strict";

const { z } = require("zod");

const emptyObj = z.preprocess((value) => value ?? {}, z.object({}).passthrough());
const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "invalid id");

// Target params are matched against the server's own suggestions, so the
// shape only needs to be bounded here; anything not suggested is rejected
// in the service.
const targetParams = z.object({
  tag: z.string().trim().min(1).max(50).optional(),
  label: z.string().trim().max(50).optional(),
  rule: z.string().trim().min(1).max(200).optional(),
  n: z.coerce.number().int().min(1).max(5).optional(),
  need: z.coerce.number().int().min(1).max(7).optional(),
}).strict();

const mindProgressSchemas = {
  seen: z.object({
    body: z.object({ ids: z.array(objectId).min(1).max(20) }).strict(),
    query: emptyObj,
    params: emptyObj,
  }),
  setTarget: z.object({
    body: z.object({
      preset: z.enum(["no_tag", "follow_rule", "stop_after_losses", "tag_every_trade", "plan_days"]),
      params: targetParams.optional().default({}),
    }).strict(),
    query: emptyObj,
    params: emptyObj,
  }),
};

module.exports = { mindProgressSchemas };
