jest.mock("../../models/Users", () => ({
  findById: jest.fn(),
}));

jest.mock("jsonwebtoken", () => ({
  verify: jest.fn(),
}));

jest.mock("../../config", () => ({
  appConfig: {
    jwt: {
      secret: "test-secret",
    },
  },
}));

const jwt = require("jsonwebtoken");
const User = require("../../models/Users");
const { protect } = require("../../middleware/authMiddleware");

const mockFindById = (user) => {
  const query = {
    select: jest.fn(),
    lean: jest.fn().mockResolvedValue(user),
  };
  query.select.mockReturnValue(query);
  User.findById.mockReturnValue(query);
};

const buildReq = (originalUrl) => ({
  headers: { authorization: "Bearer valid-token" },
  originalUrl,
  path: originalUrl,
  ip: "127.0.0.1",
});

describe("authMiddleware protect terms gate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jwt.verify.mockReturnValue({ id: "user-123", role: "user", tokenVersion: 1 });
  });

  it("allows protected product routes after current terms are accepted", async () => {
    const req = buildReq("/api/analytics/summary");
    const next = jest.fn();

    mockFindById({
      _id: "user-123",
      tokenVersion: 1,
      termsAcceptance: {
        acceptedTerms: true,
        acceptedPrivacy: true,
        termsVersion: "v1.0",
      },
    });

    await protect(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user._id).toBe("user-123");
  });

  it("blocks protected product routes until current terms are accepted", async () => {
    const req = buildReq("/api/analytics/summary");
    const next = jest.fn();

    mockFindById({
      _id: "user-123",
      tokenVersion: 1,
      termsAcceptance: {
        acceptedTerms: false,
        acceptedPrivacy: false,
        termsVersion: null,
      },
    });

    await protect(req, {}, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        errorCode: "TERMS_NOT_ACCEPTED",
      })
    );
  });

  it("allows the profile endpoint so the client can route to the terms gate", async () => {
    const req = buildReq("/api/auth/me");
    const next = jest.fn();

    mockFindById({
      _id: "user-123",
      tokenVersion: 1,
      termsAcceptance: {
        acceptedTerms: false,
        acceptedPrivacy: false,
        termsVersion: null,
      },
    });

    await protect(req, {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  it("returns 503 instead of logging the user out when the auth database is unavailable", async () => {
    const req = buildReq("/api/analytics/summary");
    const next = jest.fn();
    const query = { select: jest.fn(), lean: jest.fn().mockRejectedValue(new Error("Mongo timeout")) };
    query.select.mockReturnValue(query);
    User.findById.mockReturnValue(query);

    await protect(req, {}, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 503,
      errorCode: "AUTH_SERVICE_UNAVAILABLE",
    }));
  });
});
