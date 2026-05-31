'use strict';

/**
 * T3 — Payment flow integration tests (unit layer)
 *   - createOrder: price derived server-side, invalid planType rejected
 *   - verifyPayment: signature validation, duplicate idempotency, price not client-controlled
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../models/Notification', () => ({
  create: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../models/Payment', () => ({
  findOne: jest.fn(),
  create:  jest.fn(),
}));

jest.mock('../../models/Users', () => ({
  findById:          jest.fn(),
  findByIdAndUpdate: jest.fn().mockResolvedValue({}),
}));

// Razorpay constructor mock — prevents real HTTP calls in createOrder
jest.mock('razorpay', () =>
  jest.fn().mockImplementation(() => ({
    orders: {
      create: jest.fn().mockResolvedValue({
        id:       'order_test123',
        amount:   15000,
        currency: 'INR',
        receipt:  'rcpt_test',
      }),
    },
  }))
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const Payment  = require('../../models/Payment');
const User     = require('../../models/Users');
const mongoose = require('mongoose');

const { createOrder, verifyPayment } = require('../../controllers/paymentController');

const ORDER_ID   = 'order_testABC';
const PAYMENT_ID = 'pay_testXYZ';
const SECRET     = process.env.RAZORPAY_KEY_SECRET;

function makeValidSignature(orderId = ORDER_ID, paymentId = PAYMENT_ID) {
  return crypto.createHmac('sha256', SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
};

const mockUser = (overrides = {}) => ({
  _id:                '507f1f77bcf86cd799439011',
  name:               'Test User',
  subscriptionStatus: 'inactive',
  subscriptionExpiry: null,
  save:               jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

// Build a chainable findOne mock: Payment.findOne(...).select(...).lean() => value
function paymentFindOneMock(value) {
  return {
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(value),
    }),
  };
}

// Mock mongoose session
const mockSession = {
  startTransaction:  jest.fn(),
  commitTransaction: jest.fn().mockResolvedValue(undefined),
  abortTransaction:  jest.fn().mockResolvedValue(undefined),
  endSession:        jest.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  jest.spyOn(mongoose, 'startSession').mockResolvedValue(mockSession);
  mockSession.startTransaction.mockClear();
  mockSession.commitTransaction.mockClear();
  mockSession.abortTransaction.mockClear();
  mockSession.endSession.mockClear();
});

afterAll(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// T3: createOrder — server-side price derivation
// ---------------------------------------------------------------------------

describe('createOrder', () => {
  test('valid planType "3_months" → creates Razorpay order at server-defined price', async () => {
    const req  = { body: { planType: '3_months' }, user: { _id: 'uid' }, ip: '127.0.0.1', headers: {} };
    const res  = mockRes();
    const next = jest.fn();

    await createOrder(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 'order_test123' }));
  });

  test('invalid planType → 400 VALIDATION_ERROR (client cannot fabricate a plan)', async () => {
    const req  = { body: { planType: 'free_forever_hack' }, user: { _id: 'uid' }, ip: '127.0.0.1', headers: {} };
    const res  = mockRes();
    const next = jest.fn();

    await createOrder(req, res, next);

    expect(next.mock.calls[0][0].statusCode).toBe(400);
    expect(next.mock.calls[0][0].errorCode).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// T3: verifyPayment — signature, idempotency, price integrity
// ---------------------------------------------------------------------------

describe('verifyPayment', () => {
  const validBody = () => ({
    razorpay_order_id:   ORDER_ID,
    razorpay_payment_id: PAYMENT_ID,
    razorpay_signature:  makeValidSignature(),
    planType:            '3_months',
  });

  const authUser = { _id: '507f1f77bcf86cd799439011' };

  test('valid signature + new payment → 200 success', async () => {
    // No existing payment
    Payment.findOne.mockReturnValueOnce(paymentFindOneMock(null));
    const user = mockUser();
    User.findById.mockReturnValueOnce({ session: jest.fn().mockResolvedValue(user) });
    Payment.create.mockResolvedValueOnce([{ _id: 'new-payment-id', expiryDate: new Date() }]);

    const req  = { body: validBody(), user: authUser, ip: '127.0.0.1', headers: {} };
    const res  = mockRes();
    const next = jest.fn();

    await verifyPayment(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(mockSession.commitTransaction).toHaveBeenCalled();
  });

  test('invalid signature → 400 PAYMENT_SIGNATURE_INVALID', async () => {
    const body = { ...validBody(), razorpay_signature: 'deadbeef_tampered_signature' };
    const req  = { body, user: authUser, ip: '127.0.0.1', headers: {} };
    const res  = mockRes();
    const next = jest.fn();

    await verifyPayment(req, res, next);

    expect(next.mock.calls[0][0].statusCode).toBe(400);
    expect(next.mock.calls[0][0].errorCode).toBe('PAYMENT_SIGNATURE_INVALID');
    expect(Payment.create).not.toHaveBeenCalled();
  });

  test('duplicate payment_id → 200 idempotent:true, no second charge', async () => {
    Payment.findOne.mockReturnValueOnce(paymentFindOneMock({ _id: 'already-exists' }));

    const req  = { body: validBody(), user: authUser, ip: '127.0.0.1', headers: {} };
    const res  = mockRes();
    const next = jest.fn();

    await verifyPayment(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ idempotent: true }));
    expect(Payment.create).not.toHaveBeenCalled();
  });

  test('invalid planType → 400 VALIDATION_ERROR before signature check', async () => {
    const body = { ...validBody(), planType: 'premium_unlimited' };
    const req  = { body, user: authUser, ip: '127.0.0.1', headers: {} };
    const res  = mockRes();
    const next = jest.fn();

    await verifyPayment(req, res, next);

    expect(next.mock.calls[0][0].statusCode).toBe(400);
    expect(next.mock.calls[0][0].errorCode).toBe('VALIDATION_ERROR');
    // No DB calls — rejected before reaching them
    expect(Payment.findOne).not.toHaveBeenCalled();
  });

  test('payment amount is always server-derived — client "amount" field is ignored', async () => {
    Payment.findOne.mockReturnValueOnce(paymentFindOneMock(null));
    const user = mockUser();
    User.findById.mockReturnValueOnce({ session: jest.fn().mockResolvedValue(user) });

    let capturedAmount;
    Payment.create.mockImplementationOnce(([data]) => {
      capturedAmount = data.amount;
      return Promise.resolve([{ _id: 'pid', expiryDate: new Date() }]);
    });

    // Client attempts to pass amount=0 hoping to bypass pricing
    const body = { ...validBody(), amount: 0 };
    const req  = { body, user: authUser, ip: '127.0.0.1', headers: {} };
    const res  = mockRes();
    const next = jest.fn();

    await verifyPayment(req, res, next);

    // Server always uses PLAN_AMOUNTS["3_months"] = 150, not the client value
    expect(capturedAmount).toBe(150);
  });
});
