'use strict';

/**
 * Forgot password → verify OTP → reset password, end to end over HTTP.
 *
 * Three things are being pinned here:
 *
 *  1. The explicit contract. An unregistered address gets 404 "No account was
 *     found with this email address" and nothing is generated, stored, or
 *     mailed; a registered one gets "OTP sent successfully" only after the
 *     mail provider has accepted the message.
 *
 *  2. Lookup cost. One indexed, projected, lean read; one targeted write. No
 *     full document load, no user.save() rewriting the whole record.
 *
 *  3. The reset primitives. OTPs and reset tokens are hashed at rest, expire,
 *     are single-use, and survive neither a wrong guess nor a replay.
 */

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  stream: { write: jest.fn() },
}));

jest.mock('../../middleware/rateLimiter', () => {
  const pass = (_r, _s, n) => n();
  return {
    globalRateLimiter: pass,
    authRateLimiter: pass,
    passwordResetRequestRateLimiter: pass,
    passwordResetEmailRateLimiter: pass,
    refreshRateLimiter: pass,
    profileRateLimiter: pass,
    statusRateLimiter: pass,
  };
});

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
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  updateOne: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

jest.mock('../../services/tokenService', () => ({
  generateAccessToken: jest.fn().mockReturnValue('test-access-token'),
  createRefreshToken: jest.fn().mockResolvedValue('test-refresh-token'),
  rotateRefreshToken: jest.fn(),
  revokeRefreshToken: jest.fn().mockResolvedValue(undefined),
  revokeAllUserTokens: jest.fn().mockResolvedValue(undefined),
  getCookieOptions: jest.fn().mockReturnValue({ httpOnly: true, path: '/api/auth' }),
  getClearCookieOptions: jest.fn().mockReturnValue({ httpOnly: true, path: '/api/auth' }),
  REFRESH_COOKIE_NAME: 'sid',
}));

jest.mock('../../services/authCacheService', () => ({
  invalidateAuthCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/mailService', () => ({
  sendOTPEmail: jest.fn().mockResolvedValue(true),
}));

jest.mock('bcryptjs', () => ({
  genSalt: jest.fn().mockResolvedValue('salt'),
  hash: jest.fn(async (plain) => `hashed:${plain}`),
  compare: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../config/firebaseAdmin', () => ({ getFirebaseAdmin: jest.fn() }));

const crypto = require('crypto');
const request = require('supertest');
const express = require('express');
const cookie = require('cookie-parser');
const bcrypt = require('bcryptjs');
const User = require('../../models/Users');
const { sendOTPEmail } = require('../../services/mailService');
const { revokeAllUserTokens } = require('../../services/tokenService');
const { invalidateAuthCache } = require('../../services/authCacheService');
const { logger } = require('../../utils/logger');

const { sanitizeInput } = require('../../middleware/sanitizeInput');
const { errorHandler } = require('../../middleware/errorHandler');
const authRoutes = require('../../routes/authRoutes');

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(cookie());
  app.use(sanitizeInput);
  app.use('/api/auth', authRoutes);
  app.use(errorHandler);
  return app;
}

const app = buildApp();

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

/** Thenable query stub that also answers .select() — covers both call shapes. */
const query = (value) => {
  const q = {
    select: jest.fn(() => q),
    lean: jest.fn(() => q),
    then: (res, rej) => Promise.resolve(value).then(res, rej),
    catch: (rej) => Promise.resolve(value).catch(rej),
    finally: (fn) => Promise.resolve(value).finally(fn),
  };
  return q;
};

const REGISTERED_EMAIL = 'trader@example.com';
const STRONG_PASSWORD = 'NewStrong1!';

function makeUser(overrides = {}) {
  const user = {
    _id: '507f1f77bcf86cd799439011',
    name: 'Test Trader',
    email: REGISTERED_EMAIL,
    password: 'hashed:OldStrong1!',
    authProvider: 'local',
    accountStatus: 'active',
    tokenVersion: 3,
    loginAttempts: 4,
    loginLockedUntil: new Date(Date.now() + 5 * 60 * 1000),
    otpAttempts: 0,
    otpLockUntil: undefined,
    resetPasswordOTP: undefined,
    resetPasswordOTPExpires: undefined,
    resetPasswordToken: undefined,
    resetPasswordTokenExpires: undefined,
    ...overrides,
  };
  user.save = jest.fn().mockResolvedValue(user);
  return user;
}

const forgot = (email) => request(app).post('/api/auth/forgot-password').send({ email });
const verify = (email, otp) => request(app).post('/api/auth/verify-otp').send({ email, otp });
const reset = (body) => request(app).post('/api/auth/reset-password').send(body);

/**
 * Minimal stand-in for Mongo's updateOne: applies $set/$unset to the in-memory
 * user, and honours the "not currently locked out" filter the controller uses
 * so the lockout branch is genuinely exercised rather than assumed.
 */
function wireDb(user) {
  User.findOne.mockReturnValue(query(user));
  User.updateOne.mockImplementation(async (filter, update) => {
    if (filter.$or) {
      const lockedOut = user.otpLockUntil && user.otpLockUntil > new Date();
      if (lockedOut) return { matchedCount: 0, modifiedCount: 0 };
    }
    Object.assign(user, update.$set || {});
    for (const field of Object.keys(update.$unset || {})) user[field] = undefined;
    return { matchedCount: 1, modifiedCount: 1 };
  });
  return user;
}

/** Drives forgot-password for `user` and returns the OTP that was mailed. */
async function requestOtpFor(user) {
  wireDb(user);
  await forgot(user.email);
  const call = sendOTPEmail.mock.calls[sendOTPEmail.mock.calls.length - 1];
  return call && call[1];
}

beforeEach(() => {
  jest.clearAllMocks();
  bcrypt.compare.mockResolvedValue(false);
  bcrypt.hash.mockImplementation(async (plain) => `hashed:${plain}`);
  sendOTPEmail.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// POST /api/auth/forgot-password
// ---------------------------------------------------------------------------

describe('POST /api/auth/forgot-password', () => {
  test('registered email → 200 "OTP sent successfully", code generated and mailed', async () => {
    const user = wireDb(makeUser());

    const res = await forgot(REGISTERED_EMAIL);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('OTP sent successfully. Please check your email.');
    expect(sendOTPEmail).toHaveBeenCalledTimes(1);

    const [to, otp] = sendOTPEmail.mock.calls[0];
    expect(to).toBe(REGISTERED_EMAIL);
    expect(otp).toMatch(/^\d{6}$/);
    expect(user.resetPasswordOTP).toBe(sha256(otp));
    expect(user.resetPasswordOTPExpires.getTime()).toBeGreaterThan(Date.now());
  });

  test('non-existing email → 404 "No account was found with this email address."', async () => {
    User.findOne.mockReturnValue(query(null));

    const res = await forgot('no-such-person@example.com');

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('No account was found with this email address.');
    expect(res.body.errorCode).toBe('ACCOUNT_NOT_FOUND');
  });

  test('non-existing email generates no OTP, no token, no email, and writes nothing', async () => {
    User.findOne.mockReturnValue(query(null));

    await forgot('no-such-person@example.com');

    expect(sendOTPEmail).not.toHaveBeenCalled();
    expect(User.updateOne).not.toHaveBeenCalled();
    expect(User.create).not.toHaveBeenCalled();
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  // -- normalization --------------------------------------------------------

  test.each([
    ['uppercase', 'TRADER@EXAMPLE.COM'],
    ['mixed case', 'Trader@Example.Com'],
    ['leading/trailing spaces', '   trader@example.com   '],
    ['spaces and uppercase together', '  TRADER@Example.com  '],
  ])('%s email still finds the account', async (_label, input) => {
    const user = wireDb(makeUser());

    const res = await forgot(input);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('OTP sent successfully. Please check your email.');
    // The query filter is the folded address, not what the user typed.
    expect(User.findOne).toHaveBeenCalledWith({ email: 'trader@example.com' });
    expect(sendOTPEmail).toHaveBeenCalledWith('trader@example.com', expect.stringMatching(/^\d{6}$/));
    expect(user.resetPasswordOTP).toMatch(/^[a-f0-9]{64}$/);
  });

  // -- validation -----------------------------------------------------------

  test('empty email → 400 validation error, no DB query', async () => {
    const res = await forgot('');

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(res.body.message).toMatch(/email is required/i);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test('whitespace-only email → 400 validation error', async () => {
    const res = await forgot('     ');

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(User.findOne).not.toHaveBeenCalled();
  });

  test('missing email field → 400 validation error', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({});

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  test.each([
    'not-an-email',
    'missing@domain',
    'two@@ats.com',
    'spaces in@example.com',
    '@example.com',
  ])('malformed address %p → 400 validation error, no DB query', async (bad) => {
    const res = await forgot(bad);

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(res.body.message).toMatch(/valid email/i);
    expect(User.findOne).not.toHaveBeenCalled();
    expect(sendOTPEmail).not.toHaveBeenCalled();
  });

  test('non-string email → 400, not a 500', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: ['trader@example.com'] });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  test('mongo operator payload is rejected at the edge', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: { $ne: null } });

    expect(res.status).toBe(400);
    expect(User.findOne).not.toHaveBeenCalled();
  });

  // -- query shape / cost ---------------------------------------------------

  test('the lookup is a projected, lean, indexed read — not a full document', async () => {
    const user = makeUser();
    const q = query(user);
    User.findOne.mockReturnValue(q);
    User.updateOne.mockResolvedValue({ matchedCount: 1 });

    await forgot(REGISTERED_EMAIL);

    // Filter is exactly the indexed `email` field.
    expect(User.findOne).toHaveBeenCalledWith({ email: REGISTERED_EMAIL });
    // Only the two fields the decision needs.
    expect(q.select).toHaveBeenCalledWith('_id authProvider');
    // .lean() → plain object, no Mongoose document hydration.
    expect(q.lean).toHaveBeenCalled();
  });

  test('exactly one lookup per request, and no full-document save', async () => {
    const user = wireDb(makeUser());

    await forgot(REGISTERED_EMAIL);

    expect(User.findOne).toHaveBeenCalledTimes(1);
    expect(user.save).not.toHaveBeenCalled();
    // A single targeted write on the common (unlocked) path.
    expect(User.updateOne).toHaveBeenCalledTimes(1);
  });

  test('the write touches only reset fields, never the whole record', async () => {
    wireDb(makeUser());

    await forgot(REGISTERED_EMAIL);

    const [filter, update] = User.updateOne.mock.calls[0];
    expect(filter._id).toBe('507f1f77bcf86cd799439011');
    expect(Object.keys(update.$set).sort()).toEqual(
      ['otpAttempts', 'resetPasswordOTP', 'resetPasswordOTPExpires'].sort()
    );
    expect(Object.keys(update.$unset).sort()).toEqual(
      ['otpLockUntil', 'resetPasswordToken', 'resetPasswordTokenExpires'].sort()
    );
  });

  // -- google accounts ------------------------------------------------------

  test('Google-only account → 409, no OTP issued and no mail', async () => {
    wireDb(makeUser({ authProvider: 'google', password: undefined }));

    const res = await forgot(REGISTERED_EMAIL);

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('GOOGLE_ACCOUNT');
    expect(res.body.message).toMatch(/signs in with google/i);
    expect(sendOTPEmail).not.toHaveBeenCalled();
    expect(User.updateOne).not.toHaveBeenCalled();
  });

  // -- secret handling ------------------------------------------------------

  test('the OTP is stored hashed, never in plaintext', async () => {
    const user = makeUser();
    const otp = await requestOtpFor(user);

    expect(user.resetPasswordOTP).toBe(sha256(otp));
    expect(user.resetPasswordOTP).not.toBe(otp);
    expect(user.resetPasswordOTPExpires.getTime()).toBeGreaterThan(Date.now());
  });

  test('neither the OTP nor the address is written to the logs', async () => {
    const user = makeUser();
    const otp = await requestOtpFor(user);

    const logged = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
      ...logger.debug.mock.calls,
    ]);
    expect(logged).not.toContain(otp);
    expect(logged).not.toContain(REGISTERED_EMAIL);
  });

  test('the response body carries no account information', async () => {
    wireDb(makeUser());

    const res = await forgot(REGISTERED_EMAIL);

    expect(Object.keys(res.body)).toEqual(['message']);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('507f1f77bcf86cd799439011');
    expect(serialized).not.toContain('Test Trader');
    expect(serialized).not.toContain('hashed:');
  });

  // -- repeat requests / lockout -------------------------------------------

  test('a repeat request replaces the previous code — the old one stops working', async () => {
    const user = makeUser();
    const firstOtp = await requestOtpFor(user);
    const secondOtp = await requestOtpFor(user);

    expect(secondOtp).not.toBe(firstOtp);
    expect(user.resetPasswordOTP).toBe(sha256(secondOtp));

    User.findOne.mockReturnValue(query(user));
    const stale = await verify(REGISTERED_EMAIL, firstOtp);
    expect(stale.status).toBe(400);

    const fresh = await verify(REGISTERED_EMAIL, secondOtp);
    expect(fresh.status).toBe(200);
  });

  test('a new request revokes a reset token issued by an earlier verification', async () => {
    const user = makeUser();
    const otp = await requestOtpFor(user);
    User.findOne.mockReturnValue(query(user));
    const verified = await verify(REGISTERED_EMAIL, otp);
    const oldResetToken = verified.body.resetToken;

    await requestOtpFor(user); // user asks for another code

    User.findOne.mockReturnValue(query(user));
    const res = await reset({ email: REGISTERED_EMAIL, resetToken: oldResetToken, password: STRONG_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid or expired reset token/i);
  });

  test('an active lockout survives a new code request', async () => {
    const lockUntil = new Date(Date.now() + 20 * 60 * 1000);
    const user = wireDb(makeUser({ otpLockUntil: lockUntil }));

    const res = await forgot(REGISTERED_EMAIL);

    expect(res.status).toBe(200);
    expect(user.otpLockUntil).toBe(lockUntil);
    // Falls through to the second write, which leaves the lock alone.
    expect(User.updateOne).toHaveBeenCalledTimes(2);
    const [, secondUpdate] = User.updateOne.mock.calls[1];
    expect(secondUpdate.$unset).not.toHaveProperty('otpLockUntil');
    expect(secondUpdate.$set).not.toHaveProperty('otpAttempts');
  });

  // -- mail delivery --------------------------------------------------------

  test('mail provider failure → 502, and the response never claims success', async () => {
    wireDb(makeUser());
    sendOTPEmail.mockRejectedValue(new Error('Resend is down'));

    const res = await forgot(REGISTERED_EMAIL);

    expect(res.status).toBe(502);
    expect(res.body.errorCode).toBe('EMAIL_DELIVERY_FAILED');
    expect(res.body.message).not.toMatch(/sent successfully/i);
    expect(logger.error).toHaveBeenCalledWith(
      'Password reset OTP delivery failed',
      expect.objectContaining({ error: 'Resend is down' })
    );
  });

  test('a permanent provider misconfiguration is not dressed up as "try again"', async () => {
    wireDb(makeUser());
    // What an unverified RESEND_FROM domain actually looks like.
    const configFault = new Error('The example.com domain is not verified.');
    configFault.permanent = true;
    configFault.providerStatus = 403;
    sendOTPEmail.mockRejectedValue(configFault);

    const res = await forgot(REGISTERED_EMAIL);

    expect(res.status).toBe(502);
    expect(res.body.errorCode).toBe('EMAIL_DELIVERY_UNAVAILABLE');
    expect(res.body.message).not.toMatch(/try again/i);
    expect(logger.error).toHaveBeenCalledWith(
      'Password reset OTP delivery failed',
      expect.objectContaining({ permanent: true, providerStatus: 403 })
    );
  });

  test('a failed send leaves the previously mailed code intact', async () => {
    const stillValidHash = 'a'.repeat(64);
    const expiry = new Date(Date.now() + 5 * 60 * 1000);
    wireDb(makeUser({ resetPasswordOTP: stillValidHash, resetPasswordOTPExpires: expiry }));
    sendOTPEmail.mockRejectedValue(new Error('Resend is down'));

    const res = await forgot(REGISTERED_EMAIL);

    expect(res.status).toBe(502);
    // Nothing was written, so the code the user is already holding still works.
    expect(User.updateOne).not.toHaveBeenCalled();
  });

  test('success is only reported after the provider accepts the mail', async () => {
    wireDb(makeUser());
    const order = [];
    sendOTPEmail.mockImplementation(async () => { order.push('mail'); return true; });

    const res = await forgot(REGISTERED_EMAIL);
    order.push('response');

    expect(order).toEqual(['mail', 'response']);
    expect(res.status).toBe(200);
  });
});


// ---------------------------------------------------------------------------
// POST /api/auth/verify-otp
// ---------------------------------------------------------------------------

describe('POST /api/auth/verify-otp', () => {
  test('correct code → 200 with a reset token, stored hashed', async () => {
    const user = makeUser();
    const otp = await requestOtpFor(user);
    User.findOne.mockReturnValue(query(user));

    const res = await verify(REGISTERED_EMAIL, otp);

    expect(res.status).toBe(200);
    expect(res.body.resetToken).toMatch(/^[a-f0-9]{64}$/);
    expect(user.resetPasswordToken).toBe(sha256(res.body.resetToken));
    expect(user.resetPasswordToken).not.toBe(res.body.resetToken);
    expect(user.resetPasswordTokenExpires.getTime()).toBeGreaterThan(Date.now());
  });

  test('the used code is cleared immediately — it cannot be replayed', async () => {
    const user = makeUser();
    const otp = await requestOtpFor(user);
    User.findOne.mockReturnValue(query(user));

    const first = await verify(REGISTERED_EMAIL, otp);
    expect(first.status).toBe(200);
    expect(user.resetPasswordOTP).toBeUndefined();

    const replay = await verify(REGISTERED_EMAIL, otp);
    expect(replay.status).toBe(400);
    expect(replay.body.message).toMatch(/invalid or expired otp/i);
  });

  test('wrong code → 400 and the attempt is counted', async () => {
    const user = makeUser();
    await requestOtpFor(user);
    User.findOne.mockReturnValue(query(user));

    const res = await verify(REGISTERED_EMAIL, '000000');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid or expired otp/i);
    expect(user.otpAttempts).toBe(1);
  });

  test('expired code → 400 even though the digits match', async () => {
    const user = makeUser();
    const otp = await requestOtpFor(user);
    user.resetPasswordOTPExpires = new Date(Date.now() - 1000);
    User.findOne.mockReturnValue(query(user));

    const res = await verify(REGISTERED_EMAIL, otp);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid or expired otp/i);
  });

  test('three wrong codes lock verification, and the lock answers 429', async () => {
    const user = makeUser();
    await requestOtpFor(user);
    User.findOne.mockReturnValue(query(user));

    await verify(REGISTERED_EMAIL, '111111');
    await verify(REGISTERED_EMAIL, '222222');
    await verify(REGISTERED_EMAIL, '333333');

    expect(user.otpLockUntil.getTime()).toBeGreaterThan(Date.now());

    const locked = await verify(REGISTERED_EMAIL, '444444');
    expect(locked.status).toBe(429);
    expect(locked.body.errorCode).toBe('OTP_LOCKED');
    expect(locked.body.message).toMatch(/try again in \d+ minute/i);
  });

  test('asking for a new code does not clear an active lockout', async () => {
    const user = makeUser({ otpLockUntil: new Date(Date.now() + 20 * 60 * 1000), otpAttempts: 0 });
    const lockedUntil = user.otpLockUntil;

    await requestOtpFor(user);

    expect(user.otpLockUntil).toBe(lockedUntil);
    User.findOne.mockReturnValue(query(user));
    const res = await verify(REGISTERED_EMAIL, '123456');
    expect(res.status).toBe(429);
  });

  test('unknown email answers exactly like a wrong code', async () => {
    const user = makeUser();
    await requestOtpFor(user);
    User.findOne.mockReturnValue(query(user));
    const wrongCode = await verify(REGISTERED_EMAIL, '000000');

    User.findOne.mockReturnValue(query(null));
    const unknownEmail = await verify('no-such-person@example.com', '000000');

    expect(unknownEmail.status).toBe(wrongCode.status);
    expect(unknownEmail.body.message).toBe(wrongCode.body.message);
    expect(unknownEmail.body.errorCode).toBe(wrongCode.body.errorCode);
  });

  test('a Google account answers like a wrong code', async () => {
    User.findOne.mockReturnValue(query(makeUser({ authProvider: 'google' })));

    const res = await verify(REGISTERED_EMAIL, '123456');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid or expired otp/i);
  });

  test.each(['12345', '1234567', 'abcdef', '12 34 56'])(
    'malformed code %p → 400 without burning an attempt',
    async (bad) => {
      const user = makeUser();
      await requestOtpFor(user);
      User.findOne.mockReturnValue(query(user));

      const res = await verify(REGISTERED_EMAIL, bad);

      expect(res.status).toBe(400);
      expect(user.otpAttempts).toBe(0);
    }
  );

  test('missing fields → 400', async () => {
    const noOtp = await request(app).post('/api/auth/verify-otp').send({ email: REGISTERED_EMAIL });
    const noEmail = await request(app).post('/api/auth/verify-otp').send({ otp: '123456' });

    expect(noOtp.status).toBe(400);
    expect(noEmail.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/reset-password
// ---------------------------------------------------------------------------

describe('POST /api/auth/reset-password', () => {
  /** Runs forgot → verify and returns the live reset token. */
  async function getResetToken(user) {
    const otp = await requestOtpFor(user);
    User.findOne.mockReturnValue(query(user));
    const res = await verify(user.email, otp);
    return res.body.resetToken;
  }

  test('valid token and strong password → 200, password replaced, sessions revoked', async () => {
    const user = makeUser();
    const resetToken = await getResetToken(user);
    const versionBefore = user.tokenVersion;
    User.findOne.mockReturnValue(query(user));

    const res = await reset({ email: REGISTERED_EMAIL, resetToken, password: STRONG_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/password reset successful/i);
    expect(user.password).toBe(`hashed:${STRONG_PASSWORD}`);
    expect(user.tokenVersion).toBe(versionBefore + 1);
    expect(revokeAllUserTokens).toHaveBeenCalledWith(user._id);
    expect(invalidateAuthCache).toHaveBeenCalledWith(user._id);
  });

  test('the reset clears a login lockout so the new password works right away', async () => {
    const user = makeUser({ loginAttempts: 5, loginLockedUntil: new Date(Date.now() + 15 * 60 * 1000) });
    const resetToken = await getResetToken(user);
    User.findOne.mockReturnValue(query(user));

    await reset({ email: REGISTERED_EMAIL, resetToken, password: STRONG_PASSWORD });

    expect(user.loginAttempts).toBe(0);
    expect(user.loginLockedUntil).toBeUndefined();
  });

  test('the token is single-use — replaying it fails', async () => {
    const user = makeUser();
    const resetToken = await getResetToken(user);
    User.findOne.mockReturnValue(query(user));

    const first = await reset({ email: REGISTERED_EMAIL, resetToken, password: STRONG_PASSWORD });
    expect(first.status).toBe(200);
    expect(user.resetPasswordToken).toBeUndefined();

    const replay = await reset({ email: REGISTERED_EMAIL, resetToken, password: 'Another1!Pass' });
    expect(replay.status).toBe(400);
    expect(replay.body.message).toMatch(/invalid or expired reset token/i);
  });

  test('expired token → 400', async () => {
    const user = makeUser();
    const resetToken = await getResetToken(user);
    user.resetPasswordTokenExpires = new Date(Date.now() - 1000);
    User.findOne.mockReturnValue(query(user));

    const res = await reset({ email: REGISTERED_EMAIL, resetToken, password: STRONG_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid or expired reset token/i);
    expect(user.password).toBe('hashed:OldStrong1!');
  });

  test.each([
    ['garbage', 'not-a-real-token'],
    ['right-length forgery', 'a'.repeat(64)],
    ['empty', ''],
  ])('%s token → 400 and the password is untouched', async (_label, badToken) => {
    const user = makeUser();
    await getResetToken(user);
    User.findOne.mockReturnValue(query(user));

    const res = await reset({ email: REGISTERED_EMAIL, resetToken: badToken, password: STRONG_PASSWORD });

    expect(res.status).toBe(400);
    expect(user.password).toBe('hashed:OldStrong1!');
  });

  test.each([
    ['too short', 'Ab1!'],
    ['no uppercase', 'lowercase1!'],
    ['no lowercase', 'UPPERCASE1!'],
    ['no digit', 'NoDigitsHere!'],
    ['no special character', 'NoSpecial123'],
  ])('weak password (%s) → 400 WEAK_PASSWORD and no change', async (_label, weak) => {
    const user = makeUser();
    const resetToken = await getResetToken(user);
    User.findOne.mockReturnValue(query(user));

    const res = await reset({ email: REGISTERED_EMAIL, resetToken, password: weak });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('WEAK_PASSWORD');
    expect(user.password).toBe('hashed:OldStrong1!');
    // The token survives a rejected password, so the user can simply retype.
    expect(user.resetPasswordToken).toBeDefined();
  });

  test('reusing the current password → 400', async () => {
    const user = makeUser();
    const resetToken = await getResetToken(user);
    bcrypt.compare.mockResolvedValue(true); // "new" password matches the stored hash
    User.findOne.mockReturnValue(query(user));

    const res = await reset({ email: REGISTERED_EMAIL, resetToken, password: 'OldStrong1!' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/different from your current password/i);
  });

  test('unknown email → the same generic token error', async () => {
    User.findOne.mockReturnValue(query(null));

    const res = await reset({
      email: 'no-such-person@example.com',
      resetToken: 'a'.repeat(64),
      password: STRONG_PASSWORD,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid or expired reset token/i);
  });

  test('missing fields → 400', async () => {
    const res = await reset({ email: REGISTERED_EMAIL, password: STRONG_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  test('neither the password nor the reset token reaches the logs', async () => {
    const user = makeUser();
    const resetToken = await getResetToken(user);
    User.findOne.mockReturnValue(query(user));

    await reset({ email: REGISTERED_EMAIL, resetToken, password: STRONG_PASSWORD });

    const logged = JSON.stringify([
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
      ...logger.debug.mock.calls,
    ]);
    expect(logged).not.toContain(STRONG_PASSWORD);
    expect(logged).not.toContain(resetToken);
  });

  test('the success response returns no account data', async () => {
    const user = makeUser();
    const resetToken = await getResetToken(user);
    User.findOne.mockReturnValue(query(user));

    const res = await reset({ email: REGISTERED_EMAIL, resetToken, password: STRONG_PASSWORD });

    expect(Object.keys(res.body)).toEqual(['message']);
    expect(JSON.stringify(res.body)).not.toContain('hashed:');
  });
});
