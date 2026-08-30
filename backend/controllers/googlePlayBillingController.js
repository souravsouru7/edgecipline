"use strict";

const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const { logger } = require("../utils/logger");
const { appConfig } = require("../config");
const {
  verifyPurchase,
  restorePurchases,
  getPlaySubscriptionSummary,
  isPlayBillingAvailable,
} = require("../services/googlePlayBillingService");
const {
  buildObfuscatedAccountId,
} = require("../utils/playAccountIdentity");
const {
  PRODUCT_ID,
  BASE_PLAN_IDS,
  isWellFormedPurchaseToken,
} = require("../constants/googlePlay");
const {
  isPremium,
  getEffectiveExpiry,
  getBillingProvider,
} = require("../utils/premium");

// Every handler here is mounted behind `protect`, so req.user is an
// authenticated Edgecipline account. The client NEVER supplies a user id —
// Phase 4 is explicit about this, and accepting one would make the whole
// account-binding scheme decorative.

function requireBillingConfigured() {
  if (!isPlayBillingAvailable()) {
    // 503 rather than 500: this is "not switched on yet", which is a
    // deployment state the client can render as "temporarily unavailable"
    // instead of an error. Never falls through to granting anything.
    throw new ApiError(
      503,
      "In-app purchases are temporarily unavailable. Please try again later.",
      "GOOGLE_PLAY_UNAVAILABLE",
      null,
      true
    );
  }
}

/**
 * GET /api/payments/google-play/config
 *
 * What the Android client needs before it can open a purchase flow: which
 * product and base plans to query from Play, and the obfuscated account id it
 * must attach to the purchase so the backend can bind it to this account.
 *
 * Carries NO prices. Play Console owns pricing and the Play Billing library
 * reports the localised, tax-inclusive figure for the user's own region — a
 * price sent from here could only ever disagree with what they are charged.
 */
exports.getBillingConfig = asyncHandler(async (req, res) => {
  const available = isPlayBillingAvailable();

  res.json({
    available,
    productId: PRODUCT_ID,
    basePlanIds: BASE_PLAN_IDS,
    // Opaque HMAC, not a user id — safe to hand to the client because that is
    // exactly where it has to go (into Play's billing flow), and it discloses
    // nothing about the account. See utils/playAccountIdentity.
    obfuscatedAccountId: available ? buildObfuscatedAccountId(req.user._id) : null,
    packageName: available ? appConfig.googlePlay.packageName : null,
  });
});

/**
 * POST /api/payments/google-play/verify
 *
 * Called immediately after Play reports a successful purchase. The response
 * from Play Billing on the device is NOT proof of anything — this endpoint is
 * what actually grants entitlement, and only after Google's own servers
 * confirm the purchase.
 *
 * Body: { purchaseToken, productId? }
 */
exports.verifyGooglePlayPurchase = asyncHandler(async (req, res) => {
  requireBillingConfigured();

  const { purchaseToken, productId } = req.body || {};

  if (!purchaseToken || typeof purchaseToken !== "string") {
    throw new ApiError(400, "purchaseToken is required", "VALIDATION_ERROR");
  }
  if (!isWellFormedPurchaseToken(purchaseToken)) {
    throw new ApiError(400, "Invalid purchase token", "PLAY_PURCHASE_TOKEN_INVALID");
  }

  const result = await verifyPurchase({
    userId: req.user._id,
    purchaseToken,
    productId,
  });

  // Re-read the user so the response reflects what was just written rather
  // than the (now stale) req.user snapshot the auth cache handed us.
  const subscription = await getPlaySubscriptionSummary(req.user._id);

  res.json({
    success: true,
    // `entitled` is the honest answer to "am I PRO now". A PENDING purchase
    // verifies fine and grants nothing — the client must render that as
    // "waiting for Google", never as a failure and never as success.
    entitled: Boolean(result.entitled),
    pending: subscription?.state === "pending",
    acknowledged: Boolean(result.acknowledged),
    subscription,
  });
});

/**
 * POST /api/payments/google-play/restore
 *
 * Phase 10. The client sends every purchase token Play's queryPurchases
 * returned; each is verified server-side from scratch. A locally cached
 * purchase grants nothing on its own.
 *
 * Body: { purchaseTokens: string[] }
 */
exports.restoreGooglePlayPurchases = asyncHandler(async (req, res) => {
  requireBillingConfigured();

  const { purchaseTokens } = req.body || {};

  if (!Array.isArray(purchaseTokens)) {
    throw new ApiError(400, "purchaseTokens must be an array", "VALIDATION_ERROR");
  }

  const result = await restorePurchases({
    userId: req.user._id,
    purchaseTokens: purchaseTokens.filter((token) => typeof token === "string"),
  });

  const subscription = await getPlaySubscriptionSummary(req.user._id);

  logger.info("PLAY_RESTORE_COMPLETED", {
    userId: String(req.user._id),
    submitted: purchaseTokens.length,
    restored: result.restored,
  });

  res.json({
    success: true,
    entitled: result.entitled,
    restored: result.restored,
    // Per-token outcomes carry only a fingerprint, never the token itself.
    results: result.results,
    subscription,
  });
});

/**
 * GET /api/payments/google-play/subscription
 *
 * The Play-specific detail (renewal date, auto-renew, cancel-at-period-end)
 * that GET /api/trial/status does not carry. Entitlement itself still comes
 * from the shared endpoint — this is for the "Manage subscription" screen.
 */
exports.getGooglePlaySubscription = asyncHandler(async (req, res) => {
  const subscription = await getPlaySubscriptionSummary(req.user._id);

  res.json({
    available: isPlayBillingAvailable(),
    isPremium: isPremium(req.user),
    provider: getBillingProvider(req.user),
    expiresAt: getEffectiveExpiry(req.user),
    subscription,
  });
});
