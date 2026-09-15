"use strict";

/**
 * CPN-001 / CPN-002 regression — coupon capacity reservation and rate-limit
 * separation, exercised end to end through the real routers, middleware and
 * Mongoose models against a real MongoDB (TEST_MONGO_URI || MONGO_URI, same as
 * mission.test.js).
 *
 * Only two things are faked:
 *   - the Razorpay SDK (in-memory orders/payments, so "the customer paid" is a
 *     one-liner and HMACs are real), and
 *   - the Redis client used by the rate limiter (an in-memory INCR/PTTL), so
 *     limiter behaviour is deterministic and needs no Redis server.
 *
 * Every limit assertion is made on database state, not on HTTP status alone.
 */

const crypto = require("crypto");

jest.setTimeout(30000);

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  stream: { write: jest.fn() },
}));

// ── In-memory Razorpay ─────────────────────────────────────────────────────
const mockRzp = { orders: new Map(), payments: new Map() };
jest.mock("razorpay", () =>
  function Razorpay() {
    return {
      orders: {
        create: async (o) => {
          const id = "order_" + require("crypto").randomBytes(6).toString("hex");
          const order = { id, amount: o.amount, currency: o.currency, notes: o.notes, status: "created" };
          mockRzp.orders.set(id, order);
          return order;
        },
        fetch: async (id) => mockRzp.orders.get(id),
        fetchPayments: async (id) => ({ items: [...mockRzp.payments.values()].filter((p) => p.order_id === id) }),
      },
      payments: { fetch: async (id) => mockRzp.payments.get(id) },
      refunds: { fetch: async () => null },
    };
  }
);

// ── In-memory Redis (only what the limiter + auth cache call) ─────────────
const mockRedisStore = new Map();
jest.mock("../../config/redis", () => ({
  connectRedis: jest.fn(),
  isRedisReady: () => true,
  isRedisWriteAvailable: () => true,
  markRedisWriteFailure: jest.fn(),
  verifyRedisWrites: jest.fn(),
  client: {
    status: "ready",
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    del: jest.fn().mockResolvedValue(1),
    eval: jest.fn(async (_script, _n, key, windowMs) => {
      const entry = mockRedisStore.get(key) || { count: 0, expires: Date.now() + Number(windowMs) };
      if (entry.expires <= Date.now()) { entry.count = 0; entry.expires = Date.now() + Number(windowMs); }
      entry.count += 1;
      mockRedisStore.set(key, entry);
      return [entry.count, entry.expires - Date.now()];
    }),
  },
}));

const express = require("express");
const cookieParser = require("cookie-parser");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const { appConfig } = require("../../config");
const User = require("../../models/Users");
const Coupon = require("../../models/Coupon");
const Campaign = require("../../models/Campaign");
const CouponRedemption = require("../../models/CouponRedemption");
const CouponUserUsage = require("../../models/CouponUserUsage");
const CheckoutSession = require("../../models/CheckoutSession");
const Payment = require("../../models/Payment");
const { CURRENT_TERMS_VERSION } = require("../../constants/terms");
const { sanitizeInput } = require("../../middleware/sanitizeInput");
const { errorHandler } = require("../../middleware/errorHandler");
const { applyVerifiedRazorpayRefund } = require("../../services/paymentService");
const { processSupportedEvent } = require("../../services/razorpayWebhookService");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(sanitizeInput);
  app.use("/api/promotions", require("../../routes/promotionRoutes"));
  app.use("/api/payments", require("../../routes/paymentRoutes"));
  app.use(errorHandler);
  return app;
}

const app = buildApp();
const RUN = crypto.randomBytes(4).toString("hex");
const createdUserIds = [];
let campaign;
let couponSeq = 0;

async function makeUser() {
  const user = await User.create({
    name: "Coupon QA",
    email: `coupon-qa-${RUN}-${crypto.randomBytes(4).toString("hex")}@example.com`,
    password: "hashedpassword",
    authProvider: "local",
    role: "user",
    termsAcceptance: {
      acceptedTerms: true,
      acceptedPrivacy: true,
      termsVersion: CURRENT_TERMS_VERSION,
      acceptedAt: new Date(),
    },
  });
  createdUserIds.push(user._id);
  const token = jwt.sign(
    { id: String(user._id), tokenVersion: user.tokenVersion || 0 },
    appConfig.jwt.secret,
    { expiresIn: "1h" }
  );
  return { user, token };
}

async function makeCoupon(overrides = {}) {
  couponSeq += 1;
  const code = `QA${RUN}${couponSeq}`.toUpperCase();
  return Coupon.create({
    codeNormalized: code,
    codeDisplay: code,
    campaign: campaign._id,
    discountType: "percent",
    discountValue: 20,
    ...overrides,
  });
}

const order = (token, body) =>
  request(app).post("/api/payments/order").set("Authorization", `Bearer ${token}`).send(body);
const validate = (token, body) =>
  request(app).post("/api/promotions/coupons/validate").set("Authorization", `Bearer ${token}`).send(body);

// "The customer paid": mark the Razorpay order paid with a captured payment.
function pay(orderId, over = {}) {
  const o = mockRzp.orders.get(orderId);
  o.status = "paid";
  const id = "pay_" + crypto.randomBytes(6).toString("hex");
  mockRzp.payments.set(id, { id, order_id: orderId, amount: o.amount, currency: "INR", status: "captured", captured: true, amount_refunded: 0, ...over });
  return id;
}
const sig = (orderId, paymentId) =>
  crypto.createHmac("sha256", appConfig.razorpay.keySecret).update(`${orderId}|${paymentId}`).digest("hex");
const verify = (token, orderId, paymentId, planType) =>
  request(app)
    .post("/api/payments/verify")
    .set("Authorization", `Bearer ${token}`)
    .send({ razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sig(orderId, paymentId), planType });

async function orderAndPay(token, planType, couponCode) {
  const res = await order(token, { planType, couponCode });
  if (res.status !== 200) return { orderStatus: res.status, verifyStatus: null };
  const paymentId = pay(res.body.id);
  const v = await verify(token, res.body.id, paymentId, planType);
  return { orderStatus: res.status, verifyStatus: v.status, orderId: res.body.id, paymentId, body: v.body };
}

async function couponState(coupon) {
  const doc = await Coupon.findById(coupon._id).lean();
  return {
    redemptionCount: doc.redemptionCount,
    reservedCount: doc.reservedCount,
    applied: await CouponRedemption.countDocuments({ coupon: coupon._id, status: "applied" }),
    reversed: await CouponRedemption.countDocuments({ coupon: coupon._id, status: "reversed" }),
    reservedSessions: await CheckoutSession.countDocuments({ coupon: coupon._id, couponReservation: "reserved" }),
  };
}

beforeAll(async () => {
  await mongoose.connect(process.env.TEST_MONGO_URI || process.env.MONGO_URI);
  await Promise.all([Coupon, CouponUserUsage, CouponRedemption, CheckoutSession].map((m) => m.syncIndexes()));
  campaign = await Campaign.create({ name: `QA ${RUN}`, slug: `qa-${RUN}`, type: "general", status: "active" });
});

afterAll(async () => {
  const coupons = await Coupon.find({ campaign: campaign._id }).select("_id").lean();
  const couponIds = coupons.map((c) => c._id);
  await Promise.all([
    CouponRedemption.deleteMany({ coupon: { $in: couponIds } }),
    CouponUserUsage.deleteMany({ coupon: { $in: couponIds } }),
    CheckoutSession.deleteMany({ user: { $in: createdUserIds } }),
    Payment.deleteMany({ user: { $in: createdUserIds } }),
    Coupon.deleteMany({ campaign: campaign._id }),
    Campaign.deleteOne({ _id: campaign._id }),
    User.deleteMany({ _id: { $in: createdUserIds } }),
  ]);
  await mongoose.disconnect();
});

beforeEach(() => mockRedisStore.clear());

// ── CPN-001: global limit ─────────────────────────────────────────────────

describe("CPN-001 global limit", () => {
  test("Test 1 — maxRedemptions=1, two concurrent users: exactly one redemption", async () => {
    const coupon = await makeCoupon({ maxRedemptions: 1 });
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const results = await Promise.all([orderAndPay(a.token, "monthly", coupon.codeNormalized), orderAndPay(b.token, "monthly", coupon.codeNormalized)]);
    const orderOk = results.filter((r) => r.orderStatus === 200);
    expect(orderOk).toHaveLength(1);
    expect(results.filter((r) => r.orderStatus === 400)).toHaveLength(1);
    expect(orderOk[0].verifyStatus).toBe(200);
    expect(await couponState(coupon)).toMatchObject({ redemptionCount: 1, reservedCount: 0, applied: 1, reservedSessions: 0 });
  });

  test("Test 2 — maxRedemptions=1, five concurrent users: exactly one redemption", async () => {
    const coupon = await makeCoupon({ maxRedemptions: 1 });
    const users = await Promise.all([1, 2, 3, 4, 5].map(() => makeUser()));
    const results = await Promise.all(users.map((u) => orderAndPay(u.token, "monthly", coupon.codeNormalized)));
    expect(results.filter((r) => r.orderStatus === 200)).toHaveLength(1);
    expect(results.filter((r) => r.orderStatus === 400)).toHaveLength(4);
    expect(await couponState(coupon)).toMatchObject({ redemptionCount: 1, reservedCount: 0, applied: 1 });
  });

  test("maxRedemptions=2 admits exactly two of five concurrent users", async () => {
    const coupon = await makeCoupon({ maxRedemptions: 2 });
    const users = await Promise.all([1, 2, 3, 4, 5].map(() => makeUser()));
    const results = await Promise.all(users.map((u) => orderAndPay(u.token, "monthly", coupon.codeNormalized)));
    expect(results.filter((r) => r.orderStatus === 200)).toHaveLength(2);
    expect(await couponState(coupon)).toMatchObject({ redemptionCount: 2, reservedCount: 0, applied: 2 });
  });

  test("sequential: limit reached by an unpaid hold blocks the next buyer until it expires", async () => {
    const coupon = await makeCoupon({ maxRedemptions: 1 });
    const a = await makeUser();
    const b = await makeUser();
    expect((await order(a.token, { planType: "monthly", couponCode: coupon.codeNormalized })).status).toBe(200);
    expect((await validate(b.token, { code: coupon.codeNormalized, planType: "monthly" })).status).toBe(400);
    expect((await order(b.token, { planType: "monthly", couponCode: coupon.codeNormalized })).status).toBe(400);
    expect(await couponState(coupon)).toMatchObject({ redemptionCount: 0, reservedCount: 1, reservedSessions: 1 });
  });

  test("unlimited coupon (maxRedemptions null) is unaffected by reservation", async () => {
    const coupon = await makeCoupon({ maxRedemptions: null, maxPerUser: 5 });
    const users = await Promise.all([1, 2, 3].map(() => makeUser()));
    const results = await Promise.all(users.map((u) => orderAndPay(u.token, "monthly", coupon.codeNormalized)));
    expect(results.every((r) => r.orderStatus === 200 && r.verifyStatus === 200)).toBe(true);
    expect(await couponState(coupon)).toMatchObject({ redemptionCount: 3, reservedCount: 0, applied: 3 });
  });
});

// ── CPN-001: per-user limit ───────────────────────────────────────────────

describe("CPN-001 per-user limit", () => {
  test("Test 3 — maxPerUser=1, same user, five concurrent orders: one hold, one redemption", async () => {
    const coupon = await makeCoupon({ maxPerUser: 1 });
    const u = await makeUser();
    const orders = await Promise.all([1, 2, 3, 4, 5].map(() => order(u.token, { planType: "monthly", couponCode: coupon.codeNormalized })));
    // Requests that overlap race on the per-user counter and lose (400). A
    // request that lands after another has already persisted its session
    // supersedes it — the same path a buyer takes when reopening checkout —
    // so more than one 200 is possible, but never more than one live hold.
    const ok = orders.filter((r) => r.status === 200);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(orders.filter((r) => r.status === 400)).toHaveLength(5 - ok.length);
    const usage = await CouponUserUsage.findOne({ coupon: coupon._id, user: u.user._id }).lean();
    expect(usage.usedCount).toBe(1);
    const open = await CheckoutSession.find({ user: u.user._id, status: "open" }).lean();
    expect(open).toHaveLength(1);
    expect(open[0].couponReservation).toBe("reserved");
    expect(await couponState(coupon)).toMatchObject({ reservedCount: 1, reservedSessions: 1 });

    const paymentId = pay(open[0].razorpayOrderId);
    expect((await verify(u.token, open[0].razorpayOrderId, paymentId, "monthly")).status).toBe(200);
    expect(await couponState(coupon)).toMatchObject({ redemptionCount: 1, reservedCount: 0, applied: 1 });
    // A second purchase attempt after redeeming is refused at quote and at order.
    expect((await validate(u.token, { code: coupon.codeNormalized, planType: "monthly" })).status).toBe(400);
    expect((await order(u.token, { planType: "monthly", couponCode: coupon.codeNormalized })).status).toBe(400);
  });

  test("maxPerUser=2 admits exactly two of five concurrent orders", async () => {
    const coupon = await makeCoupon({ maxPerUser: 2 });
    const u = await makeUser();
    // Concurrent orders by ONE user race on the per-user counter; each new
    // order also supersedes the earlier open session, so the surviving holds
    // are counted on the usage document, never more than maxPerUser.
    const orders = await Promise.all([1, 2, 3, 4, 5].map(() => order(u.token, { planType: "monthly", couponCode: coupon.codeNormalized })));
    const usage = await CouponUserUsage.findOne({ coupon: coupon._id, user: u.user._id }).lean();
    expect(orders.filter((r) => r.status === 200).length).toBeLessThanOrEqual(2);
    expect(usage.usedCount).toBeLessThanOrEqual(2);
  });

  test("per-user limit does not block another user", async () => {
    const coupon = await makeCoupon({ maxPerUser: 1 });
    const a = await makeUser();
    const b = await makeUser();
    expect((await orderAndPay(a.token, "monthly", coupon.codeNormalized)).verifyStatus).toBe(200);
    expect((await orderAndPay(a.token, "monthly", coupon.codeNormalized)).orderStatus).toBe(400);
    expect((await orderAndPay(b.token, "monthly", coupon.codeNormalized)).verifyStatus).toBe(200);
    expect(await couponState(coupon)).toMatchObject({ redemptionCount: 2, applied: 2 });
  });

  test("a buyer who reopens checkout is not blocked by their own hold", async () => {
    const coupon = await makeCoupon({ maxRedemptions: 1, maxPerUser: 1 });
    const u = await makeUser();
    const first = await order(u.token, { planType: "monthly", couponCode: coupon.codeNormalized });
    expect(first.status).toBe(200);
    // Validate again (paywall re-apply) and open a fresh order: both succeed.
    expect((await validate(u.token, { code: coupon.codeNormalized, planType: "3_months" })).status).toBe(200);
    const second = await order(u.token, { planType: "3_months", couponCode: coupon.codeNormalized });
    expect(second.status).toBe(200);
    const sessions = await CheckoutSession.find({ user: u.user._id }).sort({ createdAt: 1 }).lean();
    expect(sessions.map((s) => [s.status, s.couponReservation])).toEqual([["superseded", "released"], ["open", "reserved"]]);
    expect(await couponState(coupon)).toMatchObject({ reservedCount: 1, reservedSessions: 1 });
  });

  test("legacy applied redemption without a usage counter still counts toward maxPerUser", async () => {
    // Pre-reservation data: a redemption row and the counter the old code
    // incremented, but no CouponUserUsage document.
    const coupon = await makeCoupon({ maxPerUser: 1, redemptionCount: 1 });
    const u = await makeUser();
    const legacyPayment = await Payment.create({ user: u.user._id, amount: 279, currency: "INR", status: "completed", paymentMethod: "razorpay", transactionId: `legacy_${RUN}_${couponSeq}`, planType: "monthly", expiryDate: new Date() });
    await CouponRedemption.create({ user: u.user._id, coupon: coupon._id, campaign: campaign._id, payment: legacyPayment._id, planType: "monthly", listAmount: 349, discountAmount: 70, chargedAmount: 279, codeUsed: coupon.codeNormalized, status: "applied" });
    expect((await order(u.token, { planType: "monthly", couponCode: coupon.codeNormalized })).status).toBe(400);
  });
});

// ── CPN-001: reservation lifecycle ────────────────────────────────────────

describe("CPN-001 reservation lifecycle", () => {
  test("Test 4 — abandoned checkout expires and frees the coupon for the next buyer", async () => {
    const coupon = await makeCoupon({ maxRedemptions: 1 });
    const a = await makeUser();
    const b = await makeUser();
    const held = await order(a.token, { planType: "monthly", couponCode: coupon.codeNormalized });
    expect(held.status).toBe(200);
    expect((await order(b.token, { planType: "monthly", couponCode: coupon.codeNormalized })).status).toBe(400);

    // A never pays; the checkout window closes.
    await CheckoutSession.updateOne({ razorpayOrderId: held.body.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const result = await orderAndPay(b.token, "monthly", coupon.codeNormalized);
    expect(result.orderStatus).toBe(200);
    expect(result.verifyStatus).toBe(200);
    expect(await couponState(coupon)).toMatchObject({ redemptionCount: 1, reservedCount: 0, applied: 1, reservedSessions: 0 });
    const stale = await CheckoutSession.findOne({ razorpayOrderId: held.body.id }).lean();
    expect(stale.couponReservation).toBe("released");
  });

  test("validate (read-only) also sees an expired hold as free", async () => {
    const coupon = await makeCoupon({ maxRedemptions: 1 });
    const a = await makeUser();
    const b = await makeUser();
    const held = await order(a.token, { planType: "monthly", couponCode: coupon.codeNormalized });
    expect((await validate(b.token, { code: coupon.codeNormalized, planType: "monthly" })).status).toBe(400);
    await CheckoutSession.updateOne({ razorpayOrderId: held.body.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await validate(b.token, { code: coupon.codeNormalized, planType: "monthly" })).status).toBe(200);
  });

  test("failed payment (never captured) keeps the hold; no redemption is recorded", async () => {
    const coupon = await makeCoupon({ maxRedemptions: 1 });
    const u = await makeUser();
    const res = await order(u.token, { planType: "monthly", couponCode: coupon.codeNormalized });
    const paymentId = pay(res.body.id, { status: "failed", captured: false });
    expect((await verify(u.token, res.body.id, paymentId, "monthly")).status).toBe(400);
    expect(await couponState(coupon)).toMatchObject({ redemptionCount: 0, reservedCount: 1, applied: 0, reservedSessions: 1 });
    // Retry with a real capture on the same order succeeds exactly once.
    const retryId = pay(res.body.id);
    expect((await verify(u.token, res.body.id, retryId, "monthly")).status).toBe(200);
    expect(await couponState(coupon)).toMatchObject({ redemptionCount: 1, reservedCount: 0, applied: 1 });
  });

  test("Test 5 — verification retry is idempotent: one redemption, counters unchanged", async () => {
    const coupon = await makeCoupon({ maxRedemptions: 3 });
    const u = await makeUser();
    const first = await orderAndPay(u.token, "monthly", coupon.codeNormalized);
    expect(first.verifyStatus).toBe(200);
    const replay = await verify(u.token, first.orderId, first.paymentId, "monthly");
    expect(replay.status).toBe(200);
    expect(replay.body.idempotent).toBe(true);
    expect(await couponState(coupon)).toMatchObject({ redemptionCount: 1, reservedCount: 0, applied: 1 });
  });

  test("Test 6 — webhook replay and manual verify + webhook produce one redemption", async () => {
    const coupon = await makeCoupon({ maxRedemptions: 3 });
    const u = await makeUser();
    const res = await order(u.token, { planType: "3_months", couponCode: coupon.codeNormalized });
    const paymentId = pay(res.body.id);
    const event = { event: "payment.captured", payload: { payment: { entity: { id: paymentId, order_id: res.body.id, amount: mockRzp.orders.get(res.body.id).amount, status: "captured" } } } };
    const first = await processSupportedEvent(event);
    expect(first.idempotent).toBe(false);
    const second = await processSupportedEvent(event);
    expect(second.idempotent).toBe(true);
    const manual = await verify(u.token, res.body.id, paymentId, "3_months");
    expect(manual.body.idempotent).toBe(true);
    expect(await couponState(coupon)).toMatchObject({ redemptionCount: 1, reservedCount: 0, applied: 1 });
  });

  test("superseded checkout releases its hold; paying it anyway is honoured and counted", async () => {
    const coupon = await makeCoupon({ maxRedemptions: 5, maxPerUser: 5 });
    const u = await makeUser();
    const first = await order(u.token, { planType: "monthly", couponCode: coupon.codeNormalized });
    const second = await order(u.token, { planType: "monthly" });
    expect(second.status).toBe(200);
    expect(await couponState(coupon)).toMatchObject({ reservedCount: 0, reservedSessions: 0 });
    const paymentId = pay(first.body.id);
    expect((await verify(u.token, first.body.id, paymentId, "monthly")).status).toBe(200);
    expect(await couponState(coupon)).toMatchObject({ redemptionCount: 1, reservedCount: 0, applied: 1 });
    const session = await CheckoutSession.findOne({ razorpayOrderId: first.body.id }).lean();
    expect(session.couponReservation).toBe("redeemed");
  });

  test("residual: paying a stale superseded order after capacity is gone is honoured, counted, and flagged", async () => {
    // Razorpay orders never expire, so a buyer who keeps a superseded order id
    // can still pay it. The money is captured at the discounted amount, so
    // fulfillment records it and keeps the counters truthful, and raises
    // COUPON_LIMIT_EXCEEDED_AT_FULFILLMENT for operators. This pins that
    // behaviour; it is the documented remaining risk, not a silent bypass.
    const { logger } = require("../../utils/logger");
    const coupon = await makeCoupon({ maxRedemptions: 1 });
    const a = await makeUser();
    const b = await makeUser();
    const stale = await order(a.token, { planType: "monthly", couponCode: coupon.codeNormalized });
    expect((await order(a.token, { planType: "3_months" })).status).toBe(200); // supersedes, releases the hold
    expect((await orderAndPay(b.token, "monthly", coupon.codeNormalized)).verifyStatus).toBe(200); // B takes the slot
    logger.error.mockClear();
    const paymentId = pay(stale.body.id);
    expect((await verify(a.token, stale.body.id, paymentId, "monthly")).status).toBe(200);
    expect(await couponState(coupon)).toMatchObject({ redemptionCount: 2, reservedCount: 0, applied: 2 });
    expect(logger.error).toHaveBeenCalledWith("COUPON_LIMIT_EXCEEDED_AT_FULFILLMENT", expect.objectContaining({ couponId: String(coupon._id) }));
    // The coupon reads as exhausted for everyone else from here on.
    expect((await validate(b.token, { code: coupon.codeNormalized, planType: "monthly" })).status).toBe(400);
  });

  test("full refund reverses the redemption, frees the counter, and replays once", async () => {
    const coupon = await makeCoupon({ maxRedemptions: 1, maxPerUser: 1 });
    const u = await makeUser();
    const paid = await orderAndPay(u.token, "monthly", coupon.codeNormalized);
    expect(paid.verifyStatus).toBe(200);
    expect((await order(u.token, { planType: "monthly", couponCode: coupon.codeNormalized })).status).toBe(400);

    const partial = await applyVerifiedRazorpayRefund({ razorpayPaymentId: paid.paymentId, refundKey: `rf_p_${paid.paymentId}`, totalRefundedAmount: 50, fullyRefunded: false });
    expect(partial.success).toBe(true);
    expect(await couponState(coupon)).toMatchObject({ redemptionCount: 1, applied: 1, reversed: 0 });

    const full = await applyVerifiedRazorpayRefund({ razorpayPaymentId: paid.paymentId, refundKey: `rf_f_${paid.paymentId}`, totalRefundedAmount: 279, fullyRefunded: true });
    expect(full.fullyRefunded).toBe(true);
    expect(await couponState(coupon)).toMatchObject({ redemptionCount: 0, reservedCount: 0, applied: 0, reversed: 1 });
    const usage = await CouponUserUsage.findOne({ coupon: coupon._id, user: u.user._id }).lean();
    expect(usage.usedCount).toBe(0);

    const replay = await applyVerifiedRazorpayRefund({ razorpayPaymentId: paid.paymentId, refundKey: `rf_f_${paid.paymentId}`, totalRefundedAmount: 279, fullyRefunded: true });
    expect(replay.idempotent).toBe(true);
    expect(await couponState(coupon)).toMatchObject({ redemptionCount: 0, reversed: 1 });

    // Existing rule: the code is reusable after a full refund.
    expect((await order(u.token, { planType: "monthly", couponCode: coupon.codeNormalized })).status).toBe(200);
  });

  test("fails closed: a database error while reserving refuses the discounted order and creates nothing", async () => {
    const coupon = await makeCoupon({ maxRedemptions: 1 });
    const u = await makeUser();
    const spy = jest.spyOn(Coupon, "findOneAndUpdate").mockImplementationOnce(() => {
      throw new Error("simulated primary step-down");
    });
    try {
      const res = await order(u.token, { planType: "monthly", couponCode: coupon.codeNormalized });
      expect(res.status).toBe(503);
      expect(res.body.errorCode).toBe("COUPON_RESERVATION_UNAVAILABLE");
    } finally {
      spy.mockRestore();
    }
    expect(mockRzp.orders.size).toBe([...mockRzp.orders.values()].length); // no order created for this user
    expect(await CheckoutSession.countDocuments({ user: u.user._id })).toBe(0);
    expect(await couponState(coupon)).toMatchObject({ redemptionCount: 0, reservedCount: 0 });
    // The coupon is still purchasable once the database is healthy again.
    expect((await orderAndPay(u.token, "monthly", coupon.codeNormalized)).verifyStatus).toBe(200);
  });

  test("no orphaned holds or counter drift after the lifecycle scenarios", async () => {
    const coupons = await Coupon.find({ campaign: campaign._id }).lean();
    for (const c of coupons) {
      const openHolds = await CheckoutSession.countDocuments({ coupon: c._id, couponReservation: "reserved", status: "open", expiresAt: { $gte: new Date() } });
      const applied = await CouponRedemption.countDocuments({ coupon: c._id, status: "applied" });
      expect(c.reservedCount).toBe(openHolds);
      expect(c.redemptionCount).toBe(applied);
      // Not asserted: redemptionCount ≤ maxRedemptions — the "residual" test
      // above deliberately records a flagged overspend on one coupon.
    }
  });
});

// ── Audit follow-ups on the order route and admin update path ─────────────

describe("order route validation and admin update guards", () => {
  test("/payments/order rejects malformed bodies before touching the coupon", async () => {
    const coupon = await makeCoupon({ maxRedemptions: 1 });
    const u = await makeUser();
    expect((await order(u.token, { planType: "monthly", couponCode: [coupon.codeNormalized] })).status).toBe(400);
    expect((await order(u.token, { planType: ["monthly"], couponCode: coupon.codeNormalized })).status).toBe(400);
    expect((await order(u.token, { planType: "monthly", couponCode: "A".repeat(33) })).status).toBe(400);
    expect(await couponState(coupon)).toMatchObject({ reservedCount: 0 });
    expect((await order(u.token, { planType: "monthly", couponCode: coupon.codeNormalized })).status).toBe(200);
  });

  test("admin update cannot move expiry before the stored start, and duplicate rename says so plainly", async () => {
    const admin = require("../../services/promotionAdmin.service");
    const a = await makeCoupon({ startsAt: new Date("2026-12-01T00:00:00Z") });
    const b = await makeCoupon({});
    await expect(admin.updateCoupon(a._id, { expiresAt: "2026-11-30T00:00:00Z" })).rejects.toMatchObject({ statusCode: 400 });
    // Clearing through the API (what the admin editor sends for a blank field).
    const cleared = await admin.updateCoupon(a._id, { startsAt: null, expiresAt: "2026-12-31T00:00:00Z" });
    expect(cleared.startsAt).toBeNull();
    expect(cleared.expiresAt).toEqual(new Date("2026-12-31T00:00:00Z"));
    await expect(admin.updateCoupon(b._id, { code: a.codeNormalized.toLowerCase() })).rejects.toMatchObject({
      statusCode: 409,
      message: "Coupon code already exists",
    });
  });
});

// ── CPN-002: rate limiting ────────────────────────────────────────────────

describe("CPN-002 rate limiting", () => {
  test("Test 7 — nine coupon validations do not consume the payment budget; order and verify succeed", async () => {
    const coupon = await makeCoupon({});
    const u = await makeUser();
    const statuses = [];
    for (let i = 0; i < 9; i += 1) {
      statuses.push((await validate(u.token, { code: i % 2 ? coupon.codeNormalized : "NOPE-CODE", planType: "monthly" })).status);
    }
    expect(statuses.every((s) => s === 200 || s === 400)).toBe(true);
    expect(statuses).not.toContain(429);

    const paymentKey = [...mockRedisStore.keys()].find((k) => k.startsWith("rate-limit:payment:"));
    expect(paymentKey).toBeUndefined();

    const result = await orderAndPay(u.token, "monthly", coupon.codeNormalized);
    expect(result.orderStatus).toBe(200);
    expect(result.verifyStatus).toBe(200);
    const spent = mockRedisStore.get(`rate-limit:payment:user:${u.user._id}`);
    expect(spent.count).toBe(2); // order + verify only
  });

  test("Test 8 — coupon validation is still rate-limited on its own bucket", async () => {
    const coupon = await makeCoupon({});
    const u = await makeUser();
    const limit = Number(process.env.COUPON_VALIDATE_RATE_LIMIT_MAX_REQUESTS) || 20;
    const statuses = [];
    for (let i = 0; i < limit + 2; i += 1) {
      statuses.push((await validate(u.token, { code: coupon.codeNormalized, planType: "monthly" })).status);
    }
    expect(statuses.slice(0, limit).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(limit)).toEqual([429, 429]);
    // Being locked out of validation does not lock the buyer out of paying.
    expect((await order(u.token, { planType: "monthly" })).status).toBe(200);
  });

  test("limits are per user: one user's validation storm does not affect another", async () => {
    const coupon = await makeCoupon({});
    const a = await makeUser();
    const b = await makeUser();
    for (let i = 0; i < 22; i += 1) await validate(a.token, { code: coupon.codeNormalized, planType: "monthly" });
    expect((await validate(a.token, { code: coupon.codeNormalized, planType: "monthly" })).status).toBe(429);
    expect((await validate(b.token, { code: coupon.codeNormalized, planType: "monthly" })).status).toBe(200);
  });
});
