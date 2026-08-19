const crypto = require("crypto");
const WebhookEvent = require("../models/WebhookEvent");
const { appConfig } = require("../config");
const ApiError = require("../utils/ApiError");
const { logger } = require("../utils/logger");
const analytics = require("./analyticsEventService");
const {
  activateRazorpaySubscriptionPayment,
  applyVerifiedRazorpayRefund,
  fetchAndValidateRazorpayPayment,
  getRazorpayClient,
} = require("./paymentService");

const SUPPORTED_EVENTS = new Set([
  "payment.captured",
  "order.paid",
  "payment.failed",
  "refund.processed",
  "payment.refunded",
]);

function verifyWebhookSignature(rawBody, signature) {
  const secret = String(appConfig.razorpay.webhookSecret || "").trim();
  if (!secret) {
    throw new ApiError(503, "Razorpay webhook secret is not configured", "RAZORPAY_WEBHOOK_CONFIG_MISSING");
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, "hex"),
      Buffer.from(String(signature || ""), "hex")
    );
  } catch (error) {
    // Length mismatch (truncated / non-hex signature) trips timingSafeEqual
    // before any comparison. Log the failure mode so operators can tell a
    // malformed signature apart from a wrong secret. Never log the signature
    // or expected value.
    logger.warn("[RazorpayWebhook] HMAC verify error", {
      code: error?.code || error?.name,
    });
    return false;
  }
}

function parseWebhookPayload(rawBody) {
  try {
    return JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || ""));
  } catch {
    throw new ApiError(400, "Invalid Razorpay webhook payload", "RAZORPAY_WEBHOOK_INVALID_JSON");
  }
}

function getEntity(payload, entityName) {
  return payload?.payload?.[entityName]?.entity || null;
}

function amountFromSubunits(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed / 100 : undefined;
}

async function findCapturedPaymentIdForOrder(orderId) {
  try {
    const result = await getRazorpayClient().orders.fetchPayments(orderId);
    const items = Array.isArray(result?.items) ? result.items : [];
    return items.find((item) => item.status === "captured" && item.captured === true)?.id || null;
  } catch (error) {
    throw new ApiError(502, "Unable to fetch Razorpay order payments", "RAZORPAY_VERIFICATION_FAILED");
  }
}

async function resolvePaymentActivation(payload) {
  const paymentEntity = getEntity(payload, "payment");
  const orderEntity = getEntity(payload, "order");
  const orderId = orderEntity?.id || paymentEntity?.order_id;
  if (!orderId) {
    throw new ApiError(422, "Razorpay webhook is missing an order ID", "RAZORPAY_WEBHOOK_ORDER_MISSING");
  }
  const paymentId = paymentEntity?.id || await findCapturedPaymentIdForOrder(orderId);
  if (!paymentId) {
    throw new ApiError(422, "Razorpay order has no captured payment", "RAZORPAY_WEBHOOK_PAYMENT_MISSING");
  }
  return fetchAndValidateRazorpayPayment({ orderId, paymentId });
}

async function resolveRefund(payload) {
  const refundEntity = getEntity(payload, "refund");
  const paymentEntity = getEntity(payload, "payment");
  const paymentId = refundEntity?.payment_id || paymentEntity?.id;
  if (!paymentId) {
    throw new ApiError(422, "Razorpay refund is missing a payment ID", "RAZORPAY_REFUND_INVALID");
  }

  const razorpay = getRazorpayClient();
  const [payment, refund] = await Promise.all([
    razorpay.payments.fetch(paymentId),
    refundEntity?.id ? razorpay.refunds.fetch(refundEntity.id) : Promise.resolve(null),
  ]);
  if (!payment || payment.id !== paymentId || payment.currency !== "INR") {
    throw new ApiError(400, "Razorpay refund payment verification failed", "PAYMENT_INTEGRITY_CHECK_FAILED");
  }
  if (refund && (refund.id !== refundEntity.id || refund.payment_id !== paymentId || refund.status !== "processed")) {
    throw new ApiError(400, "Razorpay refund verification failed", "PAYMENT_INTEGRITY_CHECK_FAILED");
  }

  const totalRefundedAmount = amountFromSubunits(payment.amount_refunded);
  const paymentAmount = amountFromSubunits(payment.amount);
  if (!totalRefundedAmount || !paymentAmount || totalRefundedAmount > paymentAmount) {
    throw new ApiError(400, "Razorpay refunded amount is invalid", "PAYMENT_INTEGRITY_CHECK_FAILED");
  }

  return {
    razorpayPaymentId: paymentId,
    refundKey: refund?.id || `payment_refunded:${paymentId}:${payment.amount_refunded}`,
    totalRefundedAmount,
    fullyRefunded: payment.amount_refunded === payment.amount && payment.status === "refunded",
  };
}

/**
 * Record a failed payment attempt for analytics and support.
 *
 * Deliberately writes NO Payment document. Razorpay can emit payment.failed
 * and later payment.captured for the SAME payment id (retries on the same
 * attempt, late authorisation). `Payment.transactionId` and the partial unique
 * index on `razorpayPaymentId` would both collide, and the activation path
 * treats an existing Payment row as "already processed" — so persisting a
 * failure row here would permanently swallow the subsequent success and the
 * user would be charged without receiving a subscription.
 *
 * The full event payload is already retained on the WebhookEvent document, so
 * nothing is lost by keeping this side-effect free.
 */
function recordFailedPayment(payload) {
  const paymentEntity = getEntity(payload, "payment") || {};
  const notes = paymentEntity.notes && typeof paymentEntity.notes === "object" ? paymentEntity.notes : {};
  const userId = notes.userId || notes.user_id || null;

  logger.warn("[RazorpayWebhook] payment failed", {
    eventId: payload.id,
    paymentId: paymentEntity.id || null,
    orderId: paymentEntity.order_id || null,
    userId: userId ? String(userId) : null,
    // Razorpay's own failure taxonomy — never the payer's contact details.
    errorCode: paymentEntity.error_code || null,
    errorReason: paymentEntity.error_reason || null,
    errorStep: paymentEntity.error_step || null,
    errorSource: paymentEntity.error_source || null,
  });

  analytics.track("payment_failed", {
    userId,
    properties: {
      paymentId: paymentEntity.id || null,
      orderId: paymentEntity.order_id || null,
      amount: amountFromSubunits(paymentEntity.amount) ?? null,
      method: paymentEntity.method || null,
      errorCode: paymentEntity.error_code || null,
      errorReason: paymentEntity.error_reason || null,
      errorStep: paymentEntity.error_step || null,
    },
  });

  // activated:false is explicit — a failure must never look like an activation
  // to anything reading processingResult.
  return { success: true, recorded: true, activated: false, eventType: "payment.failed" };
}

async function processSupportedEvent(payload) {
  const eventType = payload.event;

  if (!SUPPORTED_EVENTS.has(eventType)) {
    logger.info("[RazorpayWebhook] unsupported event skipped", { eventType });
    return { skipped: true, reason: "unsupported_event", eventType };
  }

  if (eventType === "payment.failed") {
    return recordFailedPayment(payload);
  }

  if (eventType === "refund.processed" || eventType === "payment.refunded") {
    return applyVerifiedRazorpayRefund(await resolveRefund(payload));
  }

  const activation = await resolvePaymentActivation(payload);
  return activateRazorpaySubscriptionPayment({
    ...activation,
    source: "razorpay_webhook",
  });
}

/**
 * Atomically upsert the webhook event AND acquire the processing lock in a
 * single findOneAndUpdate. Eliminates the TOCTOU gap between checking
 * `processed` and trying to acquire the lock.
 *
 * Returns:
 *  - { locked: true,  event }   — caller owns the lock and must process
 *  - { locked: false, processed: true }   — duplicate event, already done
 *  - { locked: false, inProgress: true }  — another worker holds a live lock
 */
async function upsertAndLockWebhookEvent(payload) {
  const eventId = payload.id;
  const eventType = payload.event;
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000);
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
          provider: "razorpay",
          processed: false,
          payload,
        },
        $set: {
          processing: true,
          processingStartedAt: now,
          processingError: null,
        },
        $inc: { deliveryAttempts: 1, processingAttempts: 1 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return { locked: true, event: locked };
  } catch (error) {
    // Duplicate key: doc exists but didn't match the filter — either already
    // processed or another worker holds a live lock. Still record the delivery.
    if (error?.code !== 11000) throw error;
    const existing = await WebhookEvent.findOneAndUpdate(
      { eventId },
      { $inc: { deliveryAttempts: 1 } },
      { new: true }
    );
    if (existing?.processed) {
      return { locked: false, processed: true };
    }
    return { locked: false, inProgress: true };
  }
}

// Reconciliation ceiling. Razorpay's own retry schedule is the first line of
// recovery; this is the safety net for events whose processing kept throwing
// (Mongo blip, Razorpay 5xx during re-fetch) until Razorpay gave up.
const MAX_PROCESSING_ATTEMPTS = 6;

/**
 * Re-run a stored webhook event through the SAME processing path the live
 * endpoint uses. Used only by the reconciliation cron.
 *
 * Signature verification is intentionally not repeated: an event document only
 * exists because processRazorpayWebhook already verified its HMAC before the
 * upsert. The stored payload is therefore already provenance-checked, and it
 * is re-validated against Razorpay's API anyway by fetchAndValidateRazorpayPayment.
 *
 * Claims the document atomically before doing any work, so a reconciliation
 * run can never race a live delivery of the same event, nor another cron
 * instance. Returns null when the event could not be claimed.
 */
async function reprocessStoredWebhookEvent(eventId) {
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000);

  const claimed = await WebhookEvent.findOneAndUpdate(
    {
      eventId,
      processed: false,
      permanentlyFailed: { $ne: true },
      processingAttempts: { $lt: MAX_PROCESSING_ATTEMPTS },
      $or: [
        { processing: false },
        { processing: { $exists: false } },
        { processingStartedAt: { $lt: staleBefore } },
      ],
    },
    {
      $set: { processing: true, processingStartedAt: new Date() },
      $inc: { processingAttempts: 1 },
    },
    { new: true }
  );

  if (!claimed) return null;

  try {
    const result = await processSupportedEvent(claimed.payload);
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
    logger.info("[RazorpayWebhook] reconciliation recovered event", {
      eventId,
      eventType: claimed.eventType,
      attempt: claimed.processingAttempts,
    });
    return { recovered: true, eventId, eventType: claimed.eventType, result };
  } catch (error) {
    const exhausted = claimed.processingAttempts >= MAX_PROCESSING_ATTEMPTS;
    await WebhookEvent.updateOne(
      { eventId },
      {
        processing: false,
        processingError: error?.message || "Unknown reconciliation error",
        ...(exhausted ? { permanentlyFailed: true, permanentlyFailedAt: new Date() } : {}),
      }
    );
    logger.error("[RazorpayWebhook] reconciliation attempt failed", {
      eventId,
      eventType: claimed.eventType,
      attempt: claimed.processingAttempts,
      exhausted,
      error: error?.message,
    });
    return {
      recovered: false,
      eventId,
      eventType: claimed.eventType,
      exhausted,
      error: error?.message,
    };
  }
}

async function processRazorpayWebhook({ rawBody, signature }) {
  if (!verifyWebhookSignature(rawBody, signature)) {
    logger.warn("[RazorpayWebhook] verification failed");
    throw new ApiError(400, "Invalid Razorpay webhook signature", "RAZORPAY_WEBHOOK_SIGNATURE_INVALID");
  }

  logger.info("[RazorpayWebhook] verification success");

  const payload = parseWebhookPayload(rawBody);
  if (!payload.id || !payload.event) {
    throw new ApiError(400, "Invalid Razorpay webhook event", "RAZORPAY_WEBHOOK_EVENT_INVALID");
  }

  logger.info("[RazorpayWebhook] received", {
    eventId: payload.id,
    eventType: payload.event,
  });

  const lockResult = await upsertAndLockWebhookEvent(payload);
  if (lockResult.processed) {
    logger.info("[RazorpayWebhook] duplicate event already processed", {
      eventId: payload.id,
      eventType: payload.event,
    });
    return { success: true, idempotent: true, eventId: payload.id };
  }
  if (!lockResult.locked) {
    logger.info("[RazorpayWebhook] event processing already in progress", {
      eventId: payload.id,
      eventType: payload.event,
    });
    return { success: true, inProgress: true, eventId: payload.id };
  }

  try {
    const result = await processSupportedEvent(payload);
    await WebhookEvent.updateOne(
      { eventId: payload.id },
      {
        processed: true,
        processing: false,
        processedAt: new Date(),
        processingResult: result,
        processingError: null,
      }
    );
    return { success: true, eventId: payload.id, result };
  } catch (error) {
    await WebhookEvent.updateOne(
      { eventId: payload.id },
      {
        processing: false,
        processingError: error?.message || "Unknown webhook processing error",
      }
    );
    logger.error("[RazorpayWebhook] processing failed", {
      eventId: payload.id,
      eventType: payload.event,
      error: error?.message,
      stack: error?.stack,
    });
    throw error;
  }
}

module.exports = {
  MAX_PROCESSING_ATTEMPTS,
  SUPPORTED_EVENTS,
  processRazorpayWebhook,
  processSupportedEvent,
  reprocessStoredWebhookEvent,
  verifyWebhookSignature,
};
