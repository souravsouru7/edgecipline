'use strict';

/**
 * T2 — Auth flow integration tests via HTTP (supertest)
 *   register → login → refresh → logout
 *
 * Mocks all external deps; builds a real Express app with real routes
 * so the middleware chain, error handler, and controller logic are exercised.
 */

// ---------------------------------------------------------------------------
// Mocks (hoisted to top by Jest)
// ---------------------------------------------------------------------------

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  stream: { write: jest.fn() },
}));

// Pass-through rate limiters so tests don't need Redis
jest.mock('../../middleware/rateLimiter', () => {
  const pass = (_r, _s, n) => n();
  return {
    globalRateLimiter:  pass,
    authRateLimiter:    pass,
    refreshRateLimiter: pass,
    profileRateLimiter: pass,
    statusRateLimiter:  pass,
  };
});

// Mock Redis client (used by timeout middleware and others)
jest.mock('../../config/redis', () => ({
  connectRedis: jest.fn(),
  client: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    eval: jest.fn().mockResolvedValue([1, 60000]),
  },
}));

jest.mock('../../models/Users', () => ({
  findOne:           jest.fn(),
  findById:          jest.fn(),
  create:            jest.fn(),
  findByIdAndUpdate: jest.fn(),
}));

jest.mock('../../services/tokenService', () => ({
  generateAccessToken:   jest.fn().mockReturnValue('test-access-token'),
  createRefreshToken:    jest.fn().mockResolvedValue('test-refresh-token'),
  rotateRefreshToken:    jest.fn(),
  revokeRefreshToken:    jest.fn().mockResolvedValue(undefined),
  revokeAllUserTokens:   jest.fn().mockResolvedValue(undefined),
  getCookieOptions:      jest.fn().mockReturnValue({ httpOnly: true, maxAge: 86400000, path: '/api/auth' }),
  getClearCookieOptions: jest.fn().mockReturnValue({ httpOnly: true, path: '/api/auth' }),
  REFRESH_COOKIE_NAME:   'sid',
}));

jest.mock('bcryptjs', () => ({
  genSalt: jest.fn().mockResolvedValue('salt'),
  hash:    jest.fn().mockResolvedValue('hashed_password'),
  compare: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../services/mailService', () => ({
  sendOTPEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../config/firebaseAdmin', () => ({
  getFirebaseAdmin: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const request  = require('supertest');
const express  = require('express');
const cookie   = require('cookie-parser');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const User     = require('../../models/Users');
const tokenSvc = require('../../services/tokenService');
const { appConfig } = require('../../config');

// Use the same secret the middleware uses — avoids any env-capture-timing mismatch.
const JWT_SECRET = appConfig.jwt.secret;

const { sanitizeInput } = require('../../middleware/sanitizeInput');
const { errorHandler }  = require('../../middleware/errorHandler');
const authRoutes         = require('../../routes/authRoutes');

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(cookie());
  app.use(sanitizeInput);
  app.use('/api/auth', authRoutes);
  app.use((_req, res) => res.status(404).json({ message: 'Not found' }));
  app.use(errorHandler);
  return app;
}

const app = buildApp();

const TEST_USER_ID = '507f1f77bcf86cd799439011';

/** Chainable Mongoose query mock */
const chainQuery = (value) => {
  const q = {};
  const methods = ['select', 'lean', 'sort', 'limit', 'skip', 'populate'];
  methods.forEach((m) => { q[m] = jest.fn().mockReturnValue(q); });
  q.select.mockResolvedValue(value);
  q.then    = (res, rej) => Promise.resolve(value).then(res, rej);
  q.catch   = (rej)      => Promise.resolve(value).catch(rej);
  q.finally = (fn)       => Promise.resolve(value).finally(fn);
  return q;
};

const userDoc = (overrides = {}) => ({
  _id:             TEST_USER_ID,
  name:            'Test User',
  email:           'test@example.com',
  password:        'hashed_TestPass1!',
  role:            'user',
  authProvider:    'local',
  tokenVersion:    0,
  loginAttempts:   0,
  loginLockedUntil: null,
  termsAcceptance: { termsVersion: 'v1.0' },
  save:            jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

// ---------------------------------------------------------------------------
// T2: POST /api/auth/register
// ---------------------------------------------------------------------------

describe('POST /api/auth/register', () => {
  const validBody = {
    name:            'New User',
    email:           'new@example.com',
    password:        'Strong1!Pass',
    acceptedTerms:   true,
    acceptedPrivacy: true,
  };

  test('valid payload → 201 with access token', async () => {
    User.findOne.mockResolvedValueOnce(null);
    User.create.mockResolvedValueOnce(userDoc({ email: 'new@example.com', name: 'New User' }));

    const res = await request(app).post('/api/auth/register').send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ token: 'test-access-token' });
    expect(res.headers['set-cookie']).toBeDefined();
  });

  test('weak password → 400 WEAK_PASSWORD', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validBody, password: 'weak' });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('WEAK_PASSWORD');
  });

  test('duplicate email → 400 VALIDATION_ERROR', async () => {
    User.findOne.mockResolvedValueOnce({ email: 'new@example.com' });

    const res = await request(app).post('/api/auth/register').send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  test('missing fields → 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'a@b.com', acceptedTerms: true, acceptedPrivacy: true });

    expect(res.status).toBe(400);
  });

  test('NoSQL injection attempt in body → 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ '$gt': '', name: 'x', email: 'a@b.com', password: 'P', acceptedTerms: true, acceptedPrivacy: true });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// T2: POST /api/auth/login
// ---------------------------------------------------------------------------

describe('POST /api/auth/login', () => {
  test('correct credentials → 200 with token + refresh cookie', async () => {
    const user = userDoc();
    User.findOne.mockReturnValueOnce(chainQuery(user));
    bcrypt.compare.mockResolvedValueOnce(true);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'TestPass1!' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ token: 'test-access-token' });
    expect(res.headers['set-cookie']).toBeDefined();
  });

  test('wrong password → 401 INVALID_CREDENTIALS', async () => {
    const user = userDoc();
    User.findOne.mockReturnValueOnce(chainQuery(user));
    bcrypt.compare.mockResolvedValueOnce(false);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'WrongPass1!' });

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('INVALID_CREDENTIALS');
  });

  test('locked account → 429 ACCOUNT_LOCKED', async () => {
    const user = userDoc({ loginLockedUntil: new Date(Date.now() + 10 * 60 * 1000) });
    User.findOne.mockReturnValueOnce(chainQuery(user));

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'AnyPass1!' });

    expect(res.status).toBe(429);
    expect(res.body.errorCode).toBe('ACCOUNT_LOCKED');
  });
});

// ---------------------------------------------------------------------------
// T2: POST /api/auth/refresh
// ---------------------------------------------------------------------------

describe('POST /api/auth/refresh', () => {
  test('valid refresh cookie → 200 with new access token', async () => {
    const user = userDoc();
    tokenSvc.rotateRefreshToken.mockResolvedValueOnce({
      userId: { _id: TEST_USER_ID, role: 'user', tokenVersion: 0 },
      family: 'test-family',
    });
    // Note: refreshToken controller does NOT call User.findById — no mock needed here.

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', 'sid=valid-refresh-token');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ token: 'test-access-token' });
  });

  test('no refresh cookie → 401', async () => {
    tokenSvc.rotateRefreshToken.mockRejectedValueOnce(
      Object.assign(new Error('Session expired'), { statusCode: 401, errorCode: 'AUTH_REQUIRED' })
    );

    const res = await request(app).post('/api/auth/refresh');

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// T2: POST /api/auth/logout
// ---------------------------------------------------------------------------

describe('POST /api/auth/logout', () => {
  test('logout clears session cookie', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', 'sid=some-refresh-token');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    // Cookie should be cleared (Set-Cookie header present with expired/empty value)
    const cookies = res.headers['set-cookie'] || [];
    const sidCookie = cookies.find(c => c.startsWith('sid='));
    expect(sidCookie).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// T2: GET /api/auth/me — authenticated route
// ---------------------------------------------------------------------------

describe('GET /api/auth/me', () => {
  test('no Authorization header → 401 AUTH_REQUIRED', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('AUTH_REQUIRED');
  });

  test('valid Bearer token → 200 with user profile', async () => {
    const user = userDoc();
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });

    const token = jwt.sign(
      { id: TEST_USER_ID, role: 'user', tokenVersion: 0 },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: 'test@example.com', role: 'user' });
  });

  test('expired token → 401 TOKEN_EXPIRED', async () => {
    const expired = jwt.sign(
      { id: TEST_USER_ID, role: 'user', tokenVersion: 0 },
      JWT_SECRET,
      { expiresIn: '-1s' }
    );

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expired}`);

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('TOKEN_EXPIRED');
  });

  test('tampered token → 401 INVALID_TOKEN', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer totally.invalid.token');

    expect(res.status).toBe(401);
  });
});
