jest.mock("../../models/ChecklistTracking", () => ({
  create: jest.fn(),
  find: jest.fn(),
}));

jest.mock("../../models/Users", () => ({}));

jest.mock("../../services/streak.service", () => ({
  recordChecklistEvent: jest.fn(),
}));

jest.mock("../../utils/logger", () => ({
  logger: { warn: jest.fn() },
}));

const ChecklistTracking = require("../../models/ChecklistTracking");
const streakService = require("../../services/streak.service");
const checklistController = require("../../controllers/checklistController");

function invoke(handler, req) {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const next = jest.fn();
  return handler(req, res, next).then(() => ({ res, next }));
}

describe("checklist ownership boundaries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    streakService.recordChecklistEvent.mockResolvedValue(undefined);
  });

  it("creates checklist records for the authenticated user, ignoring body user fields", async () => {
    const created = { _id: "track-a", user: "user-a", strategyName: "Breakout" };
    ChecklistTracking.create.mockResolvedValue(created);

    const { res, next } = await invoke(checklistController.logChecklistResult, {
      user: { _id: "user-a" },
      body: {
        user: "user-b",
        market: "Forex",
        strategyName: "Breakout",
        totalRules: 5,
        followedRules: 4,
        score: 80,
        isAPlus: true,
      },
    });

    expect(next).not.toHaveBeenCalled();
    expect(ChecklistTracking.create).toHaveBeenCalledWith(expect.objectContaining({
      user: "user-a",
      market: "Forex",
      strategyName: "Breakout",
      totalRules: 5,
      followedRules: 4,
      score: 80,
      isAPlus: true,
    }));
    expect(ChecklistTracking.create.mock.calls[0][0]).not.toMatchObject({ user: "user-b" });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(created);
  });

  it("lists only the authenticated user's checklist records", async () => {
    const tracks = [{ _id: "track-a", user: "user-a", isAPlus: true }];
    const lean = jest.fn().mockResolvedValue(tracks);
    const limit = jest.fn().mockReturnValue({ lean });
    const sort = jest.fn().mockReturnValue({ limit });
    ChecklistTracking.find.mockReturnValue({ sort });

    const { res, next } = await invoke(checklistController.getChecklistStats, {
      user: { _id: "user-a" },
      query: { market: "Forex" },
    });

    expect(next).not.toHaveBeenCalled();
    expect(ChecklistTracking.find).toHaveBeenCalledWith({ user: "user-a", market: "Forex" });
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(limit).toHaveBeenCalledWith(500);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      totalChecklists: 1,
      aPlusCount: 1,
      tracks,
    }));
  });
});
