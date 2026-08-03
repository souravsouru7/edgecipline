"use strict";

const mongoose = require("mongoose");

const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

/**
 * Normalise a user/document id to a real ObjectId for use in aggregation
 * pipelines.
 *
 * Mongoose casts a string id to an ObjectId inside find() / countDocuments()
 * using the schema, but it does NOT cast anything inside an aggregation
 * pipeline — there, `$match: { user: "<24-hex string>" }` compares a string
 * against an ObjectId and silently matches zero documents. No error is raised,
 * so the caller just sees an empty result and reports "no data".
 *
 * This matters because `req.user._id` is not always an ObjectId: on an
 * auth-cache hit it comes back as a string, since authCacheService.serialise()
 * stringifies _id before JSON.stringify. So the same endpoint behaves
 * differently depending on whether Redis had the user cached.
 *
 * Anything that is already an ObjectId, or is not a valid 24-hex id, is
 * returned untouched so callers can still pass operator objects such as
 * `{ $in: [...] }`.
 */
function toObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) return value;
  const raw = typeof value === "string" ? value : value?.toString?.() ?? "";
  return OBJECT_ID_RE.test(raw) ? new mongoose.Types.ObjectId(raw) : value;
}

module.exports = { toObjectId };
