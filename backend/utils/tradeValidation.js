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

module.exports = {
  isBulkWriteError,
  wrapBatchInsertError,
  requireEntryBasisCustomText,
};
