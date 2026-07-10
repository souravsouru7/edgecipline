const crypto = require("crypto");
const WebhookEvent = require("../models/WebhookEvent");
const { appConfig } = require("../config");
const ApiError = require("../utils/ApiError");
const { logger } = require("../utils/logger");
const {
  activateRazorpaySubscriptionPayment,
  applyVerifiedRazorpayRefund,
  fetchAndValidateRazorpayPayment,
  getRazorpayClient,
} = require("./paymentService");

const SUPPORTED_EVENTS = new Set([
  "payment.captured",
  "order.paid",
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

async function processSupportedEvent(payload) {
  const eventType = payload.event;

  if (!SUPPORTED_EVENTS.has(eventType)) {
    logger.info("[RazorpayWebhook] unsupported event skipped", { eventType });
    return { skipped: true, reason: "unsupported_event", eventType };
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
  SUPPORTED_EVENTS,
  processRazorpayWebhook,
  verifyWebhookSignature,
};
