"use strict";

// ─── Real-time developer notifications (Phase 7) ────────────────────────────
//
// Google publishes every subscription lifecycle change to a Cloud Pub/Sub
// topic, which push-delivers to this service. Without it, the only state we
// would ever know is what the app happened to report at purchase time — so
// renewals, cancellations, refunds, holds and expiries would silently never
// land, and a cancelled subscriber would keep PRO forever.
//
// Deliberately mirrors the Razorpay webhook design rather than inventing a
// second one: the same WebhookEvent collection, the same atomic
// claim-and-lock, the same reconciliation and retention crons. The only real
// differences are how the sender is authenticated (Google signs an OIDC token
// instead of an HMAC) and that the notification body is a nudge rather than a
// payload — we always re-read the truth from the Play API.

const { OAuth2Client } = require("google-auth-library");
const WebhookEvent = require("../models/WebhookEvent");
const ApiError = require("../utils/ApiError");
const { logger } = require("../utils/logger");
const { appConfig, assertGooglePlayRtdnConfig } = require("../config");
const { describeRtdnType } = require("../constants/googlePlay");
const { fingerprintPurchaseToken } = require("../utils/playAccountIdentity");
const { handleSubscriptionNotification } = require("./googlePlayBillingService");

const PROVIDER = "google_play";
const STALE_LOCK_MS = 10 * 60 * 1000;

// Verifying Google's signature needs Google's public keys; the client caches
// them internally, so this is built once.
const oidcClient = new OAuth2Client();

/**
 * Authenticate the push request.
 *
 * Pub/Sub signs each push with an OIDC token in the Authorization header. Two
 * things must hold, and BOTH matter:
 *
 *   - the token is genuinely signed by Google (checked cryptographically), and
 *   - its `email` claim is OUR push subscription's service account.
 *
 * Checking only the signature would accept a token any Google customer can
 * mint for their own service account — which is to say, anyone. The `aud`
 * check pins it further to this exact endpoint URL, so a token issued for some
 * other service of ours cannot be replayed here either.
 *
 * This is the whole authentication story for the endpoint: the request body is
 * not signed and must never be trusted on its own.
 */
async function verifyPushAuthentication(authorizationHeader) {
  const config = assertGooglePlayRtdnConfig();

  const header = String(authorizationHeader || "");
  if (!header.startsWith("Bearer ")) {
    throw new ApiError(401, "Unauthorized", "PLAY_RTDN_UNAUTHORIZED");
  }

  const idToken = header.slice(7).trim();
  if (!idToken) {
    throw new ApiError(401, "Unauthorized", "PLAY_RTDN_UNAUTHORIZED");
  }

  let ticket;
  try {
    ticket = await oidcClient.verifyIdToken({
      idToken,
      audience: config.rtdnAudience,
    });
  } catch (error) {
    // Never log the token. The failure reason is enough to tell a
    // misconfiguration apart from a forgery attempt.
    logger.warn("PLAY_RTDN_TOKEN_INVALID", { error: error?.message });
    throw new ApiError(401, "Unauthorized", "PLAY_RTDN_UNAUTHORIZED");
  }

  const claims = ticket.getPayload() || {};
  if (claims.email_verified !== true || claims.email !== config.rtdnServiceAccountEmail) {
    logger.warn("PLAY_RTDN_WRONG_PRINCIPAL", {
      // The service-account email is not a secret and is exactly what an
      // operator needs to fix the Pub/Sub subscription.
      presented: claims.email || null,
      expected: config.rtdnServiceAccountEmail,
    });
    throw new ApiError(401, "Unauthorized", "PLAY_RTDN_UNAUTHORIZED");
  }

  return claims;
}

/**
 * Unwrap the Pub/Sub push envelope into Google's DeveloperNotification.
 */
function parseNotification(rawBody) {
  let envelope;
  try {
    envelope = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || ""));
  } catch {
    throw new ApiError(400, "Invalid notification payload", "PLAY_RTDN_INVALID_JSON");
  }

  const message = envelope?.message;
  if (!message?.data) {
    throw new ApiError(400, "Notification is missing message data", "PLAY_RTDN_INVALID_PAYLOAD");
  }

  let notification;
  try {
    notification = JSON.parse(Buffer.from(message.data, "base64").toString("utf8"));
  } catch {
    throw new ApiError(400, "Notification data is not valid JSON", "PLAY_RTDN_INVALID_JSON");
  }

  return {
    // Pub/Sub reuses messageId across redeliveries of the same message, which
    // is exactly the idempotency key we need. Falling back to a composite of
    // the token and event time keeps dedupe working if it is ever absent.
    messageId:
      message.messageId ||
      `${notification?.subscriptionNotification?.purchaseToken || "unknown"}:${notification?.eventTimeMillis || ""}`,
    publishTime: message.publishTime || null,
    notification,
  };
}

/**
 * Atomically create-or-claim the event. Identical contract to the Razorpay
 * equivalent: exactly one caller ever gets `locked: true` for a given event.
 */
async function upsertAndLockEvent({ eventId, eventType, payload }) {
  const staleBefore = new Date(Date.now() - STALE_LOCK_MS);
  const now = new Date();

  try {
    const locked = await WebhookEvent.findOneAndUpdate(
      {
        eventId,
        processed: false,
        $or: [
          { processing: false },
          { processing: { $exists: false } },
          { processingStartedAt: { $lt: staleBefore } },
        ],
      },
      {
        $setOnInsert: {
          eventId,
          eventType,
          provider: PROVIDER,
          processed: false,
          payload,
        },
        $set: { processing: true, processingStartedAt: now, processingError: null },
        $inc: { deliveryAttempts: 1, processingAttempts: 1 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return { locked: true, event: locked };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const existing = await WebhookEvent.findOneAndUpdate(
      { eventId },
      { $inc: { deliveryAttempts: 1 } },
      { new: true }
    );
    if (existing?.processed) return { locked: false, processed: true };
    return { locked: false, inProgress: true };
  }
}

/**
 * Act on one DeveloperNotification.
 *
 * Every subscription notification takes the same route — re-read the
 * authoritative state from Google and reconcile — regardless of its type. See
 * googlePlayBillingService.handleSubscriptionNotification for why branching on
 * the type is a trap.
 */
async function processNotification(notification) {
  const packageName = notification?.packageName;

  // A notification for a different app is either a misrouted topic or an
  // attempt to drive our handler with someone else's data.
  if (packageName && packageName !== appConfig.googlePlay.packageName) {
    logger.warn("PLAY_RTDN_PACKAGE_MISMATCH", {
      received: packageName,
      expected: appConfig.googlePlay.packageName,
    });
    return { skipped: true, reason: "package_mismatch" };
  }

  // Play Console's "Send test notification" button. Confirms the topic and the
  // push subscription are wired up; there is nothing to reconcile.
  if (notification?.testNotification) {
    logger.info("PLAY_RTDN_TEST_RECEIVED", { version: notification.testNotification.version });
    return { skipped: true, reason: "test_notification" };
  }

  const subscriptionNotification = notification?.subscriptionNotification;
  const voidedPurchase = notification?.voidedPurchaseNotification;

  // A refund or chargeback. Routed through the same sync — Play reports the
  // purchase as expired/revoked, so entitlement is withdrawn by the normal
  // path rather than by a bespoke revoke branch that could drift.
  if (voidedPurchase?.purchaseToken) {
    const result = await handleSubscriptionNotification({
      purchaseToken: voidedPurchase.purchaseToken,
      notificationType: "VOIDED_PURCHASE",
      eventTimeMillis: notification?.eventTimeMillis,
    });
    return {
      handled: true,
      type: "VOIDED_PURCHASE",
      entitled: Boolean(result.entitled),
      stale: Boolean(result.stale),
    };
  }

  if (!subscriptionNotification?.purchaseToken) {
    // One-time product notifications land here. Edgecipline sells no one-time
    // products on Play, so there is nothing to do — but it is recorded rather
    // than dropped so an unexpected stream of them is visible.
    logger.info("PLAY_RTDN_UNSUPPORTED", {
      keys: Object.keys(notification || {}),
    });
    return { skipped: true, reason: "unsupported_notification" };
  }

  const typeName = describeRtdnType(subscriptionNotification.notificationType);
  const result = await handleSubscriptionNotification({
    purchaseToken: subscriptionNotification.purchaseToken,
    notificationType: typeName,
    eventTimeMillis: notification?.eventTimeMillis,
  });

  return {
    handled: true,
    type: typeName,
    entitled: Boolean(result.entitled),
    stale: Boolean(result.stale),
  };
}

/**
 * Endpoint entry point. Authenticates, dedupes, processes.
 *
 * Throws on a processing failure so the caller returns non-2xx and Pub/Sub
 * retries — with the reconciliation cron as the backstop for when it gives up.
 * A duplicate delivery is NOT a failure and returns quietly.
 */
async function processGooglePlayNotification({ rawBody, authorizationHeader }) {
  await verifyPushAuthentication(authorizationHeader);

  const { messageId, notification } = parseNotification(rawBody);

  const subscriptionNotification = notification?.subscriptionNotification;
  const eventType = notification?.testNotification
    ? "TEST_NOTIFICATION"
    : notification?.voidedPurchaseNotification
      ? "VOIDED_PURCHASE"
      : describeRtdnType(subscriptionNotification?.notificationType);

  logger.info("PLAY_RTDN_RECEIVED", {
    eventId: messageId,
    eventType,
    // Fingerprint, never the token itself.
    purchaseRef: fingerprintPurchaseToken(
      subscriptionNotification?.purchaseToken || notification?.voidedPurchaseNotification?.purchaseToken
    ),
  });

  const claim = await upsertAndLockEvent({
    eventId: messageId,
    eventType,
    payload: notification,
  });

  if (!claim.locked) {
    logger.info("PLAY_RTDN_DUPLICATE_IGNORED", {
      eventId: messageId,
      eventType,
      reason: claim.processed ? "already_processed" : "in_progress",
    });
    return { idempotent: true, ...claim };
  }

  try {
    const result = await processNotification(notification);
    await WebhookEvent.updateOne(
      { eventId: messageId },
      {
        processed: true,
        processing: false,
        processedAt: new Date(),
        processingResult: result,
        processingError: null,
      }
    );
    logger.info("PLAY_RTDN_PROCESSED", { eventId: messageId, eventType, ...result });
    return { processed: true, result };
  } catch (error) {
    // Release the lock so a retry (Pub/Sub's or the cron's) can claim it.
    // Leaving `processed` false is what makes the event recoverable.
    await WebhookEvent.updateOne(
      { eventId: messageId },
      { processing: false, processingError: error?.message || "Unknown error" }
    ).catch(() => {});
    logger.error("PLAY_RTDN_PROCESSING_FAILED", {
      eventId: messageId,
      eventType,
      error: error?.message,
    });
    throw error;
  }
}

/**
 * Re-run a stored Play notification. Used only by the reconciliation cron.
 *
 * Push authentication is not repeated: the event document only exists because
 * processGooglePlayNotification already verified Google's OIDC token before
 * the upsert, and the stored payload is re-validated against the Play API on
 * every replay anyway.
 */
async function reprocessStoredPlayEvent(eventId, maxAttempts) {
  const staleBefore = new Date(Date.now() - STALE_LOCK_MS);

  const claimed = await WebhookEvent.findOneAndUpdate(
    {
      eventId,
      provider: PROVIDER,
      processed: false,
      permanentlyFailed: { $ne: true },
      processingAttempts: { $lt: maxAttempts },
      $or: [
        { processing: false },
        { processing: { $exists: false } },
        { processingStartedAt: { $lt: staleBefore } },
      ],
    },
    { $set: { processing: true, processingStartedAt: new Date() }, $inc: { processingAttempts: 1 } },
    { new: true }
  );

  if (!claimed) return null;

  try {
    const result = await processNotification(claimed.payload);
    await WebhookEvent.updateOne(
      { eventId },
      {
        processed: true,
        processing: false,
        processedAt: new Date(),
        processingResult: result,
        processingError: null,
      }
    );
    logger.info("PLAY_RTDN_RECONCILED", { eventId, eventType: claimed.eventType });
    return { recovered: true, eventId, eventType: claimed.eventType, result };
  } catch (error) {
    const exhausted = claimed.processingAttempts >= maxAttempts;
    await WebhookEvent.updateOne(
      { eventId },
      {
        processing: false,
        processingError: error?.message || "Unknown reconciliation error",
        ...(exhausted ? { permanentlyFailed: true, permanentlyFailedAt: new Date() } : {}),
      }
    );
    logger.error("PLAY_RTDN_RECONCILE_FAILED", {
      eventId,
      eventType: claimed.eventType,
      attempt: claimed.processingAttempts,
      exhausted,
      error: error?.message,
    });
    return { recovered: false, eventId, eventType: claimed.eventType, exhausted };
  }
}

module.exports = {
  processGooglePlayNotification,
  reprocessStoredPlayEvent,
  // Exported for testing
  parseNotification,
  processNotification,
  verifyPushAuthentication,
};
