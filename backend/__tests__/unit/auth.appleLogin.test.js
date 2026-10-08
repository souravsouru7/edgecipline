'use strict';

/**
 * Sign in with Apple — the Apple-specific rules that Google does not need.
 *
 * Apple hands over name and email ONLY at the first authorization. On every
 * later sign-in it may send neither, so email cannot identify the account and
 * a blank must never overwrite what was captured the first time. These tests pin
 * that, plus private-relay acceptance and the provider checks.
 */

jest.mock('../../models/Users', () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  create: jest.fn(),
}));

jest.mock('../../services/tokenService', () => ({
  generateAccessToken: jest.fn().mockReturnValue('mock-access-token'),
  createRefreshToken: jest.fn().mockResolvedValue('mock-refresh-token'),
  getCookieOptions: jest.fn().mockReturnValue({ httpOnly: true }),
  getClearCookieOptions: jest.fn().mockReturnValue({ httpOnly: true }),
  REFRESH_COOKIE_NAME: 'sid',
}));

jest.mock('../../config/firebaseAdmin', () => ({
  getFirebaseAdmin: jest.fn(),
}));

jest.mock('../../services/authCacheService', () => ({
  invalidateAuthCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  stream: { write: jest.fn() },
}));

const User = require('../../models/Users');
const { getFirebaseAdmin } = require('../../config/firebaseAdmin');
const { appleLogin } = require('../../controllers/authController');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res);
  return res;
};

const mockReq = (body = {}) => ({
  body,
  headers: { 'user-agent': 'test-agent' },
  ip: '127.0.0.1',
  cookies: {},
});

/** Stubs Firebase Admin to decode one Apple token. */
const givenAppleToken = (claims = {}) => {
  const {
    email = 'real@example.com',
    appleSub = 'apple-sub-1',
    provider = 'apple.com',
    ...rest
  } = claims;

  getFirebaseAdmin.mockReturnValue({
    auth: () => ({
      verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'firebase-uid-1',
        ...(email === null ? {} : { email }),
        firebase: {
          sign_in_provider: provider,
          identities: {
            ...(appleSub ? { 'apple.com': [appleSub] } : {}),
            ...(email === null ? {} : { email: [email] }),
          },
        },
        ...rest,
      }),
    }),
  });
};

const storedUser = (overrides = {}) => ({
  _id: 'user-1',
  name: 'Existing Name',
  email: 'real@example.com',
  role: 'user',
  tokenVersion: 0,
  authProvider: 'apple',
  termsAcceptance: { acceptedTerms: true, termsVersion: 'v1.0' },
  ...overrides,
});

/** Runs the controller and surfaces the thrown ApiError rather than a rejection. */
const callAppleLogin = async (body = { idToken: 'firebase-apple-token' }) => {
  const res = mockRes();
  try {
    await appleLogin(mockReq(body), res, (err) => { throw err; });
    return { res, error: null };
  } catch (error) {
    return { res, error };
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  User.findOne.mockResolvedValue(null);
  User.findOneAndUpdate.mockResolvedValue(storedUser());
  User.create.mockResolvedValue(storedUser());
});

describe('appleLogin — provider checks', () => {
  it('rejects a token from a different provider', async () => {
    givenAppleToken({ provider: 'google.com' });

    const { error } = await callAppleLogin();

    expect(error).toBeTruthy();
    expect(error.statusCode).toBe(401);
    expect(User.create).not.toHaveBeenCalled();
  });

  it('rejects a request with no token', async () => {
    const { error } = await callAppleLogin({});

    expect(error).toBeTruthy();
    expect(error.statusCode).toBe(400);
  });
});

describe('appleLogin — private relay addresses', () => {
  it('accepts a Hide My Email relay and flags it', async () => {
    givenAppleToken({ email: 'abc123@privaterelay.appleid.com' });

    const { error } = await callAppleLogin();

    expect(error).toBeNull();
    expect(User.create).toHaveBeenCalledTimes(1);
    const created = User.create.mock.calls[0][0];
    expect(created.email).toBe('abc123@privaterelay.appleid.com');
    expect(created.appleEmailIsPrivateRelay).toBe(true);
    expect(created.authProvider).toBe('apple');
  });

  it('does not flag a real address as a relay', async () => {
    givenAppleToken({ email: 'real@example.com' });

    await callAppleLogin();

    expect(User.create.mock.calls[0][0].appleEmailIsPrivateRelay).toBe(false);
  });

  it('does not require email_verified — Apple verifies what it returns', async () => {
    // Apple's token carries no email_verified claim in some flows. Google's
    // handler rejects on that; for Apple it must not, or every relay user is
    // locked out.
    givenAppleToken({ email: 'abc123@privaterelay.appleid.com', email_verified: undefined });

    const { error } = await callAppleLogin();

    expect(error).toBeNull();
  });
});

describe('appleLogin — later sign-ins with no name or email', () => {
  it('finds the account by appleId when Apple sends no email', async () => {
    givenAppleToken({ email: null, appleSub: 'apple-sub-1' });
    User.findOne.mockImplementation(async (query) =>
      query.appleId === 'apple-sub-1' ? storedUser() : null
    );

    const { error, res } = await callAppleLogin();

    expect(error).toBeNull();
    expect(User.findOne).toHaveBeenCalledWith({ appleId: 'apple-sub-1' });
    expect(User.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ token: 'mock-access-token' }));
  });

  it('never overwrites a stored name with a blank one', async () => {
    givenAppleToken({ email: null, appleSub: 'apple-sub-1' });
    User.findOne.mockResolvedValue(storedUser({ name: 'Existing Name' }));

    await callAppleLogin();

    const update = User.findOneAndUpdate.mock.calls[0][1].$set;
    expect(update).not.toHaveProperty('name');
    expect(update).not.toHaveProperty('email');
    expect(update.lastLogin).toBeInstanceOf(Date);
  });

  it('fills in a name only when the account does not have one', async () => {
    givenAppleToken({ appleSub: 'apple-sub-1', name: 'Apple Trader' });
    User.findOne.mockResolvedValue(storedUser({ name: '' }));

    await callAppleLogin();

    expect(User.findOneAndUpdate.mock.calls[0][1].$set.name).toBe('Apple Trader');
  });

  it('refuses to create an account when Apple shares no email at all', async () => {
    // No appleId match and no email: there is no key to create an account with.
    givenAppleToken({ email: null, appleSub: 'brand-new-sub' });
    User.findOne.mockResolvedValue(null);

    const { error } = await callAppleLogin();

    expect(error).toBeTruthy();
    expect(error.statusCode).toBe(401);
    expect(error.errorCode).toBe('APPLE_EMAIL_UNAVAILABLE');
    expect(User.create).not.toHaveBeenCalled();
  });
});

describe('appleLogin — account linking conflicts', () => {
  it('refuses to take over a password account', async () => {
    givenAppleToken({ email: 'real@example.com' });
    User.findOne.mockImplementation(async (query) =>
      query.appleId ? null : storedUser({ authProvider: 'local' })
    );

    const { error } = await callAppleLogin();

    expect(error).toBeTruthy();
    expect(error.statusCode).toBe(409);
    expect(error.errorCode).toBe('AUTH_PROVIDER_CONFLICT');
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses to take over a Google account', async () => {
    givenAppleToken({ email: 'real@example.com' });
    User.findOne.mockImplementation(async (query) =>
      query.appleId ? null : storedUser({ authProvider: 'google' })
    );

    const { error } = await callAppleLogin();

    expect(error).toBeTruthy();
    expect(error.statusCode).toBe(409);
    expect(error.errorCode).toBe('AUTH_PROVIDER_CONFLICT');
  });
});

describe('appleLogin — response shape matches googleLogin', () => {
  it('returns the same fields the existing success handler reads', async () => {
    givenAppleToken({ email: 'real@example.com' });
    User.findOne.mockResolvedValue(storedUser());

    const { res } = await callAppleLogin();

    const body = res.json.mock.calls[0][0];
    expect(body).toEqual(expect.objectContaining({
      _id: 'user-1',
      email: 'real@example.com',
      role: 'user',
      token: 'mock-access-token',
    }));
    expect(res.cookie).toHaveBeenCalledWith('sid', 'mock-refresh-token', expect.any(Object));
  });
});
