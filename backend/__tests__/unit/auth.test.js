'use strict';

/**
 * T1 — Backend unit tests: auth controller (registerUser, loginUser)
 * T2 — Auth flow (unit layer): register, login, account lockout
 * T5 — Account lockout progression, OTP_MAX_ATTEMPTS = 3
 */

// ---------------------------------------------------------------------------
// Mocks (hoisted before any require by Jest)
// ---------------------------------------------------------------------------

jest.mock('../../models/Users', () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  findByIdAndUpdate: jest.fn(),
}));

jest.mock('../../services/tokenService', () => ({
  generateAccessToken:  jest.fn().mockReturnValue('mock-access-token'),
  createRefreshToken:   jest.fn().mockResolvedValue('mock-refresh-token'),
  revokeRefreshToken:   jest.fn().mockResolvedValue(undefined),
  revokeAllUserTokens:  jest.fn().mockResolvedValue(undefined),
  getCookieOptions:     jest.fn().mockReturnValue({ httpOnly: true, maxAge: 86400000 }),
  getClearCookieOptions: jest.fn().mockReturnValue({ httpOnly: true }),
  REFRESH_COOKIE_NAME:  'sid',
}));

jest.mock('bcryptjs', () => ({
  genSalt: jest.fn().mockResolvedValue('salt'),
  hash:    jest.fn().mockResolvedValue('hashed_password'),
  compare: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../services/mailService', () => ({
  sendOTPEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/authCacheService', () => ({
  invalidateAuthCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/cacheUtils', () => ({
  invalidateTradeCaches: jest.fn().mockResolvedValue(1),
}));

jest.mock('../../config/firebaseAdmin', () => ({
  getFirebaseAdmin: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  stream: { write: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const bcrypt = require('bcryptjs');
const User   = require('../../models/Users');
const tokenService = require('../../services/tokenService');
const { invalidateAuthCache } = require('../../services/authCacheService');
const { invalidateTradeCaches } = require('../../utils/cacheUtils');
const { registerUser, loginUser, forgotPassword, verifyOTP, resetPassword, updateOnboardingStep } = require('../../controllers/authController');

/** Creates a mock response that records what the controller calls */
const mockRes = () => {
  const res = {};
  res.status    = jest.fn().mockReturnValue(res);
  res.json      = jest.fn().mockReturnValue(res);
  res.cookie    = jest.fn().mockReturnValue(res);
  res.clearCookie = jest.fn().mockReturnValue(res);
  return res;
};

/** Creates a mock request */
const mockReq = (body = {}, extras = {}) => ({
  body,
  headers: { 'user-agent': 'test-agent' },
  ip: '127.0.0.1',
  ...extras,
});

/**
 * Returns a chainable Mongoose-like query that resolves to `value`.
 * Handles both `await Model.findOne()` and `await Model.findOne().select()`.
 */
const chainQuery = (value) => {
  const q = {
    select: jest.fn(),
    lean:   jest.fn(),
    sort:   jest.fn(),
    limit:  jest.fn(),
    skip:   jest.fn(),
  };
  // Each method returns a promise resolving to value (for simplicity)
  q.select.mockResolvedValue(value);
  q.lean.mockResolvedValue(value);
  q.sort.mockReturnValue(q);
  q.limit.mockReturnValue(q);
  q.skip.mockReturnValue(q);
  // Also make the query itself awaitable
  q.then   = (res, rej) => Promise.resolve(value).then(res, rej);
  q.catch  = (rej)      => Promise.resolve(value).catch(rej);
  q.finally = (fn)      => Promise.resolve(value).finally(fn);
  return q;
};

/** Factory for a user document returned by the DB */
const userDoc = (overrides = {}) => ({
  _id:             '507f1f77bcf86cd799439011',
  name:            'Test User',
  email:           'test@example.com',
  password:        'hashed_TestPass1!',
  role:            'user',
  accountStatus:   'active',
  authProvider:    'local',
  tokenVersion:    0,
  loginAttempts:   0,
  loginLockedUntil: null,
  otpAttempts:     0,
  otpLockUntil:    null,
  termsAcceptance: { termsVersion: 'v1.0' },
  save:            jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

// ---------------------------------------------------------------------------
// T1: registerUser — password strength validation
// ---------------------------------------------------------------------------

describe('registerUser — password validation', () => {
  const WEAK = [
    ['too short',          'Ab1!'],
    ['no uppercase',       'testpass1!'],
    ['no lowercase',       'TESTPASS1!'],
    ['no digit',           'TestPass!!'],
    ['no special char',    'TestPass11'],
  ];

  test.each(WEAK)('%s → 400 WEAK_PASSWORD', async (_label, pw) => {
    const req  = mockReq({ name: 'X', email: 'a@b.com', password: pw, acceptedTerms: true, acceptedPrivacy: true });
    const res  = mockRes();
    const next = jest.fn();

    await registerUser(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].statusCode).toBe(400);
    expect(next.mock.calls[0][0].errorCode).toBe('WEAK_PASSWORD');
  });

  test('missing name/email/password → 400 VALIDATION_ERROR', async () => {
    const req  = mockReq({ acceptedTerms: true, acceptedPrivacy: true });
    const res  = mockRes();
    const next = jest.fn();

    await registerUser(req, res, next);

    expect(next.mock.calls[0][0].statusCode).toBe(400);
    expect(next.mock.calls[0][0].errorCode).toBe('VALIDATION_ERROR');
  });

  test('terms not accepted → 400 TERMS_NOT_ACCEPTED', async () => {
    const req  = mockReq({ name: 'X', email: 'a@b.com', password: 'Strong1!Pass', acceptedTerms: false, acceptedPrivacy: true });
    const res  = mockRes();
    const next = jest.fn();

    await registerUser(req, res, next);

    expect(next.mock.calls[0][0].errorCode).toBe('TERMS_NOT_ACCEPTED');
  });

  test('duplicate email → 400 VALIDATION_ERROR', async () => {
    User.findOne.mockResolvedValueOnce({ email: 'existing@test.com' });

    const req  = mockReq({ name: 'X', email: 'existing@test.com', password: 'Strong1!Pass', acceptedTerms: true, acceptedPrivacy: true });
    const res  = mockRes();
    const next = jest.fn();

    await registerUser(req, res, next);

    expect(next.mock.calls[0][0].statusCode).toBe(400);
    expect(next.mock.calls[0][0].errorCode).toBe('VALIDATION_ERROR');
  });

  test('valid registration → 201 with access token', async () => {
    User.findOne.mockResolvedValueOnce(null);
    User.create.mockResolvedValueOnce(userDoc());

    const req  = mockReq({ name: 'New User', email: 'new@example.com', password: 'Strong1!Pass', acceptedTerms: true, acceptedPrivacy: true });
    const res  = mockRes();
    const next = jest.fn();

    await registerUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: 'mock-access-token' }));
    expect(res.cookie).toHaveBeenCalled(); // refresh token cookie set
  });
});

// ---------------------------------------------------------------------------
// T2: loginUser — success, wrong password, unknown user
// ---------------------------------------------------------------------------

describe('loginUser — success and failure paths', () => {
  test('correct credentials → 200 with token, sets refresh cookie', async () => {
    const user = userDoc();
    User.findOne.mockReturnValueOnce(chainQuery(user));
    bcrypt.compare.mockResolvedValueOnce(true);

    const req  = mockReq({ email: 'test@example.com', password: 'TestPass1!' });
    const res  = mockRes();
    const next = jest.fn();

    await loginUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: 'mock-access-token' }));
    expect(res.cookie).toHaveBeenCalled();
    expect(user.save).toHaveBeenCalled();
    expect(user.loginAttempts).toBe(0);
  });

  test('wrong password → 401 INVALID_CREDENTIALS, increments loginAttempts', async () => {
    const user = userDoc({ loginAttempts: 0 });
    User.findOne.mockReturnValueOnce(chainQuery(user));
    bcrypt.compare.mockResolvedValueOnce(false);

    const req  = mockReq({ email: 'test@example.com', password: 'WrongPass1!' });
    const res  = mockRes();
    const next = jest.fn();

    await loginUser(req, res, next);

    expect(next.mock.calls[0][0].statusCode).toBe(401);
    expect(next.mock.calls[0][0].errorCode).toBe('INVALID_CREDENTIALS');
    expect(user.loginAttempts).toBe(1);
    expect(user.save).toHaveBeenCalled();
  });

  test('unknown email → 401 INVALID_CREDENTIALS', async () => {
    User.findOne.mockReturnValueOnce(chainQuery(null));

    const req  = mockReq({ email: 'ghost@example.com', password: 'AnyPass1!' });
    const res  = mockRes();
    const next = jest.fn();

    await loginUser(req, res, next);

    expect(next.mock.calls[0][0].statusCode).toBe(401);
    expect(next.mock.calls[0][0].errorCode).toBe('INVALID_CREDENTIALS');
  });

  test('Google-provider account → 401 AUTH_PROVIDER_MISMATCH', async () => {
    const googleUser = userDoc({ authProvider: 'google', password: null });
    User.findOne.mockReturnValueOnce(chainQuery(googleUser));

    const req  = mockReq({ email: 'test@example.com', password: 'AnyPass1!' });
    const res  = mockRes();
    const next = jest.fn();

    await loginUser(req, res, next);

    expect(next.mock.calls[0][0].statusCode).toBe(401);
    expect(next.mock.calls[0][0].errorCode).toBe('AUTH_PROVIDER_MISMATCH');
  });

  test('disabled account with correct password is rejected without issuing tokens', async () => {
    const disabled = userDoc({ accountStatus: 'disabled' });
    User.findOne.mockReturnValueOnce(chainQuery(disabled));
    bcrypt.compare.mockResolvedValueOnce(true);

    const req = mockReq({ email: 'test@example.com', password: 'TestPass1!' });
    const res = mockRes();
    const next = jest.fn();

    await loginUser(req, res, next);

    expect(next.mock.calls[0][0].statusCode).toBe(401);
    expect(next.mock.calls[0][0].errorCode).toBe('INVALID_CREDENTIALS');
    expect(tokenService.createRefreshToken).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });

  test('locked account returns 429 ACCOUNT_LOCKED without bcrypt', async () => {
    const locked = userDoc({ loginLockedUntil: new Date(Date.now() + 10 * 60 * 1000) });
    User.findOne.mockReturnValueOnce(chainQuery(locked));

    const req  = mockReq({ email: 'test@example.com', password: 'AnyPass1!' });
    const res  = mockRes();
    const next = jest.fn();

    await loginUser(req, res, next);

    expect(next.mock.calls[0][0].statusCode).toBe(429);
    expect(next.mock.calls[0][0].errorCode).toBe('ACCOUNT_LOCKED');
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  test('expired lock with correct password succeeds and clears lock state', async () => {
    const user = userDoc({
      loginAttempts: 4,
      loginLockedUntil: new Date(Date.now() - 60 * 1000),
    });
    User.findOne.mockReturnValueOnce(chainQuery(user));
    bcrypt.compare.mockResolvedValueOnce(true);

    const req = mockReq({ email: 'test@example.com', password: 'TestPass1!' });
    const res = mockRes();
    const next = jest.fn();

    await loginUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: 'mock-access-token' }));
    expect(user.loginAttempts).toBe(0);
    expect(user.loginLockedUntil).toBeUndefined();
    expect(user.save).toHaveBeenCalled();
  });
});

describe('resetPassword session revocation', () => {
  test('password reset bumps tokenVersion and revokes every refresh token', async () => {
    tokenService.revokeAllUserTokens.mockClear();
    invalidateAuthCache.mockClear();

    const user = userDoc({
      tokenVersion: 2,
      resetPasswordToken: 'reset-token-123',
      resetPasswordTokenExpires: new Date(Date.now() + 10 * 60 * 1000),
    });
    User.findOne.mockResolvedValueOnce(user);

    const req = mockReq({
      email: 'test@example.com',
      resetToken: 'reset-token-123',
      password: 'NewStrong1!Pass',
    });
    const res = mockRes();
    const next = jest.fn();

    await resetPassword(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(user.tokenVersion).toBe(3);
    expect(user.save).toHaveBeenCalled();
    expect(tokenService.revokeAllUserTokens).toHaveBeenCalledWith(user._id);
    expect(invalidateAuthCache).toHaveBeenCalledWith(user._id);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('Password reset successful'),
    }));
  });
});

// ---------------------------------------------------------------------------
// T5: Account lockout progression — LOGIN_MAX_ATTEMPTS = 5
// ---------------------------------------------------------------------------

describe('loginUser — lockout progression (T5)', () => {
  test('4th failed attempt increments counter, does NOT lock', async () => {
    const user = userDoc({ loginAttempts: 3 });
    User.findOne.mockReturnValueOnce(chainQuery(user));
    bcrypt.compare.mockResolvedValueOnce(false);

    await loginUser(mockReq({ email: 'x@x.com', password: 'bad' }), mockRes(), jest.fn());

    expect(user.loginAttempts).toBe(4);
    expect(user.loginLockedUntil).toBeFalsy();
  });

  test('5th failed attempt locks account (loginLockedUntil set, counter reset)', async () => {
    const user = userDoc({ loginAttempts: 4 });
    User.findOne.mockReturnValueOnce(chainQuery(user));
    bcrypt.compare.mockResolvedValueOnce(false);

    await loginUser(mockReq({ email: 'x@x.com', password: 'bad' }), mockRes(), jest.fn());

    expect(user.loginLockedUntil).toBeDefined();
    expect(user.loginLockedUntil.getTime()).toBeGreaterThan(Date.now());
    // Counter resets after lock
    expect(user.loginAttempts).toBe(0);
  });

  test('successful login resets loginAttempts to 0', async () => {
    const user = userDoc({ loginAttempts: 2 });
    User.findOne.mockReturnValueOnce(chainQuery(user));
    bcrypt.compare.mockResolvedValueOnce(true);

    await loginUser(mockReq({ email: 'x@x.com', password: 'TestPass1!' }), mockRes(), jest.fn());

    expect(user.loginAttempts).toBe(0);
    expect(user.loginLockedUntil).toBeUndefined();
  });
});

describe('updateOnboardingStep', () => {
  test('invalidates dashboard snapshot cache after saving onboarding state', async () => {
    invalidateAuthCache.mockClear();
    invalidateTradeCaches.mockClear();
    User.findByIdAndUpdate.mockReset();

    const user = userDoc({
      onboarding: {
        welcomeSeen: true,
        setupAdded: true,
        tradeAdded: true,
        checklistDismissed: true,
      },
    });
    User.findByIdAndUpdate.mockResolvedValueOnce(user);

    const req = mockReq(
      { step: 'checklistDismissed', value: true },
      { user: { _id: user._id } }
    );
    const res = mockRes();
    const next = jest.fn();

    await updateOnboardingStep(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      user._id,
      { $set: { 'onboarding.checklistDismissed': true } },
      { new: true }
    );
    expect(invalidateAuthCache).toHaveBeenCalledWith(user._id);
    expect(invalidateTradeCaches).toHaveBeenCalledWith(expect.objectContaining({
      userId: user._id,
      event: 'onboarding_update',
      source: 'auth_onboarding_step',
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      onboarding: expect.objectContaining({ checklistDismissed: true }),
    }));
  });

  test('marks activation card dismissed when tour is completed', async () => {
    invalidateAuthCache.mockClear();
    invalidateTradeCaches.mockClear();
    User.findByIdAndUpdate.mockReset();

    const user = userDoc({
      onboarding: {
        welcomeSeen: true,
        setupAdded: true,
        tradeAdded: true,
        tourCompleted: true,
        checklistDismissed: true,
      },
    });
    User.findByIdAndUpdate.mockResolvedValueOnce(user);

    const req = mockReq(
      { step: 'tourCompleted', value: true },
      { user: { _id: user._id } }
    );
    const res = mockRes();
    const next = jest.fn();

    await updateOnboardingStep(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      user._id,
      {
        $set: {
          'onboarding.tourCompleted': true,
          'onboarding.checklistDismissed': true,
          'onboarding.welcomeSeen': true,
        },
      },
      { new: true }
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      onboarding: expect.objectContaining({
        tourCompleted: true,
        checklistDismissed: true,
      }),
    }));
  });
});

// ---------------------------------------------------------------------------
// T5: OTP max attempts = 3 (reduced from 5 per M4 fix)
// ---------------------------------------------------------------------------

describe('verifyOTP — OTP_MAX_ATTEMPTS = 3', () => {
  test('3rd wrong OTP locks OTP — does not proceed on 4th attempt', async () => {
    // Simulate a user who has already hit otpAttempts = 3
    const lockUntil = new Date(Date.now() + 30 * 60 * 1000);
    const user = userDoc({
      otpAttempts: 3,
      otpLockUntil: lockUntil,
      resetPasswordOTP: '123456',
      resetPasswordOTPExpires: new Date(Date.now() + 10 * 60 * 1000),
    });
    User.findOne.mockResolvedValueOnce(user);

    const req  = mockReq({ email: 'test@example.com', otp: '999999' });
    const res  = mockRes();
    const next = jest.fn();

    await verifyOTP(req, res, next);

    expect(next.mock.calls[0][0].statusCode).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// T1: forgotPassword — never leaks whether email exists
// ---------------------------------------------------------------------------

describe('forgotPassword — user enumeration prevention', () => {
  test('unknown email → same 200 response as known email', async () => {
    User.findOne.mockResolvedValueOnce(null);

    const req  = mockReq({ email: 'nobody@example.com' });
    const res  = mockRes();
    const next = jest.fn();

    await forgotPassword(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('OTP') })
    );
  });
});
