"use strict";

// ─── Apple In-App Purchase — verification and entitlement ───────────────────
//
// The iOS twin of googlePlayBillingService, built on the same rules:
//
//   * Nothing the iOS client says is trusted. The client hands over Apple's
//     SIGNED transaction (a JWS); SignedDataVerifier checks the chain up to
//     Apple Root CA - G3, the bundle id and the environment before anything
//     is read from it.
//   * One AppStoreSubscription row per subscription chain, keyed on Apple's
//     originalTransactionId. A chain binds to one account, permanently, and a
//     detached row (owner deleted their account) never re-binds.
//   * Entitlement is recomputed from the user's rows into
//     User.appStoreEntitlementExpiry, a field only this service writes and
//     which never touches the Razorpay ledger (see utils/premium).
//
// When the App Store Server API key is configured, the subscription's status
// is read from Apple (getAllSubscriptionStatuses) — authoritative for billing
// retry, grace period and revocation. Without it, state comes from the signed
// transaction plus App Store Server Notifications V2.

const fs = require("fs");
const path = require("path");
const {
  SignedDataVerifier,
  AppStoreServerAPIClient,
  Environment,
} = require("@apple/app-store-server-library");

const AppStoreSubscription = require("../models/AppStoreSubscription");
const User = require("../models/Users");
const ApiError = require("../utils/ApiError");
const { logger } = require("../utils/logger");
const { appConfig } = require("../config");
const { invalidateAuthCache } = require("./authCacheService");
const { resolveSubscriptionPlanLabel } = require("./paymentService");
const { matchesUser } = require("../utils/appStoreAccountIdentity");
const {
  getProduct,
  isAllowedProductId,
  mapAppleStatus,
  stateFromTransaction,
  grantsEntitlement,
} = require("../constants/appStore");
const { SUBSCRIPTION_STATES } = require("../constants/googlePlay");

const ROOT_CERT_DIR = path.join(__dirname, "..", "certs", "apple");

// JWS strings are three base64url segments; Apple's run to a few KB.
const SIGNED_DATA_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_SIGNED_LENGTH = 20000;

function isWellFormedSignedData(value) {
  const s = String(value || "");
  return s.length <= MAX_SIGNED_LENGTH && SIGNED_DATA_PATTERN.test(s);
}

// ─── Configuration ──────────────────────────────────────────────────────────

function isAppStoreBillingAvailable() {
  return appConfig.appStore?.enabled === true && Boolean(appConfig.appStore?.bundleId);
}

function isServerApiConfigured() {
  const { issuerId, keyId, privateKey } = appConfig.appStore || {};
  return Boolean(issuerId && keyId && privateKey);
}

let rootCertificates = null;
function loadRootCertificates() {
  if (!rootCertificates) {
    rootCertificates = fs
      .readdirSync(ROOT_CERT_DIR)
      .filter((name) => name.endsWith(".cer"))
      .map((name) => fs.readFileSync(path.join(ROOT_CERT_DIR, name)));
    if (!rootCertificates.length) {
      throw new Error(`No Apple root certificates found in ${ROOT_CERT_DIR}`);
    }
  }
  return rootCertificates;
}

/**
 * Environments this deployment will accept signed data from. Xcode/local
 * StoreKit testing is never accepted in production: those transactions are
 * signed by Xcode, not Apple, and the library does not verify their chain.
 */
function allowedEnvironments() {
  const envs = [Environment.PRODUCTION];
  if (appConfig.appStore.allowSandbox) envs.push(Environment.SANDBOX);
  if (appConfig.appStore.allowXcode && appConfig.env !== "production") {
    envs.push(Environment.XCODE, Environment.LOCAL_TESTING);
  }
  return envs;
}

const verifiers = new Map();
function getVerifier(environment) {
  if (!verifiers.has(environment)) {
    verifiers.set(
      environment,
      new SignedDataVerifier(
        loadRootCertificates(),
        // Online revocation (OCSP) checks for the signing certificate.
        environment === Environment.PRODUCTION || environment === Environment.SANDBOX,
        environment,
        appConfig.appStore.bundleId,
        environment === Environment.PRODUCTION ? appConfig.appStore.appAppleId : undefined
      )
    );
  }
  return verifiers.get(environment);
}

const apiClients = new Map();
function getApiClient(environment) {
  if (!isServerApiConfigured()) return null;
  if (environment !== Environment.PRODUCTION && environment !== Environment.SANDBOX) return null;
  if (!apiClients.has(environment)) {
    const { privateKey, keyId, issuerId, bundleId } = appConfig.appStore;
    apiClients.set(environment, new AppStoreServerAPIClient(privateKey, keyId, issuerId, bundleId, environment));
  }
  return apiClients.get(environment);
}

/**
 * Read the environment a JWS claims WITHOUT trusting it, purely to choose
 * which verifier to run. The verifier then checks that the signed payload's
 * environment matches, so a lie here only causes a rejection.
 */
function peekEnvironment(signed) {
  try {
    const payload = JSON.parse(Buffer.from(String(signed).split(".")[1], "base64url").toString("utf8"));
    return payload.environment || payload.data?.environment || null;
  } catch {
    return null;
  }
}

async function verifySigned(signed, kind) {
  if (!isWellFormedSignedData(signed)) {
    throw new ApiError(400, "Invalid App Store data", "APP_STORE_SIGNED_DATA_INVALID");
  }
  const environment = peekEnvironment(signed);
  if (!allowedEnvironments().includes(environment)) {
    logger.warn("APP_STORE_ENVIRONMENT_REJECTED", { environment, kind });
    throw new ApiError(400, "This purchase environment is not accepted", "APP_STORE_ENVIRONMENT_REJECTED");
  }
  const verifier = getVerifier(environment);
  try {
    if (kind === "notification") return { environment, payload: await verifier.verifyAndDecodeNotification(signed) };
    if (kind === "renewal") return { environment, payload: await verifier.verifyAndDecodeRenewalInfo(signed) };
    return { environment, payload: await verifier.verifyAndDecodeTransaction(signed) };
  } catch (err) {
    logger.warn("APP_STORE_VERIFICATION_FAILED", { kind, environment, status: err?.status });
    throw new ApiError(400, "Could not verify this App Store purchase", "APP_STORE_VERIFICATION_FAILED");
  }
}

// ─── State ──────────────────────────────────────────────────────────────────

const toDate = (ms) => (ms ? new Date(Number(ms)) : null);

/**
 * Authoritative state for a chain. Prefers the App Store Server API; falls
 * back to the signed transaction when the API is not configured or fails —
 * a failed lookup must never strip access the signed data proves.
 */
async function resolveChainState({ transaction, environment }) {
  const fromTransaction = {
    state: stateFromTransaction(transaction),
    appleStatus: null,
    autoRenewing: null,
    expiryTime: toDate(transaction.expiresDate),
    revokedAt: toDate(transaction.revocationDate),
    latestTransaction: transaction,
  };

  const client = getApiClient(environment);
  if (!client) return fromTransaction;

  try {
    const response = await client.getAllSubscriptionStatuses(transaction.originalTransactionId);
    for (const group of response.data || []) {
      for (const item of group.lastTransactions || []) {
        if (String(item.originalTransactionId) !== String(transaction.originalTransactionId)) continue;
        const latest = (await verifySigned(item.signedTransactionInfo, "transaction")).payload;
        const renewal = item.signedRenewalInfo
          ? (await verifySigned(item.signedRenewalInfo, "renewal")).payload
          : null;
        return {
          state: latest.revocationDate ? SUBSCRIPTION_STATES.REVOKED : mapAppleStatus(item.status),
          appleStatus: item.status,
          autoRenewing: renewal ? renewal.autoRenewStatus === 1 : null,
          // In billing grace the access window is the grace expiry, not the
          // lapsed period end.
          expiryTime: toDate(renewal?.gracePeriodExpiresDate) || toDate(latest.expiresDate),
          revokedAt: toDate(latest.revocationDate),
          latestTransaction: latest,
        };
      }
    }
  } catch (err) {
    logger.warn("APP_STORE_STATUS_LOOKUP_FAILED", {
      originalTransactionId: String(transaction.originalTransactionId),
      error: err?.message || String(err),
    });
  }
  return fromTransaction;
}

/**
 * Recompute User.appStoreEntitlementExpiry from every chain the user owns —
 * same algorithm as recomputePlayEntitlement, so the two stores behave alike.
 */
async function recomputeAppStoreEntitlement(userId) {
  const now = Date.now();
  const rows = await AppStoreSubscription.find({ user: userId, detachedAt: null })
    .select("state expiryTime productId")
    .lean();

  let entitledExpiry = null;
  let entitlingRow = null;
  let latestExpiry = null;
  for (const row of rows || []) {
    const expiry = row.expiryTime ? new Date(row.expiryTime) : null;
    const everPaid = expiry && row.state !== SUBSCRIPTION_STATES.PENDING;
    if (everPaid && (!latestExpiry || expiry > latestExpiry)) latestExpiry = expiry;
    if (grantsEntitlement(row.state, row.expiryTime, now) && (!entitledExpiry || expiry > entitledExpiry)) {
      entitledExpiry = expiry;
      entitlingRow = row;
    }
  }

  let appStoreEntitlementExpiry = entitledExpiry;
  if (!appStoreEntitlementExpiry && latestExpiry) {
    // Lapsed: keep the date for "expired on", capped so it can never read active.
    appStoreEntitlementExpiry = latestExpiry.getTime() < now ? latestExpiry : new Date(now - 1);
  }

  const update = { $set: { appStoreEntitlementExpiry } };
  const product = entitlingRow ? getProduct(entitlingRow.productId) : null;
  if (product?.userPlan) {
    const current = await User.findById(userId).select("subscriptionPlan").lean();
    update.$set.subscriptionPlan = resolveSubscriptionPlanLabel(current?.subscriptionPlan, product.userPlan);
  }

  await User.updateOne({ _id: userId }, update);
  await invalidateAuthCache(userId);
  return { entitled: Boolean(entitledExpiry), expiry: appStoreEntitlementExpiry, product };
}

// ─── Ownership ──────────────────────────────────────────────────────────────

/**
 * Which account a chain belongs to. Mirrors resolvePurchaseOwner for Play:
 *   1. Already bound → final; another user presenting it is refused.
 *   2. Detached (owner deleted their account) → spent forever.
 *   3. New, or created unbound by a Server Notification → the signed
 *      appAccountToken must match the claiming user.
 */
function resolveOwner({ existing, claimingUserId, transaction }) {
  if (existing?.user) {
    if (String(existing.user) !== String(claimingUserId)) {
      throw new ApiError(409, "This purchase belongs to a different account", "APP_STORE_PURCHASE_OWNED_ELSEWHERE");
    }
    return claimingUserId;
  }
  if (existing?.detachedAt) {
    throw new ApiError(409, "This purchase can no longer be restored", "APP_STORE_PURCHASE_DETACHED");
  }
  if (!matchesUser(transaction.appAccountToken, claimingUserId)) {
    throw new ApiError(409, "This purchase was made from a different account", "APP_STORE_ACCOUNT_MISMATCH");
  }
  return claimingUserId;
}

// ─── Sync ───────────────────────────────────────────────────────────────────

async function upsertChain({ transaction, environment, userId, notificationType = null, renewal = null }) {
  if (!isAllowedProductId(transaction.productId)) {
    throw new ApiError(400, "Unknown App Store product", "APP_STORE_PRODUCT_UNKNOWN");
  }
  const chain = await resolveChainState({ transaction, environment });
  const latest = chain.latestTransaction || transaction;
  const product = getProduct(latest.productId) || getProduct(transaction.productId);

  const set = {
    latestTransactionId: String(latest.transactionId),
    appAccountToken: latest.appAccountToken || transaction.appAccountToken || null,
    productId: product.productId,
    planType: product.planType,
    state: chain.state,
    appleStatus: chain.appleStatus,
    environment,
    purchaseDate: toDate(latest.purchaseDate),
    expiryTime: chain.expiryTime,
    revokedAt: chain.revokedAt,
    lastSyncedAt: new Date(),
  };
  // Auto-renew, most authoritative source first: the Server API, then renewal
  // info signed into a notification. Otherwise left as it was (null = unknown).
  if (chain.autoRenewing !== null) set.autoRenewing = chain.autoRenewing;
  else if (renewal && renewal.autoRenewStatus !== undefined) set.autoRenewing = renewal.autoRenewStatus === 1;
  if (notificationType) set.lastNotificationType = notificationType;
  if (userId) set.user = userId;

  return AppStoreSubscription.findOneAndUpdate(
    { originalTransactionId: String(transaction.originalTransactionId) },
    { $set: set, $setOnInsert: { originalTransactionId: String(transaction.originalTransactionId) } },
    { upsert: true, new: true }
  ).lean();
}

async function syncTransaction({ userId, signedTransaction }) {
  const { environment, payload: transaction } = await verifySigned(signedTransaction, "transaction");
  if (!transaction?.originalTransactionId) {
    throw new ApiError(400, "Invalid App Store transaction", "APP_STORE_SIGNED_DATA_INVALID");
  }
  const existing = await AppStoreSubscription.findOne({
    originalTransactionId: String(transaction.originalTransactionId),
  }).lean();
  const owner = resolveOwner({ existing, claimingUserId: userId, transaction });
  const row = await upsertChain({ transaction, environment, userId: owner });
  return { row, environment };
}

/**
 * POST /verify — called by the app right after a successful StoreKit purchase.
 * The app must only finish() the transaction after this succeeds.
 */
async function verifyTransaction({ userId, signedTransaction }) {
  const { row, environment } = await syncTransaction({ userId, signedTransaction });
  const entitlement = await recomputeAppStoreEntitlement(userId);
  logger.info("APP_STORE_PURCHASE_VERIFIED", {
    userId: String(userId),
    productId: row.productId,
    state: row.state,
    environment,
    entitled: entitlement.entitled,
  });
  return { subscription: summarize(row), entitlement };
}

/**
 * POST /restore — every transaction in Transaction.currentEntitlements. Chains
 * owned by another account are skipped, not fatal, so one shared-device
 * purchase cannot block restoring the user's own.
 */
async function restoreTransactions({ userId, signedTransactions }) {
  const list = Array.isArray(signedTransactions) ? signedTransactions.slice(0, 20) : [];
  const results = [];
  for (const signedTransaction of list) {
    try {
      const { row } = await syncTransaction({ userId, signedTransaction });
      results.push({ ok: true, productId: row.productId, state: row.state });
    } catch (err) {
      results.push({ ok: false, errorCode: err?.errorCode || "APP_STORE_RESTORE_FAILED" });
    }
  }
  const entitlement = await recomputeAppStoreEntitlement(userId);
  logger.info("APP_STORE_RESTORE_COMPLETED", {
    userId: String(userId),
    attempted: list.length,
    restored: results.filter((r) => r.ok).length,
    entitled: entitlement.entitled,
  });
  return { results, entitlement };
}

/**
 * App Store Server Notifications V2. Every notification re-syncs the chain the
 * same way, rather than branching per type — the same choice the Play RTDN
 * handler makes, so this cannot drift from Apple's actual state.
 */
async function handleServerNotification(signedPayload) {
  const { environment, payload } = await verifySigned(signedPayload, "notification");
  const notificationType = payload.subtype
    ? `${payload.notificationType}:${payload.subtype}`
    : payload.notificationType;

  const signedTransactionInfo = payload.data?.signedTransactionInfo;
  if (!signedTransactionInfo) {
    // TEST notifications and app-level events carry no transaction.
    logger.info("APP_STORE_NOTIFICATION_IGNORED", { notificationType, environment });
    return { handled: false, notificationType };
  }

  const { payload: transaction } = await verifySigned(signedTransactionInfo, "transaction");
  if (!isAllowedProductId(transaction.productId)) {
    logger.warn("APP_STORE_NOTIFICATION_UNKNOWN_PRODUCT", { notificationType, productId: transaction.productId });
    return { handled: false, notificationType };
  }

  const existing = await AppStoreSubscription.findOne({
    originalTransactionId: String(transaction.originalTransactionId),
  }).lean();
  // A notification can arrive before the app's /verify call. The row is then
  // created unbound; /verify binds it once the buyer's appAccountToken matches.
  const owner = existing?.detachedAt ? null : existing?.user || null;
  let renewal = null;
  if (payload.data?.signedRenewalInfo) {
    try {
      renewal = (await verifySigned(payload.data.signedRenewalInfo, "renewal")).payload;
    } catch {
      renewal = null;
    }
  }
  const row = await upsertChain({ transaction, environment, userId: owner, notificationType, renewal });

  if (owner) await recomputeAppStoreEntitlement(owner);

  logger.info("APP_STORE_NOTIFICATION_PROCESSED", {
    notificationType,
    environment,
    state: row.state,
    bound: Boolean(owner),
  });
  return { handled: true, notificationType };
}

// ─── Read ───────────────────────────────────────────────────────────────────

function summarize(row) {
  if (!row) return null;
  return {
    productId: row.productId,
    planType: row.planType,
    state: row.state,
    autoRenewing: typeof row.autoRenewing === "boolean" ? row.autoRenewing : null,
    expiryTime: row.expiryTime || null,
    environment: row.environment,
    entitled: grantsEntitlement(row.state, row.expiryTime),
  };
}

async function getAppStoreSubscriptionSummary(userId) {
  const rows = await AppStoreSubscription.find({ user: userId, detachedAt: null })
    .sort({ expiryTime: -1 })
    .lean();
  const entitling = (rows || []).find((row) => grantsEntitlement(row.state, row.expiryTime));
  return summarize(entitling || rows?.[0] || null);
}

module.exports = {
  isAppStoreBillingAvailable,
  isServerApiConfigured,
  isWellFormedSignedData,
  verifyTransaction,
  restoreTransactions,
  handleServerNotification,
  recomputeAppStoreEntitlement,
  getAppStoreSubscriptionSummary,
  // exported for tests
  resolveOwner,
  allowedEnvironments,
};
