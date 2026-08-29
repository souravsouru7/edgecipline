'use strict';

/**
 * Razorpay webhook — HTTP integration through the real Express route.
 *
 * This is the regression guard for the single most fragile invariant in the
 * payment integration: the webhook must receive the byte-exact request body.
 *
 * `express.json()` consumes the stream and replaces `req.body` with a parsed
 * object. Re-serialising that object does NOT reproduce the original bytes
 * (key order, whitespace, unicode escaping all differ), so the HMAC no longer
 * matches and EVERY webhook silently fails signature verification. Nothing
 * else in the suite would catch it — the unit tests call the service directly
 * with a Buffer they construct themselves.
 *
 * Covers Phase 15 of the payment QA plan.
 */

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  stream: { write: jest.fn() },
}));

jest.mock('../../middleware/rateLimiter', () => {
  const pass = (_r, _s, n) => n();
  return { webhookRateLimiter: pass, globalRateLimiter: pass };
});

jest.mock('../../config/redis', () => ({
  connectRedis: jest.fn(),
  isRedisReady: jest.fn(() => false),
  client: { get: jest.fn(), set: jest.fn(), del: jest.fn(), eval: jest.fn() },
}));

jest.mock('../../models/WebhookEvent', () => ({
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
}));

jest.mock('../../services/paymentService', () => ({
  activateRazorpaySubscriptionPayment: jest.fn(),
  applyVerifiedRazorpayRefund: jest.fn(),
  fetchAndValidateRazorpayPayment: jest.fn(),
  getRazorpayClient: jest.fn(),
}));

jest.mock('../../services/analyticsEventService', () => ({ track: jest.fn() }));

const WebhookEvent = require('../../models/WebhookEvent');
const paymentService = require('../../services/paymentService');
const { standardizeResponse } = require('../../middleware/standardizeResponse');
const { sanitizeInput } = require('../../middleware/sanitizeInput');
const { errorHandler } = require('../../middleware/errorHandler');

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

// ---------------------------------------------------------------------------
// App builders
// ---------------------------------------------------------------------------

/** Mirrors backend/server.js: raw body mounted BEFORE express.json(). */
function buildCorrectApp() {
  const app = express();
  app.use(
    '/api/payments/webhook',
    standardizeResponse,
    express.raw({ type: 'application/json', limit: '1mb' }),
    require('../../routes/razorpayWebhookRoutes')
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(sanitizeInput);
  app.use(errorHandler);
  return app;
}

/** The regression we are guarding against: express.json() mounted first. */
function buildBrokenApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(
    '/api/payments/webhook',
    standardizeResponse,
    express.raw({ type: 'application/json', limit: '1mb' }),
    require('../../routes/razorpayWebhookRoutes')
  );
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sign(rawBody, secret = WEBHOOK_SECRET) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Deliberately awkward JSON: padded whitespace and a non-ASCII value. Both are
 * destroyed by a parse/re-serialise round trip, which is what makes this body
 * a real detector rather than a formality.
 */
function makeRawBody(overrides = {}) {
  const payload = {
    id: 'evt_raw_body_1',
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_raw_1',
          order_id: 'order_raw_1',
          amount: 53700,
          currency: 'INR',
          notes: { userId: '507f1f77bcf86cd799439011', planType: '3_months', memo: 'café ₹537' },
        },
      },
    },
    ...overrides,
  };
  return Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
}

function postWebhook(app, rawBody, signature) {
  const req = request(app)
    .post('/api/payments/webhook')
    .set('Content-Type', 'application/json')
    // Identity serializer. Superagent's default JSON serializer would
    // re-encode the payload (a Buffer becomes {"type":"Buffer",...}, a string
    // gets quoted), which is precisely the byte mutation this suite exists to
    // detect — it would make every signature fail for the wrong reason.
    .serialize((value) => value);
  if (signature !== undefined) req.set('X-Razorpay-Signature', signature);
  return req.send(rawBody);
}

function mockLockAcquired() {
  WebhookEvent.findOneAndUpdate.mockResolvedValue({
    eventId: 'evt_raw_body_1',
    processed: false,
    processing: true,
  });
  WebhookEvent.updateOne.mockResolvedValue({ modifiedCount: 1 });
}

beforeEach(() => {
  jest.clearAllMocks();
  paymentService.fetchAndValidateRazorpayPayment.mockResolvedValue({
    userId: '507f1f77bcf86cd799439011',
    amount: 537,
    currency: 'INR',
    razorpayOrderId: 'order_raw_1',
    razorpayPaymentId: 'pay_raw_1',
    planType: '3_months',
    subscriptionDays: 90,
  });
  paymentService.activateRazorpaySubscriptionPayment.mockResolvedValue({
    success: true,
    idempotent: false,
  });
});

// ---------------------------------------------------------------------------
// Phase 15 — raw body accepted end to end
// ---------------------------------------------------------------------------

describe('POST /api/payments/webhook — raw body signature verification', () => {
  test('accepts a correctly signed raw body and activates the subscription', async () => {
    mockLockAcquired();
    const rawBody = makeRawBody();

    const res = await postWebhook(buildCorrectApp(), rawBody, sign(rawBody));

    expect(res.status).toBe(200);
    expect(paymentService.activateRazorpaySubscriptionPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        razorpayPaymentId: 'pay_raw_1',
        razorpayOrderId: 'order_raw_1',
        source: 'razorpay_webhook',
      })
    );
  });

  test('rejects a modified body under an otherwise valid signature', async () => {
    mockLockAcquired();
    const rawBody = makeRawBody();
    const signature = sign(rawBody);

    // Attacker inflates the amount after the signature was produced.
    const tampered = Buffer.from(
      rawBody.toString('utf8').replace('"amount": 53700', '"amount": 100'),
      'utf8'
    );

    const res = await postWebhook(buildCorrectApp(), tampered, signature);

    expect(res.status).toBe(400);
    expect(paymentService.activateRazorpaySubscriptionPayment).not.toHaveBeenCalled();
  });

  test('rejects a modified signature over a valid body', async () => {
    mockLockAcquired();
    const rawBody = makeRawBody();
    const bad = sign(rawBody).replace(/^./, (c) => (c === 'a' ? 'b' : 'a'));

    const res = await postWebhook(buildCorrectApp(), rawBody, bad);

    expect(res.status).toBe(400);
    expect(paymentService.activateRazorpaySubscriptionPayment).not.toHaveBeenCalled();
  });

  test.each([
    ['missing signature header', undefined],
    ['empty signature', ''],
    ['malformed non-hex signature', 'not-a-hex-signature'],
    ['truncated signature', sign(makeRawBody()).slice(0, 32)],
    ['signature from the wrong secret', sign(makeRawBody(), 'a-different-webhook-secret-value')],
  ])('rejects %s', async (_name, signature) => {
    mockLockAcquired();
    const rawBody = makeRawBody();

    const res = await postWebhook(buildCorrectApp(), rawBody, signature);

    expect(res.status).toBe(400);
    expect(paymentService.activateRazorpaySubscriptionPayment).not.toHaveBeenCalled();
  });

  test('a valid signature never activates once express.json() consumes the body first', async () => {
    // Proves the failure mode is real: the exact request that succeeds against
    // the correct mount cannot activate a subscription when the ordering
    // regresses. It surfaces as a 500 rather than a 400 — HMAC over a parsed
    // object throws before the comparison — so assert the security property
    // (never a success, never an activation) rather than a specific status.
    mockLockAcquired();
    const rawBody = makeRawBody();

    const res = await postWebhook(buildBrokenApp(), rawBody, sign(rawBody));

    expect(res.status).not.toBe(200);
    expect(paymentService.activateRazorpaySubscriptionPayment).not.toHaveBeenCalled();
  });

  test('does not leak internal processing detail back to Razorpay', async () => {
    mockLockAcquired();
    const rawBody = makeRawBody();

    const res = await postWebhook(buildCorrectApp(), rawBody, sign(rawBody));

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('evt_raw_body_1');
    expect(body).not.toContain('processingResult');
    expect(body).toContain('received');
  });
});

// ---------------------------------------------------------------------------
// Static guard on the real server.js mount order
// ---------------------------------------------------------------------------

describe('server.js webhook middleware ordering', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');

  const webhookMountIndex = source.indexOf('"/api/payments/webhook"');
  // Match the actual middleware call, not the explanatory comment above the
  // mount (which also contains the text "express.json()").
  const jsonIndex = source.indexOf('app.use(express.json(');
  const sanitizeIndex = source.indexOf('app.use(sanitizeInput)');
  const rateLimitIndex = source.indexOf('app.use(globalRateLimiter)');

  test('the webhook route is mounted in server.js', () => {
    expect(webhookMountIndex).toBeGreaterThan(-1);
    expect(source).toContain('express.raw(');
  });

  test('the webhook mount precedes express.json()', () => {
    expect(jsonIndex).toBeGreaterThan(-1);
    expect(webhookMountIndex).toBeLessThan(jsonIndex);
  });

  test('the webhook mount precedes input sanitization', () => {
    expect(sanitizeIndex).toBeGreaterThan(-1);
    expect(webhookMountIndex).toBeLessThan(sanitizeIndex);
  });

  test('the webhook mount precedes the global rate limiter', () => {
    expect(rateLimitIndex).toBeGreaterThan(-1);
    expect(webhookMountIndex).toBeLessThan(rateLimitIndex);
  });
});
