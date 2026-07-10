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
const { registerDeviceToken } = require("../../controllers/deviceTokenController");

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
});
