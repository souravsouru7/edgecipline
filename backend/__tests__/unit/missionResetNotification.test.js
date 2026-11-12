// "Mission reset" must only be sent when a reset actually happened.
jest.mock("../../models/MissionAssignment", () => ({ find: jest.fn(), findById: jest.fn() }));
jest.mock("../../models/DailyReflection", () => ({}));
jest.mock("../../services/missionService", () => ({ completeMission: jest.fn() }));
jest.mock("../../services/missionNotificationService", () => ({
  sendMissionNotification: jest.fn().mockResolvedValue(null),
}));
jest.mock("../../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const MissionAssignment = require("../../models/MissionAssignment");
const { sendMissionNotification } = require("../../services/missionNotificationService");
const { evaluateDayBasedMissions } = require("../../services/missionProgressService");

function assignment(overrides = {}) {
  return {
    _id: "a1",
    processedDays: [],
    consecutiveCount: 3,
    currentProgress: 3,
    progressEvents: [],
    missionSnapshot: { validationType: "no_revenge_trade", progressMode: "consecutive_days", target: 10 },
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const resets = () => sendMissionNotification.mock.calls.filter(([, , type]) => type === "streak_broken");

beforeEach(() => jest.clearAllMocks());

it("sends one reset when a consecutive-days mission with progress fails the day", async () => {
  MissionAssignment.find.mockResolvedValue([assignment()]);
  await evaluateDayBasedMissions("u1", "2026-11-04", { hasRevengeTrade: true, tradeCount: 2 });
  expect(resets()).toHaveLength(1);
  expect(resets()[0][3]).toEqual({ dayKey: "2026-11-04" });
});

it("re-running an already graded day sends nothing (the old false 'Mission Reset')", async () => {
  MissionAssignment.find.mockResolvedValue([assignment({ processedDays: ["2026-11-04"] })]);
  await evaluateDayBasedMissions("u1", "2026-11-04", { hasRevengeTrade: true, tradeCount: 2 });
  expect(resets()).toHaveLength(0);
});

it("a failed day with no progress to lose is not a 'reset'", async () => {
  MissionAssignment.find.mockResolvedValue([assignment({ consecutiveCount: 0, currentProgress: 0 })]);
  await evaluateDayBasedMissions("u1", "2026-11-04", { hasRevengeTrade: true, tradeCount: 2 });
  expect(resets()).toHaveLength(0);
});

it("total-days missions never 'reset'", async () => {
  MissionAssignment.find.mockResolvedValue([assignment({
    missionSnapshot: { validationType: "no_revenge_trade", progressMode: "total_days", target: 10 },
  })]);
  await evaluateDayBasedMissions("u1", "2026-11-04", { hasRevengeTrade: true, tradeCount: 2 });
  expect(resets()).toHaveLength(0);
});

it("'log a trade' missions are not graded on a weekend day", async () => {
  const doc = assignment({ missionSnapshot: { validationType: "trade_logged", progressMode: "consecutive_days", target: 10 } });
  MissionAssignment.find.mockResolvedValue([doc]);
  await evaluateDayBasedMissions("u1", "2026-11-07", { tradeCount: 0 }); // Saturday
  expect(resets()).toHaveLength(0);
  expect(doc.consecutiveCount).toBe(3);
  expect(doc.processedDays).toEqual(["2026-11-07"]);
});

it("a passed day sends no reset", async () => {
  MissionAssignment.find.mockResolvedValue([assignment()]);
  await evaluateDayBasedMissions("u1", "2026-11-04", { hasRevengeTrade: false, tradeCount: 1 });
  expect(resets()).toHaveLength(0);
});

describe("daily_loss_limit mission uses each market's own limit", () => {
  const lossMission = () => assignment({
    missionSnapshot: { validationType: "daily_loss_limit", progressMode: "consecutive_days", target: 30 },
  });
  const run = async (marketChecks) => {
    const doc = lossMission();
    MissionAssignment.find.mockResolvedValue([doc]);
    await evaluateDayBasedMissions("u1", "2026-11-04", { tradeCount: 3, marketChecks });
    return doc;
  };

  it("fails when a market goes past its limit", async () => {
    const doc = await run([
      { market: "Forex", tradeCount: 2, pnl: -250, limit: 200 },
      { market: "Indian_Market", tradeCount: 0, pnl: 0, limit: null },
    ]);
    expect(doc.consecutiveCount).toBe(0);
    expect(resets()).toHaveLength(1);
  });

  it("passes inside the limit, and exactly at it", async () => {
    const doc = await run([{ market: "Forex", tradeCount: 2, pnl: -200, limit: 200 }]);
    expect(doc.consecutiveCount).toBe(4);
  });

  it("never adds $ and ₹ together", async () => {
    // −$150 and −₹5,000: each within its own limit, though the raw sum would breach either.
    const doc = await run([
      { market: "Forex", tradeCount: 1, pnl: -150, limit: 200 },
      { market: "Indian_Market", tradeCount: 1, pnl: -5000, limit: 10000 },
    ]);
    expect(doc.consecutiveCount).toBe(4);
  });

  it("ignores a market without a limit", async () => {
    const doc = await run([
      { market: "Forex", tradeCount: 1, pnl: -5000, limit: null },
      { market: "Indian_Market", tradeCount: 1, pnl: -100, limit: 1000 },
    ]);
    expect(doc.consecutiveCount).toBe(4);
  });

  it("keeps the old behaviour (pass) when no limit is set at all", async () => {
    const doc = await run([
      { market: "Forex", tradeCount: 3, pnl: -99999, limit: null },
      { market: "Indian_Market", tradeCount: 0, pnl: 0, limit: null },
    ]);
    expect(doc.consecutiveCount).toBe(4);
    expect(resets()).toHaveLength(0);
  });
});
