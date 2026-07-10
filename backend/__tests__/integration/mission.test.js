"use strict";

/**
 * Integration tests for the Mission API.
 * Requires a running MongoDB instance (uses the test DB from env).
 * All requests go through the Express app using supertest.
 */

const request = require("supertest");

// Mocks — isolate external dependencies
jest.mock("../../services/notificationService", () => ({
  notifyUser: jest.fn().mockResolvedValue(null),
  TYPE_CHANNEL: {},
}));
jest.mock("../../services/geminiService", () => ({
  generateWeeklyFeedback: jest.fn().mockResolvedValue({ model: "test", feedback: {} }),
}));
jest.mock("../../config/firebaseAdmin", () => ({
  getFirebaseAdmin: jest.fn().mockReturnValue(null),
}));
jest.mock("../../config/redis", () => ({
  connectRedis: jest.fn(),
  isRedisReady: jest.fn().mockReturnValue(false),
  getRedisClient: jest.fn().mockReturnValue(null),
}));
jest.mock("../../middleware/rateLimiter", () => ({
  globalRateLimiter: (_req, _res, next) => next(),
  getRateLimiterHealth: jest.fn().mockReturnValue("ok"),
  authRateLimiter: (_req, _res, next) => next(),
  refreshRateLimiter: (_req, _res, next) => next(),
  statusRateLimiter: (_req, _res, next) => next(),
  profileRateLimiter: (_req, _res, next) => next(),
  uploadRateLimiter: (_req, _res, next) => next(),
  tradingDnaRateLimiter: (_req, _res, next) => next(),
  tradingDnaJobStatusRateLimiter: (_req, _res, next) => next(),
  shareTokenRateLimiter: (_req, _res, next) => next(),
  publicShareRateLimiter: (_req, _res, next) => next(),
  issueReportRateLimiter: (_req, _res, next) => next(),
  adminDestructiveRateLimiter: (_req, _res, next) => next(),
}));
jest.mock("../../middleware/cacheMiddleware", () => ({
  cacheMiddleware: () => (_req, _res, next) => next(),
}));

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

let app;
let MissionTemplate;
let MissionAssignment;
let User;

const TEST_USER_ID = new mongoose.Types.ObjectId();
const TEST_TEMPLATE_ID = new mongoose.Types.ObjectId();

function makeAuthToken(userId) {
  return jwt.sign({ id: String(userId), role: "user" }, process.env.JWT_SECRET || "test-secret-key-32chars-minimum!!", { expiresIn: "1h" });
}

beforeAll(async () => {
  process.env.JWT_SECRET = "test-secret-key-32chars-minimum!!";
  process.env.ADMIN_JWT_SECRET = "test-admin-key-32chars-minimum!!!";
  process.env.MONGO_URI = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017/stratedge_test";
  process.env.NODE_ENV = "test";

  await mongoose.connect(process.env.MONGO_URI);

  MissionTemplate = require("../../models/MissionTemplate");
  MissionAssignment = require("../../models/MissionAssignment");
  User = require("../../models/Users");

  // Create test user
  await User.findOneAndUpdate(
    { _id: TEST_USER_ID },
    {
      _id: TEST_USER_ID,
      email: "mission-test@example.com",
      password: "hashedpassword",
      firstName: "Mission",
      lastName: "Tester",
      role: "user",
      isOnboardingCompleted: true,
      termsVersion: 1,
      acceptedTermsVersion: 1,
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  // Create test template
  await MissionTemplate.findOneAndUpdate(
    { _id: TEST_TEMPLATE_ID },
    {
      _id: TEST_TEMPLATE_ID,
      name: "Test Stop Loss Mission",
      description: "Test mission for integration tests",
      category: "risk_management",
      difficulty: "beginner",
      validationType: "stop_loss_required",
      progressMode: "consecutive_trades",
      target: 5,
      unit: "trades",
      validationConfig: {},
      isActive: true,
      isSystemMission: false,
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  // Lazy-load the app after env is set
  app = require("../../server");
});

afterAll(async () => {
  // Clean up test data
  await Promise.all([
    MissionAssignment.deleteMany({ user: TEST_USER_ID }),
    MissionTemplate.deleteOne({ _id: TEST_TEMPLATE_ID }),
    User.deleteOne({ _id: TEST_USER_ID }),
  ]);
  await mongoose.disconnect();
});

beforeEach(async () => {
  // Clean assignments before each test
  await MissionAssignment.deleteMany({ user: TEST_USER_ID });
});

describe("GET /api/missions/templates", () => {
  it("returns active templates", async () => {
    const token = makeAuthToken(TEST_USER_ID);
    const res = await request(app)
      .get("/api/missions/templates")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const names = res.body.data.map(t => t.name);
    expect(names).toContain("Test Stop Loss Mission");
  });

  it("filters by category", async () => {
    const token = makeAuthToken(TEST_USER_ID);
    const res = await request(app)
      .get("/api/missions/templates?category=risk_management")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    res.body.data.forEach(t => {
      expect(t.category).toBe("risk_management");
    });
  });
});

describe("GET /api/missions", () => {
  it("returns empty active missions when none assigned", async () => {
    const token = makeAuthToken(TEST_USER_ID);
    const res = await request(app)
      .get("/api/missions")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(0);
  });

  it("returns 401 without auth token", async () => {
    const res = await request(app).get("/api/missions");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/missions/:id/accept", () => {
  it("accepts an available mission and marks it active", async () => {
    const token = makeAuthToken(TEST_USER_ID);

    // First assign the mission (simulating AI recommendation)
    const { assignMission } = require("../../services/missionService");
    const assignment = await assignMission(String(TEST_USER_ID), String(TEST_TEMPLATE_ID), {
      recommendedBy: "system",
    });

    const res = await request(app)
      .post(`/api/missions/${assignment.id}/accept`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("active");
    expect(res.body.data.acceptedAt).toBeTruthy();
  });

  it("enforces 3-mission cap", async () => {
    const token = makeAuthToken(TEST_USER_ID);
    const { assignMission } = require("../../services/missionService");

    // Create and accept 3 missions
    const templates = await MissionTemplate.find({ isActive: true }).limit(4).lean();
    const toAccept = templates.slice(0, 3);

    for (const t of toAccept) {
      const a = await assignMission(String(TEST_USER_ID), String(t._id), { recommendedBy: "system" });
      await request(app)
        .post(`/api/missions/${a.id}/accept`)
        .set("Authorization", `Bearer ${token}`);
    }

    // 4th accept should fail
    const fourth = templates[3];
    if (fourth) {
      const a4 = await assignMission(String(TEST_USER_ID), String(fourth._id), { recommendedBy: "system" });
      const res4 = await request(app)
        .post(`/api/missions/${a4.id}/accept`)
        .set("Authorization", `Bearer ${token}`);
      expect(res4.status).toBe(422);
      expect(res4.body.errorCode).toBe("MAX_ACTIVE_MISSIONS_REACHED");
    }
  });
});

describe("POST /api/missions/:id/archive", () => {
  it("archives an active mission", async () => {
    const token = makeAuthToken(TEST_USER_ID);
    const { assignMission, acceptMission } = require("../../services/missionService");

    const assignment = await assignMission(String(TEST_USER_ID), String(TEST_TEMPLATE_ID), {
      recommendedBy: "system",
    });
    await acceptMission(String(TEST_USER_ID), assignment.id);

    const res = await request(app)
      .post(`/api/missions/${assignment.id}/archive`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("archived");
  });
});

describe("GET /api/missions/stats", () => {
  it("returns stats with correct shape", async () => {
    const token = makeAuthToken(TEST_USER_ID);
    const res = await request(app)
      .get("/api/missions/stats")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      completed: expect.any(Number),
      active: expect.any(Number),
      archived: expect.any(Number),
    });
  });
});
