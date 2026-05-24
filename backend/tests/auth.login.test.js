const express = require("express");
const request = require("supertest");

jest.mock("../models/Users", () => ({
  findOne: jest.fn(),
}));

jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
}));

jest.mock("jsonwebtoken", () => ({
  sign: jest.fn(() => "signed-jwt-token"),
}));

jest.mock("../config", () => ({
  appConfig: {
    env: "test",
    jwt: {
      secret: "test-secret",
      expiresIn: "1h",
    },
  },
}));

jest.mock("../utils/logger", () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock("../middleware/rateLimiter", () => ({
  authRateLimiter: (_req, _res, next) => next(),
}));

const User = require("../models/Users");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const authRoutes = require("../routes/authRoutes");
const { errorHandler } = require("../middleware/errorHandler");

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  app.use(errorHandler);
  return app;
};

const findOneResult = (user) => ({
  select: jest.fn().mockResolvedValue(user),
});

describe("POST /api/auth/login", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  it("logs in a local user with valid credentials", async () => {
    const user = {
      _id: "user-123",
      name: "Test Trader",
      email: "trader@example.com",
      password: "hashed-password",
      role: "user",
      tokenVersion: 2,
      authProvider: "local",
      termsAcceptance: { termsVersion: "v1.0" },
      save: jest.fn().mockResolvedValue(undefined),
    };

    User.findOne.mockReturnValue(findOneResult(user));
    bcrypt.compare.mockResolvedValue(true);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "trader@example.com", password: "password123" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      _id: "user-123",
      name: "Test Trader",
      email: "trader@example.com",
      role: "user",
      token: "signed-jwt-token",
    });
    expect(User.findOne).toHaveBeenCalledWith({ email: "trader@example.com" });
    expect(bcrypt.compare).toHaveBeenCalledWith("password123", "hashed-password");
    expect(user.save).toHaveBeenCalledTimes(1);
    expect(user.lastLogin).toBeInstanceOf(Date);
    expect(jwt.sign).toHaveBeenCalledWith(
      { id: "user-123", role: "user", tokenVersion: 2 },
      "test-secret",
      { expiresIn: "1h" }
    );
  });

  it("rejects invalid credentials", async () => {
    User.findOne.mockReturnValue(findOneResult(null));

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "missing@example.com", password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      status: "error",
      message: "Invalid credentials",
      errorCode: "INVALID_CREDENTIALS",
    });
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it("rejects password login for Google accounts", async () => {
    const user = {
      email: "google@example.com",
      authProvider: "google",
    };

    User.findOne.mockReturnValue(findOneResult(user));

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "google@example.com", password: "password123" });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      status: "error",
      message: "This account uses Google sign-in. Please continue with Google.",
      errorCode: "AUTH_PROVIDER_MISMATCH",
    });
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });
});
