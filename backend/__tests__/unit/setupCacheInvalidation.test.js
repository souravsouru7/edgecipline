jest.mock("../../repositories/setup.repository", () => ({
  findRawSetupsByUserAndMarket: jest.fn(),
  findSetupsByUserAndMarket: jest.fn(),
  applySetupsDiff: jest.fn(),
}));

jest.mock("../../models/ChecklistNotificationSetting", () => ({
  findOne: jest.fn(),
}));

jest.mock("../../config/cloudinary", () => ({
  uploader: {
    destroy: jest.fn(),
  },
}));

jest.mock("../../utils/cacheUtils", () => ({
  TRADE_CACHE_EVENTS: {
    SETUP_EDIT: "setup_edit",
  },
  invalidateTradeCaches: jest.fn(),
}));

const setupRepository = require("../../repositories/setup.repository");
const ChecklistNotificationSetting = require("../../models/ChecklistNotificationSetting");
const { invalidateTradeCaches } = require("../../utils/cacheUtils");
const setupService = require("../../services/setup.service");

describe("setup cache invalidation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupRepository.findRawSetupsByUserAndMarket.mockResolvedValue([]);
    setupRepository.applySetupsDiff.mockResolvedValue({
      strategies: [{ name: "Breakout" }],
      deletedIds: [],
      renamed: [],
    });
    ChecklistNotificationSetting.findOne.mockResolvedValue(null);
    invalidateTradeCaches.mockResolvedValue(12);
  });

  test("advances the user cache version after the setup save commits", async () => {
    await setupService.saveSetups("user-1", "Forex", [{
      name: "Breakout",
      rules: [{ label: "Wait for retest" }],
      referenceImages: [],
    }]);

    expect(setupRepository.applySetupsDiff).toHaveBeenCalledWith(
      "user-1",
      "Forex",
      [expect.objectContaining({ name: "Breakout" })]
    );
    expect(invalidateTradeCaches).toHaveBeenCalledWith({
      userId: "user-1",
      event: "setup_edit",
      market: "Forex",
      source: "setup_replace",
      count: 1,
    });

    const saveOrder = setupRepository.applySetupsDiff.mock.invocationCallOrder[0];
    const invalidationOrder = invalidateTradeCaches.mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(invalidationOrder);
  });

  test("passes the client-supplied strategy id through so the save updates in place", async () => {
    await setupService.saveSetups("user-1", "Forex", [{
      _id: "5f2b1c9e4d3a2b1c8e7d6f50",
      name: "Breakout",
      rules: [{ label: "Wait for retest" }],
    }]);

    expect(setupRepository.applySetupsDiff).toHaveBeenCalledWith(
      "user-1",
      "Forex",
      [expect.objectContaining({ _id: "5f2b1c9e4d3a2b1c8e7d6f50" })]
    );
  });

  test("clears the checklist notification binding when its strategy is deleted", async () => {
    const setting = { strategyId: "5f2b1c9e4d3a2b1c8e7d6f50", strategyName: "Breakout", save: jest.fn() };
    ChecklistNotificationSetting.findOne.mockResolvedValue(setting);
    setupRepository.applySetupsDiff.mockResolvedValue({
      strategies: [],
      deletedIds: ["5f2b1c9e4d3a2b1c8e7d6f50"],
      renamed: [],
    });

    await setupService.saveSetups("user-1", "Forex", []);

    expect(setting.strategyId).toBeNull();
    expect(setting.strategyName).toBe("");
    expect(setting.save).toHaveBeenCalled();
  });

  test("follows a rename so the notification stops advertising the old name", async () => {
    const setting = { strategyId: "5f2b1c9e4d3a2b1c8e7d6f50", strategyName: "Breakout", save: jest.fn() };
    ChecklistNotificationSetting.findOne.mockResolvedValue(setting);
    setupRepository.applySetupsDiff.mockResolvedValue({
      strategies: [{ name: "Breakout v2" }],
      deletedIds: [],
      renamed: [{ id: "5f2b1c9e4d3a2b1c8e7d6f50", from: "Breakout", to: "Breakout v2" }],
    });

    await setupService.saveSetups("user-1", "Forex", [{
      _id: "5f2b1c9e4d3a2b1c8e7d6f50",
      name: "Breakout v2",
      rules: [],
    }]);

    expect(setting.strategyName).toBe("Breakout v2");
    expect(setting.save).toHaveBeenCalled();
  });

  test("rejects a strategy that has rules but no name instead of dropping it", async () => {
    await expect(
      setupService.saveSetups("user-1", "Forex", [{ name: "  ", rules: [{ label: "Wait for retest" }] }])
    ).rejects.toMatchObject({ errorCode: "STRATEGY_NAME_REQUIRED" });
    expect(setupRepository.applySetupsDiff).not.toHaveBeenCalled();
  });

  test("rejects more rules than a trade can record", async () => {
    const rules = Array.from({ length: 21 }, (_, i) => ({ label: `Rule ${i + 1}` }));
    await expect(
      setupService.saveSetups("user-1", "Forex", [{ name: "TooMany", rules }])
    ).rejects.toMatchObject({ errorCode: "TOO_MANY_RULES" });
  });
});
