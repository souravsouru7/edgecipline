jest.mock("../../models/DeviceToken", () => ({
  find: jest.fn(),
  updateMany: jest.fn(),
}));
jest.mock("../../models/NotificationHistory", () => ({
  create: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateMany: jest.fn(),
}));
jest.mock("../../models/NotificationPreference", () => ({ findOneAndUpdate: jest.fn() }));
jest.mock("../../config/firebaseAdmin", () => ({ getFirebaseAdmin: jest.fn() }));
jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const DeviceToken = require("../../models/DeviceToken");
const NotificationHistory = require("../../models/NotificationHistory");
const NotificationPreference = require("../../models/NotificationPreference");
const { getFirebaseAdmin } = require("../../config/firebaseAdmin");
const { notifyUser } = require("../../services/notificationService");

function document(overrides = {}) {
  const value = {
    _id: "notification-1",
    user: "user-1",
    type: "system",
    title: "Title",
    body: "Body",
    delivery: { acceptedTokenIds: [] },
    sentAt: null,
    ...overrides,
  };
  value.toObject = () => ({ ...value });
  return value;
}

function mockTokens(tokens) {
  DeviceToken.find.mockReturnValue({
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(tokens) }),
  });
}

describe("notification delivery reliability", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    NotificationPreference.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        inAppEnabled: true,
        pushEnabled: true,
        smartCoach: true,
        quietHours: { enabled: false },
      }),
    });
    DeviceToken.updateMany.mockResolvedValue({ modifiedCount: 0 });
  });

  it("throws transient FCM failures so BullMQ retries the job", async () => {
    const created = document();
    NotificationHistory.create.mockResolvedValue(created);
    NotificationHistory.findOneAndUpdate
      .mockResolvedValueOnce(document({ status: "sending" }))
      .mockResolvedValueOnce(document({ status: "failed" }))
      .mockResolvedValueOnce(document({ status: "failed" }));
    mockTokens([{ _id: "token-1", token: "fcm-1", platform: "android" }]);
    getFirebaseAdmin.mockReturnValue({
      messaging: () => ({
        sendEachForMulticast: jest.fn().mockResolvedValue({
          successCount: 0,
          failureCount: 1,
          responses: [{ error: { code: "messaging/server-unavailable" } }],
        }),
      }),
    });

    await expect(notifyUser("user-1", {
      type: "system", title: "Title", body: "Body", dedupeKey: "system:1",
    })).rejects.toMatchObject({ code: "FCM_TRANSIENT_FAILURE" });

    expect(NotificationHistory.findOneAndUpdate).toHaveBeenLastCalledWith(
      { _id: "notification-1", user: "user-1" },
      expect.objectContaining({ status: "failed", deliveryLeaseUntil: null }),
    );
  });

  it("does not resend to tokens that already accepted a partial delivery", async () => {
    NotificationHistory.create.mockRejectedValue({ code: 11000 });
    const partial = document({
      status: "partial",
      sentAt: new Date("2026-01-01T00:00:00Z"),
      delivery: { acceptedTokenIds: ["token-a"] },
    });
    NotificationHistory.findOne.mockResolvedValue(partial);
    NotificationHistory.findOneAndUpdate
      .mockResolvedValueOnce(partial)
      .mockResolvedValueOnce(document({ status: "sent" }));
    mockTokens([]);

    await expect(notifyUser("user-1", {
      type: "system", title: "Title", body: "Body", dedupeKey: "system:1",
    })).resolves.toMatchObject({ status: "sent" });

    expect(DeviceToken.find).toHaveBeenCalledWith(expect.objectContaining({
      user: "user-1",
      _id: { $nin: ["token-a"] },
    }));
  });
});
