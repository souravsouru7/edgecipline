"use strict";

const crypto = require("crypto");
const { appConfig } = require("../config");

// ─── Binding a Play purchase to the right Edgecipline account (Phase 9) ─────
//
// The attack this exists to stop:
//
//     User A signs in  →  buys on Google Play  →  signs out
//                      →  User B signs in on the same device
//                      →  B's app queries Play, finds A's purchase, sends it up
//
// Google Play knows nothing about Edgecipline accounts. It only knows the
// Google account that paid, and that account stays signed in on the device. So
// without an application-level binding, B's client presents a perfectly valid
// purchase token and the backend has no way to tell it was not B's.
//
// The fix is Play's obfuscatedAccountId: the Android client passes an opaque
// per-user string into the billing flow, and the Play Developer API echoes it
// back on every subsequent read. We set it to an HMAC of the Edgecipline user
// id, so the token itself proves which account started the purchase — without
// ever putting a real user id on Google's servers (Google's own docs require
// this value not to be PII, and a raw Mongo ObjectId is a stable identifier).
//
// Defence in depth: this is the check for a purchase we have not seen before.
// Once a token IS bound in the PlaySubscription collection, the unique index on
// purchaseToken is the stronger guarantee — a bound token is never re-bound to
// anyone else, whatever it claims.

// Domain-separated so this HMAC can never collide with another use of the same
// secret elsewhere in the app.
const HMAC_LABEL = "edgecipline:play:account:v1";

// Play caps obfuscatedAccountId at 64 characters. A full hex SHA-256 is exactly
// 64, so there is nothing to truncate — but the slice is kept explicit so a
// future switch to a longer digest cannot silently start producing values Play
// rejects at purchase time.
const MAX_LENGTH = 64;

// Falls back to the admin JWT secret, matching how support.feedbackFingerprintSalt
// degrades: a missing env var still yields something secret rather than an
// unsalted, brute-forceable hash of an ObjectId (the id space is small and
// guessable enough to matter).
//
// IMPORTANT: rotating this invalidates the binding on every EXISTING purchase.
// Already-bound tokens keep working — they are matched by the unique index in
// MongoDB, not by this value — but a restore of a purchase we have never seen
// will fail its identity check and land as a flagged row for support. Treat it
// as append-only key material, not as a rotatable secret.
function getSalt() {
  return appConfig.googlePlay?.accountSalt || appConfig.jwt.adminSecret;
}

/**
 * The value the Android client must pass to Play as obfuscatedAccountId when
 * launching the billing flow, and which the backend re-derives to verify it.
 */
function buildObfuscatedAccountId(userId) {
  const id = String(userId || "").trim();
  if (!id) return null;
  return crypto
    .createHmac("sha256", getSalt())
    .update(`${HMAC_LABEL}:${id}`)
    .digest("hex")
    .slice(0, MAX_LENGTH);
}

/**
 * Constant-time comparison of the identifier Google echoed back against the one
 * this user should have produced.
 *
 * Returns one of:
 *   "match"    — Google's value is ours. Safe to bind.
 *   "mismatch" — Google's value belongs to a DIFFERENT account. Never bind.
 *   "absent"   — Google returned no identifier at all.
 *
 * "absent" is not a failure. It happens for purchases made before this feature
 * shipped, and for some restore paths, and the token in that case still came
 * from Play's own queryPurchases on a device where the user is signed in. There
 * is no stronger signal available, so the caller binds it and logs — refusing
 * would strand real subscribers with no way to recover their purchase.
 */
function verifyObfuscatedAccountId(echoedValue, userId) {
  const echoed = String(echoedValue || "").trim();
  if (!echoed) return "absent";

  const expected = buildObfuscatedAccountId(userId);
  if (!expected) return "mismatch";

  const a = Buffer.from(echoed, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual throws on a length mismatch, which is itself a mismatch.
  if (a.length !== b.length) return "mismatch";
  return crypto.timingSafeEqual(a, b) ? "match" : "mismatch";
}

/**
 * A short, non-reversible fingerprint of a purchase token, for logs and Sentry.
 *
 * A purchase token is a bearer credential: anyone holding it can ask Google
 * about the subscription, and it is the key our own verify endpoint accepts.
 * It must never appear in a log line, an error message, or an analytics
 * property. This gives operators something stable to correlate a purchase
 * across the verify → acknowledge → RTDN chain without leaking the token.
 */
function fingerprintPurchaseToken(purchaseToken) {
  const token = String(purchaseToken || "");
  if (!token) return null;
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}

module.exports = {
  buildObfuscatedAccountId,
  verifyObfuscatedAccountId,
  fingerprintPurchaseToken,
};
