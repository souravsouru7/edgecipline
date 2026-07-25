jest.mock("../../models/Trade", () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

jest.mock("../../services/tradeLifecycle.service", () => ({
  softDeleteTrade: jest.fn(),
}));

const Trade = require("../../models/Trade");
const tradeLifecycleService = require("../../services/tradeLifecycle.service");
const tradeRepository = require("../../repositories/trade.repository");

describe("trade repository mass-assignment protection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("scopes Forex trade reads to the authenticated user", async () => {
    const lean = jest.fn().mockResolvedValue(null);
    Trade.findOne.mockReturnValue({ lean });

    await tradeRepository.findForexTradeByUser("trade-a", "user-b");

    expect(Trade.findOne).toHaveBeenCalledWith({
      _id: "trade-a",
      user: "user-b",
      marketType: { $ne: "Indian_Market" },
      deletedAt: null,
    });
    expect(lean).toHaveBeenCalled();
  });

  it("cannot bypass the Forex allowlist through a direct repository call", async () => {
    Trade.findOneAndUpdate.mockResolvedValue({ _id: "trade-1" });

    await tradeRepository.updateForexTradeByUser("trade-1", "user-1", {
      notes: "allowed",
      user: "user-2",
      marketType: "Indian_Market",
      createdAt: "2000-01-01",
      updatedAt: "2000-01-01",
      deletedAt: "2000-01-01",
      ocrJobId: "attacker-job",
      subscriptionStatus: "active",
      paymentStatus: "paid",
      tokenVersion: 0,
      role: "admin",
      processedAt: "2000-01-01",
      extractionConfidence: 100,
    });

    expect(Trade.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: "trade-1",
        user: "user-1",
        marketType: { $ne: "Indian_Market" },
        deletedAt: null,
      },
      { notes: "allowed" },
      {
        returnDocument: "after",
        lean: true,
        runValidators: true,
      }
    );
  });

  it("soft-deletes Forex trades only through the authenticated user's scope", async () => {
    tradeLifecycleService.softDeleteTrade.mockResolvedValue(null);

    await tradeRepository.deleteForexTradeByUser("trade-a", "user-b");

    expect(tradeLifecycleService.softDeleteTrade).toHaveBeenCalledWith(
      Trade,
      {
        tradeId: "trade-a",
        userId: "user-b",
        deletedBy: "user-b",
        deletedSource: "user",
        marketFilter: { marketType: { $ne: "Indian_Market" } },
      }
    );
  });
});
