"use strict";

function makeModel(modelName) {
  return {
    modelName,
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
  };
}

function queryResult(value) {
  const query = {
    select: jest.fn(() => query),
    lean: jest.fn().mockResolvedValue(value),
  };
  return query;
}

describe("account deletion storage cleanup", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test("collects trade image public IDs before purging records and destroys them", async () => {
    const models = new Map();
    const modelNames = [
      "AnalyticsEvent",
      "ChecklistNotificationSetting",
      "ChecklistTracking",
      "CoachConversation",
      "CoachMessage",
      "DailyDisciplineEntry",
      "DailyReflection",
      "DeviceToken",
      "ExtractionLog",
      "Feedback",
      "IssueReport",
      "MissionAssignment",
      "NotificationDebugLog",
      "NotificationHistory",
      "NotificationPreference",
      "RescueDispatch",
      "SetupStrategy",
      "TradingDnaReport",
      "WeeklyReport",
      "Notification",
    ];

    for (const name of modelNames) {
      const model = makeModel(name);
      models.set(name, model);
      jest.doMock(`../../models/${name}`, () => model);
    }

    const userId = "507f1f77bcf86cd799439011";
    const Users = {
      findById: jest.fn(() => queryResult({ email: "deleted@example.com", name: "Deleted User" })),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    const Trade = {
      ...makeModel("Trade"),
      find: jest.fn(() => queryResult([
        { tradeImages: [{ publicId: "trade/a" }, { publicId: "shared/dup" }] },
      ])),
    };
    const IndianTrade = {
      ...makeModel("IndianTrade"),
      find: jest.fn(() => queryResult([
        { tradeImages: [{ publicId: "indian/b" }, { publicId: "shared/dup" }] },
      ])),
    };
    const RefreshToken = makeModel("RefreshToken");
    const OCRJob = makeModel("OCRJob");
    const destroyImages = jest.fn().mockResolvedValue({ destroyed: 3, failed: 0 });

    jest.doMock("../../models/Users", () => Users);
    jest.doMock("../../models/Trade", () => Trade);
    jest.doMock("../../models/IndianTrade", () => IndianTrade);
    jest.doMock("../../models/RefreshToken", () => RefreshToken);
    jest.doMock("../../models/OCRJob", () => ({ OCRJob }));
    jest.doMock("../../utils/cloudinaryHelpers", () => ({ destroyImages }));
    jest.doMock("../../config/firebaseAdmin", () => ({
      getFirebaseAdmin: jest.fn(() => ({
        auth: () => ({
          getUserByEmail: jest.fn().mockRejectedValue({ code: "auth/user-not-found" }),
          deleteUser: jest.fn(),
        }),
      })),
    }));
    jest.doMock("../../utils/logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    }));

    const { deleteAccount } = require("../../services/accountDeletionService");

    const result = await deleteAccount(userId);

    expect(Trade.find).toHaveBeenCalledWith({ user: userId });
    expect(IndianTrade.find).toHaveBeenCalledWith({ user: userId });
    expect(destroyImages).toHaveBeenCalledWith(["trade/a", "shared/dup", "indian/b"]);
    expect(Users.deleteOne).toHaveBeenCalledWith({ _id: userId });
    expect(result.images).toEqual({ destroyed: 3, failed: 0 });
  });
});
