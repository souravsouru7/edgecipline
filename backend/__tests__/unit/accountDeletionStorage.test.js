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
      "SupportTicket",
      "SupportAuditLog",
      "ArticleFeedback",
      "AttributionTouch",
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
    // Detached rather than purged, so it needs updateMany rather than the
    // deleteMany makeModel() provides.
    const PlaySubscription = {
      modelName: "PlaySubscription",
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 2 }),
    };
    const OCRJob = makeModel("OCRJob");
    // Support attachments are private customer data stored on Cloudinary under
    // a different shape to trade images, so they need their own sweep.
    const SupportMessage = {
      ...makeModel("SupportMessage"),
      find: jest.fn(() => queryResult([
        { attachments: [{ publicId: "support/c" }, { publicId: "shared/dup" }] },
        { attachments: [] },
      ])),
    };
    const destroyImages = jest.fn().mockResolvedValue({ destroyed: 4, failed: 0 });

    jest.doMock("../../models/Users", () => Users);
    jest.doMock("../../models/Trade", () => Trade);
    jest.doMock("../../models/IndianTrade", () => IndianTrade);
    jest.doMock("../../models/RefreshToken", () => RefreshToken);
    jest.doMock("../../models/PlaySubscription", () => PlaySubscription);
    jest.doMock("../../models/SupportMessage", () => SupportMessage);
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

    // Detached, never deleted — the row is what keeps the purchase token spent.
    expect(PlaySubscription.updateMany).toHaveBeenCalledWith(
      { user: userId },
      { $set: { user: null } }
    );
    expect(PlaySubscription.deleteMany).toBeUndefined();
    expect(result.playSubscriptionsDetached).toBe(2);

    expect(Trade.find).toHaveBeenCalledWith({ user: userId });
    expect(IndianTrade.find).toHaveBeenCalledWith({ user: userId });
    // Keyed on ticketUser (the customer), not author — an agent's reply on
    // this customer's ticket carries attachments that belong to the customer.
    expect(SupportMessage.find).toHaveBeenCalledWith({
      ticketUser: userId,
      "attachments.0": { $exists: true },
    });
    expect(destroyImages).toHaveBeenCalledWith([
      "trade/a",
      "shared/dup",
      "indian/b",
      "support/c",
    ]);
    expect(Users.deleteOne).toHaveBeenCalledWith({ _id: userId });
    expect(result.images).toEqual({ destroyed: 4, failed: 0 });
  });
});
