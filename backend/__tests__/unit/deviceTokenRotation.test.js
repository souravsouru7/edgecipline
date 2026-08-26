jest.mock("../../models/DeviceToken", () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateMany: jest.fn(),
}));
jest.mock("../../services/notificationService", () => ({}));
jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const DeviceToken = require("../../models/DeviceToken");
const { registerDeviceToken, unregisterDeviceToken } = require("../../controllers/deviceTokenController");

describe("device token rotation", () => {
  it("revokes only older tokens from the same physical device", async () => {
    DeviceToken.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    });
    DeviceToken.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: "new-token", platform: "android" }),
    });
    DeviceToken.updateMany.mockResolvedValue({ modifiedCount: 1 });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await registerDeviceToken({
      user: { _id: "user-a" },
      body: { token: "new-fcm", platform: "android", deviceId: "phone-a" },
    }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(DeviceToken.updateMany).toHaveBeenCalledWith(
      {
        user: "user-a",
        platform: "android",
        deviceId: "phone-a",
        token: { $ne: "new-fcm" },
        enabled: true,
      },
      { $set: { enabled: false, revokedAt: expect.any(Date) } },
    );
  });

  it("does not revoke sibling devices when a legacy client has no deviceId", async () => {
    DeviceToken.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    });
    DeviceToken.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: "new-token", platform: "android" }),
    });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await registerDeviceToken({
      user: { _id: "user-a" }, body: { token: "legacy-fcm", platform: "android" },
    }, res, jest.fn());

    expect(DeviceToken.updateMany).not.toHaveBeenCalled();
  });

  it("registers device tokens to the authenticated user, ignoring body owner fields", async () => {
    DeviceToken.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    });
    DeviceToken.findOneAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: "new-token", platform: "android" }),
    });
    DeviceToken.updateMany.mockResolvedValue({ modifiedCount: 0 });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await registerDeviceToken({
      user: { _id: "user-a" },
      body: {
        token: "new-fcm",
        platform: "android",
        deviceId: "phone-a",
        user: "user-b",
        userId: "user-b",
      },
    }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(DeviceToken.findOneAndUpdate).toHaveBeenCalledWith(
      { token: "new-fcm" },
      expect.objectContaining({
        $set: expect.objectContaining({ user: "user-a" }),
      }),
      expect.objectContaining({ upsert: true })
    );
  });

  it("unregisters only tokens owned by the authenticated user", async () => {
    DeviceToken.findOneAndUpdate.mockResolvedValue(null);
    const res = { json: jest.fn() };
    const next = jest.fn();

    await unregisterDeviceToken({
      user: { _id: "user-a" },
      body: { token: "other-user-token", user: "user-b" },
    }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(DeviceToken.findOneAndUpdate).toHaveBeenCalledWith(
      { token: "other-user-token", user: "user-a" },
      { enabled: false, revokedAt: expect.any(Date) }
    );
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});
