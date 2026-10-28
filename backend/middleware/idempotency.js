"use strict";

const crypto = require("crypto");
const IdempotencyRecord = require("../models/IdempotencyRecord");
const ApiError = require("../utils/ApiError");
const { logger } = require("../utils/logger");

const HEADER = "idempotency-key";
const MAX_KEY_LENGTH = 200;

function readKey(req) {
  const raw = req.get(HEADER) || req.get("x-idempotency-key") || "";
  return String(raw).trim();
}

function hashBody(body) {
  // Stable across key order so a client that serialises the same object
  // differently between attempts is not falsely rejected as a key reuse.
  const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
      return Object.keys(value)
        .sort()
        .reduce((acc, k) => {
          acc[k] = stable(value[k]);
          return acc;
        }, {});
    }
    return value;
  };
  return crypto.createHash("sha256").update(JSON.stringify(stable(body ?? null))).digest("hex");
}

/**
 * Deduplicates a write request by `Idempotency-Key`.
 *
 * Mount on any route where the same submission can legitimately arrive twice:
 * a user double-tapping Save, an interceptor retry, or — the case this was
 * built for — a client that gave up on a slow request the server went on to
 * commit, and then retried it.
 *
 * Without a key the request behaves exactly as it did before, so adding this
 * middleware breaks no existing caller.
 *
 * Semantics:
 *   - first request with a key  → claimed, handler runs, 2xx response stored
 *   - repeat after completion   → the stored response is replayed verbatim
 *   - repeat while in flight    → 409 IDEMPOTENT_REQUEST_IN_PROGRESS
 *   - same key, different body  → 422 IDEMPOTENCY_KEY_REUSED
 *   - handler failed (non-2xx)  → claim released, so a corrected retry works
 *
 * Deliberately fails OPEN: if the dedupe store itself is unavailable we run the
 * handler rather than refuse the write. Losing a trade the user entered is a
 * worse outcome than the duplicate this is guarding against.
 */
function idempotency(req, res, next) {
  const key = readKey(req);
  if (!key) return next();

  if (key.length > MAX_KEY_LENGTH) {
    return next(
      new ApiError(400, "Idempotency-Key is too long", "VALIDATION_ERROR")
    );
  }
  if (!req.user?._id) {
    // Keys are scoped per user; an unauthenticated route has no scope to use.
    return next();
  }

  const userId = req.user._id;
  const requestHash = hashBody(req.body);

  const replay = (record) => {
    res.set("Idempotent-Replay", "true");
    res.locals.standardApiResponse = true;
    return res.status(record.responseStatus || 200).json(record.responseBody);
  };

  IdempotencyRecord.create({
    user: userId,
    key,
    method: req.method,
    path: req.originalUrl?.split("?")[0] || "",
    requestHash,
    status: "in_progress",
  })
    .then(() => {
      // We own this key. Capture the response so a repeat can replay it.
      const originalJson = res.json.bind(res);
      let captured = false;

      res.json = (body) => {
        if (captured) return originalJson(body);
        captured = true;

        const status = res.statusCode || 200;
        if (status >= 200 && status < 300) {
          IdempotencyRecord.updateOne(
            { user: userId, key },
            {
              $set: {
                status: "completed",
                responseStatus: status,
                responseBody: body,
                completedAt: new Date(),
              },
            }
          ).catch((error) => {
            logger.warn("IDEMPOTENCY_STORE_FAILED", { key, error: error.message });
          });
        } else {
          // Not a success, so nothing worth replaying — and holding the claim
          // would block the user from retrying a request they can fix (a
          // validation error, a quota refusal they then resolve by upgrading).
          IdempotencyRecord.deleteOne({ user: userId, key }).catch((error) => {
            logger.warn("IDEMPOTENCY_RELEASE_FAILED", { key, error: error.message });
          });
        }
        return originalJson(body);
      };

      // A handler that throws never reaches res.json, so the claim would
      // outlive the failed attempt and wedge the key for the full TTL.
      res.on("finish", () => {
        if (captured) return;
        IdempotencyRecord.deleteOne({ user: userId, key, status: "in_progress" }).catch(() => {});
      });

      next();
    })
    .catch(async (error) => {
      if (error?.code !== 11000) {
        logger.warn("IDEMPOTENCY_CLAIM_FAILED_OPEN", {
          key,
          error: error.message,
        });
        return next();
      }

      try {
        const existing = await IdempotencyRecord.findOne({ user: userId, key }).lean();
        if (!existing) {
          // Raced with its own expiry/release. Treat as a fresh request.
          return next();
        }
        if (existing.requestHash && existing.requestHash !== requestHash) {
          return next(
            new ApiError(
              422,
              "This Idempotency-Key was already used for a different request.",
              "IDEMPOTENCY_KEY_REUSED"
            )
          );
        }
        if (existing.status === "completed" && existing.responseBody) {
          logger.info("IDEMPOTENT_REPLAY", {
            key,
            userId: userId?.toString?.(),
            path: existing.path,
          });
          return replay(existing);
        }
        // Still running. Answering 409 rather than waiting keeps the socket
        // free; the client already holds the first request and will get its
        // answer there.
        return next(
          new ApiError(
            409,
            "This request is already being processed. Please wait a moment.",
            "IDEMPOTENT_REQUEST_IN_PROGRESS",
            null,
            true
          )
        );
      } catch (lookupError) {
        logger.warn("IDEMPOTENCY_LOOKUP_FAILED_OPEN", {
          key,
          error: lookupError.message,
        });
        return next();
      }
    });
}

module.exports = { idempotency, hashBody };
