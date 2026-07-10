jest.mock("../../repositories/setup.repository", () => ({
  findRawSetupsByUserAndMarket: jest.fn(),
  findSetupsByUserAndMarket: jest.fn(),
  replaceSetupsByUserAndMarket: jest.fn(),
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
const { invalidateTradeCaches } = require("../../utils/cacheUtils");
const setupService = require("../../services/setup.service");

describe("setup cache invalidation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupRepository.findRawSetupsByUserAndMarket.mockResolvedValue([]);
    setupRepository.replaceSetupsByUserAndMarket.mockResolvedValue([]);
    invalidateTradeCaches.mockResolvedValue(12);
  });

  test("advances the user cache version after setup replacement commits", async () => {
    await setupService.saveSetups("user-1", "Forex", [{
      name: "Breakout",
      rules: [{ label: "Wait for retest" }],
      referenceImages: [],
    }]);

    expect(setupRepository.replaceSetupsByUserAndMarket).toHaveBeenCalledWith(
      "user-1",
      "Forex",
      [expect.objectContaining({
        user: "user-1",
        marketType: "Forex",
        name: "Breakout",
      })]
    );
    expect(invalidateTradeCaches).toHaveBeenCalledWith({
      userId: "user-1",
      event: "setup_edit",
      market: "Forex",
      source: "setup_replace",
      count: 1,
    });

    const replacementOrder =
      setupRepository.replaceSetupsByUserAndMarket.mock.invocationCallOrder[0];
    const invalidationOrder = invalidateTradeCaches.mock.invocationCallOrder[0];
    expect(replacementOrder).toBeLessThan(invalidationOrder);
  });
});
