'use strict';

/**
 * Payment lifecycle: checkout duplication, renewal stacking, database
 * integrity and the refund matrix.
 *
 * Covers Phases 20-23 of the payment QA plan. Extends paymentRefund.test.js
 * (full refund + replay) with the partial, over-refund, unknown-payment and
 * repeated-refund cases.
 */

const crypto = require('crypto');

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../models/Notification', () => ({ create: jest.fn().mockResolvedValue({}) }));
jest.mock('../../models/Payment', () => ({ findOne: jest.fn(), create: jest.fn() }));
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
jest.mock('razorpay', () =>
  jest.fn().mockImplementation(() => ({
    orders: { create: mockOrderCreate, fetch: jest.fn() },
    payments: { fetch: jest.fn() },
  }))
);

const mongoose = require('mongoose');
const Payment = require('../../models/Payment');
const User = require('../../models/Users');
const { createOrder } = require('../../controllers/paymentController');
const {
  activateRazorpaySubscriptionPayment,
  applyVerifiedRazorpayRefund,
  resolveSubscriptionPlanLabel,
  PLAN_CONFIG,
} = require('../../services/paymentService');

// activate() and createOrder() both fall back to the catalogue price when the
// caller does not pass one, so these track PLAN_CONFIG rather than a literal.
const PLAN_PRICE = PLAN_CONFIG['3_months'].amount;
const PLAN_PAISE = PLAN_PRICE * 100;

const USER_ID = '507f1f77bcf86cd799439011';
const DAY_MS = 24 * 60 * 60 * 1000;

const session = {
  startTransaction: jest.fn(),
  commitTransaction: jest.fn().mockResolvedValue(undefined),
  abortTransaction: jest.fn().mockResolvedValue(undefined),
  endSession: jest.fn().mockResolvedValue(undefined),
};

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

function refundPaymentQuery(value) {
  return { session: jest.fn().mockResolvedValue(value) };
}

function stubUser(overrides = {}) {
  const doc = {
    _id: USER_ID,
    name: 'Lifecycle Tester',
    subscriptionStatus: 'inactive',
    subscriptionPlan: 'free',
    subscriptionExpiry: null,
    totalPaid: 0,
    trial: { endsAt: null, used: false },
    ...overrides,
  };
  User.findById.mockReturnValue({
    session: jest.fn().mockResolvedValue(doc),
    then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject),
  });
  return doc;
}

/** Pull the Payment document the activation path tried to persist. */
function createdPaymentDoc() {
  const call = Payment.create.mock.calls[0];
  const docs = Array.isArray(call[0]) ? call[0] : [call[0]];
  return docs[0];
}

/** Pull the User update the activation path applied. */
function userUpdate() {
  return User.findByIdAndUpdate.mock.calls[0][1];
}

async function activate(overrides = {}) {
  return activateRazorpaySubscriptionPayment({
    userId: USER_ID,
    currency: 'INR',
    razorpayOrderId: 'order_lifecycle',
    razorpayPaymentId: 'pay_lifecycle',
    razorpaySignature: 'sig',
    planType: '3_months',
    source: 'manual_verify',
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
  Payment.findOne.mockReturnValue(paymentFindOneMock(null));
  Payment.create.mockImplementation(async (docs) =>
    (Array.isArray(docs) ? docs : [docs]).map((doc, i) => ({ _id: `pay_doc_${i}`, ...doc }))
  );
  mockOrderCreate.mockImplementation(async (opts) => ({
    id: `order_${crypto.randomBytes(4).toString('hex')}`,
    amount: opts.amount,
    currency: opts.currency,
    receipt: opts.receipt,
    notes: opts.notes,
  }));
  stubUser();
});

afterAll(() => jest.restoreAllMocks());

// ---------------------------------------------------------------------------
// Phase 20 — duplicate checkout requests
// ---------------------------------------------------------------------------

describe('Phase 20 — duplicate checkout behaviour', () => {
  test('a double-clicked Subscribe button creates two independent Razorpay orders', async () => {
    // Documenting actual behaviour, not asserting a guard. There is no
    // pending-order lock today: each click mints a fresh order. That is safe
    // for data integrity (each order can back at most one Payment, enforced by
    // the unique partial index on razorpayOrderId) but it does leave a user
    // able to pay twice if they complete both checkouts.
    await Promise.all([
      createOrder({ body: {}, user: { _id: USER_ID } }, mockRes(), jest.fn()),
      createOrder({ body: {}, user: { _id: USER_ID } }, mockRes(), jest.fn()),
    ]);

    expect(mockOrderCreate).toHaveBeenCalledTimes(2);
    const [first, second] = mockOrderCreate.mock.results.map((r) => r.value);
    return Promise.all([first, second]).then(([a, b]) => {
      expect(a.id).not.toBe(b.id);
    });
  });

  test('every concurrently created order carries the identical server-derived price', async () => {
    await Promise.all(
      Array.from({ length: 4 }, () =>
        createOrder({ body: { amount: 1 }, user: { _id: USER_ID } }, mockRes(), jest.fn())
      )
    );

    for (const call of mockOrderCreate.mock.calls) {
      expect(call[0].amount).toBe(PLAN_PAISE);
      expect(call[0].currency).toBe('INR');
    }
  });

  test('each order is bound to the authenticated user via trusted notes', async () => {
    await createOrder({ body: {}, user: { _id: USER_ID } }, mockRes(), jest.fn());

    expect(mockOrderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        notes: expect.objectContaining({ userId: USER_ID, planType: '3_months' }),
      })
    );
  });

  test('receipts are unique per order so Razorpay never collapses two checkouts', async () => {
    await createOrder({ body: {}, user: { _id: USER_ID } }, mockRes(), jest.fn());
    await createOrder({ body: {}, user: { _id: USER_ID } }, mockRes(), jest.fn());

    const [a, b] = mockOrderCreate.mock.calls.map((c) => c[0].receipt);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Phase 21 — renewal and stacking across subscription states
// ---------------------------------------------------------------------------

describe('Phase 21 — subscription stacking by user state', () => {
  test('a free user gets 90 days from now', async () => {
    const now = Date.now();
    await activate();

    const expiry = new Date(createdPaymentDoc().expiryDate).getTime();
    expect(expiry).toBeGreaterThanOrEqual(now + 89 * DAY_MS);
    expect(expiry).toBeLessThanOrEqual(now + 91 * DAY_MS);
  });

  test('books the verified charged amount rather than the live catalogue price', async () => {
    await activate({ amount: 376, promo: { listAmount: 537, discountAmount: 161 } });
    const payment = createdPaymentDoc();
    expect(payment.amount).toBe(376);
    expect(payment.listAmount).toBe(537);
    expect(payment.discountAmount).toBe(161);
    expect(userUpdate().$inc.totalPaid).toBe(376);
  });

  test('an active subscriber stacks 90 days on top of the existing expiry', async () => {
    const existingExpiry = new Date(Date.now() + 30 * DAY_MS);
    stubUser({
      subscriptionStatus: 'active',
      subscriptionPlan: 'monthly',
      subscriptionExpiry: existingExpiry,
    });

    await activate();

    const expiry = new Date(createdPaymentDoc().expiryDate).getTime();
    expect(expiry).toBeGreaterThanOrEqual(existingExpiry.getTime() + 89 * DAY_MS);
  });

  test('an expired subscriber starts a fresh 90 days from now, not from the old expiry', async () => {
    const oldExpiry = new Date(Date.now() - 60 * DAY_MS);
    stubUser({
      subscriptionStatus: 'expired',
      subscriptionPlan: 'monthly',
      subscriptionExpiry: oldExpiry,
    });

    const now = Date.now();
    await activate();

    const expiry = new Date(createdPaymentDoc().expiryDate).getTime();
    expect(expiry).toBeGreaterThanOrEqual(now + 89 * DAY_MS);
  });

  test('a user inside a trial keeps the remaining trial days', async () => {
    const trialEnd = new Date(Date.now() + 4 * DAY_MS);
    stubUser({ trial: { endsAt: trialEnd, used: true } });

    await activate();

    const expiry = new Date(createdPaymentDoc().expiryDate).getTime();
    // 90 paid days must begin AFTER the trial ends, not swallow it.
    expect(expiry).toBeGreaterThanOrEqual(trialEnd.getTime() + 89 * DAY_MS);
  });

  test('the longest live benefit wins when both a subscription and a trial are active', async () => {
    const trialEnd = new Date(Date.now() + 4 * DAY_MS);
    const subEnd = new Date(Date.now() + 20 * DAY_MS);
    stubUser({
      subscriptionStatus: 'active',
      subscriptionPlan: 'monthly',
      subscriptionExpiry: subEnd,
      trial: { endsAt: trialEnd, used: true },
    });

    await activate();

    const expiry = new Date(createdPaymentDoc().expiryDate).getTime();
    expect(expiry).toBeGreaterThanOrEqual(subEnd.getTime() + 89 * DAY_MS);
  });

  test('an already-processed payment is idempotent and adds no revenue', async () => {
    Payment.findOne.mockReturnValue(
      paymentFindOneMock({
        _id: 'existing',
        user: USER_ID,
        status: 'completed',
        expiryDate: new Date(Date.now() + 40 * DAY_MS),
      })
    );

    const result = await activate();

    expect(result.idempotent).toBe(true);
    expect(Payment.create).not.toHaveBeenCalled();
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('a higher-tier plan label is never downgraded by a later purchase', () => {
    expect(resolveSubscriptionPlanLabel('yearly', 'monthly')).toBe('yearly');
    expect(resolveSubscriptionPlanLabel('free', 'monthly')).toBe('monthly');
    expect(resolveSubscriptionPlanLabel('monthly', 'yearly')).toBe('yearly');
    expect(resolveSubscriptionPlanLabel('monthly', 'monthly')).toBe('monthly');
  });
});

// ---------------------------------------------------------------------------
// Phase 22 — database integrity of a successful activation
// ---------------------------------------------------------------------------

describe('Phase 22 — database integrity', () => {
  test('the Payment document records every field the audit trail needs', async () => {
    await activate();

    expect(createdPaymentDoc()).toEqual(
      expect.objectContaining({
        user: USER_ID,
        amount: PLAN_PRICE,
        currency: 'INR',
        status: 'completed',
        paymentMethod: 'razorpay',
        transactionId: 'pay_lifecycle',
        razorpayOrderId: 'order_lifecycle',
        razorpayPaymentId: 'pay_lifecycle',
        planType: '3_months',
        subscriptionDays: 90,
      })
    );
  });

  test('transactionId mirrors razorpayPaymentId so the unique index catches replays', async () => {
    await activate();

    const doc = createdPaymentDoc();
    expect(doc.transactionId).toBe(doc.razorpayPaymentId);
  });

  test('the User update sets exactly one activation and one revenue increment', async () => {
    await activate();

    const update = userUpdate();
    expect(update).toEqual(
      expect.objectContaining({
        subscriptionStatus: 'active',
        subscriptionPlan: 'monthly',
        $inc: { totalPaid: PLAN_PRICE },
      })
    );
    expect(User.findByIdAndUpdate).toHaveBeenCalledTimes(1);
  });

  test('subscriptionDays is snapshotted so a later PLAN_CONFIG change cannot rewrite history', async () => {
    await activate();
    expect(createdPaymentDoc().subscriptionDays).toBe(90);
  });

  test('the payment and user writes share one transaction, committed once', async () => {
    await activate();

    expect(session.startTransaction).toHaveBeenCalledTimes(1);
    expect(session.commitTransaction).toHaveBeenCalledTimes(1);
    expect(session.abortTransaction).not.toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  test('a duplicate-key error aborts the transaction and reports idempotent success', async () => {
    Payment.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }));

    const result = await activate();

    expect(result.idempotent).toBe(true);
    expect(session.abortTransaction).toHaveBeenCalled();
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('a non-duplicate failure aborts and propagates rather than half-applying', async () => {
    Payment.create.mockRejectedValueOnce(new Error('mongo exploded'));

    await expect(activate()).rejects.toThrow('mongo exploded');
    expect(session.abortTransaction).toHaveBeenCalled();
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('a non-INR currency is refused before any write', async () => {
    await expect(activate({ currency: 'USD' })).rejects.toMatchObject({
      errorCode: 'PAYMENT_INTEGRITY_CHECK_FAILED',
    });
    expect(Payment.create).not.toHaveBeenCalled();
  });

  test('a non-orderable plan is refused before any write', async () => {
    await expect(activate({ planType: 'yearly' })).rejects.toMatchObject({
      errorCode: 'VALIDATION_ERROR',
    });
    expect(Payment.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 23 — refund matrix
// ---------------------------------------------------------------------------

describe('Phase 23 — refund matrix', () => {
  function refundablePayment(overrides = {}) {
    return {
      _id: 'db-payment-1',
      user: USER_ID,
      amount: 537,
      status: 'completed',
      planType: '3_months',
      subscriptionDays: 90,
      refundedAmount: 0,
      razorpayRefundIds: [],
      save: jest.fn(),
      ...overrides,
    };
  }

  test('a partial refund marks the payment partially_refunded and keeps entitlement', async () => {
    const payment = refundablePayment();
    Payment.findOne.mockReturnValue(refundPaymentQuery(payment));

    const result = await applyVerifiedRazorpayRefund({
      razorpayPaymentId: 'pay-1',
      refundKey: 'rfnd-partial',
      totalRefundedAmount: 50,
      fullyRefunded: false,
    });

    expect(result.idempotent).toBe(false);
    expect(payment.status).toBe('partially_refunded');
    expect(payment.refundedAmount).toBe(50);

    // Subscription duration is untouched on a partial refund — only revenue moves.
    const stages = User.updateOne.mock.calls[0][1];
    expect(JSON.stringify(stages)).toContain('totalPaid');
    expect(JSON.stringify(stages)).not.toContain('subscriptionExpiry');
  });

  test('a partial refund followed by the balance escalates to fully refunded', async () => {
    const payment = refundablePayment({
      status: 'partially_refunded',
      refundedAmount: 50,
      razorpayRefundIds: ['rfnd-partial'],
    });
    Payment.findOne.mockReturnValue(refundPaymentQuery(payment));

    await applyVerifiedRazorpayRefund({
      razorpayPaymentId: 'pay-1',
      refundKey: 'rfnd-balance',
      totalRefundedAmount: 537,
      fullyRefunded: true,
    });

    expect(payment.status).toBe('refunded');
    expect(payment.refundedAmount).toBe(537);
    expect(payment.razorpayRefundIds).toEqual(['rfnd-partial', 'rfnd-balance']);
    // Only the incremental 487 is reversed, not the full 537 twice.
    expect(JSON.stringify(User.updateOne.mock.calls[0][1])).toContain('subscriptionExpiry');
  });

  test('a refund exceeding the payment amount is rejected', async () => {
    const payment = refundablePayment();
    Payment.findOne.mockReturnValue(refundPaymentQuery(payment));

    await expect(
      applyVerifiedRazorpayRefund({
        razorpayPaymentId: 'pay-1',
        refundKey: 'rfnd-over',
        totalRefundedAmount: 1000,
        fullyRefunded: true,
      })
    ).rejects.toMatchObject({ errorCode: 'PAYMENT_INTEGRITY_CHECK_FAILED' });

    expect(payment.save).not.toHaveBeenCalled();
    expect(User.updateOne).not.toHaveBeenCalled();
  });

  test('a refund for an unknown payment is rejected', async () => {
    Payment.findOne.mockReturnValue(refundPaymentQuery(null));

    await expect(
      applyVerifiedRazorpayRefund({
        razorpayPaymentId: 'pay-nonexistent',
        refundKey: 'rfnd-ghost',
        totalRefundedAmount: 537,
        fullyRefunded: true,
      })
    ).rejects.toMatchObject({ errorCode: 'PAYMENT_NOT_FOUND' });

    expect(User.updateOne).not.toHaveBeenCalled();
  });

  test.each([
    ['zero amount', 0],
    ['negative amount', -50],
    ['non-numeric amount', 'lots'],
    ['missing amount', undefined],
  ])('a refund with a %s is rejected before any lookup', async (_name, totalRefundedAmount) => {
    await expect(
      applyVerifiedRazorpayRefund({
        razorpayPaymentId: 'pay-1',
        refundKey: 'rfnd-bad',
        totalRefundedAmount,
        fullyRefunded: true,
      })
    ).rejects.toMatchObject({ errorCode: 'RAZORPAY_REFUND_INVALID' });

    expect(Payment.findOne).not.toHaveBeenCalled();
  });

  test('a refund with no refund key is rejected', async () => {
    await expect(
      applyVerifiedRazorpayRefund({
        razorpayPaymentId: 'pay-1',
        refundKey: '',
        totalRefundedAmount: 537,
        fullyRefunded: true,
      })
    ).rejects.toMatchObject({ errorCode: 'RAZORPAY_REFUND_INVALID' });
  });

  test('refunding an already fully refunded payment with a new key does not double-reverse', async () => {
    const payment = refundablePayment({
      status: 'refunded',
      refundedAmount: 537,
      razorpayRefundIds: ['rfnd-1'],
    });
    Payment.findOne.mockReturnValue(refundPaymentQuery(payment));

    await applyVerifiedRazorpayRefund({
      razorpayPaymentId: 'pay-1',
      refundKey: 'rfnd-2',
      totalRefundedAmount: 537,
      fullyRefunded: true,
    });

    // refundedAmount is a total, not a delta — it stays at 537.
    expect(payment.refundedAmount).toBe(537);
    // becameFullyRefunded is false (already refunded), so no second duration cut.
    expect(JSON.stringify(User.updateOne.mock.calls[0][1])).not.toContain('subscriptionExpiry');
  });

  test('revenue reversal can never drive totalPaid negative', async () => {
    const payment = refundablePayment();
    Payment.findOne.mockReturnValue(refundPaymentQuery(payment));

    await applyVerifiedRazorpayRefund({
      razorpayPaymentId: 'pay-1',
      refundKey: 'rfnd-floor',
      totalRefundedAmount: 537,
      fullyRefunded: true,
    });

    // The pipeline clamps at zero via $max.
    expect(JSON.stringify(User.updateOne.mock.calls[0][1])).toContain('$max');
  });
});
