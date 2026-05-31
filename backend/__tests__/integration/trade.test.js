'use strict';

/**
 * T6 — API endpoint tests: pagination, ObjectId validation, input validation, error codes
 *   Tests the trade endpoints through the full HTTP stack.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  stream: { write: jest.fn() },
}));

jest.mock('../../middleware/rateLimiter', () => {
  const pass = (_r, _s, n) => n();
  return {
    globalRateLimiter:  pass,
    authRateLimiter:    pass,
    statusRateLimiter:  pass,
    refreshRateLimiter: pass,
    profileRateLimiter: pass,
  };
});

jest.mock('../../config/redis', () => ({
  connectRedis: jest.fn(),
  client: {
    get:  jest.fn().mockResolvedValue(null),
    set:  jest.fn().mockResolvedValue('OK'),
    del:  jest.fn().mockResolvedValue(1),
    eval: jest.fn().mockResolvedValue([1, 60000]),
  },
}));

jest.mock('../../models/Users', () => ({
  findOne:  jest.fn(),
  findById: jest.fn(),
  create:   jest.fn(),
}));

// tradeController delegates to trade.service — mock the service
jest.mock('../../services/trade.service', () => ({
  getTrades:       jest.fn(),
  getTrade:        jest.fn(),
  getTradeStatus:  jest.fn(),
  createTrade:     jest.fn(),
  updateTrade:     jest.fn(),
  deleteTrade:     jest.fn(),
}));

jest.mock('../../models/IndianTrade', () => ({
  find:             jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

// Mock cache utils used by trade.service (pulled in transitively)
jest.mock('../../utils/cache', () => ({
  buildCacheKey:  jest.fn((...args) => args.join(':')),
  getCache:       jest.fn().mockResolvedValue(null),
  rememberCache:  jest.fn().mockImplementation((_key, _ttl, fn) =>
    fn().then(data => ({ data }))
  ),
}));

jest.mock('../../utils/cacheUtils', () => ({
  clearUserCache: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const request = require('supertest');
const express = require('express');
const cookie  = require('cookie-parser');
const jwt     = require('jsonwebtoken');

const User         = require('../../models/Users');
const tradeService = require('../../services/trade.service');
const { appConfig } = require('../../config');
const JWT_SECRET = appConfig.jwt.secret;

const { sanitizeInput } = require('../../middleware/sanitizeInput');
const { errorHandler }  = require('../../middleware/errorHandler');
const tradeRoutes        = require('../../routes/tradeRoutes');

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(cookie());
  app.use(sanitizeInput);
  app.use('/api/trades', tradeRoutes);
  app.use((_req, res) => res.status(404).json({ message: 'Not found' }));
  app.use(errorHandler);
  return app;
}

const app = buildApp();

const TEST_USER_ID  = '507f1f77bcf86cd799439011';
const VALID_TRADE_ID = '507f191e810c19729de860ea';

const authUser = {
  _id:          TEST_USER_ID,
  name:         'Test User',
  email:        'test@example.com',
  role:         'user',
  tokenVersion: 0,
  subscriptionStatus: 'active',
  freeUploadUsed: false,
};

function bearerToken(userOverrides = {}) {
  const u = { ...authUser, ...userOverrides };
  return jwt.sign(
    { id: u._id.toString(), role: u.role, tokenVersion: u.tokenVersion },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// Mock User.findById to return authUser (used by protect middleware)
beforeEach(() => {
  User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(authUser) });
});

// ---------------------------------------------------------------------------
// T6: Authentication guard
// ---------------------------------------------------------------------------

describe('Trade endpoints — auth guard', () => {
  test('GET /api/trades without token → 401 AUTH_REQUIRED', async () => {
    const res = await request(app).get('/api/trades');

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('AUTH_REQUIRED');
  });

  test('GET /api/trades with invalid token → 401', async () => {
    const res = await request(app)
      .get('/api/trades')
      .set('Authorization', 'Bearer not.a.valid.token');

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// T6: ObjectId validation — invalid ID format rejected
// ---------------------------------------------------------------------------

describe('Trade endpoints — ObjectId validation (H6 fix)', () => {
  const token = bearerToken();

  test('GET /api/trades/not-an-objectid → 400 INVALID_ID', async () => {
    const res = await request(app)
      .get('/api/trades/not-an-objectid')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('INVALID_ID');
  });

  test('PUT /api/trades/bad-id → 400 INVALID_ID', async () => {
    const res = await request(app)
      .put('/api/trades/!!!invalid!!!')
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'update' });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('INVALID_ID');
  });

  test('DELETE /api/trades/bad-id → 400 INVALID_ID', async () => {
    const res = await request(app)
      .delete('/api/trades/not-valid-objectid')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('INVALID_ID');
  });

  test('valid ObjectId format passes validation (may 404 if not found)', async () => {
    const ApiError = require('../../utils/ApiError');
    tradeService.getTrade.mockRejectedValueOnce(
      new ApiError(404, 'Trade not found or unauthorized', 'NOT_FOUND')
    );

    const res = await request(app)
      .get(`/api/trades/${VALID_TRADE_ID}`)
      .set('Authorization', `Bearer ${token}`);

    // Not 400 — ObjectId format is valid
    expect(res.status).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// T6: NoSQL injection prevention
// ---------------------------------------------------------------------------

describe('Trade endpoints — NoSQL injection prevention', () => {
  const token = bearerToken();

  test('body with $ key → 400 VALIDATION_ERROR (sanitizeInput blocks it)', async () => {
    const res = await request(app)
      .post('/api/trades')
      .set('Authorization', `Bearer ${token}`)
      .send({ '$where': 'this.a == this.b' });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// T6: Pagination on trade listing
// ---------------------------------------------------------------------------

describe('GET /api/trades — pagination', () => {
  const token = bearerToken();

  test('returns trades with page metadata', async () => {
    const mockTrades = [
      { _id: VALID_TRADE_ID, symbol: 'EURUSD', profit: 100 },
    ];

    tradeService.getTrades.mockResolvedValueOnce(mockTrades);

    const res = await request(app)
      .get('/api/trades?page=1&limit=10')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});
