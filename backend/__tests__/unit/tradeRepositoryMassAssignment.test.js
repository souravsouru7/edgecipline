jest.mock("../../models/Trade", () => ({
  findOneAndUpdate: jest.fn(),
}));

jest.mock("../../services/tradeLifecycle.service", () => ({}));

const Trade = require("../../models/Trade");
const tradeRepository = require("../../repositories/trade.repository");

describe("trade repository mass-assignment protection", () => {
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
});
