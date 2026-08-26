jest.mock("../../models/SetupStrategy", () => {
  function SetupStrategyMock(doc) {
    Object.assign(this, doc);
  }
  SetupStrategyMock.prototype.validateSync = jest.fn(() => undefined);
  SetupStrategyMock.find = jest.fn();
  SetupStrategyMock.deleteMany = jest.fn();
  SetupStrategyMock.insertMany = jest.fn();
  SetupStrategyMock.bulkWrite = jest.fn();
  return SetupStrategyMock;
});

const SetupStrategy = require("../../models/SetupStrategy");
const mongoose = require("mongoose");
const setupRepository = require("../../repositories/setup.repository");

// find(...).sort(...) resolves to the given documents.
function mockFindResults(...results) {
  SetupStrategy.find.mockReset();
  results.forEach((docs) => {
    SetupStrategy.find.mockImplementationOnce(() => ({
      sort: jest.fn().mockResolvedValue(docs),
    }));
  });
}

function transactionalSession() {
  return { withTransaction: async (work) => work(), endSession: jest.fn() };
}

describe("setup repository", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    SetupStrategy.deleteMany.mockResolvedValue({ deletedCount: 0 });
    SetupStrategy.insertMany.mockImplementation(async (docs) => docs);
    SetupStrategy.bulkWrite.mockResolvedValue({});
  });

  it("reconstructs new setup documents with server-owned user and market", async () => {
    jest.spyOn(mongoose, "startSession").mockResolvedValue(transactionalSession());
    mockFindResults([], []);

    await setupRepository.applySetupsDiff("user-1", "Forex", [{
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
        rules: [{ label: "Retest" }],
        referenceImages: [],
      }],
      expect.objectContaining({ session: expect.anything() })
    );
  });

  it("updates a matched strategy in place instead of recreating it", async () => {
    // Regression guard: recreating the document changed its _id on every save,
    // which silently broke ChecklistNotificationSetting.strategyId.
    jest.spyOn(mongoose, "startSession").mockResolvedValue(transactionalSession());
    const existing = { _id: "strategy-1", name: "Breakout", referenceImages: [], rules: [] };
    mockFindResults([existing], [existing]);

    const result = await setupRepository.applySetupsDiff("user-1", "Forex", [{
      _id: "strategy-1",
      name: "Breakout",
      referenceImages: [],
      rules: [{ label: "Retest" }],
    }]);

    expect(SetupStrategy.insertMany).not.toHaveBeenCalled();
    expect(SetupStrategy.deleteMany).not.toHaveBeenCalled();
    expect(SetupStrategy.bulkWrite).toHaveBeenCalledWith(
      [expect.objectContaining({
        updateOne: expect.objectContaining({
          filter: { _id: "strategy-1", user: "user-1" },
        }),
      })],
      expect.anything()
    );
    expect(result.deletedIds).toEqual([]);
  });

  it("reports deletions and renames so callers can reconcile references", async () => {
    jest.spyOn(mongoose, "startSession").mockResolvedValue(transactionalSession());
    const keep = { _id: "strategy-1", name: "Breakout", referenceImages: [], rules: [] };
    const drop = { _id: "strategy-2", name: "Pullback", referenceImages: [], rules: [] };
    mockFindResults([keep, drop], [keep]);

    const result = await setupRepository.applySetupsDiff("user-1", "Forex", [{
      _id: "strategy-1",
      name: "Breakout v2",
      referenceImages: [],
      rules: [],
    }]);

    expect(result.deletedIds).toEqual(["strategy-2"]);
    expect(result.renamed).toEqual([{ id: "strategy-1", from: "Breakout", to: "Breakout v2" }]);
  });

  it("falls back to a non-transactional apply on standalone MongoDB", async () => {
    const session = {
      withTransaction: jest.fn(async () => {
        throw new Error("Transaction numbers are only allowed on a replica set member or mongos");
      }),
      endSession: jest.fn(),
    };
    jest.spyOn(mongoose, "startSession").mockResolvedValue(session);
    const saved = [{ user: "user-1", marketType: "Forex", name: "Breakout", rules: [{ label: "Retest" }], referenceImages: [] }];
    mockFindResults([], saved);

    const result = await setupRepository.applySetupsDiff("user-1", "Forex", [{
      name: "Breakout",
      referenceImages: [],
      rules: [{ label: "Retest" }],
    }]);

    expect(SetupStrategy.insertMany).toHaveBeenLastCalledWith(
      [{
        user: "user-1",
        marketType: "Forex",
        name: "Breakout",
        rules: [{ label: "Retest" }],
        referenceImages: [],
      }],
      {}
    );
    expect(result.strategies).toEqual(saved);
    expect(session.endSession).toHaveBeenCalled();
  });
});
