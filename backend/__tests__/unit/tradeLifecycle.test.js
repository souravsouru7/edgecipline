const {
  activeTradeQuery,
  deletedTradeQuery,
  restoreTrade,
  softDeleteTrade,
} = require("../../services/tradeLifecycle.service");

function mockModel(result = null) {
  return {
    findOneAndUpdate: jest.fn().mockResolvedValue(result),
  };
}

describe("trade lifecycle service", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-06-10T12:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("builds active-trade query that excludes deleted records", () => {
    expect(activeTradeQuery({
      tradeId: "trade-1",
      userId: "user-1",
      marketFilter: { marketType: { $ne: "Indian_Market" } },
    })).toEqual({
      _id: "trade-1",
      user: "user-1",
      marketType: { $ne: "Indian_Market" },
      deletedAt: null,
    });
  });

  test("softDeleteTrade marks an active Forex trade as deleted with audit metadata", async () => {
    const Model = mockModel({ _id: "trade-1", deletedAt: new Date() });

    await softDeleteTrade(Model, {
      tradeId: "trade-1",
      userId: "user-1",
      deletedBy: "user-1",
      deleteReason: "duplicate",
      deletedSource: "user",
      marketFilter: { marketType: { $ne: "Indian_Market" } },
      options: { lean: true },
    });

    expect(Model.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: "trade-1",
        user: "user-1",
        marketType: { $ne: "Indian_Market" },
        deletedAt: null,
      },
      {
        $set: {
          deletedAt: new Date("2026-06-10T12:00:00.000Z"),
          deletedBy: "user-1",
          deleteReason: "duplicate",
          deletedSource: "user",
        },
      },
      { returnDocument: "after", lean: true }
    );
  });

  test("softDeleteTrade marks an active Indian trade as deleted using the same lifecycle path", async () => {
    const Model = mockModel({ _id: "indian-1", deletedAt: new Date() });

    await softDeleteTrade(Model, {
      tradeId: "indian-1",
      userId: "user-1",
      deletedBy: "user-1",
      deletedSource: "user",
      options: { lean: true },
    });

    expect(Model.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: "indian-1",
        user: "user-1",
        deletedAt: null,
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          deletedAt: new Date("2026-06-10T12:00:00.000Z"),
          deletedBy: "user-1",
          deletedSource: "user",
        }),
      }),
      { returnDocument: "after", lean: true }
    );
  });

  test("restoreTrade only restores previously deleted trades and clears audit metadata", async () => {
    const Model = mockModel({ _id: "trade-1", deletedAt: null });

    await restoreTrade(Model, {
      tradeId: "trade-1",
      userId: "user-1",
      marketFilter: { marketType: { $ne: "Indian_Market" } },
      options: { lean: true },
    });

    expect(Model.findOneAndUpdate).toHaveBeenCalledWith(
      deletedTradeQuery({
        tradeId: "trade-1",
        userId: "user-1",
        marketFilter: { marketType: { $ne: "Indian_Market" } },
      }),
      {
        $set: { deletedAt: null },
        $unset: {
          deletedBy: "",
          deleteReason: "",
          deletedSource: "",
        },
      },
      { returnDocument: "after", lean: true }
    );
  });
});
