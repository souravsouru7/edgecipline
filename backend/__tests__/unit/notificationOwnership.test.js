jest.mock("../../models/NotificationHistory", () => ({
  countDocuments: jest.fn(),
  find: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateMany: jest.fn(),
}));

jest.mock("../../models/DeviceToken", () => ({
  find: jest.fn(),
  updateMany: jest.fn(),
}));

jest.mock("../../models/NotificationPreference", () => ({
  findOneAndUpdate: jest.fn(),
}));

jest.mock("../../config/firebaseAdmin", () => ({
  getFirebaseAdmin: jest.fn(),
}));

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../../models/Notification", () => ({
  find: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateMany: jest.fn(),
}));

jest.mock("../../models/Users", () => ({ find: jest.fn() }));
jest.mock("../../queues/smartNotificationQueue", () => ({
  enqueueNotificationDelivery: jest.fn(),
}));

const Notification = require("../../models/Notification");
const NotificationHistory = require("../../models/NotificationHistory");
const notificationService = require("../../services/notificationService");
const notificationController = require("../../controllers/notificationController");

function invoke(handler, req) {
  const res = { json: jest.fn() };
  const next = jest.fn();
  return handler(req, res, next).then(() => ({ res, next }));
}

describe("notification ownership", () => {
  it("marks only User A notifications as read", async () => {
    const notifications = [
      { user: "user-a", isRead: false },
      { user: "user-a", isRead: false },
      { user: "user-b", isRead: false },
    ];

    NotificationHistory.updateMany.mockImplementation(async (filter, update) => {
      for (const notification of notifications) {
        if (notification.user === filter.user && notification.isRead === filter.isRead) {
          Object.assign(notification, update);
        }
      }
    });

    await notificationService.markAllAsRead("user-a");

    expect(NotificationHistory.updateMany).toHaveBeenCalledWith(
      { user: "user-a", isRead: false },
      expect.objectContaining({ isRead: true, readAt: expect.any(Date) })
    );
    expect(notifications).toEqual([
      expect.objectContaining({ user: "user-a", isRead: true }),
      expect.objectContaining({ user: "user-a", isRead: true }),
      expect.objectContaining({ user: "user-b", isRead: false }),
    ]);
  });

  it("lists only the authenticated user's notification records", async () => {
    const items = [{ _id: "notification-a", user: "user-a", isRead: false }];
    const lean = jest.fn().mockResolvedValue(items);
    const limit = jest.fn().mockReturnValue({ lean });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    NotificationHistory.find.mockReturnValue({ sort });
    NotificationHistory.countDocuments.mockResolvedValue(1);

    const result = await notificationService.listUserNotifications("user-a", {
      page: 1,
      limit: 10,
      unreadOnly: true,
    });

    expect(NotificationHistory.find).toHaveBeenCalledWith({ user: "user-a", isRead: false });
    expect(NotificationHistory.countDocuments).toHaveBeenCalledWith({ user: "user-a", isRead: false });
    expect(result.items).toBe(items);
  });

  it("fails closed instead of issuing a bulk update without an owner", async () => {
    await expect(notificationService.markAllAsRead(undefined)).rejects.toThrow(
      "A user ID is required"
    );
    expect(NotificationHistory.updateMany).not.toHaveBeenCalled();
  });

  it("cannot mark another user's individual notification as read", async () => {
    NotificationHistory.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    await expect(
      notificationService.markAsRead("user-a", "user-b-notification")
    ).resolves.toBeNull();

    expect(NotificationHistory.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "user-b-notification", user: "user-a" },
      { isRead: true, readAt: expect.any(Date) },
      { returnDocument: "after" }
    );
  });

  it.each([
    ["delivered", () => notificationService.trackDelivered("user-a", "user-b-notification")],
    ["opened", () => notificationService.trackOpen("user-a", "user-b-notification")],
    ["action", () => notificationService.trackAction("user-a", "user-b-notification", "cta")],
  ])("cannot track another user's notification as %s", async (_name, run) => {
    NotificationHistory.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });

    await expect(run()).resolves.toBeNull();

    expect(NotificationHistory.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "user-b-notification", user: "user-a" }),
      expect.anything(),
      { returnDocument: "after" }
    );
  });

  it("scopes an admin bulk update to the requested target user", async () => {
    Notification.updateMany.mockResolvedValue({ modifiedCount: 2 });
    const targetUserId = "507f1f77bcf86cd799439011";

    const { next } = await invoke(notificationController.markAllAsRead, {
      user: { _id: "507f1f77bcf86cd799439012" },
      body: { userId: targetUserId },
    });

    expect(next).not.toHaveBeenCalled();
    expect(Notification.updateMany).toHaveBeenCalledWith(
      { userId: targetUserId, isRead: false },
      { isRead: true }
    );
  });

  it("does not incorrectly scope an admin update to the admin's user ID", async () => {
    Notification.findOneAndUpdate.mockResolvedValue({ _id: "notification-a" });

    const { next } = await invoke(notificationController.markAsRead, {
      user: { _id: "507f1f77bcf86cd799439012" },
      params: { id: "507f1f77bcf86cd799439013" },
    });

    expect(next).not.toHaveBeenCalled();
    expect(Notification.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "507f1f77bcf86cd799439013" },
      { isRead: true },
      { returnDocument: "after" }
    );
  });
});
