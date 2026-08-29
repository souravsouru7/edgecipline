'use strict';

/**
 * Sandbox isolation — proves the demo payment path cannot be reached by
 * accident.
 *
 * Sandbox mode activates a REAL subscription against the REAL database from a
 * fabricated payment ID. If it can be entered without deliberate opt-in, any
 * authenticated user can grant themselves premium for free. These tests pin
 * the fail-closed behaviour:
 *
 *   missing credentials + no opt-in            -> 503, never a subscription
 *   missing credentials + opt-in (non-prod)    -> sandbox allowed
 *   missing credentials + opt-in + production  -> 503 (config strips the flag)
 *   credentials present                        -> real Razorpay path, never sandbox
 */

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
}));

jest.mock('razorpay', () =>
  jest.fn().mockImplementation(() => ({
    orders: { create: jest.fn(), fetch: jest.fn() },
    payments: { fetch: jest.fn() },
  }))
);

const Payment = require('../../models/Payment');
const User = require('../../models/Users');
const { appConfig } = require('../../config');
const { createOrder, verifyPayment } = require('../../controllers/paymentController');

const authUser = { _id: '507f1f77bcf86cd799439011' };

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const sandboxBody = () => ({
  razorpay_order_id: 'sandbox_order_attack',
  razorpay_payment_id: 'sandbox_pay_attack',
});

const originalKeyId = appConfig.razorpay.keyId;
const originalAllowSandbox = appConfig.razorpay.allowSandboxPayments;

afterEach(() => {
  appConfig.razorpay.keyId = originalKeyId;
  appConfig.razorpay.allowSandboxPayments = originalAllowSandbox;
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sandbox isolation — missing credentials must fail closed', () => {
  beforeEach(() => {
    appConfig.razorpay.keyId = '';
    appConfig.razorpay.allowSandboxPayments = false;
  });

  test('verifyPayment refuses to activate a subscription without opt-in', async () => {
    const next = jest.fn();
    const res = mockRes();

    await verifyPayment({ body: sandboxBody(), user: authUser }, res, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(503);
    expect(err.errorCode).toBe('RAZORPAY_CONFIG_MISSING');

    // The security property that actually matters: no entitlement, no revenue.
    expect(Payment.create).not.toHaveBeenCalled();
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  test('createOrder refuses to issue a fake order without opt-in', async () => {
    const next = jest.fn();
    const res = mockRes();

    await createOrder({ body: {}, user: authUser }, res, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(503);
    expect(err.errorCode).toBe('RAZORPAY_CONFIG_MISSING');
    expect(res.json).not.toHaveBeenCalled();
  });

  test('missing credentials are never treated as a successful payment', async () => {
    const next = jest.fn();
    const res = mockRes();

    await verifyPayment({ body: sandboxBody(), user: authUser }, res, next);

    // No success envelope reached the client under any shape.
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].statusCode).toBe(503);
  });
});

describe('sandbox isolation — explicit opt-in on a non-production env', () => {
  beforeEach(() => {
    appConfig.razorpay.keyId = '';
    appConfig.razorpay.allowSandboxPayments = true;
  });

  test('createOrder returns a sandbox order only when opted in', async () => {
    const res = mockRes();
    const next = jest.fn();

    await createOrder({ body: {}, user: authUser }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      sandbox: true,
      amount: 53700,
      currency: 'INR',
    }));
  });
});

describe('sandbox isolation — production can never opt in', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_TRUST_PROXY = process.env.TRUST_PROXY;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (ORIGINAL_TRUST_PROXY === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = ORIGINAL_TRUST_PROXY;
    delete process.env.ALLOW_SANDBOX_PAYMENTS;
    jest.resetModules();
  });

  test('config strips allowSandboxPayments when NODE_ENV=production', () => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    // Unrelated production-only requirement; set so config can be constructed.
    process.env.TRUST_PROXY = 'false';
    process.env.ALLOW_SANDBOX_PAYMENTS = 'true';

    // Re-require config with a production environment so the guard re-evaluates.
    const freshConfig = require('../../config').appConfig;

    expect(freshConfig.razorpay.allowSandboxPayments).toBe(false);
  });

  test('config honours the flag on a non-production environment', () => {
    jest.resetModules();
    process.env.NODE_ENV = 'staging';
    process.env.ALLOW_SANDBOX_PAYMENTS = 'true';

    const freshConfig = require('../../config').appConfig;

    expect(freshConfig.razorpay.allowSandboxPayments).toBe(true);
  });

  test('config defaults to disabled when the flag is absent', () => {
    jest.resetModules();
    process.env.NODE_ENV = 'development';
    delete process.env.ALLOW_SANDBOX_PAYMENTS;

    const freshConfig = require('../../config').appConfig;

    expect(freshConfig.razorpay.allowSandboxPayments).toBe(false);
  });
});

describe('sandbox isolation — configured credentials always take the real path', () => {
  test('a configured key id disables sandbox even if the flag is on', async () => {
    appConfig.razorpay.keyId = 'rzp_test_realkey';
    appConfig.razorpay.allowSandboxPayments = true;

    const next = jest.fn();
    const res = mockRes();

    // Real path: signature verification runs and rejects the fabricated ids.
    await verifyPayment({
      body: {
        razorpay_order_id: 'sandbox_order_attack',
        razorpay_payment_id: 'sandbox_pay_attack',
        razorpay_signature: 'deadbeef',
      },
      user: authUser,
    }, res, next);

    expect(next.mock.calls[0][0].errorCode).toBe('PAYMENT_SIGNATURE_INVALID');
    expect(Payment.create).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
