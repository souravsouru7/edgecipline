jest.mock("../../models/DeviceToken", () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
}));
jest.mock("../../models/NotificationPreference", () => ({
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../models/Users", () => ({ updateOne: jest.fn().mockResolvedValue({}) }));
jest.mock("../../services/notificationService", () => ({}));
jest.mock("../../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const DeviceToken = require("../../models/DeviceToken");
const NotificationPreference = require("../../models/NotificationPreference");
const User = require("../../models/Users");
const {
  registerDeviceToken,
  updateNotificationPreferences,
  validTimezone,
} = require("../../controllers/deviceTokenController");

function res() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
  NotificationPreference.findOneAndUpdate.mockReturnValue({ lean: async () => ({ ok: true }) });
  DeviceToken.findOne.mockReturnValue({ select: () => ({ lean: async () => null }) });
  DeviceToken.findOneAndUpdate.mockReturnValue({ lean: async () => ({ _id: "t1", platform: "android" }) });
});

describe("timezone capture on push registration", () => {
  it("accepts real IANA zones and rejects garbage", () => {
    expect(validTimezone("Europe/London")).toBe("Europe/London");
    expect(validTimezone("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(validTimezone("IST")).toBeNull();
    expect(validTimezone("+05:30")).toBeNull();
    expect(validTimezone("Not/AZone")).toBeNull();
    expect(validTimezone(42)).toBeNull();
  });

  it("writes the device timezone to both the user and quiet-hours preference", async () => {
    await registerDeviceToken({ user: { _id: "u1" }, body: { token: "fcm", timezone: "Europe/London" } }, res(), jest.fn());
    expect(User.updateOne).toHaveBeenCalledWith({ _id: "u1" }, { $set: { "streaks.timezone": "Europe/London" } });
    expect(NotificationPreference.updateOne).toHaveBeenCalledWith(
      { user: "u1" },
      expect.objectContaining({ $set: { "quietHours.timezone": "Europe/London" } }),
      { upsert: true }
    );
  });

  it("ignores an invalid timezone without failing the registration", async () => {
    const r = res();
    await registerDeviceToken({ user: { _id: "u1" }, body: { token: "fcm", timezone: "garbage" } }, r, jest.fn());
    expect(User.updateOne).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(201);
  });
});

describe("updateNotificationPreferences", () => {
  async function update(body) {
    const next = jest.fn();
    await updateNotificationPreferences({ user: { _id: "u1" }, body }, res(), next);
    return next;
  }
  const setOf = () => NotificationPreference.findOneAndUpdate.mock.calls[0][1].$set;

  it("saves the flags that used to be silently dropped, plus the new ones", async () => {
    await update({ streakProtection: false, eveningReflection: false, supportUpdates: false, dailyLossWarning: false, promotions: false });
    expect(setOf()).toEqual({
      streakProtection: false, eveningReflection: false, supportUpdates: false, dailyLossWarning: false, promotions: false,
    });
  });

  it("merges quiet hours field by field (enabling no longer wipes start/end)", async () => {
    await update({ quietHours: { enabled: true } });
    expect(setOf()).toEqual({ "quietHours.enabled": true });
  });

  it("validates quiet-hour times and timezone, and syncs the timezone to the user", async () => {
    await update({ quietHours: { start: "23:00", end: "06:30", timezone: "Asia/Dubai" } });
    expect(setOf()).toEqual({ "quietHours.start": "23:00", "quietHours.end": "06:30", "quietHours.timezone": "Asia/Dubai" });
    expect(User.updateOne).toHaveBeenCalledWith({ _id: "u1" }, { $set: { "streaks.timezone": "Asia/Dubai" } });
  });

  it.each([
    [{ quietHours: { start: "99:99" } }],
    [{ quietHours: { timezone: "IST" } }],
    [{ quietHours: "on" }],
    [{ pushEnabled: "false" }],
  ])("rejects invalid input %j", async (body) => {
    const next = await update(body);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(NotificationPreference.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("ignores unknown keys", async () => {
    await update({ hacked: true, pushEnabled: true });
    expect(setOf()).toEqual({ pushEnabled: true });
  });
});
