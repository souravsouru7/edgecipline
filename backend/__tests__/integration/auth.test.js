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
  isRedisReady: jest.fn(() => false),
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
const ADMIN_JWT_SECRET = appConfig.jwt.adminSecret;

const { sanitizeInput } = require('../../middleware/sanitizeInput');
const { errorHandler }  = require('../../middleware/errorHandler');
const { protect }       = require('../../middleware/authMiddleware');
const authRoutes         = require('../../routes/authRoutes');

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(cookie());
  app.use(sanitizeInput);
  app.use('/api/auth', authRoutes);
  app.get('/api/product/dashboard', protect, (_req, res) => res.json({ ok: true }));
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
  q.select.mockReturnValue(q);
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
  accountStatus:   'active',
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
  test('lost register response retry does not create another account; login still works', async () => {
    const existing = userDoc({ email: 'new@example.com', name: 'New User' });
    const createCallsBefore = User.create.mock.calls.length;
    User.findOne.mockResolvedValueOnce(existing);

    const retry = await request(app).post('/api/auth/register').send(validBody);

    expect(retry.status).toBe(400);
    expect(retry.body.errorCode).toBe('VALIDATION_ERROR');
    expect(User.create.mock.calls.length).toBe(createCallsBefore);

    User.findOne.mockReturnValueOnce(chainQuery(existing));
    bcrypt.compare.mockResolvedValueOnce(true);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: validBody.email, password: validBody.password });

    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ token: 'test-access-token' });
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

  test('login from two devices issues independent refresh sessions', async () => {
    tokenSvc.createRefreshToken.mockClear();
    const firstUser = userDoc({ _id: 'device-user-1' });
    const secondUser = userDoc({ _id: 'device-user-1' });
    User.findOne
      .mockReturnValueOnce(chainQuery(firstUser))
      .mockReturnValueOnce(chainQuery(secondUser));
    bcrypt.compare
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    tokenSvc.createRefreshToken
      .mockResolvedValueOnce('refresh-device-a')
      .mockResolvedValueOnce('refresh-device-b');

    const first = await request(app)
      .post('/api/auth/login')
      .set('User-Agent', 'device-a')
      .send({ email: 'test@example.com', password: 'TestPass1!' });
    const second = await request(app)
      .post('/api/auth/login')
      .set('User-Agent', 'device-b')
      .send({ email: 'test@example.com', password: 'TestPass1!' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(tokenSvc.createRefreshToken).toHaveBeenCalledTimes(2);
    expect(first.headers['set-cookie'].join(';')).toContain('refresh-device-a');
    expect(second.headers['set-cookie'].join(';')).toContain('refresh-device-b');
  });

  test('disabled account login is rejected safely', async () => {
    const user = userDoc({ accountStatus: 'disabled' });
    User.findOne.mockReturnValueOnce(chainQuery(user));
    bcrypt.compare.mockResolvedValueOnce(true);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'TestPass1!' });

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('INVALID_CREDENTIALS');
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
    tokenSvc.rotateRefreshToken.mockClear();
    const res = await request(app).post('/api/auth/refresh');

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('AUTH_REQUIRED');
    expect(tokenSvc.rotateRefreshToken).not.toHaveBeenCalled();
  });

  test('expired refresh token clears the refresh cookie', async () => {
    tokenSvc.rotateRefreshToken.mockRejectedValueOnce(
      Object.assign(new Error('expired'), { statusCode: 401, errorCode: 'REFRESH_TOKEN_EXPIRED' })
    );

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', 'sid=expired-refresh-token');

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('REFRESH_TOKEN_EXPIRED');
    expect((res.headers['set-cookie'] || []).join(';')).toContain('sid=');
  });

  test('same-client refresh race -> 409 without clearing refresh cookie', async () => {
    tokenSvc.rotateRefreshToken.mockReset();
    tokenSvc.rotateRefreshToken.mockRejectedValueOnce(
      Object.assign(new Error('Refresh already completed'), {
        statusCode: 409,
        errorCode: 'REFRESH_TOKEN_RACE',
      })
    );

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', 'sid=just-rotated-refresh-token');

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('REFRESH_TOKEN_RACE');
    expect(res.headers['set-cookie']).toBeUndefined();
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
    User.findById.mockReturnValue(chainQuery(user));

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

  test('admin token signed with admin secret cannot access user auth route', async () => {
    const adminToken = jwt.sign(
      { id: TEST_USER_ID, role: 'admin', tokenVersion: 0 },
      ADMIN_JWT_SECRET,
      { expiresIn: '1h' }
    );

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('INVALID_TOKEN');
  });

  test('token belonging to a deleted user is rejected', async () => {
    User.findById.mockReturnValueOnce(chainQuery(null));

    const token = jwt.sign(
      { id: TEST_USER_ID, role: 'user', tokenVersion: 0 },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('AUTH_FAILED');
  });
});

describe('POST /api/auth/logout-all', () => {
  test('logout-all revokes refresh tokens, bumps tokenVersion, and clears cookie', async () => {
    tokenSvc.revokeAllUserTokens.mockClear();
    User.findByIdAndUpdate.mockClear();
    User.findById.mockReturnValueOnce(chainQuery(userDoc({
      termsAcceptance: {
        acceptedTerms: true,
        acceptedPrivacy: true,
        termsVersion: 'v1.0',
      },
    })));

    const token = jwt.sign(
      { id: TEST_USER_ID, role: 'user', tokenVersion: 0 },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const res = await request(app)
      .post('/api/auth/logout-all')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', 'sid=active-refresh-token');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(tokenSvc.revokeAllUserTokens).toHaveBeenCalledWith(TEST_USER_ID);
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(TEST_USER_ID, { $inc: { tokenVersion: 1 } });
    expect((res.headers['set-cookie'] || []).join(';')).toContain('sid=');
  });
});

describe('Protected product routes terms gate', () => {
  test('authenticated user without current terms is blocked from dashboard API', async () => {
    const user = userDoc({
      termsAcceptance: {
        acceptedTerms: false,
        acceptedPrivacy: false,
        termsVersion: null,
      },
    });
    User.findById.mockReturnValueOnce(chainQuery(user));

    const token = jwt.sign(
      { id: TEST_USER_ID, role: 'user', tokenVersion: 0 },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const res = await request(app)
      .get('/api/product/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('TERMS_NOT_ACCEPTED');
  });

  test('authenticated user with current terms can access dashboard API', async () => {
    User.findById.mockReturnValueOnce(chainQuery(userDoc({
      termsAcceptance: {
        acceptedTerms: true,
        acceptedPrivacy: true,
        termsVersion: 'v1.0',
      },
    })));

    const token = jwt.sign(
      { id: TEST_USER_ID, role: 'user', tokenVersion: 0 },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const res = await request(app)
      .get('/api/product/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
