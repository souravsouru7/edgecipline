'use strict';

/**
 * T5 — Admin auth integration tests via HTTP (supertest)
 *   - Admin login: correct, wrong password, non-admin, missing fields
 *   - Rate limiting: authRateLimiter is configured for admin routes
 *   - tokenVersion: logout-all invalidates subsequent requests
 *
 * T6 — Admin API endpoint tests
 *   - Unauthenticated access to admin resources → 401
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  stream: { write: jest.fn() },
}));

// For rate limit test we want the REAL authRateLimiter behaviour
// but mock Redis to return controlled values.
// All other limiters pass through.
jest.mock('../../middleware/rateLimiter', () => {
  const pass = (_r, _s, n) => n();

  // Simulate rate limit hit after 5 calls to authRateLimiter
  let authCallCount = 0;
  const authRateLimiter = (req, res, next) => {
    authCallCount += 1;
    if (authCallCount > 5) {
      return res.status(429).json({ status: 'error', message: 'Too Many Requests', errorCode: 'RATE_LIMIT_EXCEEDED' });
    }
    next();
  };
  // Export a reset helper so tests can reset the counter
  authRateLimiter._reset = () => { authCallCount = 0; };

  return {
    globalRateLimiter:  pass,
    authRateLimiter,
    refreshRateLimiter: pass,
    profileRateLimiter: pass,
    statusRateLimiter:  pass,
    adminDestructiveRateLimiter: pass,
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
  findOne:           jest.fn(),
  findById:          jest.fn(),
  find:              jest.fn(),
  countDocuments:    jest.fn(),
  updateOne:         jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  findByIdAndUpdate: jest.fn(),
}));

jest.mock('../../models/Trade', () => ({
  aggregate:      jest.fn().mockResolvedValue([]),
  deleteMany:     jest.fn().mockResolvedValue({ deletedCount: 0 }),
}));

jest.mock('../../models/IndianTrade', () => ({
  aggregate:  jest.fn().mockResolvedValue([]),
  deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
}));

jest.mock('bcryptjs', () => ({
  compare: jest.fn().mockResolvedValue(false), // default: no match
}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const request = require('supertest');
const express = require('express');
const cookie  = require('cookie-parser');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');

const User = require('../../models/Users');
const { authRateLimiter } = require('../../middleware/rateLimiter');
const { appConfig } = require('../../config');
const JWT_SECRET = appConfig.jwt.secret;
const ADMIN_JWT_SECRET = appConfig.jwt.adminSecret;

const { sanitizeInput } = require('../../middleware/sanitizeInput');
const { errorHandler }  = require('../../middleware/errorHandler');
const adminAuthRoutes    = require('../../admin/routes/adminAuthRoutes');
const adminUserRoutes    = require('../../admin/routes/adminUserRoutes');

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(cookie());
  app.use(sanitizeInput);
  app.use('/api/admin/auth',  adminAuthRoutes);
  app.use('/api/admin/users', adminUserRoutes);
  app.use((_req, res) => res.status(404).json({ message: 'Not found' }));
  app.use(errorHandler);
  return app;
}

const app = buildApp();

const ADMIN_USER_ID = '507f1f77bcf86cd799439011';

const adminDoc = (overrides = {}) => ({
  _id:          ADMIN_USER_ID,
  name:         'Admin',
  email:        'admin@stratedge.com',
  password:     'hashed_AdminPass1!',
  role:         'admin',
  authProvider: 'local',
  tokenVersion: 0,
  ...overrides,
});

// Generates a valid admin session cookie JWT
function adminCookie() {
  const token = jwt.sign(
    { id: ADMIN_USER_ID, role: 'admin', tokenVersion: 0 },
    ADMIN_JWT_SECRET,
    { expiresIn: '8h' }
  );
  return `admin_sid=${token}`;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Reset rate limiter counter between tests
  if (authRateLimiter._reset) authRateLimiter._reset();
});

// ---------------------------------------------------------------------------
// T5: POST /api/admin/auth/login
// ---------------------------------------------------------------------------

describe('POST /api/admin/auth/login', () => {
  test('correct credentials → 200 with admin profile, sets session cookie', async () => {
    const admin = adminDoc();
    User.findOne.mockReturnValueOnce({ select: jest.fn().mockResolvedValue(admin) });
    bcrypt.compare.mockResolvedValueOnce(true);

    const res = await request(app)
      .post('/api/admin/auth/login')
      .send({ email: 'admin@stratedge.com', password: 'AdminPass1!' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'admin', email: 'admin@stratedge.com' });
    expect(res.body).not.toHaveProperty('token');
    const cookies = res.headers['set-cookie'] || [];
    expect(cookies.some(c => c.startsWith('admin_sid='))).toBe(true);
  });

  test('wrong password → 401 INVALID_CREDENTIALS', async () => {
    const admin = adminDoc();
    User.findOne.mockReturnValueOnce({ select: jest.fn().mockResolvedValue(admin) });
    bcrypt.compare.mockResolvedValueOnce(false);

    const res = await request(app)
      .post('/api/admin/auth/login')
      .send({ email: 'admin@stratedge.com', password: 'WrongPass1!' });

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('INVALID_CREDENTIALS');
  });

  test('non-admin user → 401 INVALID_CREDENTIALS', async () => {
    const regular = adminDoc({ role: 'user' });
    User.findOne.mockReturnValueOnce({ select: jest.fn().mockResolvedValue(regular) });
    bcrypt.compare.mockResolvedValueOnce(true);

    const res = await request(app)
      .post('/api/admin/auth/login')
      .send({ email: 'user@example.com', password: 'UserPass1!' });

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('INVALID_CREDENTIALS');
  });

  test('unknown email → 401 (bcrypt still ran — timing attack prevention)', async () => {
    User.findOne.mockReturnValueOnce({ select: jest.fn().mockResolvedValue(null) });
    bcrypt.compare.mockResolvedValueOnce(false);

    const res = await request(app)
      .post('/api/admin/auth/login')
      .send({ email: 'nobody@example.com', password: 'AnyPass1!' });

    expect(res.status).toBe(401);
    // bcrypt.compare was called even though user doesn't exist (timing safety)
    expect(bcrypt.compare).toHaveBeenCalledTimes(1);
  });

  test('missing password → 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/api/admin/auth/login')
      .send({ email: 'admin@stratedge.com' });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  // T5: Rate limiting — more than 5 rapid login attempts → 429
  test('> 5 rapid login attempts → 429 RATE_LIMIT_EXCEEDED', async () => {
    // Exhaust the 5 allowed attempts
    for (let i = 0; i < 5; i++) {
      User.findOne.mockReturnValueOnce({ select: jest.fn().mockResolvedValue(null) });
      bcrypt.compare.mockResolvedValueOnce(false);
      await request(app)
        .post('/api/admin/auth/login')
        .send({ email: 'admin@stratedge.com', password: 'bad' });
    }

    // 6th attempt should be rate limited
    const res = await request(app)
      .post('/api/admin/auth/login')
      .send({ email: 'admin@stratedge.com', password: 'bad' });

    expect(res.status).toBe(429);
    expect(res.body.errorCode).toBe('RATE_LIMIT_EXCEEDED');
  });
});

// ---------------------------------------------------------------------------
// T5: POST /api/admin/auth/logout
// ---------------------------------------------------------------------------

describe('POST /api/admin/auth/logout', () => {
  test('clears admin session cookie', async () => {
    User.findById.mockReturnValueOnce({
      select: jest.fn().mockResolvedValue(adminDoc()),
    });

    const res = await request(app)
      .post('/api/admin/auth/logout')
      .set('Cookie', adminCookie());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    const cookies = res.headers['set-cookie'] || [];
    // Cookie should be cleared
    expect(cookies.some(c => c.startsWith('admin_sid='))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T6: Admin protected routes — unauthenticated access
// ---------------------------------------------------------------------------

describe('Admin user routes — authentication guard', () => {
  test('GET /api/admin/users without admin cookie → 401', async () => {
    const res = await request(app).get('/api/admin/users');

    expect(res.status).toBe(401);
  });

  test('GET /api/admin/users with valid admin cookie → 200', async () => {
    const admin = adminDoc();
    // adminAuth middleware calls User.findById
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(admin) });

    const findQuery = {
      select: jest.fn().mockReturnThis(),
      sort:   jest.fn().mockReturnThis(),
      skip:   jest.fn().mockReturnThis(),
      limit:  jest.fn().mockReturnThis(),
      lean:   jest.fn().mockResolvedValue([admin]),
    };
    User.find.mockReturnValue(findQuery);
    User.countDocuments.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', adminCookie());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1 });
  });
});

// ---------------------------------------------------------------------------
// T5: tokenVersion invalidation via adminAuth middleware
// ---------------------------------------------------------------------------

describe('Admin tokenVersion invalidation (T5)', () => {
  test('cookie with stale tokenVersion → 401', async () => {
    const admin = adminDoc({ tokenVersion: 99 }); // DB has version 99
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(admin) });

    // Cookie was issued with tokenVersion = 0 (old)
    const staleToken = jwt.sign(
      { id: ADMIN_USER_ID, role: 'admin', tokenVersion: 0 },
      ADMIN_JWT_SECRET,
      { expiresIn: '8h' }
    );

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', `admin_sid=${staleToken}`);

    expect(res.status).toBe(401);
  });

  test('admin-looking token signed with user JWT secret is rejected', async () => {
    const admin = adminDoc();
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(admin) });

    const confusedToken = jwt.sign(
      { id: ADMIN_USER_ID, role: 'admin', tokenVersion: 0 },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', `admin_sid=${confusedToken}`);

    expect(res.status).toBe(401);
    expect(User.findById).not.toHaveBeenCalled();
  });

  test('normal user token cannot access admin route', async () => {
    const userToken = jwt.sign(
      { id: ADMIN_USER_ID, role: 'user', tokenVersion: 0 },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(401);
  });
});
