"use strict";

// HTTP layer for Apple In-App Purchase. Thin on purpose: every decision about
// what a transaction proves lives in services/appStoreBillingService.

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { logger } = require("../utils/logger");
const {
  isAppStoreBillingAvailable,
  isWellFormedSignedData,
  verifyTransaction,
  restoreTransactions,
  handleServerNotification,
  getAppStoreSubscriptionSummary,
} = require("../services/appStoreBillingService");
const { buildAppAccountToken } = require("../utils/appStoreAccountIdentity");
const { PRODUCT_IDS, SUBSCRIPTION_GROUP } = require("../constants/appStore");
const { isPremium, getEffectiveExpiry, getBillingProvider } = require("../utils/premium");
const User = require("../models/Users");

function requireBillingConfigured() {
  if (!isAppStoreBillingAvailable()) {
    throw new ApiError(
      503,
      "In-app purchases are temporarily unavailable. Please try again later.",
      "APP_STORE_UNAVAILABLE",
      null,
      true
    );
  }
}

async function entitlementSnapshot(userId) {
  const user = await User.findById(userId).lean();
  return {
    premium: isPremium(user),
    expiresAt: getEffectiveExpiry(user),
    provider: getBillingProvider(user),
  };
}

/**
 * GET /api/payments/app-store/config
 * Product ids for StoreKit to load (prices come from StoreKit, never from
 * here) and the appAccountToken the app must attach to every purchase.
 */
exports.getAppStoreConfig = asyncHandler(async (req, res) => {
  const available = isAppStoreBillingAvailable();
  res.json({
    available,
    subscriptionGroup: SUBSCRIPTION_GROUP,
    productIds: PRODUCT_IDS,
    appAccountToken: available ? buildAppAccountToken(req.user._id) : null,
    currentSubscription: available ? await getAppStoreSubscriptionSummary(req.user._id) : null,
  });
});

/** GET /api/payments/app-store/subscription */
exports.getAppStoreSubscription = asyncHandler(async (req, res) => {
  requireBillingConfigured();
  res.json({
    subscription: await getAppStoreSubscriptionSummary(req.user._id),
    ...(await entitlementSnapshot(req.user._id)),
  });
});

/**
 * POST /api/payments/app-store/verify
 * Body: { signedTransaction }  — StoreKit 2 Transaction.jwsRepresentation
 */
exports.verifyAppStorePurchase = asyncHandler(async (req, res) => {
  requireBillingConfigured();
  const { signedTransaction } = req.body || {};
  if (!isWellFormedSignedData(signedTransaction)) {
    throw new ApiError(400, "Invalid App Store transaction", "APP_STORE_SIGNED_DATA_INVALID");
  }
  const result = await verifyTransaction({ userId: req.user._id, signedTransaction });
  res.json({
    subscription: result.subscription,
    ...(await entitlementSnapshot(req.user._id)),
  });
});

/**
 * POST /api/payments/app-store/restore
 * Body: { signedTransactions: string[] }  — from Transaction.currentEntitlements
 */
exports.restoreAppStorePurchases = asyncHandler(async (req, res) => {
  requireBillingConfigured();
  const { signedTransactions } = req.body || {};
  if (!Array.isArray(signedTransactions)) {
    throw new ApiError(400, "signedTransactions must be an array", "VALIDATION_ERROR");
  }
  const result = await restoreTransactions({ userId: req.user._id, signedTransactions });
  res.json({
    results: result.results,
    subscription: await getAppStoreSubscriptionSummary(req.user._id),
    ...(await entitlementSnapshot(req.user._id)),
  });
});

/**
 * POST /api/webhooks/app-store — App Store Server Notifications V2.
 * Unauthenticated by design; trust comes from Apple's signature on
 * signedPayload. Answers 200 for anything verified (including types we ignore)
 * so Apple stops retrying, and 4xx for anything that fails verification.
 */
exports.handleAppStoreNotification = asyncHandler(async (req, res) => {
  let body = req.body;
  if (Buffer.isBuffer(body)) {
    try {
      body = JSON.parse(body.toString("utf8"));
    } catch {
      throw new ApiError(400, "Invalid notification body", "APP_STORE_NOTIFICATION_INVALID");
    }
  }
  const signedPayload = body?.signedPayload;
  if (!isWellFormedSignedData(signedPayload)) {
    throw new ApiError(400, "Invalid notification body", "APP_STORE_NOTIFICATION_INVALID");
  }
  if (!isAppStoreBillingAvailable()) {
    // Not live yet: tell Apple to retry later rather than dropping events.
    logger.warn("APP_STORE_NOTIFICATION_WHILE_DISABLED");
    throw new ApiError(503, "App Store billing is not enabled", "APP_STORE_UNAVAILABLE", null, true);
  }
  const result = await handleServerNotification(signedPayload);
  res.json({ received: true, handled: result.handled });
});
