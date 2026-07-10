const mockRotateRefreshToken = jest.fn();

jest.mock("../../models/Users", () => ({}));
jest.mock("../../services/tokenService", () => ({
  generateAccessToken: jest.fn(() => "new-access-token"),
  createRefreshToken: jest.fn(),
  rotateRefreshToken: mockRotateRefreshToken,
  revokeRefreshToken: jest.fn(),
  revokeAllUserTokens: jest.fn(),
  getCookieOptions: jest.fn(() => ({ httpOnly: true, path: "/api/auth" })),
  getClearCookieOptions: jest.fn(() => ({ httpOnly: true, path: "/api/auth" })),
  REFRESH_COOKIE_NAME: "sid",
}));
jest.mock("../../services/mailService", () => ({ sendOTPEmail: jest.fn() }));
jest.mock("../../config/firebaseAdmin", () => ({ getFirebaseAdmin: jest.fn() }));
jest.mock("../../services/authCacheService", () => ({ invalidateAuthCache: jest.fn() }));
jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { refreshToken } = require("../../controllers/authController");

function request() {
  return {
    cookies: { sid: "raw-refresh" },
    headers: {
      origin: "https://stratedge.live",
      "user-agent": "test-agent",
      "x-device-id": "device-1",
      "x-session-id": "session-1",
    },
    ip: "127.0.0.1",
  };
}

function response() {
  const res = {};
  res.cookie = jest.fn(() => res);
  res.clearCookie = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe("refresh reliability", () => {
  beforeEach(() => jest.clearAllMocks());

  test("does not clear a valid refresh cookie when Mongo is temporarily unavailable", async () => {
    mockRotateRefreshToken.mockRejectedValueOnce(new Error("MongoNetworkTimeoutError"));
    const res = response();
    const next = jest.fn();

    await refreshToken(request(), res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "MongoNetworkTimeoutError" }));
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  test("clears the refresh cookie after a definitive expired-session response", async () => {
    mockRotateRefreshToken.mockRejectedValueOnce(Object.assign(new Error("expired"), {
      statusCode: 401,
      errorCode: "REFRESH_TOKEN_EXPIRED",
    }));
    const res = response();

    await refreshToken(request(), res, jest.fn());

    expect(res.clearCookie).toHaveBeenCalledWith("sid", expect.any(Object));
  });

  test("does not clear the cookie for a recoverable parallel refresh race", async () => {
    mockRotateRefreshToken.mockRejectedValueOnce(Object.assign(new Error("race"), {
      statusCode: 409,
      errorCode: "REFRESH_TOKEN_RACE",
    }));
    const res = response();

    await refreshToken(request(), res, jest.fn());

    expect(res.clearCookie).not.toHaveBeenCalled();
  });
});
