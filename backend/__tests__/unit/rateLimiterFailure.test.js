'use strict';

const mockEval = jest.fn();
const mockIsRedisReady = jest.fn();
const mockCaptureOperationalError = jest.fn();
const jwt = require('jsonwebtoken');

jest.mock('../../config/redis', () => ({
  client: { eval: mockEval },
  isRedisReady: mockIsRedisReady,
}));

jest.mock('../../config/sentry', () => ({
  captureOperationalError: mockCaptureOperationalError,
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const {
  authRateLimiter,
  createRedisRateLimiter,
  deviceTokenRateLimiter,
  globalRateLimiter,
  getRateLimiterHealth,
  refreshRateLimiter,
  resetRateLimiterStateForTests,
  webhookRateLimiter,
} = require('../../middleware/rateLimiter');

function createReq(ip = '203.0.113.10') {
  return {
    ip,
    headers: {},
    method: 'POST',
    originalUrl: '/api/auth/login',
    requestId: 'request-1',
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

describe('Redis rate limiter failure behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimiterStateForTests();
    mockIsRedisReady.mockReturnValue(false);
  });

  test('auth limiter fails closed with 503 when Redis is unavailable', async () => {
    const res = createRes();
    const next = jest.fn();

    await authRateLimiter(createReq(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'Authentication temporarily unavailable' });
    expect(mockEval).not.toHaveBeenCalled();
    expect(mockCaptureOperationalError).toHaveBeenCalledTimes(1);
    expect(getRateLimiterHealth()).toMatchObject({
      status: 'degraded',
      failClosedRequestCount: 1,
      affectedScopes: ['auth'],
    });
  });

  test('refresh limiter also fails closed instead of rotating tokens without protection', async () => {
    const res = createRes();
    const next = jest.fn();

    await refreshRateLimiter(createReq(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'Authentication temporarily unavailable' });
  });

  test('auth limiter blocks rapid login attempts after the configured budget', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockEval.mockResolvedValueOnce([6, 60_000]);
    const res = createRes();
    const next = jest.fn();

    await authRateLimiter(createReq(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({
      status: 'error',
      message: 'Too many authentication attempts. Please try again later.',
    });
    expect(res.headers['Retry-After']).toBe('60');
  });

  test('webhook limiter fails closed when distributed limiting is unavailable', async () => {
    const res = createRes();
    const next = jest.fn();

    await webhookRateLimiter(createReq(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
  });

  test('in-memory fallback uses the limiter budget instead of a hard-coded 10 requests', async () => {
    const next = jest.fn();

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const res = createRes();
      await deviceTokenRateLimiter(createReq(), res, next);
      expect(res.statusCode).toBe(200);
      expect(res.headers['RateLimit-Policy']).toBe('fallback-memory');
      expect(res.headers['RateLimit-Limit']).toBe('20');
    }

    const blockedRes = createRes();
    await deviceTokenRateLimiter(createReq(), blockedRes, next);
    expect(next).toHaveBeenCalledTimes(20);
    expect(blockedRes.statusCode).toBe(429);
    expect(mockCaptureOperationalError).toHaveBeenCalledTimes(1);
    expect(getRateLimiterHealth()).toMatchObject({
      fallbackRequestCount: 21,
      fallback: { defaultMaxRequests: 10, defaultWindowMs: 60_000 },
    });
  });

  test('global fallback is keyed by authenticated user so normal page loads are not shared by IP', async () => {
    const verifySpy = jest.spyOn(jwt, 'verify').mockReturnValue({ id: 'user-a' });
    const userReq = createReq();
    userReq.method = 'GET';
    userReq.originalUrl = '/api/reports/weekly';
    userReq.headers.authorization = 'Bearer valid-token';

    const otherUserReq = createReq();
    otherUserReq.method = 'GET';
    otherUserReq.originalUrl = '/api/reports/weekly';
    otherUserReq.headers.authorization = 'Bearer other-token';

    for (let attempt = 1; attempt <= 100; attempt += 1) {
      const res = createRes();
      await globalRateLimiter(userReq, res, jest.fn());
      expect(res.statusCode).toBe(200);
      expect(res.headers['RateLimit-Limit']).toBe('100');
    }

    const blockedRes = createRes();
    await globalRateLimiter(userReq, blockedRes, jest.fn());
    expect(blockedRes.statusCode).toBe(429);

    verifySpy.mockReturnValueOnce({ id: 'user-b' });
    const otherUserRes = createRes();
    const next = jest.fn();
    await globalRateLimiter(otherUserReq, otherUserRes, next);
    expect(otherUserRes.statusCode).toBe(200);
    expect(next).toHaveBeenCalledTimes(1);

    verifySpy.mockRestore();
  });

  test('global limiter lets OCR status polling use the dedicated status limiter', async () => {
    const req = createReq();
    req.method = 'GET';
    req.originalUrl = '/api/upload/job-status/6a5c833d695e198b67aca68d';

    const res = createRes();
    const next = jest.fn();

    await globalRateLimiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(mockEval).not.toHaveBeenCalled();
    expect(mockCaptureOperationalError).not.toHaveBeenCalled();
  });

  test('successful Redis evaluation clears degraded state', async () => {
    const limiter = createRedisRateLimiter({ scope: 'recovery-test', windowMs: 60_000, maxRequests: 10 });
    await limiter(createReq(), createRes(), jest.fn());
    expect(getRateLimiterHealth().degraded).toBe(true);

    mockIsRedisReady.mockReturnValue(true);
    mockEval.mockResolvedValueOnce([1, 60_000]);
    const next = jest.fn();
    await limiter(createReq(), createRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(getRateLimiterHealth().status).toBe('healthy');
  });

  test('Bearer-token keying accepts only HS256 JWTs', async () => {
    mockIsRedisReady.mockReturnValue(true);
    mockEval.mockResolvedValueOnce([1, 60_000]);
    const verifySpy = jest.spyOn(jwt, 'verify').mockReturnValue({ id: 'user-1' });
    const limiter = createRedisRateLimiter({
      scope: 'algorithm-test',
      windowMs: 60_000,
      maxRequests: 10,
    });
    const req = createReq();
    req.headers.authorization = 'Bearer test-token';

    await limiter(req, createRes(), jest.fn());

    expect(verifySpy).toHaveBeenCalledWith(
      'test-token',
      expect.any(String),
      { algorithms: ['HS256'] }
    );
    verifySpy.mockRestore();
  });
});
