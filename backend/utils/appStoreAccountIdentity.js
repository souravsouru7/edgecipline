"use strict";

// The appAccountToken that binds an Apple purchase to an Edgecipline account.
//
// StoreKit lets the app attach a UUID to a purchase (Product.PurchaseOption
// .appAccountToken), and Apple then echoes it, signed, in every transaction of
// that subscription chain — including renewals and Server Notifications. The
// backend re-derives the expected UUID for the claiming user and refuses a
// transaction carrying someone else's. This is the Apple twin of Play's
// obfuscatedAccountId (utils/playAccountIdentity).
//
// An HMAC rather than the raw user id so the value Apple stores reveals
// nothing about our database, and so it cannot be forged without the salt.

const crypto = require("crypto");
const { appConfig } = require("../config");

const HMAC_LABEL = "edgecipline:appstore:account:v1";

function getSalt() {
  return appConfig.appStore?.accountSalt || appConfig.jwt.adminSecret;
}

/**
 * Deterministic UUID (RFC 4122 layout, version 4 / variant bits set) for a
 * user. Lower-case, which is how StoreKit reports it back.
 */
function buildAppAccountToken(userId) {
  const id = String(userId || "").trim();
  if (!id) return null;
  const bytes = crypto
    .createHmac("sha256", getSalt())
    .update(`${HMAC_LABEL}:${id}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function matchesUser(appAccountToken, userId) {
  const expected = buildAppAccountToken(userId);
  if (!expected || !appAccountToken) return false;
  const given = String(appAccountToken).trim().toLowerCase();
  return given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

module.exports = { buildAppAccountToken, matchesUser };
