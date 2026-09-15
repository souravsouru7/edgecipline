"use strict";

// Attaches the post-create allowance snapshot to a create-trade response
// without changing the shape existing clients rely on: the trade (or batch
// result) keeps every field it had, and gains two siblings —
//
//   quota                  { market, premium, limit, used, remaining, exhausted }
//   showLastFreeTradeSheet true only when THIS save used the last free slot
//                          and the account has not dismissed the sheet yet
//
// A mongoose document is serialised through its own toJSON so schema
// transforms (hidden fields, virtuals) still apply.
function withQuota(payload, funnel) {
  const base = payload && typeof payload.toJSON === "function" ? payload.toJSON() : payload;
  if (!base || typeof base !== "object") return base;
  return {
    ...base,
    quota: funnel?.quota || null,
    showLastFreeTradeSheet: Boolean(funnel?.showLastFreeTradeSheet),
  };
}

module.exports = { withQuota };
