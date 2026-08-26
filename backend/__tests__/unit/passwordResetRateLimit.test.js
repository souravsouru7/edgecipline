'use strict';

/**
 * Per-email rate limiting on POST /api/auth/forgot-password.
 *
 * The IP limiter that already guarded this route cannot stop a distributed
 * mail-bomb against one inbox, so the counter also has to key on the submitted
 * address. These tests pin the two properties that matter: the bucket follows
 * the email rather than the caller, and it is charged the same whether or not
 * that email has an account (otherwise the 429 itself becomes an enumeration
 * oracle).
 */

const mockEval = jest.fn();
const mockIsRedisReady = jest.fn();

process.env.PASSWORD_RESET_EMAIL_WINDOW_MS = '60000';
process.env.PASSWORD_RESET_EMAIL_MAX_REQUESTS = '3';

jest.mock('../../config/redis', () => ({
  client: { eval: mockEval },
  isRedisReady: mockIsRedisReady,
}));

jest.mock('../../config/sentry', () => ({
  captureOperationalError: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const {
  passwordResetEmailRateLimiter,
  resetRateLimiterStateForTests,
} = require('../../middleware/rateLimiter');

function createReq(email, ip = '203.0.113.10') {
  return {
    ip,
    headers: {},
    method: 'POST',
    originalUrl: '/api/auth/forgot-password',
    requestId: 'request-1',
    body: email === undefined ? {} : { email },
  };
}

function createRes() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function run(req) {
  const res = createRes();
  const next = jest.fn();
  await passwordResetEmailRateLimiter(req, res, next);
  return { res, allowed: next.mock.calls.length === 1 };
}

describe('password reset per-email rate limiter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimiterStateForTests();
    // Redis unavailable → in-memory fallback, which exercises the same
    // key resolver without needing a live server.
    mockIsRedisReady.mockReturnValue(false);
  });

  test('allows the first three requests for an address and blocks the fourth', async () => {
    for (let i = 0; i < 3; i += 1) {
      const { allowed } = await run(createReq('trader@example.com'));
      expect(allowed).toBe(true);
    }

    const fourth = await run(createReq('trader@example.com'));
    expect(fourth.allowed).toBe(false);
    expect(fourth.res.statusCode).toBe(429);
    expect(fourth.res.body.message).toMatch(/too many password reset requests/i);
    expect(fourth.res.headers['Retry-After']).toBeDefined();
  });

  test('the bucket follows the email, not the IP — rotating IPs cannot mail-bomb one inbox', async () => {
    for (let i = 0; i < 3; i += 1) {
      await run(createReq('victim@example.com', `198.51.100.${i}`));
    }

    const fromFreshIp = await run(createReq('victim@example.com', '192.0.2.77'));
    expect(fromFreshIp.allowed).toBe(false);
    expect(fromFreshIp.res.statusCode).toBe(429);
  });

  test('a different address has its own budget', async () => {
    for (let i = 0; i < 3; i += 1) await run(createReq('first@example.com'));

    const other = await run(createReq('second@example.com'));
    expect(other.allowed).toBe(true);
  });

  test('case and surrounding whitespace map to the same bucket', async () => {
    await run(createReq('Trader@Example.com'));
    await run(createReq('  trader@example.com  '));
    await run(createReq('TRADER@EXAMPLE.COM'));

    const fourth = await run(createReq('trader@example.com'));
    expect(fourth.allowed).toBe(false);
  });

  test('unregistered addresses are charged exactly like registered ones', async () => {
    // The limiter runs before any DB lookup, so it cannot behave differently —
    // this asserts the property holds for an address nothing knows about.
    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push((await run(createReq('nobody-here-at-all@example.com'))).allowed);
    }
    expect(results).toEqual([true, true, true, false]);
  });

  test('requests with no usable email skip the limiter so validation can answer', async () => {
    const missing = await run(createReq(undefined));
    const blank = await run(createReq('   '));
    const nonString = await run(createReq(['a@b.co']));

    expect(missing.allowed).toBe(true);
    expect(blank.allowed).toBe(true);
    expect(nonString.allowed).toBe(true);
  });

  test('the redis key is a hash — raw inboxes are never written to redis', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockEval.mockResolvedValue([1, 60000]);

    await run(createReq('trader@example.com'));

    const [, , key] = mockEval.mock.calls[0];
    expect(key).toMatch(/^rate-limit:password-reset-email:email:[a-f0-9]{32}$/);
    expect(key).not.toContain('trader@example.com');
  });
});
