jest.mock("../../models/Trade", () => ({ distinct: jest.fn(), countDocuments: jest.fn() }));
jest.mock("../../models/IndianTrade", () => ({ distinct: jest.fn(), countDocuments: jest.fn() }));
jest.mock("../../models/SetupStrategy", () => ({ distinct: jest.fn(), exists: jest.fn() }));

const Trade = require("../../models/Trade");
const IndianTrade = require("../../models/IndianTrade");
const SetupStrategy = require("../../models/SetupStrategy");
const { resolveActiveMarketsForUsers, getActiveMarketsForUser } = require("../../services/userMarketService");

describe("userMarketService.resolveActiveMarketsForUsers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Trade.distinct.mockResolvedValue(["fx-trader", "both"]);
    IndianTrade.distinct.mockResolvedValue(["in-trader", "both"]);
    SetupStrategy.distinct.mockImplementation((_field, filter) =>
      Promise.resolve(filter.marketType === "Forex" ? ["fx-setup"] : ["in-setup"])
    );
  });

  it("derives markets from preferredMarket, trades and setups", async () => {
    const users = [
      { _id: "fx-trader" },
      { _id: "in-trader" },
      { _id: "both" },
      { _id: "fx-setup" },
      { _id: "in-setup" },
      { _id: "pref-forex", preferredMarket: "Forex" },
      { _id: "pref-indian", preferredMarket: "Indian_Market" },
      { _id: "nothing" },
    ];
    const result = await resolveActiveMarketsForUsers(users);
    expect([...result.get("fx-trader")]).toEqual(["Forex"]);
    expect([...result.get("in-trader")]).toEqual(["Indian_Market"]);
    expect([...result.get("both")].sort()).toEqual(["Forex", "Indian_Market"]);
    expect([...result.get("fx-setup")]).toEqual(["Forex"]);
    expect([...result.get("in-setup")]).toEqual(["Indian_Market"]);
    expect([...result.get("pref-forex")]).toEqual(["Forex"]);
    expect([...result.get("pref-indian")]).toEqual(["Indian_Market"]);
    expect(result.get("nothing").size).toBe(0);
  });

  it("uses four fleet-wide distinct queries regardless of user count", async () => {
    await resolveActiveMarketsForUsers(Array.from({ length: 500 }, (_, i) => ({ _id: `u${i}` })));
    expect(Trade.distinct).toHaveBeenCalledTimes(1);
    expect(IndianTrade.distinct).toHaveBeenCalledTimes(1);
    expect(SetupStrategy.distinct).toHaveBeenCalledTimes(2);
  });

  it("excludes soft-deleted and ghost Forex trades from the signal", async () => {
    await resolveActiveMarketsForUsers([]);
    expect(Trade.distinct).toHaveBeenCalledWith("user", expect.objectContaining({
      deletedAt: null,
      "parsedData.multiTradeGhost": { $ne: true },
    }));
    expect(IndianTrade.distinct).toHaveBeenCalledWith("user", { deletedAt: null });
  });
});

describe("userMarketService.getActiveMarketsForUser", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Trade.countDocuments.mockReturnValue({ limit: () => Promise.resolve(0) });
    IndianTrade.countDocuments.mockReturnValue({ limit: () => Promise.resolve(0) });
    SetupStrategy.exists.mockResolvedValue(null);
  });

  it("returns the preferred market even with no activity", async () => {
    const markets = await getActiveMarketsForUser({ _id: "u1", preferredMarket: "Indian_Market" });
    expect([...markets]).toEqual(["Indian_Market"]);
  });

  it("adds a market once the user has a trade there", async () => {
    Trade.countDocuments.mockReturnValue({ limit: () => Promise.resolve(1) });
    const markets = await getActiveMarketsForUser({ _id: "u1", preferredMarket: "Indian_Market" });
    expect([...markets].sort()).toEqual(["Forex", "Indian_Market"]);
  });
});
