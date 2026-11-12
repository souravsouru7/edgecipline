// Gates and payload rules added to notifyUser / sendPushToUser.
const mockUser = { accountStatus: "active", pendingDeletion: false };
jest.mock("../../models/Users", () => ({
  findById: jest.fn(() => ({ select: () => ({ lean: async () => mockUser }) })),
}));
jest.mock("../../models/DeviceToken", () => ({ find: jest.fn(), updateMany: jest.fn().mockResolvedValue({}) }));
jest.mock("../../models/NotificationHistory", () => ({
  exists: jest.fn().mockResolvedValue(null),
  countDocuments: jest.fn().mockResolvedValue(0),
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
const { logger } = require("../../utils/logger");
const {
  buildAndroidConfig,
  buildApnsConfig,
  notifyUser,
  SKIP_REASONS,
} = require("../../services/notificationService");

const USER = "507f1f77bcf86cd799439011";

function prefs(overrides = {}) {
  return {
    inAppEnabled: true, pushEnabled: true, smartCoach: true, promotions: true,
    sessionReminders: true, quietHours: { enabled: false, timezone: "Asia/Kolkata" },
    ...overrides,
  };
}

function row(overrides = {}) {
  const value = { _id: "n1", user: USER, status: "created", delivery: {}, ...overrides };
  value.toObject = () => ({ ...value });
  return value;
}

function mockTokens(tokens) {
  DeviceToken.find.mockReturnValue({ select: () => ({ lean: async () => tokens }) });
}

function skippedWith(reason) {
  return logger.info.mock.calls.some(([event, fields]) => event === "NOTIFICATION_SKIPPED" && fields.reason === reason);
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockUser, { accountStatus: "active", pendingDeletion: false });
  NotificationPreference.findOneAndUpdate.mockReturnValue({ lean: async () => prefs() });
  NotificationHistory.exists.mockResolvedValue(null);
  NotificationHistory.countDocuments.mockResolvedValue(0);
  NotificationHistory.create.mockImplementation(async (doc) => row(doc));
  NotificationHistory.findOneAndUpdate.mockImplementation(async (filter, update) => row({ ...(update.$set || update) }));
});

describe("payloads", () => {
  it("Android: no clickAction (it pointed at an intent nothing handles), per-type ttl and collapse key", () => {
    const cfg = buildAndroidConfig({ type: "session_reminder", _id: "n1" });
    expect(cfg.notification.clickAction).toBeUndefined();
    expect(cfg.ttl).toBe(30 * 60 * 1000);
    expect(cfg.collapseKey).toBe("edgecipline_session_reminder");
    expect(cfg.notification.tag).toBe("edgecipline_session_reminder");
  });

  it("Android: one-off alerts keep a unique tag so they don't overwrite each other", () => {
    const cfg = buildAndroidConfig({ type: "revenge_trading", _id: "abc" });
    expect(cfg.collapseKey).toBeUndefined();
    expect(cfg.notification.tag).toBe("edgecipline_abc");
    expect(cfg.priority).toBe("high");
  });

  it("iOS: sound + expiry matching the type's ttl", () => {
    const now = Date.UTC(2026, 10, 8, 12);
    const cfg = buildApnsConfig({ type: "session_reminder" }, now);
    expect(cfg.payload.aps.sound).toBe("default");
    expect(Number(cfg.headers["apns-expiration"])).toBe(Math.floor((now + 30 * 60 * 1000) / 1000));
    expect(cfg.headers["apns-collapse-id"]).toBe("edgecipline_session_reminder");
  });
});

describe("gates", () => {
  it("skips disabled and pending-deletion accounts before creating anything", async () => {
    mockUser.accountStatus = "disabled";
    expect(await notifyUser(USER, { type: "session_reminder", title: "t", body: "b", dedupeKey: "k1" })).toBeNull();
    expect(NotificationHistory.create).not.toHaveBeenCalled();
    expect(skippedWith(SKIP_REASONS.ACCOUNT_INACTIVE)).toBe(true);

    jest.clearAllMocks();
    Object.assign(mockUser, { accountStatus: "active", pendingDeletion: true });
    expect(await notifyUser(USER, { type: "morning_mentor", title: "t", body: "b", dedupeKey: "k2" })).toBeNull();
    expect(NotificationHistory.create).not.toHaveBeenCalled();
  });

  it("holds promotions outside 09:00–21:00 in the user's timezone", async () => {
    jest.useFakeTimers().setSystemTime(new Date(Date.UTC(2026, 10, 8, 20, 0))); // 01:30 IST
    try {
      expect(await notifyUser(USER, { type: "free_tier_d_plus_1", title: "t", body: "b", dedupeKey: "k3" })).toBeNull();
      expect(skippedWith(SKIP_REASONS.OUTSIDE_PROMO_WINDOW)).toBe(true);
      expect(NotificationHistory.create).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("respects the promotions opt-out", async () => {
    NotificationPreference.findOneAndUpdate.mockReturnValue({ lean: async () => prefs({ promotions: false }) });
    expect(await notifyUser(USER, { type: "renewal_d_minus_1", title: "t", body: "b", dedupeKey: "k4" })).toBeNull();
    expect(skippedWith(SKIP_REASONS.PREFERENCE_DISABLED)).toBe(true);
  });

  it("caps non-essential pushes per local day but never risk alerts", async () => {
    NotificationHistory.countDocuments.mockResolvedValue(6);
    expect(await notifyUser(USER, { type: "evening_reflection", title: "t", body: "b", dedupeKey: "k5" })).toBeNull();
    expect(skippedWith(SKIP_REASONS.DAILY_CAP)).toBe(true);

    mockTokens([]);
    await notifyUser(USER, { type: "revenge_trading", title: "t", body: "b", dedupeKey: "k6" });
    expect(NotificationHistory.create).toHaveBeenCalledTimes(1);
  });

  it("never caps a retry of a row that already exists", async () => {
    NotificationHistory.countDocuments.mockResolvedValue(99);
    NotificationHistory.exists.mockResolvedValue({ _id: "n1" });
    mockTokens([]);
    await notifyUser(USER, { type: "session_reminder", title: "t", body: "b", dedupeKey: "k7" });
    expect(NotificationHistory.create).toHaveBeenCalled();
  });

  it("turning off the smart coach no longer silences scheduled reminders", async () => {
    NotificationPreference.findOneAndUpdate.mockReturnValue({ lean: async () => prefs({ smartCoach: false }) });
    mockTokens([]);
    await notifyUser(USER, { type: "session_reminder", title: "t", body: "b", dedupeKey: "k8" });
    expect(NotificationHistory.create).toHaveBeenCalled();
    jest.clearAllMocks();
    NotificationPreference.findOneAndUpdate.mockReturnValue({ lean: async () => prefs({ smartCoach: false }) });
    expect(await notifyUser(USER, { type: "revenge_trading", title: "t", body: "b", dedupeKey: "k9" })).toBeNull();
  });
});

describe("invalid-argument handling", () => {
  function fcm(responses) {
    getFirebaseAdmin.mockReturnValue({
      messaging: () => ({
        sendEachForMulticast: jest.fn().mockResolvedValue({
          responses,
          successCount: responses.filter((r) => !r.error).length,
          failureCount: responses.filter((r) => r.error).length,
        }),
      }),
    });
  }

  it("a payload rejected on every token does NOT disable the user's devices", async () => {
    mockTokens([{ _id: "t1", token: "aaa" }, { _id: "t2", token: "bbb" }]);
    fcm([{ error: { code: "messaging/invalid-argument" } }, { error: { code: "messaging/invalid-argument" } }]);
    await notifyUser(USER, { type: "payment", title: "t", body: "b", dedupeKey: "k10" });
    const disableCall = DeviceToken.updateMany.mock.calls.find(([, update]) => update.enabled === false);
    expect(disableCall).toBeUndefined();
  });

  it("invalid-argument on only one token disables just that token", async () => {
    mockTokens([{ _id: "t1", token: "aaa" }, { _id: "t2", token: "bbb" }]);
    fcm([{}, { error: { code: "messaging/invalid-argument" } }]);
    await notifyUser(USER, { type: "payment", title: "t", body: "b", dedupeKey: "k11" });
    const disableCall = DeviceToken.updateMany.mock.calls.find(([, update]) => update.enabled === false);
    expect(disableCall[0]).toEqual({ token: { $in: ["bbb"] } });
  });
});
