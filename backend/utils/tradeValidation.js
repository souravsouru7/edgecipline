"use strict";

const ApiError = require("./ApiError");

// insertMany({ordered:true}) on a mid-batch failure (only reachable via the
// standalone-Mongo fallback -- the transactional path is all-or-nothing)
// leaves earlier documents committed but throws a plain bulk-write error,
// which the global error handler flattens into a generic 500. Surface which
// trades actually saved instead of hiding it.
function isBulkWriteError(err) {
  return Boolean(err) && (
    err.name === "MongoBulkWriteError" ||
    err.name === "BulkWriteError" ||
    Array.isArray(err.writeErrors) ||
    Array.isArray(err.insertedDocs)
  );
}

function wrapBatchInsertError(err, totalCount) {
  if (!isBulkWriteError(err)) return err;
  const insertedDocs = Array.isArray(err.insertedDocs) ? err.insertedDocs : [];
  const insertedCount = insertedDocs.length || Number(err?.result?.nInserted ?? err?.result?.result?.nInserted ?? 0);
  const failedCount = Math.max(0, totalCount - insertedCount);
  const insertedTradeIds = insertedDocs.map((d) => d?._id).filter(Boolean);
  return new ApiError(
    409,
    insertedCount > 0
      ? `${insertedCount} of ${totalCount} trades were saved before an error occurred (${failedCount} failed). Check your trade log before retrying to avoid duplicates.`
      : `Failed to save trades: ${err.message}`,
    "BATCH_PARTIAL_FAILURE",
    { insertedCount, failedCount, insertedTradeIds }
  );
}

function requireEntryBasisCustomText(entryBasis, entryBasisCustom) {
  if (entryBasis === "Custom" && !String(entryBasisCustom || "").trim()) {
    throw new ApiError(400, "Custom entry basis requires a description", "VALIDATION_ERROR");
  }
}

// ─── Field-level trade rules (both markets) ─────────────────────────────────
//
// Mirrors frontend/features/trade/lib/tradeValidation.js. The client blocks bad
// input inline; these are the server's safety net for every API path.
//
// Compatibility (shipped iOS 1.0 / Android 1.1.2): those apps resend the whole
// form on edit. Every rule below that takes `existing` only fires for a field
// whose value actually CHANGED, so an old trade that already holds e.g. a
// custom R:R of "ssd" can still be edited by them. New writes are held to the
// rules.

const RR_MAX_SIDE = 100;
const RR_PATTERN = /^\s*(\d+(?:\.\d{1,2})?)\s*(?:[:/]\s*(\d+(?:\.\d{1,2})?))?\s*$/;

function badRequest(message) {
  return new ApiError(400, message, "VALIDATION_ERROR");
}

function has(obj, key) {
  return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "string" ? Number(value.replace(/,/g, "").trim()) : Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function sameValue(a, b) {
  const blank = (v) => v === null || v === undefined || v === "";
  if (blank(a) && blank(b)) return true;
  const na = toNumberOrNull(a);
  const nb = toNumberOrNull(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
  return String(a ?? "").trim() === String(b ?? "").trim();
}

/** True on create, or when `field` is in the payload with a different value. */
function changed(field, payload, existing) {
  if (!has(payload, field)) return false;
  if (!existing) return true;
  return !sameValue(payload[field], existing[field]);
}

/**
 * "1:2.5", "1 : 2", "1/3" or a bare "2.5" (= 1:2.5) → "1:2.5".
 * Returns { value } or { error }. Blank → { value: "" }.
 */
function parseRiskReward(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { value: "" };
  const m = RR_PATTERN.exec(text);
  if (!m) return { error: "Custom R:R must look like 1:2.5" };
  const risk = m[2] === undefined ? 1 : Number(m[1]);
  const reward = m[2] === undefined ? Number(m[1]) : Number(m[2]);
  if (!(risk > 0) || !(reward > 0)) return { error: "Both sides of the R:R must be above 0" };
  if (risk > RR_MAX_SIDE || reward > RR_MAX_SIDE) return { error: `R:R values can't be above ${RR_MAX_SIDE}` };
  const fmt = (n) => String(Math.round(n * 100) / 100);
  return { value: `${fmt(risk)}:${fmt(reward)}` };
}

/**
 * Normalises riskRewardRatio / riskRewardCustom on `update` in place.
 *  - A preset (or blank) ratio clears stale custom text.
 *  - "custom" needs a parsable value, stored as "1:2.5".
 */
function applyRiskRewardRules(update, existing = null) {
  const ratioGiven = has(update, "riskRewardRatio");
  const customGiven = has(update, "riskRewardCustom");
  if (!ratioGiven && !customGiven) return;

  if (ratioGiven && update.riskRewardRatio === null) update.riskRewardRatio = existing ? undefined : "";
  if (update.riskRewardRatio === undefined) delete update.riskRewardRatio;

  const ratio = has(update, "riskRewardRatio") ? update.riskRewardRatio : existing?.riskRewardRatio;
  if (ratio !== "custom") {
    if (customGiven || ratioGiven) update.riskRewardCustom = "";
    return;
  }
  if (!customGiven) {
    // Switching an existing trade to custom without sending the value.
    if (!String(existing?.riskRewardCustom || "").trim()) throw badRequest("Enter your custom R:R, like 1:2.5");
    return;
  }
  if (existing && sameValue(update.riskRewardCustom, existing.riskRewardCustom)) return; // unchanged legacy value
  const parsed = parseRiskReward(update.riskRewardCustom);
  if (parsed.error) throw badRequest(parsed.error);
  if (!parsed.value) throw badRequest("Enter your custom R:R, like 1:2.5");
  update.riskRewardCustom = parsed.value;
}

/**
 * Stop loss / take profit sanity (owner decision): a take profit on the wrong
 * side of entry is an error; a stop beyond entry is allowed (trailed /
 * break-even stop). 0 or blank means "not set".
 */
function assertTradeLevels(update, existing = null) {
  const relevant = ["type", "entryPrice", "stopLoss", "takeProfit"];
  if (!relevant.some((f) => changed(f, update, existing))) return;
  const pick = (f) => (has(update, f) ? update[f] : existing?.[f]);
  const sl = toNumberOrNull(pick("stopLoss"));
  const tp = toNumberOrNull(pick("takeProfit"));
  if (Number.isNaN(sl) || (sl !== null && sl < 0)) throw badRequest("Stop loss must be a positive price");
  if (Number.isNaN(tp) || (tp !== null && tp < 0)) throw badRequest("Take profit must be a positive price");
  const slSet = sl !== null && sl > 0;
  const tpSet = tp !== null && tp > 0;
  if (slSet && tpSet && sl === tp) throw badRequest("Stop loss and take profit can't be the same price");
  const entry = toNumberOrNull(pick("entryPrice"));
  const type = String(pick("type") || "").toUpperCase();
  if (!tpSet || !(entry > 0)) return;
  if (type === "BUY" && tp <= entry) throw badRequest("Take profit must be above your entry price for a BUY");
  if (type === "SELL" && tp >= entry) throw badRequest("Take profit must be below your entry price for a SELL");
}

/** Positive-number check on update, only for fields that changed. */
function assertPositiveIfChanged(update, existing, fields) {
  for (const [field, label] of fields) {
    if (!changed(field, update, existing)) continue;
    const n = toNumberOrNull(update[field]);
    if (n === null) continue; // clearing is handled by each market's own rules
    if (!(n > 0)) throw badRequest(`${label} must be a positive number`);
  }
}

function dayKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Indian options: strike > 0 and expiry not before the trade date. */
function assertOptionContract(update, existing = null) {
  const pick = (f) => (has(update, f) ? update[f] : existing?.[f]);
  const instrumentType = String(pick("instrumentType") || "OPTION").toUpperCase();
  if (instrumentType === "EQUITY") return;
  if (changed("strikePrice", update, existing)) {
    const strike = toNumberOrNull(update.strikePrice);
    if (!(strike > 0)) throw badRequest("Strike price must be a positive number");
  }
  if (["expiryDate", "tradeDate"].some((f) => changed(f, update, existing))) {
    const expiry = pick("expiryDate");
    const trade = pick("tradeDate");
    const e = expiry ? dayKey(expiry) : null;
    const t = trade ? dayKey(trade) : null;
    if (expiry && !e) throw badRequest("Expiry date is not a valid date");
    if (e && t && e < t) throw badRequest("Expiry can't be before the trade date");
  }
}

module.exports = {
  isBulkWriteError,
  wrapBatchInsertError,
  requireEntryBasisCustomText,
  applyRiskRewardRules,
  assertOptionContract,
  assertPositiveIfChanged,
  assertTradeLevels,
  changed,
  parseRiskReward,
};
