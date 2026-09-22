"use strict";

// ─── Google Play billing — verification, entitlement, lifecycle ─────────────
//
// ONE code path — syncPurchase() — serves all three entry points:
//
//   POST /api/payments/google-play/verify    (user just bought)
//   POST /api/payments/google-play/restore   (reinstall / new device / re-login)
//   POST /api/payments/webhook/google-play   (Google says something changed)
//
// They differ only in who triggered them. Every one of them re-reads the
// authoritative state from Google and recomputes from scratch, so there is no
// "initial purchase" special case that can drift out of sync with renewals —
// the single most common way these integrations rot.
//
// NOTHING the client sends is trusted except the purchase token, and that only
// as an opaque key to ask Google about. Product, base plan, price, state,
// expiry, renewal flag and account binding all come from Google's response.

const PlaySubscription = require("../models/PlaySubscription");
const User = require("../models/Users");
const ApiError = require("../utils/ApiError");
const { logger } = require("../utils/logger");
const { appConfig } = require("../config");
const { invalidateAuthCache } = require("./authCacheService");
const { captureOperationalError } = require("../config/sentry");
const analytics = require("./analyticsEventService");
const {
  getSubscriptionPurchase,
  acknowledgeSubscriptionPurchase,
  areCredentialsUsable,
} = require("./googlePlayApiService");
const {
  isAllowedProductId,
  getBasePlan,
  isWellFormedPurchaseToken,
  mapPlayState,
  grantsEntitlement,
  SUBSCRIPTION_STATES,
  PRODUCT_ID,
} = require("../constants/googlePlay");
const {
  verifyObfuscatedAccountId,
  fingerprintPurchaseToken,
} = require("../utils/playAccountIdentity");
const { resolveSubscriptionPlanLabel } = require("./paymentService");

// ─── Normalising Google's response ──────────────────────────────────────────

/**
 * Flatten a purchases.subscriptionsv2 response into the handful of facts we
 * actually store. Google nests the interesting parts inside `lineItems`, one
 * per base plan in the purchase; Edgecipline sells a single base plan at a time
 * so there is exactly one, but we pick the longest-lived rather than [0] so a
 * multi-line purchase can never be under-credited.
 */
function normalizePlayPurchase(raw) {
  const lineItems = Array.isArray(raw?.lineItems) ? raw.lineItems : [];

  const lineItem = lineItems.reduce((furthest, item) => {
    if (!furthest) return item;
    const a = new Date(item?.expiryTime || 0).getTime();
    const b = new Date(furthest?.expiryTime || 0).getTime();
    return a > b ? item : furthest;
  }, null);

  const state = mapPlayState(raw?.subscriptionState);
  const autoRenewEnabled = Boolean(lineItem?.autoRenewingPlan?.autoRenewEnabled);

  return {
    productId: lineItem?.productId || null,
    basePlanId: lineItem?.offerDetails?.basePlanId || null,
    offerId: lineItem?.offerDetails?.offerId || null,
    state,
    playState: raw?.subscriptionState || null,
    expiryTime: lineItem?.expiryTime ? new Date(lineItem.expiryTime) : null,
    startTime: raw?.startTime ? new Date(raw.startTime) : null,
    autoRenewing: autoRenewEnabled,
    // Google reports CANCELED for "auto-renew off but still paid through
    // expiry". Surfacing it as an explicit flag keeps the UI honest — the user
    // is still PRO, they simply will not be charged again.
    cancelAtPeriodEnd: state === SUBSCRIPTION_STATES.CANCELLED || !autoRenewEnabled,
    latestOrderId: raw?.latestOrderId || null,
    linkedPurchaseToken: raw?.linkedPurchaseToken || null,
    acknowledged: raw?.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    // Presence of the `testPurchase` object is how Google flags a licence
    // tester's purchase. It is a real purchase in every other respect but must
    // never be counted as revenue.
    testPurchase: Boolean(raw?.testPurchase),
    obfuscatedAccountId:
      raw?.externalAccountIdentifiers?.obfuscatedExternalAccountId || null,
    regionCode: raw?.regionCode || null,
  };
}

// ─── Entitlement projection onto the User document ──────────────────────────

/**
 * Recompute and write the Play half of this user's entitlement from EVERY
 * PlaySubscription row they own — never from the single token that happened
 * to trigger the sync.
 *
 * Why not project the current token: a user legitimately holds more than one
 * row. After a plan change the superseded token gets its own EXPIRED RTDN, a
 * restore batch can carry a pending token next to the active one, and a
 * resubscribe leaves the old expired row behind. Projecting any of those
 * onto the user would null an entitlement that another token still funds.
 *
 * Deliberately touches ONLY `playEntitlementExpiry` (plus the cosmetic plan
 * label). It must never set subscriptionStatus/subscriptionExpiry:
 *
 *   - those two are the Razorpay prepaid ledger, maintained by paymentService
 *     and the hourly expiry cron, and
 *   - `hasActiveSubscription()` treats status "active" with a NULL expiry as
 *     unlimited access. A Play write that set status without a matching expiry
 *     would hand out permanent free premium.
 *
 * When nothing entitles, the field keeps the most recent PAID-THROUGH date
 * (never a future one — an ON_HOLD row still reports a future expiryTime and
 * writing that would grant access) so the settings page can say "expired"
 * rather than "never paid". `hasActivePlaySubscription` compares dates, so a
 * past date is exactly as locked-out as null.
 */
async function recomputePlayEntitlement(userId, { session = null } = {}) {
  const now = Date.now();

  let query = PlaySubscription.find({ user: userId, supersededAt: null, detachedAt: null })
    .select("state expiryTime basePlanId supersededAt detachedAt")
    .lean();
  if (session) query = query.session(session);
  const rows = (await query) || [];

  let entitledExpiry = null;
  let entitlingRow = null;
  let latestExpiry = null;

  for (const row of rows) {
    const expiry = row.expiryTime ? new Date(row.expiryTime) : null;
    // A PENDING row never granted anything, so it must not leave a "lapsed"
    // date behind — that would tell a first-time buyer they had expired.
    const everPaid = expiry && row.state !== SUBSCRIPTION_STATES.PENDING;
    if (everPaid && (!latestExpiry || expiry > latestExpiry)) latestExpiry = expiry;
    if (grantsEntitlement(row.state, row.expiryTime, now) && (!entitledExpiry || expiry > entitledExpiry)) {
      entitledExpiry = expiry;
      entitlingRow = row;
    }
  }

  let playEntitlementExpiry = entitledExpiry;
  if (!playEntitlementExpiry && latestExpiry) {
    // Lapsed: keep the date for "expired on" display, but cap it at now so a
    // held/paused row with a future expiryTime can never read as active.
    playEntitlementExpiry = latestExpiry.getTime() < now ? latestExpiry : new Date(now - 1);
  }

  const update = { $set: { playEntitlementExpiry } };

  const basePlan = entitlingRow ? getBasePlan(entitlingRow.basePlanId) : null;
  if (basePlan?.userPlan) {
    // Read-modify-write via the same rank guard the Razorpay path uses, so a
    // Play monthly purchase cannot relabel a user who still holds a longer
    // web plan. Cosmetic only — no entitlement depends on this field.
    const current = await User.findById(userId).select("subscriptionPlan").lean().session(session);
    update.$set.subscriptionPlan = resolveSubscriptionPlanLabel(
      current?.subscriptionPlan,
      basePlan.userPlan
    );
  }

  await User.updateOne({ _id: userId }, update, { session });

  // A stale cache entry keeps the OLD entitlement for up to the cache TTL
  // (~300s). On a grant that is a paying user still being told to upgrade; on
  // a revoke it is free premium. Awaited so the response that follows can
  // never be served from the pre-write snapshot. invalidateAuthCache never
  // throws — it logs and returns false.
  await invalidateAuthCache(userId);

  return { entitled: Boolean(entitledExpiry), expiry: playEntitlementExpiry, basePlan };
}

/**
 * Backwards-compatible name. Every caller now recomputes from the user's rows;
 * the per-token arguments are ignored on purpose (see recomputePlayEntitlement).
 */
async function applyPlayEntitlement({ userId, session } = {}) {
  return recomputePlayEntitlement(userId, { session });
}

// ─── Account association (Phase 9) ──────────────────────────────────────────

/**
 * Decide which Edgecipline account this purchase belongs to, and refuse rather
 * than guess when the answer is ambiguous.
 *
 * The rules, in order:
 *
 *   1. The token is already bound to a user. That binding is FINAL — it is
 *      enforced by the unique index on purchaseToken and never reassigned.
 *      A different user presenting it is rejected, which is precisely the
 *      "log out, log in as someone else, inherit their subscription" case.
 *   2. The token was DETACHED (its owner deleted their account —
 *      `detachedAt` is set). It stays spent forever. Re-binding it would
 *      resurrect a subscription onto a stranger's account. An RTDN for such a
 *      token is still synced (state bookkeeping) but grants nobody anything.
 *   3. The token is new to this account — either no row exists, or the row
 *      was created by an RTDN that beat the app's verify call and has no
 *      user yet. Google's echoed obfuscatedAccountId must either match this
 *      user or be absent; a mismatch means the purchase was started under a
 *      different Edgecipline account and is refused.
 */
function resolvePurchaseOwner({ existing, claimingUserId, purchase, tokenFingerprint }) {
  if (existing?.detachedAt) {
    if (!claimingUserId) {
      return { userId: null, identity: "detached", mismatch: false };
    }
    logger.warn("PLAY_PURCHASE_DETACHED_CLAIM", {
      purchaseRef: tokenFingerprint,
      claimingUserId: String(claimingUserId),
    });
    throw new ApiError(
      409,
      "This purchase is linked to an account that has been deleted and cannot be reused.",
      "PLAY_PURCHASE_DETACHED"
    );
  }

  if (existing?.user) {
    if (claimingUserId && String(existing.user) !== String(claimingUserId)) {
      logger.warn("PLAY_PURCHASE_OWNERSHIP_CONFLICT", {
        purchaseRef: tokenFingerprint,
        boundUserId: String(existing.user),
        claimingUserId: String(claimingUserId),
      });
      throw new ApiError(
        409,
        "This Google Play subscription is already linked to a different Edgecipline account.",
        "PLAY_PURCHASE_ALREADY_CLAIMED"
      );
    }
    return { userId: existing.user, identity: "bound", mismatch: false };
  }

  if (!claimingUserId) {
    // An RTDN arrived for a token nobody has claimed yet. We cannot reverse
    // the HMAC to find the owner, and guessing is unthinkable. Recording it
    // and moving on is safe: the device that made the purchase will present
    // the token at the next verify/restore and the branch below binds it.
    return { userId: null, identity: "unknown", mismatch: false };
  }

  // No row, or an unbound row (RTDN-first). Either way this is the first
  // account to claim the token, so the echoed identifier decides.
  const identity = verifyObfuscatedAccountId(purchase.obfuscatedAccountId, claimingUserId);

  if (identity === "mismatch") {
    logger.warn("PLAY_PURCHASE_ACCOUNT_MISMATCH", {
      purchaseRef: tokenFingerprint,
      claimingUserId: String(claimingUserId),
    });
    throw new ApiError(
      409,
      "This Google Play subscription was purchased under a different Edgecipline account. "
        + "Sign in with that account, or contact support.",
      "PLAY_PURCHASE_ACCOUNT_MISMATCH"
    );
  }

  if (identity === "absent") {
    // Pre-dates the obfuscated id, or a restore path that does not carry it.
    // The token still came from Play's own queryPurchases on a device where
    // this user is signed in, so we bind and leave a trail.
    logger.info("PLAY_PURCHASE_UNVERIFIED_IDENTITY", {
      purchaseRef: tokenFingerprint,
      userId: String(claimingUserId),
    });
  }

  return { userId: claimingUserId, identity, mismatch: false };
}

// ─── Acknowledgement (Phase 6) ──────────────────────────────────────────────

/**
 * Acknowledge a purchase, idempotently.
 *
 * Google auto-refunds and revokes any subscription purchase left
 * unacknowledged for three days, so a silent failure here is lost revenue AND
 * a customer who loses access without explanation.
 *
 * Never acknowledges a purchase that failed verification (callers only reach
 * this after the product allowlist and ownership checks have passed) and never
 * one that is not actually entitling — acknowledging a PENDING purchase would
 * confirm a transaction Google has not completed.
 *
 * A failure here does NOT fail the request. The entitlement has already been
 * granted from verified state; what remains is a retryable side effect, and
 * the unacknowledged-sweep index on PlaySubscription exists to find it.
 */
async function acknowledgeIfNeeded({ record, purchase, tokenFingerprint }) {
  if (purchase.acknowledged || record?.acknowledged) return { acknowledged: true, changed: false };
  if (!grantsEntitlement(purchase.state, purchase.expiryTime)) {
    return { acknowledged: false, changed: false, skipped: "not_entitling" };
  }

  try {
    await acknowledgeSubscriptionPurchase(purchase.productId || PRODUCT_ID, record.purchaseToken);
    await PlaySubscription.updateOne(
      { _id: record._id },
      {
        $set: { acknowledged: true, acknowledgedAt: new Date(), lastAcknowledgementError: null },
        $inc: { acknowledgementAttempts: 1 },
      }
    );
    logger.info("PLAY_ACKNOWLEDGEMENT_OK", { purchaseRef: tokenFingerprint });
    return { acknowledged: true, changed: true };
  } catch (error) {
    // "Already acknowledged" comes back as a 400. That is success, not
    // failure — it happens whenever two handlers race, which is routine when a
    // verify request and the SUBSCRIPTION_PURCHASED RTDN arrive together.
    const alreadyAcknowledged =
      error?.playHttpStatus === 400 && /already/i.test(String(error?.message || ""));

    if (alreadyAcknowledged) {
      await PlaySubscription.updateOne(
        { _id: record._id },
        { $set: { acknowledged: true, acknowledgedAt: new Date() } }
      );
      return { acknowledged: true, changed: true };
    }

    await PlaySubscription.updateOne(
      { _id: record._id },
      {
        $set: { lastAcknowledgementError: String(error?.message || "unknown").slice(0, 300) },
        $inc: { acknowledgementAttempts: 1 },
      }
    );
    // Loud on purpose: three days of this and Google takes the money back.
    logger.error("PLAY_ACKNOWLEDGEMENT_FAILED", {
      purchaseRef: tokenFingerprint,
      code: error?.errorCode || null,
      error: error?.message,
    });
    captureOperationalError(error, {
      subsystem: "google_play",
      tags: { operation: "acknowledge" },
      extra: { purchaseRef: tokenFingerprint },
    });
    return { acknowledged: false, changed: false, error: error?.message };
  }
}

// ─── The one sync path ──────────────────────────────────────────────────────

/**
 * Re-read a purchase from Google and make Edgecipline agree with it.
 *
 * @param {string}  purchaseToken  opaque token from Play Billing
 * @param {string?} userId         the AUTHENTICATED user, never a client-supplied id.
 *                                 null for RTDN, where there is no request user.
 * @param {string}  source         "verify" | "restore" | "rtdn" | "reconcile"
 * @param {object?} notification   RTDN metadata, for ordering/observability
 */
async function syncPurchase({ purchaseToken, userId = null, source = "verify", notification = null }) {
  if (!isWellFormedPurchaseToken(purchaseToken)) {
    throw new ApiError(400, "Invalid purchase token", "PLAY_PURCHASE_TOKEN_INVALID");
  }

  const tokenFingerprint = fingerprintPurchaseToken(purchaseToken);

  logger.info("PLAY_VERIFICATION_STARTED", { purchaseRef: tokenFingerprint, source });

  const raw = await getSubscriptionPurchase(purchaseToken);
  // Stamped AFTER the response lands, so it orders snapshots by when they were
  // observed. Using the request start instead would let a slow call that began
  // earlier overwrite a fast one that saw newer state.
  const fetchedAt = new Date();
  const purchase = normalizePlayPurchase(raw);

  // Phase 4: the product must be OURS. A token minted against a different
  // developer's product, or against a product we have retired, gets no further.
  if (!isAllowedProductId(purchase.productId)) {
    logger.warn("PLAY_PRODUCT_NOT_ALLOWED", {
      purchaseRef: tokenFingerprint,
      source,
      productId: purchase.productId,
    });
    throw new ApiError(
      400,
      "This purchase is not for an Edgecipline subscription",
      "PLAY_PRODUCT_NOT_ALLOWED"
    );
  }

  const basePlan = getBasePlan(purchase.basePlanId);
  if (!basePlan) {
    // Phase 4 again: a base plan that exists in Play Console but not in
    // constants/googlePlay is not something we sell. Refuse rather than grant
    // with an unknown plan — the fix is to add it to BASE_PLANS, and until
    // then the purchase is recorded in Google's own ledger, not lost.
    logger.warn("PLAY_BASE_PLAN_UNKNOWN", {
      purchaseRef: tokenFingerprint,
      source,
      basePlanId: purchase.basePlanId,
    });
    throw new ApiError(400, "Unknown subscription plan", "PLAY_BASE_PLAN_UNKNOWN");
  }

  const existing = await PlaySubscription.findOne({ purchaseToken }).lean();
  const owner = resolvePurchaseOwner({ existing, claimingUserId: userId, purchase, tokenFingerprint });

  // Ordering guard (Phase 7): never let an older snapshot overwrite a newer
  // one. Two RTDNs, or an RTDN racing a verify, can arrive out of order.
  if (existing?.lastSyncedAt && new Date(existing.lastSyncedAt) > fetchedAt) {
    logger.info("PLAY_SYNC_SKIPPED_STALE", {
      purchaseRef: tokenFingerprint,
      source,
      storedSyncedAt: existing.lastSyncedAt,
      incomingSyncedAt: fetchedAt,
    });
    return settleStaleSync({ current: existing, claimingUserId: userId, purchase, tokenFingerprint, source });
  }

  const entitled = grantsEntitlement(purchase.state, purchase.expiryTime);

  const update = {
    $set: {
      productId: purchase.productId,
      basePlanId: purchase.basePlanId,
      offerId: purchase.offerId,
      planType: basePlan.planType,
      state: purchase.state,
      playState: purchase.playState,
      autoRenewing: purchase.autoRenewing,
      cancelAtPeriodEnd: purchase.cancelAtPeriodEnd,
      startTime: purchase.startTime,
      expiryTime: purchase.expiryTime,
      latestOrderId: purchase.latestOrderId,
      linkedPurchaseToken: purchase.linkedPurchaseToken,
      testPurchase: purchase.testPurchase,
      obfuscatedAccountId: purchase.obfuscatedAccountId,
      regionCode: purchase.regionCode,
      acknowledged: purchase.acknowledged || Boolean(existing?.acknowledged),
      lastSyncedAt: fetchedAt,
      lastEventTimeMillis: Number(notification?.eventTimeMillis) || existing?.lastEventTimeMillis || 0,
      lastNotificationType: notification?.type || existing?.lastNotificationType || null,
    },
    $setOnInsert: { purchaseToken },
  };

  // Only ever SET the owner, never change it. Combined with the unique index
  // this is what makes a binding permanent.
  if (owner.userId && !existing?.user) {
    update.$set.user = owner.userId;
  }
  if (owner.identity === "absent") {
    update.$set.accountMismatchAt = null;
  }

  const filter = {
    purchaseToken,
    // Re-assert the ordering guard inside the write so two concurrent
    // handlers cannot both pass the read-time check above.
    $or: [{ lastSyncedAt: null }, { lastSyncedAt: { $lte: fetchedAt } }],
  };
  if (owner.userId) {
    // And re-assert ownership inside the write: if another account bound the
    // token between our read and this write, the filter misses, the upsert
    // collides with the unique index, and the race branch below re-checks
    // ownership against the row that won. A binding can never be overwritten.
    filter.user = { $in: [null, owner.userId] };
  }

  let record;
  try {
    record = await PlaySubscription.findOneAndUpdate(filter, update, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    });
  } catch (error) {
    if (error?.code === 11000) {
      // The upsert lost a race: another handler inserted the row between our
      // read and our write, so the filter's ordering clause no longer matched
      // and Mongo tried a fresh insert against the unique index. The winner's
      // snapshot is at least as fresh as ours, so adopting it is correct —
      // but the winner may have been an RTDN with no user, so the claiming
      // account still has to be bound.
      logger.info("PLAY_SYNC_LOST_UPSERT_RACE", { purchaseRef: tokenFingerprint, source });
      const current = await PlaySubscription.findOne({ purchaseToken }).lean();
      return settleStaleSync({ current, claimingUserId: userId, purchase, tokenFingerprint, source });
    }
    throw error;
  }

  // An upgrade or downgrade does not mutate the old token — Google issues a new
  // one and points it back. Retire the predecessor so the user does not appear
  // to hold two live subscriptions. Its owner is normally this user, but the
  // entitlement of whoever it was is recomputed below either way.
  let supersededOwnerId = null;
  if (purchase.linkedPurchaseToken) {
    try {
      const superseded = await PlaySubscription.findOneAndUpdate(
        { purchaseToken: purchase.linkedPurchaseToken, supersededAt: null },
        { $set: { supersededAt: new Date(), state: SUBSCRIPTION_STATES.EXPIRED } },
        { new: true, lean: true }
      );
      if (superseded?.user && String(superseded.user) !== String(owner.userId || "")) {
        supersededOwnerId = superseded.user;
      }
    } catch (error) {
      logger.warn("PLAY_SUPERSEDE_FAILED", { purchaseRef: tokenFingerprint, error: error?.message });
    }
  }

  // Acknowledge BEFORE granting, so that a purchase we are about to honour is
  // one Google will not claw back. A failure is logged and retried later
  // rather than blocking the entitlement the user has already paid for.
  const ack = await acknowledgeIfNeeded({ record, purchase, tokenFingerprint });

  let userEntitled = false;
  if (owner.userId) {
    // Entitlement is derived from EVERY row this user owns, never from this
    // token alone — see recomputePlayEntitlement.
    const projection = await recomputePlayEntitlement(owner.userId);
    userEntitled = projection.entitled;
    emitTelemetry({ owner, existing, purchase, basePlan, entitled, source, tokenFingerprint });
  } else {
    logger.info("PLAY_SYNC_UNBOUND", {
      purchaseRef: tokenFingerprint,
      source,
      state: purchase.state,
      detached: owner.identity === "detached",
      note: owner.identity === "detached"
        ? "Owner deleted their account; the token stays spent."
        : "No Edgecipline account is linked to this purchase yet; the next verify or restore will bind it.",
    });
  }
  if (supersededOwnerId) {
    await recomputePlayEntitlement(supersededOwnerId);
  }

  logger.info("PLAY_VERIFICATION_SUCCEEDED", {
    purchaseRef: tokenFingerprint,
    source,
    userId: owner.userId ? String(owner.userId) : null,
    state: purchase.state,
    entitled,
    userEntitled,
    acknowledged: ack.acknowledged,
    expiryTime: purchase.expiryTime ? purchase.expiryTime.toISOString() : null,
    testPurchase: purchase.testPurchase,
  });

  return {
    stale: false,
    record,
    purchase,
    basePlan,
    // `entitled` is THIS token's entitlement (what the verify response reports
    // for the purchase just made); `userEntitled` is the account's overall
    // Play entitlement after the recompute.
    entitled,
    userEntitled,
    acknowledged: ack.acknowledged,
  };
}

/**
 * The tail of a sync that did not get to write because a fresher snapshot
 * already exists (read-time stale check, or a lost upsert race).
 *
 * The fresher row is authoritative for STATE, but it may have been written by
 * an RTDN — which has no user — while this call comes from an authenticated
 * account. Returning "stale" without binding would leave a paying user's
 * purchase ownerless and their next restore refused, so the claiming account
 * is bound here under the same ownership rules as the main path.
 */
async function settleStaleSync({ current, claimingUserId, purchase, tokenFingerprint, source }) {
  if (!current) {
    return { stale: true, record: null, entitled: false, userEntitled: false };
  }

  // Throws PLAY_PURCHASE_ALREADY_CLAIMED / DETACHED / ACCOUNT_MISMATCH exactly
  // as the main path would, against the row that actually won.
  const owner = resolvePurchaseOwner({ existing: current, claimingUserId, purchase, tokenFingerprint });

  let record = current;
  if (owner.userId && !current.user) {
    const bound = await PlaySubscription.findOneAndUpdate(
      { purchaseToken: current.purchaseToken, user: null, detachedAt: null },
      {
        $set: {
          user: owner.userId,
          ...(owner.identity === "absent" ? { accountMismatchAt: null } : {}),
        },
      },
      { new: true, lean: true }
    );
    if (bound) {
      record = bound;
      logger.info("PLAY_SYNC_BOUND_AFTER_RACE", {
        purchaseRef: tokenFingerprint,
        source,
        userId: String(owner.userId),
      });
    } else {
      // Somebody bound it between our read and this write. Re-check against
      // the latest row; a different owner throws, the same owner proceeds.
      const latest = await PlaySubscription.findOne({ purchaseToken: current.purchaseToken }).lean();
      resolvePurchaseOwner({ existing: latest, claimingUserId, purchase, tokenFingerprint });
      record = latest || current;
    }
  }

  let userEntitled = false;
  if (record?.user) {
    // Idempotent: the winner already did this for its own view; doing it
    // again from the rows guarantees the binding above is reflected.
    const projection = await recomputePlayEntitlement(record.user);
    userEntitled = projection.entitled;
  }

  return { stale: true, record, entitled: isRecordEntitling(record), userEntitled };
}

function isRecordEntitling(record) {
  if (!record) return false;
  if (record.supersededAt) return false;
  if (record.detachedAt) return false;
  return grantsEntitlement(record.state, record.expiryTime);
}

function emitTelemetry({ owner, existing, purchase, basePlan, entitled, source, tokenFingerprint }) {
  const stateChanged = existing?.state !== purchase.state;
  if (!stateChanged && source !== "verify") return;

  // Never include the purchase token or the obfuscated account id.
  analytics.track("play_subscription_state_changed", {
    userId: owner.userId,
    properties: {
      source,
      previousState: existing?.state || null,
      state: purchase.state,
      entitled,
      basePlanId: purchase.basePlanId,
      planType: basePlan?.planType || null,
      autoRenewing: purchase.autoRenewing,
      testPurchase: purchase.testPurchase,
      purchaseRef: tokenFingerprint,
    },
  });

  // First activation of a purchase we had not seen — the Android equivalent of
  // paymentService's subscription_started.
  if (!existing && entitled) {
    analytics.track("subscription_started", {
      userId: owner.userId,
      properties: {
        planType: basePlan?.planType || null,
        billingProvider: "google_play",
        days: basePlan?.days || null,
        source: `google_play_${source}`,
        testPurchase: purchase.testPurchase,
      },
    });
  }
}

// ─── Public entry points ────────────────────────────────────────────────────

/**
 * A user has just completed a purchase in the Android app.
 */
async function verifyPurchase({ userId, purchaseToken, productId }) {
  // The client tells us which product it thinks it bought. We do not trust it,
  // but a mismatch against the allowlist is worth rejecting before spending a
  // Play API call, and worth logging as a possible tampering attempt.
  if (productId && !isAllowedProductId(productId)) {
    logger.warn("PLAY_CLIENT_PRODUCT_REJECTED", {
      userId: String(userId),
      productId: String(productId).slice(0, 100),
    });
    throw new ApiError(400, "Unknown subscription product", "PLAY_PRODUCT_NOT_ALLOWED");
  }
  return syncPurchase({ purchaseToken, userId, source: "verify" });
}

/**
 * Reconcile every purchase the device can see with this account (Phase 10).
 *
 * Called after a reinstall, a device change, a re-login, or "Restore purchases".
 * The client sends whatever Play's queryPurchases returned; each is verified
 * server-side exactly as a fresh purchase would be. A locally cached purchase
 * grants nothing on its own.
 *
 * Partial success is the norm here — a device may hold a purchase belonging to
 * a different Edgecipline account alongside a valid one — so each token is
 * reported individually instead of failing the whole batch.
 */
async function restorePurchases({ userId, purchaseTokens }) {
  const tokens = [...new Set((Array.isArray(purchaseTokens) ? purchaseTokens : []).filter(Boolean))];

  if (!tokens.length) {
    return { restored: 0, entitled: false, results: [] };
  }
  // Play returns at most a handful of purchases for one product. A long list
  // is either a bug or someone probing tokens, and each entry costs a Play API
  // call, so cap it rather than fanning out.
  if (tokens.length > 10) {
    throw new ApiError(400, "Too many purchases to restore at once", "VALIDATION_ERROR");
  }

  const results = [];
  for (const purchaseToken of tokens) {
    try {
      const outcome = await syncPurchase({ purchaseToken, userId, source: "restore" });
      results.push({
        purchaseRef: fingerprintPurchaseToken(purchaseToken),
        status: outcome.entitled ? "active" : "inactive",
        state: outcome.record?.state || null,
      });
    } catch (error) {
      results.push({
        purchaseRef: fingerprintPurchaseToken(purchaseToken),
        status: "failed",
        code: error?.errorCode || "GOOGLE_PLAY_UNAVAILABLE",
        // Ownership conflicts are the one failure worth showing the user, so
        // the message is passed through for those and generic otherwise.
        message: error?.statusCode === 409 ? error.message : undefined,
      });
    }
  }

  return {
    restored: results.filter((r) => r.status === "active").length,
    entitled: results.some((r) => r.status === "active"),
    results,
  };
}

/**
 * Google told us a subscription changed. Re-read and reconcile.
 *
 * Note this ignores the notification TYPE entirely and just re-fetches. That is
 * deliberate: Google's own guidance is that the notification is a nudge, not a
 * payload, and branching on the type is how an implementation ends up handling
 * eleven of the fourteen cases and silently mishandling the rest.
 */
async function handleSubscriptionNotification({ purchaseToken, notificationType, eventTimeMillis }) {
  return syncPurchase({
    purchaseToken,
    userId: null,
    source: "rtdn",
    notification: { type: notificationType, eventTimeMillis },
  });
}

/**
 * The entitlement snapshot the Android app renders (Phase 12). Derived from
 * MongoDB, never from anything the device believes.
 */
async function getPlaySubscriptionSummary(userId) {
  const rows = await PlaySubscription.find({ user: userId, supersededAt: null, detachedAt: null }).lean();
  if (!rows?.length) return null;

  // The row the user would call "my subscription": a live one first, then a
  // purchase Google is still confirming (a pending row has no expiryTime and
  // would otherwise lose to any long-expired row), then whatever ran last.
  // At most a handful of rows per user, so sorting in JS is fine.
  const rank = (row) => (isRecordEntitling(row) ? 2 : row.state === SUBSCRIPTION_STATES.PENDING ? 1 : 0);
  const record = [...rows].sort((a, b) => {
    const byRank = rank(b) - rank(a);
    if (byRank !== 0) return byRank;
    return new Date(b.expiryTime || 0).getTime() - new Date(a.expiryTime || 0).getTime();
  })[0];

  return {
    state: record.state,
    active: isRecordEntitling(record),
    productId: record.productId,
    basePlanId: record.basePlanId,
    planType: record.planType,
    expiresAt: record.expiryTime || null,
    autoRenewing: record.autoRenewing,
    cancelAtPeriodEnd: record.cancelAtPeriodEnd,
    // A non-reversible fingerprint of the purchase token. The Android paywall
    // compares it against the fingerprint of the purchases the DEVICE holds so
    // a plan change replaces THIS subscription and not, on a shared phone,
    // somebody else's. Never expose purchaseToken, latestOrderId or
    // obfuscatedAccountId themselves — they are credentials/identifiers.
    purchaseRef: fingerprintPurchaseToken(record.purchaseToken),
  };
}

/**
 * True when Play billing is configured well enough to accept a purchase. The
 * Android client asks before showing a paywall, so a misconfigured server
 * produces "temporarily unavailable" rather than a checkout that dead-ends
 * after the user has been charged.
 */
function isPlayBillingAvailable() {
  const config = appConfig.googlePlay;
  return Boolean(
    config?.enabled &&
      config.packageName &&
      config.clientEmail &&
      config.privateKey &&
      // The boot-time credential check (server.js → assertCredentialsUsable)
      // flips this off when Google rejects the key, so a misconfigured deploy
      // shows "temporarily unavailable" instead of charging and then failing.
      areCredentialsUsable()
  );
}

module.exports = {
  verifyPurchase,
  restorePurchases,
  handleSubscriptionNotification,
  getPlaySubscriptionSummary,
  isPlayBillingAvailable,
  syncPurchase,
  recomputePlayEntitlement,
  // Exported for testing
  normalizePlayPurchase,
  resolvePurchaseOwner,
  applyPlayEntitlement,
  isRecordEntitling,
  settleStaleSync,
};
