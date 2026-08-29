const Razorpay = require("razorpay");
const crypto = require("crypto");
const mongoose = require("mongoose");
const Payment = require("../models/Payment");
const User = require("../models/Users");
const Notification = require("../models/Notification");
const { appConfig } = require("../config");
const ApiError = require("../utils/ApiError");
const { logger } = require("../utils/logger");
const { invalidateAuthCache } = require("./authCacheService");
const { captureOperationalError } = require("../config/sentry");
const analytics = require("./analyticsEventService");
const { isTrialActive } = require("../utils/premium");
const { quoteCheckout, publicQuote } = require("./promotionQuote.service");
const {
  promoNotes,
  persistCheckoutSession,
  markCheckoutPaid,
  recordRedemption,
  reverseRedemptionForPayment,
} = require("./promotionFulfillment.service");
const { CHECKOUT_SESSION_TTL_MS } = require("../constants/promotions");

// `amount` is the single source of truth for what a customer is charged:
// createRazorpayOrder derives paise from it, and the webhook path re-checks
// both the order and the payment against it. `listAmount` is the struck-through
// "before" price the paywall shows — presentational only, never charged.
const PLAN_CONFIG = {
  monthly: {
    amount: 199,
    listAmount: 249,
    days: 30,
    label: "1 month",
    userPlan: "monthly",
    orderable: true,
  },
  "3_months": {
    amount: 537,
    // Every price we have ever charged for this plan. A Razorpay order is
    // created at whatever price was live when checkout opened, so an order
    // placed before a price change — or a webhook retry for one — still
    // carries the old amount. Validating against only the current price
    // would reject an already-charged payment and strand the customer's
    // money. Never remove entries; add the outgoing price on every change.
    priorAmounts: [150],
    listAmount: 747,
    days: 90,
    label: "3 months",
    userPlan: "monthly",
    orderable: true,
  },
  "6_months": {
    amount: 894,
    listAmount: 1494,
    days: 180,
    label: "6 months",
    userPlan: "monthly",
    orderable: true,
  },
  yearly: {
    days: 365,
    userPlan: "yearly",
  },
};

// A struck-through price that is not strictly above the charged price would
// advertise a "discount" to a higher number — deceptive pricing, and a store
// and consumer-law problem, not merely a cosmetic one. Fail at boot rather
// than ship it: this is a static config error, so it can only be a mistake.
function assertPlanConfigIsSane(config) {
  for (const [planType, plan] of Object.entries(config)) {
    if (!plan.orderable) continue;
    if (!Number.isInteger(plan.amount) || plan.amount <= 0) {
      throw new Error(`PLAN_CONFIG.${planType}: orderable plans need a positive integer amount`);
    }
    if (!Number.isInteger(plan.days) || plan.days <= 0) {
      throw new Error(`PLAN_CONFIG.${planType}: orderable plans need a positive integer days`);
    }
    if (plan.listAmount !== undefined && !(Number.isInteger(plan.listAmount) && plan.listAmount > plan.amount)) {
      throw new Error(
        `PLAN_CONFIG.${planType}: listAmount (${plan.listAmount}) must be an integer strictly above amount (${plan.amount})`
      );
    }
    for (const prior of plan.priorAmounts || []) {
      if (!Number.isInteger(prior) || prior <= 0) {
        throw new Error(`PLAN_CONFIG.${planType}: priorAmounts must be positive integers`);
      }
    }
  }
  return config;
}

assertPlanConfigIsSane(PLAN_CONFIG);

// Current price plus every superseded one, in paise.
function recognisedAmountsPaise(plan) {
  const amounts = [plan.amount, ...(Array.isArray(plan.priorAmounts) ? plan.priorAmounts : [])];
  return new Set(
    amounts
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.round(value * 100))
  );
}

// The paywall renders straight from this so the displayed price and the
// charged price cannot drift apart. Cheapest first.
function listOrderablePlans() {
  return Object.entries(PLAN_CONFIG)
    .filter(([, plan]) => plan.orderable && Number.isFinite(plan.amount) && plan.amount > 0)
    .map(([planType, plan]) => {
      const months = plan.days / 30;
      return {
        planType,
        label: plan.label || planType,
        days: plan.days,
        amount: plan.amount,
        listAmount: Number.isFinite(plan.listAmount) ? plan.listAmount : null,
        perMonth: Math.round(plan.amount / months),
        listPerMonth: Number.isFinite(plan.listAmount)
          ? Math.round(plan.listAmount / months)
          : null,
        savingsPct: Number.isFinite(plan.listAmount) && plan.listAmount > 0
          ? Math.round((1 - plan.amount / plan.listAmount) * 100)
          : 0,
      };
    })
    .sort((a, b) => a.amount - b.amount);
}

function getRazorpayClient() {
  const keyId = String(appConfig.razorpay.keyId || "").trim();
  const keySecret = String(appConfig.razorpay.keySecret || "").trim();

  if (!keyId || !keySecret) {
    throw new ApiError(503, "Razorpay is not configured. Manual admin payments can still be used.", "RAZORPAY_CONFIG_MISSING");
  }

  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
}

function getPlanConfig(planType, options = {}) {
  const normalizedPlanType = String(planType || "3_months").trim();
  const configured = PLAN_CONFIG[normalizedPlanType];
  if (configured) {
    return {
      planType: normalizedPlanType,
      ...configured,
    };
  }

  if (normalizedPlanType === "custom") {
    const customDays = Number(options.customDays || options.days || 30);
    if (!Number.isFinite(customDays) || customDays <= 0) {
      return null;
    }
    return {
      planType: "custom",
      amount: options.amount,
      days: Math.ceil(customDays),
      userPlan: "custom",
    };
  }

  return null;
}

// subscriptionPlan is a display label ("free"/"monthly"/"yearly"/"custom"),
// not a precise record of remaining entitlement. Unconditionally overwriting
// it on every purchase mislabels a user who still has months of higher-tier
// time left (e.g. a "yearly" purchase followed by a "monthly" one) as the
// lesser plan, even though subscriptionExpiry itself stays correct. Only
// adopt the new plan's label if it's the same tier or higher.
const PLAN_LABEL_RANK = { free: 0, monthly: 1, custom: 1, yearly: 2 };

function resolveSubscriptionPlanLabel(currentLabel, nextLabel) {
  const currentRank = PLAN_LABEL_RANK[currentLabel] ?? 0;
  const nextRank = PLAN_LABEL_RANK[nextLabel] ?? 1;
  return nextRank >= currentRank ? nextLabel : currentLabel;
}

function getOrderablePlanConfig(planType) {
  const config = getPlanConfig(planType);
  if (!config?.orderable || !Number.isFinite(config.amount) || config.amount <= 0) {
    return null;
  }
  return config;
}

function verifyRazorpayOrderSignature({ orderId, paymentId, signature }) {
  const expectedSignature = crypto
    .createHmac("sha256", appConfig.razorpay.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, "hex"),
      Buffer.from(String(signature || ""), "hex")
    );
  } catch (error) {
    // Length mismatch (truncated / non-hex signature) trips timingSafeEqual
    // before any comparison. Log the failure mode so operators can tell a
    // malformed signature apart from a wrong secret. Never log the signature.
    logger.warn("[Razorpay] order signature verify error", {
      code: error?.code || error?.name,
    });
    return false;
  }
}

function paymentIntegrityError(message, details) {
  return new ApiError(400, message, "PAYMENT_INTEGRITY_CHECK_FAILED", details);
}

function requireMatchingValue(actual, expected, field) {
  if (String(actual ?? "") !== String(expected ?? "")) {
    throw paymentIntegrityError(`Razorpay ${field} does not match the expected value`, {
      field,
      expected,
      actual,
    });
  }
}

async function fetchAndValidateRazorpayPayment({ orderId, paymentId, expectedUserId } = {}) {
  if (!orderId || !paymentId) {
    throw new ApiError(400, "Razorpay order ID and payment ID are required", "VALIDATION_ERROR");
  }

  const razorpay = getRazorpayClient();
  let order;
  let payment;
  try {
    [order, payment] = await Promise.all([
      razorpay.orders.fetch(orderId),
      razorpay.payments.fetch(paymentId),
    ]);
  } catch (error) {
    captureOperationalError(error, {
      subsystem: "razorpay",
      tags: { operation: "verify_payment_entities" },
      userId: expectedUserId,
      extra: { orderId, paymentId },
    });
    throw new ApiError(502, "Unable to verify payment with Razorpay", "RAZORPAY_VERIFICATION_FAILED");
  }

  if (!order || !payment) {
    throw new ApiError(502, "Razorpay returned an incomplete payment response", "RAZORPAY_VERIFICATION_FAILED");
  }

  requireMatchingValue(order.id, orderId, "order ID");
  requireMatchingValue(payment.id, paymentId, "payment ID");
  requireMatchingValue(payment.order_id, order.id, "payment order ID");

  if (order.status !== "paid") {
    throw paymentIntegrityError("Razorpay order is not paid", { status: order.status });
  }
  if (payment.status !== "captured" || payment.captured !== true) {
    throw paymentIntegrityError("Razorpay payment is not captured", {
      status: payment.status,
      captured: payment.captured,
    });
  }

  const notes = order.notes && typeof order.notes === "object" ? order.notes : {};
  const planType = notes.planType || notes.plan_type;
  const userId = notes.userId || notes.user_id;
  const plan = getOrderablePlanConfig(planType);
  if (!plan || !userId) {
    throw paymentIntegrityError("Razorpay order is missing trusted plan or user metadata");
  }
  if (expectedUserId) {
    requireMatchingValue(userId, expectedUserId, "order user ID");
  }

  const recognisedAmounts = recognisedAmountsPaise(plan);
  const notesPayable = Number.parseInt(String(notes.payablePaise || ""), 10);
  const hasQuotedPayable = Number.isSafeInteger(notesPayable) && notesPayable > 0;

  if (hasQuotedPayable) {
    if (order.amount !== notesPayable) {
      throw paymentIntegrityError("Razorpay order amount does not match the quoted payable amount", {
        expectedAmount: notesPayable,
        actualAmount: order.amount,
      });
    }
  } else if (!Number.isSafeInteger(order.amount) || !recognisedAmounts.has(order.amount)) {
    throw paymentIntegrityError("Razorpay order amount does not match the plan price", {
      expectedAmount: plan.amount * 100,
      recognisedAmounts: [...recognisedAmounts],
      actualAmount: order.amount,
    });
  }
  // The captured payment must match its own order to the paise. This is the
  // invariant that actually protects revenue, and unlike a comparison against
  // the catalogue it stays true across a price change.
  if (!Number.isSafeInteger(payment.amount) || payment.amount !== order.amount) {
    throw paymentIntegrityError("Razorpay payment amount does not match the order amount", {
      orderAmount: order.amount,
      actualAmount: payment.amount,
    });
  }
  if (order.amount !== plan.amount * 100) {
    logger.warn("PAYMENT_SUPERSEDED_PRICE_HONOURED", {
      planType: plan.planType,
      orderAmount: order.amount,
      currentAmount: plan.amount * 100,
      razorpayOrderId: order.id,
    });
  }
  requireMatchingValue(order.currency, "INR", "order currency");
  requireMatchingValue(payment.currency, "INR", "payment currency");

  return {
    userId,
    // What the customer was actually charged.
    amount: order.amount / 100,
    currency: "INR",
    razorpayOrderId: order.id,
    razorpayPaymentId: payment.id,
    planType: plan.planType,
    subscriptionDays: plan.days,
    promo: promoNotes(notes),
  };
}

async function loadPayer(userId) {
  try {
    const found = await User.findById(userId).select("totalPaid subscriptionStatus").lean();
    if (found) return found;
  } catch {
    // Shallow unit-test mocks of User.findById don't implement .select().lean().
  }
  return { _id: userId, totalPaid: 0, subscriptionStatus: "inactive" };
}

async function createRazorpayOrder({ userId, planType = "3_months", couponCode }) {
  const plan = getOrderablePlanConfig(planType);
  if (!plan) {
    throw new ApiError(400, "Invalid plan type", "VALIDATION_ERROR");
  }

  const payer = await loadPayer(userId);
  const quote = await quoteCheckout({ user: payer, plan, couponCode });

  const razorpay = getRazorpayClient();
  let order;
  try {
    order = await razorpay.orders.create({
      amount: quote.payablePaise,
      currency: "INR",
      receipt: `rcpt_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
      notes: {
        planType: plan.planType,
        userId: String(userId),
        payablePaise: String(quote.payablePaise),
        listAmount: String(quote.listAmount),
        discountAmount: String(quote.discountAmount),
        couponId: quote.coupon ? String(quote.coupon._id) : "",
        campaignId: quote.campaignId ? String(quote.campaignId) : "",
        influencerId: quote.influencerId ? String(quote.influencerId) : "",
        codeUsed: quote.codeUsed || "",
      },
    });
  } catch (error) {
    captureOperationalError(error, {
      subsystem: "razorpay",
      tags: { operation: "create_order", plan_type: plan.planType },
      userId,
    });
    throw error;
  }

  if (!order) {
    throw new ApiError(500, "Failed to create payment order", "PAYMENT_ORDER_FAILED");
  }

  await persistCheckoutSession({
    user: userId,
    razorpayOrderId: order.id,
    planType: plan.planType,
    listAmount: quote.listAmount,
    discountAmount: quote.discountAmount,
    payableAmount: quote.payableAmount,
    coupon: quote.coupon?._id || null,
    campaign: quote.campaignId || null,
    influencer: quote.influencerId || null,
    codeUsed: quote.codeUsed || "",
    rulesSnapshot: quote.rulesSnapshot || {},
    status: "open",
    expiresAt: new Date(Date.now() + CHECKOUT_SESSION_TTL_MS),
  });

  return { ...order, planType: plan.planType, quote: publicQuote(quote) };
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

async function notifyPaymentReceived({ user, userId, paymentId, amount, planType }) {
  Notification.create([
    {
      title: "New Payment Received",
      message: `User ${user?.name || userId} paid Rs ${amount} for a ${String(planType).replace("_", " ")} plan.`,
      type: "payment",
      userId,
      metadata: { paymentId, amount },
    },
  ]).catch((error) => {
    // Fire-and-forget but observable. A silent swallow hid validation /
    // transient Mongo failures from operators after a successful payment.
    logger.warn("[Payment] notifyPaymentReceived failed", {
      paymentId: String(paymentId),
      userId: String(userId),
      error: error?.message,
    });
  });
}

async function ensureExistingPaymentApplied(existingPayment, session) {
  if (!existingPayment?.user || existingPayment.status !== "completed" || !existingPayment.expiryDate) {
    return;
  }

  if (new Date(existingPayment.expiryDate) <= new Date()) {
    return;
  }

  await User.updateOne(
    { _id: existingPayment.user },
    [
      {
        $set: {
          subscriptionStatus: "active",
          subscriptionExpiry: {
            $max: [{ $ifNull: ["$subscriptionExpiry", "$$NOW"] }, existingPayment.expiryDate],
          },
        },
      },
    ],
    { session, updatePipeline: true }
  );
}

// MongoDB transactions require a replica set. Production runs on Atlas, which
// always is one; a standalone local mongod cannot start a transaction at all
// and fails with "Transaction numbers are only allowed on a replica set member
// or mongos". Without a fallback every payment verify dies there — the
// customer is charged by Razorpay and never activated.
//
// Outside production we therefore degrade to non-transactional writes. That is
// safe here specifically because every step is idempotent and keyed on
// razorpayPaymentId: a replay finds the existing Payment and re-applies the
// entitlement rather than double-charging or double-extending.
//
// In production we NEVER degrade. A transaction failure there is a real fault
// and must surface rather than silently writing without atomicity.
function transactionsUnsupported(error) {
  const message = String(error?.message || "");
  return (
    error?.code === 20 ||
    /Transaction numbers are only allowed on a replica set member or mongos/i.test(message) ||
    /Transactions are not supported/i.test(message)
  );
}

const NO_TRANSACTION = {
  session: undefined,   // Mongoose ignores .session(undefined)
  degraded: true,
  commit: async () => {},
  abort: async () => {},
  end: async () => {},
};

async function beginTransaction() {
  const session = await mongoose.startSession();
  session.startTransaction();
  return {
    session,
    degraded: false,
    commit: () => session.commitTransaction(),
    abort: () => session.abortTransaction().catch(() => {}),
    end: () => session.endSession(),
  };
}

// startTransaction() itself succeeds on a standalone — the server only
// rejects when the first operation carries the transaction number. So the
// capability can't be probed up front; we attempt the real transaction and
// fall back if that specific failure comes back. Nothing has been written at
// that point, so replaying the body is safe.
async function runWithOptionalTransaction(run) {
  try {
    return await run(await beginTransaction());
  } catch (error) {
    if (appConfig.env === "production" || !transactionsUnsupported(error)) throw error;
    logger.warn("PAYMENT_TRANSACTION_UNAVAILABLE", {
      message:
        "MongoDB is not a replica set, so this write is not atomic. Acceptable "
        + "outside production only; run mongod with --replSet to restore atomicity.",
      error: error?.message,
    });
    return run(NO_TRANSACTION);
  }
}

async function activateRazorpaySubscriptionPayment({
  userId,
  currency = "INR",
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
  planType = "3_months",
  customDays,
  source = "manual_verify",
  amount,
  promo,
}) {
  const plan = getPlanConfig(planType, { customDays });
  if (!plan?.orderable) {
    throw new ApiError(400, "Invalid plan type", "VALIDATION_ERROR");
  }

  // Charged amount from the verified Razorpay order. Fall back to the
  // catalogue only for callers (older tests / custom) that omit it.
  const paymentAmount = Number.isFinite(Number(amount)) && Number(amount) > 0
    ? Number(amount)
    : plan.amount;
  const promoMeta = promo && typeof promo === "object" ? promo : {};
  const listAmount = Number.isFinite(Number(promoMeta.listAmount)) && Number(promoMeta.listAmount) > 0
    ? Number(promoMeta.listAmount)
    : paymentAmount;
  const discountAmount = Number.isFinite(Number(promoMeta.discountAmount))
    ? Math.max(0, Number(promoMeta.discountAmount))
    : 0;

  if (!Number.isFinite(Number(paymentAmount)) || Number(paymentAmount) <= 0) {
    throw new ApiError(400, "Missing payment amount", "VALIDATION_ERROR");
  }
  if (currency !== "INR") {
    throw paymentIntegrityError("Payment currency does not match the server plan", {
      currency,
    });
  }

  if (!razorpayPaymentId) {
    throw new ApiError(400, "Missing Razorpay payment ID", "VALIDATION_ERROR");
  }

  return runWithOptionalTransaction(async (txn) => {
  const session = txn.session;
  try {
    const existingPayment = await Payment.findOne({
      $or: [
        { transactionId: razorpayPaymentId },
        { razorpayPaymentId },
        ...(razorpayOrderId ? [{ razorpayOrderId }] : []),
      ],
    })
      .select("_id user status expiryDate razorpayOrderId razorpayPaymentId")
      .session(session)
      .lean();

    if (existingPayment) {
      await ensureExistingPaymentApplied(existingPayment, session);
      await txn.commit();
      logger.info("[PaymentActivation] payment already processed", {
        paymentId: razorpayPaymentId,
        orderId: razorpayOrderId,
        source,
      });
      if (existingPayment.user) invalidateAuthCache(existingPayment.user).catch(() => {});
      return {
        success: true,
        idempotent: true,
        paymentId: existingPayment._id,
        message: "Payment already verified",
      };
    }

    const userInTxn = await User.findById(userId).session(session);
    if (!userInTxn) {
      throw new ApiError(404, "User not found", "NOT_FOUND");
    }

    const now = new Date();
    // Stack the paid window on top of whichever benefit ends latest: an
    // existing paid subscription, a still-running trial, or "now" (no overlap).
    // Without honoring trial.endsAt, a user paying on day-4 of a 7-day trial
    // would silently lose 3 days they were already entitled to.
    const benefitCandidates = [now.getTime()];
    if (
      userInTxn.subscriptionStatus === "active" &&
      userInTxn.subscriptionExpiry &&
      new Date(userInTxn.subscriptionExpiry) > now
    ) {
      benefitCandidates.push(new Date(userInTxn.subscriptionExpiry).getTime());
    }
    if (userInTxn.trial?.endsAt && new Date(userInTxn.trial.endsAt) > now) {
      benefitCandidates.push(new Date(userInTxn.trial.endsAt).getTime());
    }
    const baseExpiry = new Date(Math.max(...benefitCandidates));
    const expiryDate = addDays(baseExpiry, plan.days);

    const [payment] = await Payment.create(
      [
        {
          user: userId,
          amount: paymentAmount,
          currency,
          status: "completed",
          paymentMethod: "razorpay",
          transactionId: razorpayPaymentId,
          razorpayOrderId,
          razorpayPaymentId,
          razorpaySignature,
          planType: plan.planType,
          expiryDate,
          subscriptionDays: plan.days,
          listAmount,
          discountAmount,
          coupon: promoMeta.couponId || null,
          campaign: promoMeta.campaignId || null,
          influencer: promoMeta.influencerId || null,
          notes: `Automated subscription via Razorpay (${source})`,
        },
      ],
      { session }
    );

    await markCheckoutPaid(razorpayOrderId, session);
    await recordRedemption({
      payment,
      promo: promoMeta,
      userId,
      planType: plan.planType,
      session,
    });

    await User.findByIdAndUpdate(
      userId,
      {
        subscriptionStatus: "active",
        subscriptionPlan: resolveSubscriptionPlanLabel(userInTxn.subscriptionPlan, plan.userPlan),
        subscriptionExpiry: expiryDate,
        $inc: { totalPaid: paymentAmount },
      },
      { session }
    );

    await txn.commit();

    invalidateAuthCache(userId).catch(() => {});
    notifyPaymentReceived({
      user: userInTxn,
      userId,
      paymentId: razorpayPaymentId,
      amount: paymentAmount,
      planType: plan.planType,
    });

    // Conversion telemetry — distinguish "converted from active trial" from
    // "subscribed after trial expired" from "subscribed without ever
    // trialing" (legacy users). This is the headline funnel metric.
    const trialWasActive = isTrialActive(userInTxn);
    const trialWasUsed = Boolean(userInTxn.trial?.used);
    analytics.track("subscription_started", {
      userId,
      properties: {
        planType: plan.planType,
        amount: paymentAmount,
        days: plan.days,
        source,
        couponId: promoMeta.couponId || null,
        campaignId: promoMeta.campaignId || null,
        fromTrial: trialWasActive,
        afterExpiredTrial: !trialWasActive && trialWasUsed,
        neverTrialed: !trialWasUsed,
      },
    });
    if (trialWasActive) {
      analytics.track("subscription_started_from_trial", {
        userId,
        properties: {
          trialEndedAt: userInTxn.trial?.endsAt,
          daysIntoTrial: userInTxn.trial?.startedAt
            ? Math.floor((Date.now() - new Date(userInTxn.trial.startedAt).getTime()) / (24 * 60 * 60 * 1000))
            : null,
        },
      });
    }

    logger.info("[PaymentActivation] subscription activated", {
      userId: String(userId),
      paymentId: razorpayPaymentId,
      orderId: razorpayOrderId,
      planType: plan.planType,
      expiryDate: expiryDate.toISOString(),
      source,
    });

    return {
      success: true,
      idempotent: false,
      paymentId: payment._id,
      expiryDate,
      message: "Payment verified and subscription extended successfully",
    };
  } catch (error) {
    await txn.abort();
    if (error?.code === 11000) {
      logger.info("[PaymentActivation] duplicate payment key", {
        paymentId: razorpayPaymentId,
        orderId: razorpayOrderId,
        source,
      });
      return {
        success: true,
        idempotent: true,
        message: "Payment already verified",
      };
    }
    throw error;
  } finally {
    await txn.end();
  }
  });
}

async function applyVerifiedRazorpayRefund({
  razorpayPaymentId,
  refundKey,
  totalRefundedAmount,
  fullyRefunded,
}) {
  if (!razorpayPaymentId || !refundKey || !Number.isFinite(totalRefundedAmount) || totalRefundedAmount <= 0) {
    throw new ApiError(400, "Invalid verified refund data", "RAZORPAY_REFUND_INVALID");
  }

  return runWithOptionalTransaction(async (txn) => {
  const session = txn.session;
  try {
    const payment = await Payment.findOne({ razorpayPaymentId }).session(session);
    if (!payment) {
      throw new ApiError(404, "Original payment record not found", "PAYMENT_NOT_FOUND");
    }

    if (payment.razorpayRefundIds?.includes(refundKey)) {
      await txn.commit();
      return { success: true, idempotent: true, paymentId: payment._id };
    }
    if (totalRefundedAmount > payment.amount) {
      throw paymentIntegrityError("Refunded amount exceeds the recorded payment amount");
    }

    const previousRefundedAmount = Number(payment.refundedAmount || 0);
    const refundDelta = Math.max(0, totalRefundedAmount - previousRefundedAmount);
    const becameFullyRefunded = fullyRefunded && payment.status !== "refunded";

    payment.razorpayRefundIds = [...(payment.razorpayRefundIds || []), refundKey];
    payment.refundedAmount = totalRefundedAmount;
    payment.refundedAt = new Date();
    payment.status = fullyRefunded ? "refunded" : "partially_refunded";
    await payment.save({ session });

    const updateStages = [
      {
        $set: {
          totalPaid: {
            $max: [0, { $subtract: [{ $ifNull: ["$totalPaid", 0] }, refundDelta] }],
          },
        },
      },
    ];

    const subscriptionDays = payment.subscriptionDays || getPlanConfig(payment.planType)?.days || 0;
    if (becameFullyRefunded && subscriptionDays > 0) {
      const durationMs = subscriptionDays * 24 * 60 * 60 * 1000;
      updateStages.push({
        $set: {
          subscriptionExpiry: {
            $subtract: [{ $ifNull: ["$subscriptionExpiry", "$$NOW"] }, durationMs],
          },
        },
      });
      updateStages.push({
        $set: {
          subscriptionStatus: {
            $cond: [{ $gt: ["$subscriptionExpiry", "$$NOW"] }, "active", "inactive"],
          },
        },
      });
    }

    await User.updateOne({ _id: payment.user }, updateStages, { session, updatePipeline: true });
    if (becameFullyRefunded) {
      await reverseRedemptionForPayment(payment, session);
    }
    await txn.commit();
    invalidateAuthCache(payment.user).catch(() => {});

    logger.info("[PaymentRefund] refund applied", {
      paymentId: razorpayPaymentId,
      refundKey,
      refundDelta,
      fullyRefunded,
    });
    return { success: true, idempotent: false, paymentId: payment._id, fullyRefunded };
  } catch (error) {
    await txn.abort();
    throw error;
  } finally {
    await txn.end();
  }
  });
}

module.exports = {
  PLAN_CONFIG,
  activateRazorpaySubscriptionPayment,
  applyVerifiedRazorpayRefund,
  resolveSubscriptionPlanLabel,
  createRazorpayOrder,
  fetchAndValidateRazorpayPayment,
  getPlanConfig,
  getOrderablePlanConfig,
  listOrderablePlans,
  // Exported for testing
  assertPlanConfigIsSane,
  getRazorpayClient,
  verifyRazorpayOrderSignature,
};
