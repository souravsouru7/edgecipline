"use strict";

const { z } = require("zod");
const { ANCHOR_KINDS } = require("../models/CoachConversation");

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Must be a valid ObjectId");
const market = z.enum(["Forex", "Indian_Market", "any"]).optional();

const anchor = z.object({
  kind:  z.enum(ANCHOR_KINDS),
  refId: z.string().trim().max(200).optional(),
  label: z.string().trim().max(200).optional(),
}).partial({ refId: true, label: true });

const emptyObj = z.preprocess((value) => value ?? {}, z.object({}).passthrough());

const coachSchemas = {
  createConversation: z.object({
    body: z.object({
      anchor: anchor.optional(),
      market,
      initialMessage: z.string().trim().min(1).max(1200).optional(),
    }),
    query: emptyObj,
    params: emptyObj,
  }),
  listConversations: z.object({
    body: emptyObj,
    query: z.object({
      limit: z.coerce.number().int().min(1).max(50).default(20),
      anchorKind: z.enum(ANCHOR_KINDS).optional(),
    }),
    params: emptyObj,
  }),
  conversationId: z.object({
    body: emptyObj,
    query: emptyObj,
    params: z.object({ id: objectId }),
  }),
  sendMessage: z.object({
    body: z.object({
      content: z.string().trim().min(1).max(1200),
      stream: z.coerce.boolean().optional().default(true),
      anchor: anchor.optional(),
    }),
    query: emptyObj,
    params: z.object({ id: objectId }),
  }),
  quickPrompts: z.object({
    body: emptyObj,
    query: z.object({
      anchor: z.enum(ANCHOR_KINDS).optional(),
    }),
    params: emptyObj,
  }),
};

module.exports = { coachSchemas };
