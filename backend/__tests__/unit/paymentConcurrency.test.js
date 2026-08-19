'use strict';

/**
 * Payment concurrency, idempotency and webhook ordering.
 *
 * Covers Phases 16-19 of the payment QA plan:
 *   16 — duplicate webhook delivery (Razorpay is at-least-once)
 *   17 — concurrent delivery of the same event
 *   18 — /payments/verify racing the webhook for the same payment
 *   19 — out-of-order events (payment.captured vs order.paid)
 *
 * Shallow jest.fn() mocks cannot prove any of this: the guarantee lives in the
 * interaction between the WebhookEvent lock, the Payment unique indexes and
 * the activation path. So this suite uses in-memory collections that actually
 * enforce the production unique constraints:
 *
 *   Payment.transactionId       unique
 *   Payment.razorpayPaymentId   unique (partial, paymentMethod: "razorpay")
 *   Payment.razorpayOrderId     unique (partial, paymentMethod: "razorpay")
 *   WebhookEvent.eventId        unique
 *
 * Violations throw a duplicate-key error with code 11000, exactly as MongoDB
 * would, so the production error handling is genuinely exercised.
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// In-memory Payment collection with real unique-index behaviour
// ---------------------------------------------------------------------------

const mockPaymentStore = [];

function mockDuplicateKeyError(field) {
  const err = new Error(`E11000 duplicate key error collection: payments index: ${field}`);
  err.code = 11000;
  err.keyPattern = { [field]: 1 };
  return err;
}

function mockAssertPaymentUniqueness(doc) {
  for (const existing of mockPaymentStore) {
    if (doc.transactionId && existing.transactionId === doc.transactionId) {
      throw mockDuplicateKeyError('transactionId');
    }
    if (
      doc.paymentMethod === 'razorpay' &&
      doc.razorpayPaymentId &&
      existing.razorpayPaymentId === doc.razorpayPaymentId
    ) {
      throw mockDuplicateKeyError('razorpayPaymentId');
    }
    if (
      doc.paymentMethod === 'razorpay' &&
      doc.razorpayOrderId &&
      existing.razorpayOrderId === doc.razorpayOrderId
    ) {
      throw mockDuplicateKeyError('razorpayOrderId');
    }
  }
}

function mockMatchesOrClause(doc, query) {
  if (!query?.$or) return false;
  return query.$or.some((clause) =>
    Object.entries(clause).every(([key, value]) => doc[key] === value)
  );
}

jest.mock('../../models/Payment', () => {
  const chainable = (value) => {
    const chain = {
      select: jest.fn(() => chain),
      session: jest.fn(() => chain),
      lean: jest.fn(async () => value),
      then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
    };
    return chain;
  };

  return {
    findOne: jest.fn((query) => {
      const found = mockPaymentStore.find((doc) => mockMatchesOrClause(doc, query)) || null;
      return chainable(found);
    }),
    create: jest.fn(async (docs) => {
      const list = Array.isArray(docs) ? docs : [docs];
      const created = list.map((doc) => {
        mockAssertPaymentUniqueness(doc);
        const stored = { _id: `payment_${mockPaymentStore.length + 1}`, ...doc };
        mockPaymentStore.push(stored);
        return stored;
      });
      return Array.isArray(docs) ? created : created[0];
    }),
  };
});

// ---------------------------------------------------------------------------
// In-memory User document
// ---------------------------------------------------------------------------

const mockUserState = {};

function mockResetUser(overrides = {}) {
  Object.keys(mockUserState).forEach((key) => delete mockUserState[key]);
  Object.assign(mockUserState, {
    _id: '507f1f77bcf86cd799439011',
    name: 'Race Tester',
    subscriptionStatus: 'inactive',
    subscriptionPlan: 'free',
    subscriptionExpiry: null,
    totalPaid: 0,
    trial: { endsAt: null, used: false },
    ...overrides,
  });
}

jest.mock('../../models/Users', () => ({
  findById: jest.fn(() => {
    const chain = {
      session: jest.fn(async () => mockUserState),
      then: (resolve, reject) => Promise.resolve(mockUserState).then(resolve, reject),
    };
    return chain;
  }),
  findByIdAndUpdate: jest.fn(async (_id, update) => {
    if (update.$inc?.totalPaid) mockUserState.totalPaid += update.$inc.totalPaid;
    for (const [key, value] of Object.entries(update)) {
      if (key.startsWith('$')) continue;
      mockUserState[key] = value;
    }
    return mockUserState;
  }),
  updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
}));

// ---------------------------------------------------------------------------
// In-memory WebhookEvent collection with real lock semantics
// ---------------------------------------------------------------------------

const mockWebhookStore = new Map();

function mockEventMatchesLockFilter(doc, filter) {
  // The duplicate-key recovery path re-queries with a bare { eventId } filter
  // purely to bump deliveryAttempts. That has no lock predicate and must match
  // whatever document exists, otherwise a duplicate delivery is misreported as
  // "in progress" instead of "already processed".
  if (!Object.prototype.hasOwnProperty.call(filter, 'processed')) return true;

  if (doc.processed !== filter.processed) return false;
  const staleBefore = filter.$or?.find((c) => c.processingStartedAt)?.processingStartedAt?.$lt;
  const unlocked = doc.processing === false || doc.processing === undefined;
  const stale = staleBefore && doc.processingStartedAt && doc.processingStartedAt < staleBefore;
  return Boolean(unlocked || stale);
}

jest.mock('../../models/WebhookEvent', () => ({
  findOneAndUpdate: jest.fn(async (filter, update, options = {}) => {
    const existing = mockWebhookStore.get(filter.eventId);

    if (!existing) {
      if (!options.upsert) return null;
      const doc = {
        ...update.$setOnInsert,
        ...update.$set,
        deliveryAttempts: update.$inc?.deliveryAttempts || 0,
        processingAttempts: update.$inc?.processingAttempts || 0,
      };
      mockWebhookStore.set(filter.eventId, doc);
      return doc;
    }

    if (!mockEventMatchesLockFilter(existing, filter)) {
      // Upsert against an existing doc that does not match the filter is what
      // produces a duplicate-key error in MongoDB — the exact race the
      // production code catches on code 11000.
      if (options.upsert) throw mockDuplicateKeyError('eventId');
      return null;
    }

    Object.assign(existing, update.$set);
    if (update.$inc?.deliveryAttempts) existing.deliveryAttempts += update.$inc.deliveryAttempts;
    if (update.$inc?.processingAttempts) existing.processingAttempts += update.$inc.processingAttempts;
    return existing;
  }),
  updateOne: jest.fn(async (filter, update) => {
    const doc = mockWebhookStore.get(filter.eventId);
    if (doc) Object.assign(doc, update);
    return { modifiedCount: doc ? 1 : 0 };
  }),
}));

jest.mock('../../models/Notification', () => ({ create: jest.fn().mockResolvedValue({}) }));
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../services/authCacheService', () => ({
  invalidateAuthCache: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/analyticsEventService', () => ({ track: jest.fn() }));

// ---------------------------------------------------------------------------
// Razorpay client mock — both paths re-fetch the same provider truth
// ---------------------------------------------------------------------------

const ORDER_ID = 'order_race_1';
const PAYMENT_ID = 'pay_race_1';
const USER_ID = '507f1f77bcf86cd799439011';

const mockOrderFetch = jest.fn();
const mockPaymentFetch = jest.fn();

jest.mock('razorpay', () =>
  jest.fn().mockImplementation(() => ({
    orders: {
      create: jest.fn(),
      fetch: mockOrderFetch,
      fetchPayments: jest.fn(async () => ({
        items: [{ id: 'pay_race_1', status: 'captured', captured: true }],
      })),
    },
    payments: { fetch: mockPaymentFetch },
  }))
);

const mongoose = require('mongoose');
const Payment = require('../../models/Payment');
const { verifyPayment } = require('../../controllers/paymentController');
const { processRazorpayWebhook } = require('../../services/razorpayWebhookService');

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

// Standalone MongoDB (and CI) cannot run transactions; the session is a no-op
// so the surrounding logic is what gets exercised.
const mockSession = {
  startTransaction: jest.fn(),
  commitTransaction: jest.fn().mockResolvedValue(undefined),
  abortTransaction: jest.fn().mockResolvedValue(undefined),
  endSession: jest.fn().mockResolvedValue(undefined),
};

function signWebhook(payload) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  return { rawBody, signature };
}

function orderSignature(orderId = ORDER_ID, paymentId = PAYMENT_ID) {
  return crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
}

const capturedEvent = (eventId = 'evt_captured_1') => ({
  id: eventId,
  event: 'payment.captured',
  payload: { payment: { entity: { id: PAYMENT_ID, order_id: ORDER_ID } } },
});

const orderPaidEvent = (eventId = 'evt_order_paid_1') => ({
  id: eventId,
  event: 'order.paid',
  payload: { order: { entity: { id: ORDER_ID } } },
});

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

async function runVerify() {
  const res = mockRes();
  const next = jest.fn();
  await verifyPayment(
    {
      body: {
        razorpay_order_id: ORDER_ID,
        razorpay_payment_id: PAYMENT_ID,
        razorpay_signature: orderSignature(),
      },
      user: { _id: USER_ID },
    },
    res,
    next
  );
  return { res, next };
}

async function runWebhook(payload) {
  const { rawBody, signature } = signWebhook(payload);
  return processRazorpayWebhook({ rawBody, signature });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPaymentStore.length = 0;
  mockWebhookStore.clear();
  mockResetUser();
  jest.spyOn(mongoose, 'startSession').mockResolvedValue(mockSession);

  mockOrderFetch.mockResolvedValue({
    id: ORDER_ID,
    amount: 15000,
    currency: 'INR',
    status: 'paid',
    notes: { userId: USER_ID, planType: '3_months' },
  });
  mockPaymentFetch.mockResolvedValue({
    id: PAYMENT_ID,
    order_id: ORDER_ID,
    amount: 15000,
    currency: 'INR',
    status: 'captured',
    captured: true,
  });
});

afterAll(() => jest.restoreAllMocks());

// ---------------------------------------------------------------------------
// Phase 16 — duplicate webhook delivery
// ---------------------------------------------------------------------------

describe('Phase 16 — duplicate webhook delivery', () => {
  test('the same event delivered four times activates exactly once', async () => {
    const event = capturedEvent();

    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await runWebhook(event));
    }

    expect(mockPaymentStore).toHaveLength(1);
    expect(mockUserState.totalPaid).toBe(150);
    expect(mockUserState.subscriptionStatus).toBe('active');

    // Every redelivery is acknowledged so Razorpay stops retrying.
    expect(results.every((r) => r.success)).toBe(true);
    expect(results.slice(1).every((r) => r.idempotent || r.result?.idempotent)).toBe(true);
  });

  test('redelivery does not extend the subscription a second time', async () => {
    const event = capturedEvent();

    await runWebhook(event);
    const expiryAfterFirst = new Date(mockUserState.subscriptionExpiry).getTime();

    await runWebhook(event);
    await runWebhook(event);

    expect(new Date(mockUserState.subscriptionExpiry).getTime()).toBe(expiryAfterFirst);
    expect(mockUserState.totalPaid).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// Phase 17 — concurrent delivery of the same event
// ---------------------------------------------------------------------------

describe('Phase 17 — concurrent webhook race', () => {
  test('two simultaneous deliveries of one event produce one activation', async () => {
    const event = capturedEvent('evt_concurrent_1');

    const results = await Promise.all([runWebhook(event), runWebhook(event)]);

    expect(mockPaymentStore).toHaveLength(1);
    expect(mockUserState.totalPaid).toBe(150);
    expect(results.every((r) => r.success)).toBe(true);
  });

  test('five simultaneous deliveries still produce one activation', async () => {
    const event = capturedEvent('evt_concurrent_5');

    await Promise.all(Array.from({ length: 5 }, () => runWebhook(event)));

    expect(mockPaymentStore).toHaveLength(1);
    expect(mockUserState.totalPaid).toBe(150);
    expect(mockUserState.subscriptionStatus).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// Phase 18 — /payments/verify racing the webhook
// ---------------------------------------------------------------------------

describe('Phase 18 — verify and webhook race', () => {
  test('verify and webhook running concurrently activate exactly once', async () => {
    const [verifyOutcome] = await Promise.all([
      runVerify(),
      runWebhook(capturedEvent('evt_verify_race')),
    ]);

    expect(mockPaymentStore).toHaveLength(1);
    expect(mockUserState.totalPaid).toBe(150);
    expect(mockUserState.subscriptionStatus).toBe('active');
    // The synchronous path must never surface an error to the paying user.
    expect(verifyOutcome.next).not.toHaveBeenCalled();
  });

  test('webhook first, then verify — verify reports idempotent, no double charge', async () => {
    await runWebhook(capturedEvent('evt_webhook_first'));
    const expiryAfterWebhook = new Date(mockUserState.subscriptionExpiry).getTime();

    const { res, next } = await runVerify();

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ idempotent: true }));
    expect(mockPaymentStore).toHaveLength(1);
    expect(mockUserState.totalPaid).toBe(150);
    expect(new Date(mockUserState.subscriptionExpiry).getTime()).toBe(expiryAfterWebhook);
  });

  test('verify first, then webhook — webhook is a no-op', async () => {
    await runVerify();
    const expiryAfterVerify = new Date(mockUserState.subscriptionExpiry).getTime();

    await runWebhook(capturedEvent('evt_verify_first'));

    expect(mockPaymentStore).toHaveLength(1);
    expect(mockUserState.totalPaid).toBe(150);
    expect(new Date(mockUserState.subscriptionExpiry).getTime()).toBe(expiryAfterVerify);
  });
});

// ---------------------------------------------------------------------------
// Phase 19 — out-of-order events
// ---------------------------------------------------------------------------

describe('Phase 19 — webhook ordering independence', () => {
  test('payment.captured then order.paid yields one activation', async () => {
    await runWebhook(capturedEvent('evt_a1'));
    await runWebhook(orderPaidEvent('evt_a2'));

    expect(mockPaymentStore).toHaveLength(1);
    expect(mockUserState.totalPaid).toBe(150);
  });

  test('order.paid then payment.captured yields the identical final state', async () => {
    await runWebhook(orderPaidEvent('evt_b1'));
    const stateAfterOrderPaid = {
      payments: mockPaymentStore.length,
      totalPaid: mockUserState.totalPaid,
      status: mockUserState.subscriptionStatus,
      expiry: new Date(mockUserState.subscriptionExpiry).getTime(),
    };

    await runWebhook(capturedEvent('evt_b2'));

    expect(mockPaymentStore).toHaveLength(stateAfterOrderPaid.payments);
    expect(mockUserState.totalPaid).toBe(stateAfterOrderPaid.totalPaid);
    expect(mockUserState.subscriptionStatus).toBe(stateAfterOrderPaid.status);
    expect(new Date(mockUserState.subscriptionExpiry).getTime()).toBe(stateAfterOrderPaid.expiry);
  });

  test('both orderings converge on the same database state', async () => {
    await runWebhook(capturedEvent('evt_c1'));
    await runWebhook(orderPaidEvent('evt_c2'));
    const forward = { payments: mockPaymentStore.length, totalPaid: mockUserState.totalPaid };

    mockPaymentStore.length = 0;
    mockWebhookStore.clear();
    mockResetUser();

    await runWebhook(orderPaidEvent('evt_d1'));
    await runWebhook(capturedEvent('evt_d2'));
    const reverse = { payments: mockPaymentStore.length, totalPaid: mockUserState.totalPaid };

    expect(reverse).toEqual(forward);
  });

  test('interleaved duplicates across both event types still activate once', async () => {
    await Promise.all([
      runWebhook(capturedEvent('evt_mix_1')),
      runWebhook(orderPaidEvent('evt_mix_2')),
      runWebhook(capturedEvent('evt_mix_1')),
      runWebhook(orderPaidEvent('evt_mix_2')),
    ]);

    expect(mockPaymentStore).toHaveLength(1);
    expect(mockUserState.totalPaid).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// Phase 11 — payment.failed must not poison a later capture
// ---------------------------------------------------------------------------

describe('Phase 11 — payment.failed followed by payment.captured', () => {
  const failedEvent = {
    id: 'evt_failed_1',
    event: 'payment.failed',
    payload: {
      payment: {
        entity: {
          id: PAYMENT_ID,
          order_id: ORDER_ID,
          amount: 15000,
          error_code: 'BAD_REQUEST_ERROR',
          error_reason: 'payment_failed',
          notes: { userId: USER_ID, planType: '3_months' },
        },
      },
    },
  };

  test('payment.failed records nothing that grants entitlement', async () => {
    const result = await runWebhook(failedEvent);

    expect(result.success).toBe(true);
    expect(result.result.activated).toBe(false);
    expect(mockPaymentStore).toHaveLength(0);
    expect(mockUserState.subscriptionStatus).toBe('inactive');
    expect(mockUserState.totalPaid).toBe(0);
  });

  test('a later payment.captured for the SAME payment id still activates', async () => {
    await runWebhook(failedEvent);
    await runWebhook(capturedEvent('evt_captured_after_failure'));

    expect(mockPaymentStore).toHaveLength(1);
    expect(mockUserState.subscriptionStatus).toBe('active');
    expect(mockUserState.totalPaid).toBe(150);
  });

  test('a failure arriving after a successful capture does not revoke it', async () => {
    await runWebhook(capturedEvent('evt_captured_before_failure'));
    await runWebhook(failedEvent);

    expect(mockPaymentStore).toHaveLength(1);
    expect(mockUserState.subscriptionStatus).toBe('active');
    expect(mockUserState.totalPaid).toBe(150);
  });
});
