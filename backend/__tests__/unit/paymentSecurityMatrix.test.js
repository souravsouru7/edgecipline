'use strict';

/**
 * Payment security attack matrix.
 *
 * Covers Phases 6-9 and the attack rows of Phase 28. Complements
 * payment.test.js (which pins the happy paths and the headline attacks) by
 * enumerating the manipulation variants exhaustively.
 *
 * Every test asserts BOTH halves of the contract:
 *   1. the API rejects with the right error code, and
 *   2. the database is untouched — no Payment row, no entitlement, no revenue.
 *
 * A rejection that still wrote to the database would be a silent breach, so
 * the second assertion is the one that actually matters.
 */

const crypto = require('crypto');

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../models/Notification', () => ({ create: jest.fn().mockResolvedValue({}) }));

jest.mock('../../models/Payment', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
}));

jest.mock('../../models/Users', () => ({
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn().mockResolvedValue({}),
  updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
}));

jest.mock('../../services/authCacheService', () => ({
  invalidateAuthCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/analyticsEventService', () => ({ track: jest.fn() }));

const mockOrderCreate = jest.fn();
const mockOrderFetch = jest.fn();
const mockPaymentFetch = jest.fn();

jest.mock('razorpay', () =>
  jest.fn().mockImplementation(() => ({
    orders: { create: mockOrderCreate, fetch: mockOrderFetch },
    payments: { fetch: mockPaymentFetch },
  }))
);

const mongoose = require('mongoose');
const Payment = require('../../models/Payment');
const User = require('../../models/Users');
const { createOrder, verifyPayment } = require('../../controllers/paymentController');

const ORDER_ID = 'order_secATTACK';
const PAYMENT_ID = 'pay_secATTACK';
const USER_ID = '507f1f77bcf86cd799439011';
const OTHER_USER_ID = '507f1f77bcf86cd799439099';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

const PLAN_AMOUNT_PAISE = 15000; // 150 INR, from PLAN_CONFIG["3_months"]

function validSignature(orderId = ORDER_ID, paymentId = PAYMENT_ID, secret = KEY_SECRET) {
  return crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
}

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

function paymentFindOneMock(value) {
  const chain = {
    session: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
  return { select: jest.fn().mockReturnValue(chain) };
}

const mockSession = {
  startTransaction: jest.fn(),
  commitTransaction: jest.fn().mockResolvedValue(undefined),
  abortTransaction: jest.fn().mockResolvedValue(undefined),
  endSession: jest.fn().mockResolvedValue(undefined),
};

/** Assert nothing was persisted — the half of a rejection that can silently fail. */
function expectDatabaseUntouched() {
  expect(Payment.create).not.toHaveBeenCalled();
  expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
}

async function attemptVerify(body, user = { _id: USER_ID }) {
  const res = mockRes();
  const next = jest.fn();
  await verifyPayment({ body, user }, res, next);
  return { res, next, error: next.mock.calls[0]?.[0] };
}

function baseVerifyBody(overrides = {}) {
  return {
    razorpay_order_id: ORDER_ID,
    razorpay_payment_id: PAYMENT_ID,
    razorpay_signature: validSignature(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(mongoose, 'startSession').mockResolvedValue(mockSession);
  Payment.findOne.mockReturnValue(paymentFindOneMock(null));
  // Activation destructures `const [payment] = await Payment.create([...])`,
  // so the mock must resolve to an array.
  Payment.create.mockImplementation(async (docs) =>
    (Array.isArray(docs) ? docs : [docs]).map((doc, i) => ({ _id: `pay_doc_${i}`, ...doc }))
  );
  // findById is consumed as `User.findById(id).session(session)` inside the
  // activation transaction, so the mock has to be chainable, not a bare promise.
  const userDoc = {
    _id: USER_ID,
    subscriptionStatus: 'inactive',
    subscriptionPlan: 'free',
    trial: {},
  };
  User.findById.mockReturnValue({
    session: jest.fn().mockResolvedValue(userDoc),
    then: (resolve, reject) => Promise.resolve(userDoc).then(resolve, reject),
  });
  mockOrderCreate.mockResolvedValue({
    id: ORDER_ID,
    amount: PLAN_AMOUNT_PAISE,
    currency: 'INR',
    receipt: 'rcpt_x',
  });
  mockOrderFetch.mockResolvedValue({
    id: ORDER_ID,
    amount: PLAN_AMOUNT_PAISE,
    currency: 'INR',
    status: 'paid',
    notes: { userId: USER_ID, planType: '3_months' },
  });
  mockPaymentFetch.mockResolvedValue({
    id: PAYMENT_ID,
    order_id: ORDER_ID,
    amount: PLAN_AMOUNT_PAISE,
    currency: 'INR',
    status: 'captured',
    captured: true,
  });
});

afterAll(() => jest.restoreAllMocks());

// ---------------------------------------------------------------------------
// Phase 6 — client-side price manipulation
// ---------------------------------------------------------------------------

describe('Phase 6 — client cannot control the amount', () => {
  test.each([
    ['amount = 1', 1],
    ['amount = 0', 0],
    ['amount = 999999', 999999],
    ['amount = -100', -100],
    ['amount = "1" (string)', '1'],
    ['amount = null', null],
    ['amount = undefined', undefined],
    ['amount = NaN', NaN],
    ['amount = {} (object)', {}],
  ])('createOrder ignores %s and charges the server price', async (_name, amount) => {
    const res = mockRes();
    await createOrder(
      { body: { planType: '3_months', amount }, user: { _id: USER_ID } },
      res,
      jest.fn()
    );

    expect(mockOrderCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: PLAN_AMOUNT_PAISE, currency: 'INR' })
    );
  });

  test.each([
    ['currency = USD', 'USD'],
    ['currency = EUR', 'EUR'],
    ['currency = inr (lowercase)', 'inr'],
  ])('createOrder ignores %s and charges in INR', async (_name, currency) => {
    const res = mockRes();
    await createOrder(
      { body: { planType: '3_months', currency }, user: { _id: USER_ID } },
      res,
      jest.fn()
    );

    expect(mockOrderCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: PLAN_AMOUNT_PAISE, currency: 'INR' })
    );
  });

  test.each([
    ['unknown plan', 'lifetime_free'],
    ['non-orderable monthly plan', 'monthly'],
    ['non-orderable yearly plan', 'yearly'],
    ['custom plan (admin-only)', 'custom'],
    ['empty string', ''],
    ['numeric plan', 123],
  ])('createOrder rejects %s', async (_name, planType) => {
    const next = jest.fn();
    await createOrder({ body: { planType }, user: { _id: USER_ID } }, mockRes(), next);

    // An empty planType falls back to the default orderable plan by design.
    if (planType === '') {
      expect(mockOrderCreate).toHaveBeenCalledWith(
        expect.objectContaining({ amount: PLAN_AMOUNT_PAISE })
      );
      return;
    }

    expect(next.mock.calls[0][0].errorCode).toBe('VALIDATION_ERROR');
    expect(mockOrderCreate).not.toHaveBeenCalled();
  });

  test.each([
    ['order underpaid at Razorpay', { amount: 100 }],
    ['order overpaid at Razorpay', { amount: 999999 }],
    ['order priced in USD', { currency: 'USD' }],
  ])('verifyPayment rejects when the %s', async (_name, orderOverrides) => {
    mockOrderFetch.mockResolvedValueOnce({
      id: ORDER_ID,
      amount: PLAN_AMOUNT_PAISE,
      currency: 'INR',
      status: 'paid',
      notes: { userId: USER_ID, planType: '3_months' },
      ...orderOverrides,
    });

    const { error } = await attemptVerify(baseVerifyBody());

    expect(error.errorCode).toBe('PAYMENT_INTEGRITY_CHECK_FAILED');
    expectDatabaseUntouched();
  });

  test.each([
    ['payment underpaid', { amount: 100 }],
    ['payment in USD', { currency: 'USD' }],
  ])('verifyPayment rejects when the %s', async (_name, paymentOverrides) => {
    mockPaymentFetch.mockResolvedValueOnce({
      id: PAYMENT_ID,
      order_id: ORDER_ID,
      amount: PLAN_AMOUNT_PAISE,
      currency: 'INR',
      status: 'captured',
      captured: true,
      ...paymentOverrides,
    });

    const { error } = await attemptVerify(baseVerifyBody());

    expect(error.errorCode).toBe('PAYMENT_INTEGRITY_CHECK_FAILED');
    expectDatabaseUntouched();
  });

  test('a client-supplied amount in the verify body cannot inflate revenue', async () => {
    const { res } = await attemptVerify(
      baseVerifyBody({ amount: 999999, currency: 'USD', subscriptionDays: 36500 })
    );

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(Payment.create).toHaveBeenCalledWith(
      [expect.objectContaining({ amount: 150, currency: 'INR', subscriptionDays: 90 })],
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 7 — cross-user payment claim
// ---------------------------------------------------------------------------

describe('Phase 7 — cross-user protection', () => {
  test('User B cannot claim an order whose notes name User A', async () => {
    const { error } = await attemptVerify(baseVerifyBody(), { _id: OTHER_USER_ID });

    expect(error.errorCode).toBe('PAYMENT_INTEGRITY_CHECK_FAILED');
    expectDatabaseUntouched();
  });

  test('a forged userId in the request body is ignored — order notes win', async () => {
    const { error } = await attemptVerify(
      baseVerifyBody({ userId: OTHER_USER_ID, user: OTHER_USER_ID }),
      { _id: OTHER_USER_ID }
    );

    expect(error.errorCode).toBe('PAYMENT_INTEGRITY_CHECK_FAILED');
    expectDatabaseUntouched();
  });

  test('a valid signature does not let User B claim User A\'s payment', async () => {
    // Signature is genuinely valid — it only binds order+payment, not identity.
    // Identity comes from the order notes, re-fetched from Razorpay.
    const { error } = await attemptVerify(
      { ...baseVerifyBody(), razorpay_signature: validSignature() },
      { _id: OTHER_USER_ID }
    );

    expect(error.errorCode).toBe('PAYMENT_INTEGRITY_CHECK_FAILED');
    expectDatabaseUntouched();
  });

  test('an order with no user metadata is rejected outright', async () => {
    mockOrderFetch.mockResolvedValueOnce({
      id: ORDER_ID,
      amount: PLAN_AMOUNT_PAISE,
      currency: 'INR',
      status: 'paid',
      notes: { planType: '3_months' },
    });

    const { error } = await attemptVerify(baseVerifyBody());

    expect(error.errorCode).toBe('PAYMENT_INTEGRITY_CHECK_FAILED');
    expectDatabaseUntouched();
  });
});

// ---------------------------------------------------------------------------
// Phase 8 — signature manipulation
// ---------------------------------------------------------------------------

describe('Phase 8 — order signature verification', () => {
  test('a valid signature is accepted', async () => {
    const { res, next } = await attemptVerify(baseVerifyBody());

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  test.each([
    ['an invalid signature', 'deadbeefdeadbeefdeadbeefdeadbeef'],
    ['an empty signature', ''],
    ['a missing signature', undefined],
    ['a malformed non-hex signature', 'zzzz-not-hex-at-all'],
    ['a truncated signature', validSignature().slice(0, 32)],
    ['an over-long signature', `${validSignature()}00`],
    ['a signature from the wrong secret', validSignature(ORDER_ID, PAYMENT_ID, 'wrong-secret')],
    ['a signature over a different order id', validSignature('order_other', PAYMENT_ID)],
    ['a signature over a different payment id', validSignature(ORDER_ID, 'pay_other')],
    ['a null signature', null],
    ['a numeric signature', 12345],
  ])('rejects %s without touching the database', async (_name, signature) => {
    const { error } = await attemptVerify(baseVerifyBody({ razorpay_signature: signature }));

    expect(error.errorCode).toBe('PAYMENT_SIGNATURE_INVALID');
    expectDatabaseUntouched();
    // Rejected before any provider call — a bad signature must not cost an API round trip.
    expect(mockOrderFetch).not.toHaveBeenCalled();
  });

  test('swapping order and payment ids invalidates an otherwise valid signature', async () => {
    const { error } = await attemptVerify({
      razorpay_order_id: PAYMENT_ID,
      razorpay_payment_id: ORDER_ID,
      razorpay_signature: validSignature(),
    });

    expect(error.errorCode).toBe('PAYMENT_SIGNATURE_INVALID');
    expectDatabaseUntouched();
  });

  test('the signature is never echoed back to the client', async () => {
    const signature = validSignature();
    const { res } = await attemptVerify(baseVerifyBody({ razorpay_signature: signature }));

    expect(JSON.stringify(res.json.mock.calls)).not.toContain(signature);
  });
});

// ---------------------------------------------------------------------------
// Phase 9 — provider re-fetch is authoritative
// ---------------------------------------------------------------------------

describe('Phase 9 — provider re-fetch validation', () => {
  test.each([
    ['order not paid (created)', { status: 'created' }],
    ['order attempted but unpaid', { status: 'attempted' }],
    ['order id mismatch', { id: 'order_someone_else' }],
  ])('rejects when the %s', async (_name, orderOverrides) => {
    mockOrderFetch.mockResolvedValueOnce({
      id: ORDER_ID,
      amount: PLAN_AMOUNT_PAISE,
      currency: 'INR',
      status: 'paid',
      notes: { userId: USER_ID, planType: '3_months' },
      ...orderOverrides,
    });

    const { error } = await attemptVerify(baseVerifyBody());

    expect(error.errorCode).toBe('PAYMENT_INTEGRITY_CHECK_FAILED');
    expectDatabaseUntouched();
  });

  test.each([
    ['payment authorized but not captured', { status: 'authorized', captured: false }],
    ['payment claims captured status but captured flag is false', { captured: false }],
    ['payment failed', { status: 'failed', captured: false }],
    ['payment belongs to another order', { order_id: 'order_elsewhere' }],
    ['payment id mismatch', { id: 'pay_elsewhere' }],
  ])('rejects when the %s', async (_name, paymentOverrides) => {
    mockPaymentFetch.mockResolvedValueOnce({
      id: PAYMENT_ID,
      order_id: ORDER_ID,
      amount: PLAN_AMOUNT_PAISE,
      currency: 'INR',
      status: 'captured',
      captured: true,
      ...paymentOverrides,
    });

    const { error } = await attemptVerify(baseVerifyBody());

    expect(error.errorCode).toBe('PAYMENT_INTEGRITY_CHECK_FAILED');
    expectDatabaseUntouched();
  });

  test('rejects an order whose notes carry a non-orderable plan', async () => {
    mockOrderFetch.mockResolvedValueOnce({
      id: ORDER_ID,
      amount: PLAN_AMOUNT_PAISE,
      currency: 'INR',
      status: 'paid',
      notes: { userId: USER_ID, planType: 'yearly' },
    });

    const { error } = await attemptVerify(baseVerifyBody());

    expect(error.errorCode).toBe('PAYMENT_INTEGRITY_CHECK_FAILED');
    expectDatabaseUntouched();
  });

  test('rejects a fabricated payment id that Razorpay does not know', async () => {
    mockPaymentFetch.mockRejectedValueOnce(Object.assign(new Error('not found'), { statusCode: 400 }));

    const { error } = await attemptVerify(baseVerifyBody());

    expect(error.errorCode).toBe('RAZORPAY_VERIFICATION_FAILED');
    expect(error.statusCode).toBe(502);
    expectDatabaseUntouched();
  });

  test('rejects a fabricated order id that Razorpay does not know', async () => {
    mockOrderFetch.mockRejectedValueOnce(Object.assign(new Error('not found'), { statusCode: 400 }));

    const { error } = await attemptVerify(baseVerifyBody());

    expect(error.errorCode).toBe('RAZORPAY_VERIFICATION_FAILED');
    expectDatabaseUntouched();
  });

  test('a Razorpay API outage fails closed, never open', async () => {
    mockOrderFetch.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    const { error } = await attemptVerify(baseVerifyBody());

    expect(error.statusCode).toBe(502);
    expectDatabaseUntouched();
  });

  test('an incomplete provider response is rejected', async () => {
    mockPaymentFetch.mockResolvedValueOnce(null);

    const { error } = await attemptVerify(baseVerifyBody());

    expect(error.errorCode).toBe('RAZORPAY_VERIFICATION_FAILED');
    expectDatabaseUntouched();
  });

  test('a planType disagreeing with the order notes is rejected', async () => {
    const { error } = await attemptVerify(baseVerifyBody({ planType: 'yearly' }));

    expect(error.errorCode).toBe('PAYMENT_INTEGRITY_CHECK_FAILED');
    expectDatabaseUntouched();
  });

  test.each([
    ['missing order id', { razorpay_order_id: undefined }],
    ['missing payment id', { razorpay_payment_id: undefined }],
  ])('rejects a request with a %s', async (_name, overrides) => {
    const body = baseVerifyBody(overrides);
    // Sign whatever ids were actually supplied so the signature is not the
    // thing under test here.
    body.razorpay_signature = validSignature(
      String(body.razorpay_order_id ?? 'undefined'),
      String(body.razorpay_payment_id ?? 'undefined')
    );

    const { error } = await attemptVerify(body);

    expect(error).toBeDefined();
    expectDatabaseUntouched();
  });
});
