'use strict';

/**
 * T5 — Admin auth tests (unit layer)
 *   - Login with correct/incorrect credentials
 *   - Non-admin user cannot use admin login
 *   - Timing attack: bcrypt always runs even for unknown emails (L1 fix)
 *   - tokenVersion invalidation
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../models/Users', () => ({
  findOne: jest.fn(),
  updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
}));

jest.mock('bcryptjs', () => ({
  compare: jest.fn().mockResolvedValue(false), // default: no match
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const bcrypt = require('bcryptjs');
const User   = require('../../models/Users');
const { adminLogin } = require('../../admin/controllers/adminAuthController');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res);
  return res;
};

const adminDoc = (overrides = {}) => ({
  _id:          '507f1f77bcf86cd799439011',
  name:         'Admin',
  email:        'admin@stratedge.com',
  password:     'hashed_AdminPass1!',
  role:         'admin',
  authProvider: 'local',
  tokenVersion: 0,
  termsAcceptance: {
    acceptedTerms: true,
    acceptedPrivacy: true,
    termsVersion: 'v1.0',
  },
  ...overrides,
});

const authQuery = (user) => {
  const query = { select: jest.fn(), lean: jest.fn().mockResolvedValue(user) };
  query.select.mockReturnValue(query);
  query.then = (resolve, reject) => Promise.resolve(user).then(resolve, reject);
  return query;
};

// ---------------------------------------------------------------------------
// T5: Admin login
// ---------------------------------------------------------------------------

describe('adminLogin', () => {
  test('correct credentials → 200 with admin profile, sets cookie', async () => {
    const admin = adminDoc();
    User.findOne.mockReturnValueOnce({ select: jest.fn().mockResolvedValue(admin) });
    bcrypt.compare.mockResolvedValueOnce(true);

    const req  = { body: { email: 'admin@stratedge.com', password: 'AdminPass1!' }, ip: '127.0.0.1', headers: {} };
    const res  = mockRes();
    const next = jest.fn();

    await adminLogin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'admin', email: 'admin@stratedge.com' })
    );
    expect(res.json.mock.calls[0][0]).not.toHaveProperty('token');
    expect(res.cookie).toHaveBeenCalled();
  });

  test('wrong password → 401 INVALID_CREDENTIALS', async () => {
    const admin = adminDoc();
    User.findOne.mockReturnValueOnce({ select: jest.fn().mockResolvedValue(admin) });
    bcrypt.compare.mockResolvedValueOnce(false);

    const req  = { body: { email: 'admin@stratedge.com', password: 'WrongPass1!' }, ip: '127.0.0.1', headers: {} };
    const res  = mockRes();
    const next = jest.fn();

    await adminLogin(req, res, next);

    expect(next.mock.calls[0][0].statusCode).toBe(401);
    expect(next.mock.calls[0][0].errorCode).toBe('INVALID_CREDENTIALS');
  });

  test('non-admin user cannot log in via admin endpoint → 401', async () => {
    const regularUser = adminDoc({ role: 'user' });
    User.findOne.mockReturnValueOnce({ select: jest.fn().mockResolvedValue(regularUser) });
    // Even if bcrypt matches, role check should block it
    bcrypt.compare.mockResolvedValueOnce(true);

    const req  = { body: { email: 'user@stratedge.com', password: 'UserPass1!' }, ip: '127.0.0.1', headers: {} };
    const res  = mockRes();
    const next = jest.fn();

    await adminLogin(req, res, next);

    expect(next.mock.calls[0][0].statusCode).toBe(401);
    expect(next.mock.calls[0][0].errorCode).toBe('INVALID_CREDENTIALS');
  });

  test('Google-provider admin account → 401 (cannot use admin password login)', async () => {
    const googleAdmin = adminDoc({ authProvider: 'google', password: null, role: 'admin' });
    User.findOne.mockReturnValueOnce({ select: jest.fn().mockResolvedValue(googleAdmin) });
    bcrypt.compare.mockResolvedValueOnce(false);

    const req  = { body: { email: 'admin@stratedge.com', password: 'AnyPass1!' }, ip: '127.0.0.1', headers: {} };
    const res  = mockRes();
    const next = jest.fn();

    await adminLogin(req, res, next);

    expect(next.mock.calls[0][0].statusCode).toBe(401);
  });

  test('missing email or password → 400 VALIDATION_ERROR', async () => {
    const req  = { body: { email: 'admin@stratedge.com' }, ip: '127.0.0.1', headers: {} };
    const res  = mockRes();
    const next = jest.fn();

    await adminLogin(req, res, next);

    expect(next.mock.calls[0][0].statusCode).toBe(400);
    expect(next.mock.calls[0][0].errorCode).toBe('VALIDATION_ERROR');
  });

  // L1 fix: bcrypt.compare ALWAYS runs — even when user is not found — to prevent timing attacks
  test('unknown email still calls bcrypt.compare (timing attack prevention)', async () => {
    User.findOne.mockReturnValueOnce({ select: jest.fn().mockResolvedValue(null) });
    bcrypt.compare.mockResolvedValueOnce(false);

    const req  = { body: { email: 'nobody@example.com', password: 'AnyPass1!' }, ip: '127.0.0.1', headers: {} };
    const res  = mockRes();
    const next = jest.fn();

    await adminLogin(req, res, next);

    // Should still call bcrypt.compare despite user not existing
    expect(bcrypt.compare).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// T5: tokenVersion invalidation
// ---------------------------------------------------------------------------

describe('tokenVersion invalidation (middleware layer)', () => {
  // This tests that the protect / adminAuth middleware rejects tokens
  // whose tokenVersion doesn't match the DB record.
  // The middleware is in authMiddleware.js / adminAuth.js.
  // We test it through the auth middleware directly.

  test('stale tokenVersion causes 401 TOKEN_INVALIDATED', async () => {
    const jwt = require('jsonwebtoken');
    const { protect } = require('../../middleware/authMiddleware');

    // Additional User mock for protect middleware
    const currentUser = adminDoc({ tokenVersion: 5 }); // DB has version 5
    User.findOne.mockReturnValue(undefined); // not called by protect
    // protect uses User.findById, not findOne
    User.findById = jest.fn().mockReturnValue(authQuery(currentUser));

    // Token was issued with old version 3
    const staleToken = jwt.sign(
      { id: '507f1f77bcf86cd799439011', role: 'user', tokenVersion: 3 },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const req  = { headers: { authorization: `Bearer ${staleToken}` }, originalUrl: '/test', ip: '127.0.0.1' };
    const res  = mockRes();
    const next = jest.fn();

    await protect(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeDefined();
    expect(next.mock.calls[0][0].statusCode).toBe(401);
    expect(next.mock.calls[0][0].errorCode).toBe('TOKEN_INVALIDATED');
  });

  test('matching tokenVersion passes protect middleware', async () => {
    const jwt = require('jsonwebtoken');
    const { protect } = require('../../middleware/authMiddleware');

    const currentUser = adminDoc({ tokenVersion: 2 });
    User.findById = jest.fn().mockReturnValue(authQuery(currentUser));

    const validToken = jwt.sign(
      { id: '507f1f77bcf86cd799439011', role: 'user', tokenVersion: 2 },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const req  = { headers: { authorization: `Bearer ${validToken}` }, originalUrl: '/test', ip: '127.0.0.1' };
    const res  = mockRes();
    const next = jest.fn();

    await protect(req, res, next);

    // next() called with no arguments = success
    expect(next).toHaveBeenCalledWith();
    expect(req.user).toBeDefined();
  });
});
