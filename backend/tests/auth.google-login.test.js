const express = require("express");
const request = require("supertest");

jest.mock("../models/Users", () => ({
  findOneAndUpdate: jest.fn(),
}));

jest.mock("jsonwebtoken", () => ({
  sign: jest.fn(() => "google-jwt-token"),
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

jest.mock("../config/firebaseAdmin", () => ({
  getFirebaseAdmin: jest.fn(),
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
const { getFirebaseAdmin } = require("../config/firebaseAdmin");
const authRoutes = require("../routes/authRoutes");
const { errorHandler } = require("../middleware/errorHandler");

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  app.use(errorHandler);
  return app;
};

describe("POST /api/auth/google", () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  it("logs in with a verified Firebase Google token", async () => {
    getFirebaseAdmin.mockReturnValue({
      auth: () => ({
        verifyIdToken: jest.fn().mockResolvedValue({
          email: "google@example.com",
          email_verified: true,
          name: "Google Trader",
          picture: "https://example.com/avatar.png",
          uid: "firebase-user-1",
          firebase: {
            sign_in_provider: "google.com",
            identities: {
              "google.com": ["google-id-1"],
            },
          },
        }),
      }),
    });

    User.findOneAndUpdate.mockResolvedValue({
      _id: "user-google-1",
      name: "Google Trader",
      email: "google@example.com",
      role: "user",
      tokenVersion: 0,
      termsAcceptance: { termsVersion: "v1.0" },
    });

    const res = await request(app)
      .post("/api/auth/google")
      .send({ idToken: "firebase-token" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      _id: "user-google-1",
      name: "Google Trader",
      email: "google@example.com",
      role: "user",
      token: "google-jwt-token",
    });
  });

  it("requires a Google or Firebase token", async () => {
    const res = await request(app)
      .post("/api/auth/google")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      status: "error",
      message: "Missing Google or Firebase ID token",
      errorCode: "VALIDATION_ERROR",
    });
  });

  it("rejects an unsupported Firebase sign-in provider", async () => {
    getFirebaseAdmin.mockReturnValue({
      auth: () => ({
        verifyIdToken: jest.fn().mockResolvedValue({
          email: "user@example.com",
          email_verified: true,
          uid: "firebase-user-2",
          firebase: {
            sign_in_provider: "password",
            identities: {},
          },
        }),
      }),
    });

    const res = await request(app)
      .post("/api/auth/google")
      .send({ credential: "firebase-token" });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      status: "error",
      message: "Unsupported Firebase sign-in provider",
      errorCode: "AUTH_FAILED",
    });
  });
});
