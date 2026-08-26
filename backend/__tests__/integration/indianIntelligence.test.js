const express = require("express");
const request = require("supertest");

const mockGetIndianIntelligenceSummary = jest.fn();

jest.mock("../../services/indianIntelligenceService", () => ({
  getIndianIntelligenceSummary: (...args) => mockGetIndianIntelligenceSummary(...args),
  normalizeInstrumentType: (value = "ALL") => {
    const normalized = String(value || "ALL").trim().toUpperCase() || "ALL";
    if (!["ALL", "OPTION", "EQUITY"].includes(normalized)) throw new Error("Invalid Indian instrumentType");
    return normalized;
  },
}));

jest.mock("../../middleware/authMiddleware", () => ({
  protect: (req, res, next) => {
    if (!req.headers.authorization?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided", errorCode: "AUTH_REQUIRED" });
    }
    req.user = { _id: "user-a" };
    return next();
  },
}));

jest.mock("../../middleware/cacheMiddleware", () => () => (_req, _res, next) => next());

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/indian/intelligence", require("../../routes/indianIntelligenceRoutes"));
  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({ message: error.message, errorCode: error.errorCode });
  });
  return app;
}

describe("GET /api/indian/intelligence/summary", () => {
  beforeEach(() => mockGetIndianIntelligenceSummary.mockReset());

  test("requires authentication", async () => {
    const response = await request(makeApp()).get("/api/indian/intelligence/summary");

    expect(response.status).toBe(401);
    expect(response.body.errorCode).toBe("AUTH_REQUIRED");
    expect(mockGetIndianIntelligenceSummary).not.toHaveBeenCalled();
  });

  test("scopes the summary to the authenticated user and Indian instrument", async () => {
    mockGetIndianIntelligenceSummary.mockResolvedValue({
      marketType: "Indian_Market",
      instrumentType: "EQUITY",
      sample: { totalTrades: 21 },
      strengths: [],
      leaks: [],
    });

    const response = await request(makeApp())
      .get("/api/indian/intelligence/summary?instrumentType=equity")
      .set("Authorization", "Bearer test-token");

    expect(response.status).toBe(200);
    expect(response.body.marketType).toBe("Indian_Market");
    expect(mockGetIndianIntelligenceSummary).toHaveBeenCalledWith({
      userId: "user-a",
      instrumentType: "EQUITY",
    });
  });

  test("rejects non-Indian instrument filters before querying data", async () => {
    const response = await request(makeApp())
      .get("/api/indian/intelligence/summary?instrumentType=FOREX")
      .set("Authorization", "Bearer test-token");

    expect(response.status).toBe(400);
    expect(response.body.errorCode).toBe("INVALID_INDIAN_INSTRUMENT");
    expect(mockGetIndianIntelligenceSummary).not.toHaveBeenCalled();
  });

  test("passes service failures to centralized error handling", async () => {
    mockGetIndianIntelligenceSummary.mockRejectedValue(new Error("database unavailable"));

    const response = await request(makeApp())
      .get("/api/indian/intelligence/summary")
      .set("Authorization", "Bearer test-token");

    expect(response.status).toBe(500);
    expect(response.body.message).toBe("database unavailable");
  });
});
