jest.mock("../../models/SetupStrategy", () => ({
  deleteMany: jest.fn(),
  insertMany: jest.fn(),
}));

const SetupStrategy = require("../../models/SetupStrategy");
const mongoose = require("mongoose");
const setupRepository = require("../../repositories/setup.repository");

describe("setup repository mass-assignment protection", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it("reconstructs setup documents with server-owned user and market", async () => {
    const session = {
      withTransaction: async (work) => work(),
      endSession: jest.fn(),
    };
    jest.spyOn(mongoose, "startSession").mockResolvedValue(session);
    SetupStrategy.deleteMany.mockResolvedValue({ deletedCount: 0 });
    SetupStrategy.insertMany.mockImplementation(async (docs) => docs);

    await setupRepository.replaceSetupsByUserAndMarket("user-1", "Forex", [{
      name: "Breakout",
      referenceImages: [],
      rules: [{ label: "Retest" }],
      user: "user-2",
      marketType: "Indian_Market",
      createdAt: "2000-01-01",
      updatedAt: "2000-01-01",
      deletedAt: "2000-01-01",
      role: "admin",
    }]);

    expect(SetupStrategy.insertMany).toHaveBeenCalledWith(
      [{
        user: "user-1",
        marketType: "Forex",
        name: "Breakout",
        referenceImages: [],
        rules: [{ label: "Retest" }],
      }],
      { session }
    );
  });

  it("falls back to a non-transactional replace on standalone MongoDB", async () => {
    const session = {
      withTransaction: jest.fn(async () => {
        throw new Error("Transaction numbers are only allowed on a replica set member or mongos");
      }),
      endSession: jest.fn(),
    };
    jest.spyOn(mongoose, "startSession").mockResolvedValue(session);
    SetupStrategy.deleteMany.mockResolvedValue({ deletedCount: 1 });
    SetupStrategy.insertMany.mockImplementation(async (docs) => docs);

    const result = await setupRepository.replaceSetupsByUserAndMarket("user-1", "Forex", [{
      name: "Breakout",
      referenceImages: [],
      rules: [{ label: "Retest" }],
    }]);

    expect(result).toEqual([{
      user: "user-1",
      marketType: "Forex",
      name: "Breakout",
      referenceImages: [],
      rules: [{ label: "Retest" }],
    }]);
    expect(SetupStrategy.deleteMany).toHaveBeenLastCalledWith({ user: "user-1", marketType: "Forex" });
    expect(SetupStrategy.insertMany).toHaveBeenLastCalledWith([{
      user: "user-1",
      marketType: "Forex",
      name: "Breakout",
      referenceImages: [],
      rules: [{ label: "Retest" }],
    }]);
    expect(session.endSession).toHaveBeenCalled();
  });
});
