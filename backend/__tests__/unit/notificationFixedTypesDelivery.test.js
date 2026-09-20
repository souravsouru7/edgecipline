/**
 * End-to-end through the real notifyUser for the five types that used to die
 * on schema validation: history row (validated against the real schema) →
 * preference gate → FCM payload (channel, deep link, data) → status.
 */
jest.mock("../../models/DeviceToken", () => ({
  find: jest.fn(),
  updateMany: jest.fn().mockResolvedValue({}),
}));

jest.mock("../../models/NotificationHistory", () => {
  const Actual = jest.requireActual("../../models/NotificationHistory");
  const store = new Map();
  let seq = 0;
  const mock = {
    __store: store,
    create: jest.fn(async (doc) => {
      const err = new Actual(doc).validateSync();
      if (err) throw err;
      const key = `${doc.user}:${doc.dedupeKey}`;
      if (store.has(key)) {
        const dup = new Error("E11000 duplicate key");
        dup.code = 11000;
        throw dup;
      }
      const row = { _id: `n${++seq}`, status: "created", delivery: {}, ...doc, toObject() { return { ...this }; } };
      store.set(key, row);
      return row;
    }),
    findOne: jest.fn(async ({ user, dedupeKey }) => store.get(`${user}:${dedupeKey}`) || null),
    findOneAndUpdate: jest.fn(async (filter, update) => {
      const row = [...store.values()].find((r) => r._id === filter._id);
      if (!row) return null;
      if (filter.status && !filter.status.$in.includes(row.status)) return null;
      const set = update.$set || update;
      Object.assign(row, set);
      if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) row[k] = (row[k] || 0) + v;
      return { ...row, toObject() { return { ...row }; } };
    }),
    updateMany: jest.fn(),
  };
  return mock;
});

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
const { notifyUser, SKIP_REASONS } = require("../../services/notificationService");
const streak = require("../../services/streakNotification.service");
const { sendMissionNotification } = require("../../services/missionNotificationService");

const USER = "507f1f77bcf86cd799439011";

function prefs(overrides = {}) {
  return {
    inAppEnabled: true, pushEnabled: true, smartCoach: true,
    streakProtection: true, eveningReflection: true, sessionReminders: true,
    supportUpdates: true, quietHours: { enabled: false },
    ...overrides,
  };
}
function mockPrefs(p) {
  NotificationPreference.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(p) });
}
function mockTokens(tokens) {
  DeviceToken.find.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(tokens) }) });
}
let sendEachForMulticast;
function mockFcm(responses) {
  sendEachForMulticast = jest.fn().mockResolvedValue({
    successCount: responses.filter((r) => !r.error).length,
    failureCount: responses.filter((r) => r.error).length,
    responses,
  });
  getFirebaseAdmin.mockReturnValue({ messaging: () => ({ sendEachForMulticast }) });
}

beforeEach(() => {
  jest.clearAllMocks();
  NotificationHistory.__store.clear();
  mockPrefs(prefs());
  mockTokens([{ _id: "t1", token: "tok-1", platform: "android" }]);
  mockFcm([{}]);
});

const CASES = [
  { type: "streak_milestone", channel: "edgecipline_coaching", pref: "streakProtection", send: () => streak.sendMilestone(USER, 7), deepLink: "/streaks" },
  { type: "streak_at_risk",   channel: "edgecipline_coaching", pref: "streakProtection", send: () => streak.sendAtRisk(USER, { currentStreak: 5, dayKey: "2026-09-21" }), deepLink: "/streaks" },
  { type: "streak_broken",    channel: "edgecipline_coaching", pref: "streakProtection", send: () => streak.sendBroken(USER, 9), deepLink: "/streaks" },
  { type: "evening_reflection", channel: "edgecipline_coaching", pref: "eveningReflection",
    send: () => notifyUser(USER, { type: "evening_reflection", title: "Close the day.", body: "…", sourceType: "cron", dedupeKey: `evening-reflection:${USER}:2026-09-21`, deepLink: "/reflection", data: { screen: "reflection" } }),
    deepLink: "/reflection" },
  { type: "mission_update",   channel: "edgecipline_coaching", pref: "smartCoach",
    send: () => sendMissionNotification(USER, { _id: "64b000000000000000000009", missionSnapshot: { name: "Log 5 trades", target: 5, unit: "trades" }, currentProgress: 5 }, "completed"),
    deepLink: "/missions" },
];

describe.each(CASES)("$type end-to-end", ({ type, channel, pref, send, deepLink }) => {
  it("persists, passes the gate, reaches FCM on the right channel with a deep link", async () => {
    await send();
    expect(NotificationHistory.create).toHaveBeenCalledWith(expect.objectContaining({ type, deepLink }));
    expect(sendEachForMulticast).toHaveBeenCalledTimes(1);
    const msg = sendEachForMulticast.mock.calls[0][0];
    expect(msg.tokens).toEqual(["tok-1"]);
    expect(msg.data.type).toBe(type);
    expect(msg.data.deepLink).toBe(deepLink);
    expect(msg.data.notificationId).toBeTruthy();
    expect(msg.android.notification.channelId).toBe(channel);
    const row = [...NotificationHistory.__store.values()][0];
    expect(row.status).toBe("sent");
    expect(row.sentAt).toBeInstanceOf(Date);
  });

  it(`is silenced by ${pref}=false (row not written, reason logged)`, async () => {
    mockPrefs(prefs({ [pref]: false }));
    await send();
    expect(NotificationHistory.create).not.toHaveBeenCalled();
    expect(sendEachForMulticast).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("NOTIFICATION_SKIPPED", expect.objectContaining({
      notificationType: type, reason: SKIP_REASONS.PREFERENCE_DISABLED,
    }));
  });

  it("keeps the inbox row but skips push during quiet hours", async () => {
    mockPrefs(prefs({ quietHours: { enabled: true, start: "00:00", end: "23:59", timezone: "Asia/Kolkata" } }));
    await send();
    expect(sendEachForMulticast).not.toHaveBeenCalled();
    const row = [...NotificationHistory.__store.values()][0];
    expect(row.status).toBe("skipped");
    expect(row["delivery.error"]).toBe("quiet_hours");
    expect(logger.info).toHaveBeenCalledWith("NOTIFICATION_SKIPPED", expect.objectContaining({
      notificationType: type, reason: SKIP_REASONS.QUIET_HOURS, inboxRowKept: true,
    }));
  });

  it("is a no-op the second time (dedupe)", async () => {
    await send();
    await send();
    expect(sendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("NOTIFICATION_SKIPPED", expect.objectContaining({
      notificationType: type, reason: SKIP_REASONS.DUPLICATE,
    }));
  });
});

describe("delivery outcomes", () => {
  it("records NO_DEVICE_TOKEN when the user has no registered device", async () => {
    mockTokens([]);
    await streak.sendMilestone(USER, 3);
    const row = [...NotificationHistory.__store.values()][0];
    expect(row.status).toBe("skipped");
    expect(logger.info).toHaveBeenCalledWith("NOTIFICATION_SKIPPED", expect.objectContaining({ reason: SKIP_REASONS.NO_DEVICE_TOKEN }));
  });

  it("disables an unregistered token and still counts the other device as sent", async () => {
    mockTokens([{ _id: "t1", token: "dead" }, { _id: "t2", token: "alive" }]);
    mockFcm([{ error: { code: "messaging/registration-token-not-registered" } }, {}]);
    await streak.sendMilestone(USER, 3);
    expect(DeviceToken.updateMany).toHaveBeenCalledWith(
      { token: { $in: ["dead"] } },
      expect.objectContaining({ enabled: false })
    );
    const row = [...NotificationHistory.__store.values()][0];
    expect(row.status).toBe("sent");
    expect(row.delivery.invalidTokens).toEqual(["dead"]);
    expect(row.delivery.acceptedTokenIds).toEqual(["t2"]);
  });

  it("transient FCM failure → partial + rethrow so the queue retries, then only the failed device is retried", async () => {
    mockTokens([{ _id: "t1", token: "ok" }, { _id: "t2", token: "flaky" }]);
    mockFcm([{}, { error: { code: "messaging/server-unavailable" } }]);
    const payload = { type: "evening_reflection", title: "t", body: "b", sourceType: "cron", dedupeKey: `evening-reflection:${USER}:x` };
    await expect(notifyUser(USER, payload)).rejects.toMatchObject({ code: "FCM_TRANSIENT_FAILURE" });
    let row = [...NotificationHistory.__store.values()][0];
    expect(row.status).toBe("partial");

    // Retry (as BullMQ would): the accepted token is excluded from the resend.
    mockFcm([{}]);
    mockTokens([{ _id: "t2", token: "flaky" }]);
    await notifyUser(USER, payload);
    expect(DeviceToken.find).toHaveBeenLastCalledWith(expect.objectContaining({ _id: { $nin: ["t1"] } }));
    row = [...NotificationHistory.__store.values()][0];
    expect(row.status).toBe("sent");
    expect(sendEachForMulticast).toHaveBeenCalledTimes(1); // only the retry's mock
  });

  it("smartCoach=false does not silence support or session-independent transactional pushes", async () => {
    mockPrefs(prefs({ smartCoach: false }));
    await notifyUser(USER, { type: "support_agent_reply", title: "t", body: "b", dedupeKey: "support:1" });
    await notifyUser(USER, { type: "ocr_completed", title: "t", body: "b", dedupeKey: "ocr:1" });
    expect(sendEachForMulticast).toHaveBeenCalledTimes(2);
  });

  it("sessionReminders=false silences only session reminders", async () => {
    mockPrefs(prefs({ sessionReminders: false }));
    expect(await notifyUser(USER, { type: "session_reminder", title: "t", body: "b", dedupeKey: "s:1" })).toBeNull();
    await notifyUser(USER, { type: "morning_mentor", title: "t", body: "b", dedupeKey: "m:1" });
    expect(sendEachForMulticast).toHaveBeenCalledTimes(1);
  });
});
