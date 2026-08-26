jest.mock("../../models/DeviceToken", () => ({
  find: jest.fn(),
  updateMany: jest.fn(),
}));

jest.mock("../../models/NotificationHistory", () => ({
  create: jest.fn(),
  find: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findOneAndUpdate: jest.fn(),
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

const NotificationHistory = require("../../models/NotificationHistory");
const NotificationPreference = require("../../models/NotificationPreference");
const { getFirebaseAdmin } = require("../../config/firebaseAdmin");
const { logger } = require("../../utils/logger");
const { getAllowedPreferences, notifyUser } = require("../../services/notificationService");

function buildPrefs(overrides = {}) {
  return {
    inAppEnabled: true,
    pushEnabled: true,
    smartCoach: true,
    revengeTrading: true,
    overtrading: true,
    setupDiscipline: true,
    repeatedMistakes: true,
    moodRisk: true,
    noStopLoss: true,
    weeklyInsight: true,
    morningMentor: true,
    quietHours: {
      enabled: true,
      start: "22:00",
      end: "07:00",
      timezone: "Asia/Kolkata",
    },
    ...overrides,
  };
}

function mockPreferences(prefs) {
  NotificationPreference.findOneAndUpdate.mockReturnValue({
    lean: jest.fn().mockResolvedValue(prefs),
  });
}

describe("notification quiet hours", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test.each([
    {
      name: "22:00 to 07:00, current local time 23:30, blocked",
      start: "22:00",
      end: "07:00",
      now: "2026-01-01T18:00:00.000Z",
      blocked: true,
    },
    {
      name: "22:00 to 07:00, current local time 06:30, blocked",
      start: "22:00",
      end: "07:00",
      now: "2026-01-01T01:00:00.000Z",
      blocked: true,
    },
    {
      name: "22:00 to 07:00, current local time 08:00, allowed",
      start: "22:00",
      end: "07:00",
      now: "2026-01-01T02:30:00.000Z",
      blocked: false,
    },
    {
      name: "09:00 to 17:00, current local time 12:00, blocked",
      start: "09:00",
      end: "17:00",
      now: "2026-01-01T06:30:00.000Z",
      blocked: true,
    },
    {
      name: "09:00 to 17:00, current local time 18:00, allowed",
      start: "09:00",
      end: "17:00",
      now: "2026-01-01T12:30:00.000Z",
      blocked: false,
    },
  ])("$name", async ({ start, end, now, blocked }) => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(now));
    const prefs = buildPrefs({ quietHours: { enabled: true, start, end, timezone: "Asia/Kolkata" } });
    mockPreferences(prefs);

    const result = await getAllowedPreferences("user-1", "morning_mentor");

    expect(result).toBe(blocked ? null : prefs);
    if (blocked) {
      expect(logger.info).toHaveBeenCalledWith(
        "QUIET_HOURS_BLOCKED",
        expect.objectContaining({
          userId: "user-1",
          type: "morning_mentor",
          timezone: "Asia/Kolkata",
          quietHoursStart: start,
          quietHoursEnd: end,
        })
      );
    } else {
      expect(logger.info).not.toHaveBeenCalledWith(
        "QUIET_HOURS_BLOCKED",
        expect.any(Object)
      );
    }
  });

  it("keeps in-app history but suppresses Firebase during quiet hours", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T18:00:00.000Z"));
    mockPreferences(buildPrefs());
    NotificationHistory.create.mockResolvedValue({ _id: "notification-1" });
    NotificationHistory.findOneAndUpdate.mockResolvedValue({ _id: "notification-1" });

    const result = await notifyUser("user-1", {
      type: "morning_mentor",
      title: "Quiet test",
      body: "This should not be created",
    });

    expect(result).toEqual({ _id: "notification-1" });
    expect(NotificationHistory.create).toHaveBeenCalled();
    expect(NotificationHistory.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "notification-1", user: "user-1" },
      { status: "skipped", "delivery.error": "quiet_hours" },
      { returnDocument: "after" }
    );
    expect(getFirebaseAdmin).not.toHaveBeenCalled();
  });

  it("falls back to Asia/Kolkata when timezone is invalid", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T18:00:00.000Z"));
    mockPreferences(buildPrefs({
      quietHours: {
        enabled: true,
        start: "22:00",
        end: "07:00",
        timezone: "Mars/Olympus",
      },
    }));

    await expect(getAllowedPreferences("user-1", "morning_mentor")).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      "[QuietHours] invalid timezone; falling back to Asia/Kolkata",
      expect.objectContaining({
        timezone: "Mars/Olympus",
        fallbackTimezone: "Asia/Kolkata",
      })
    );
  });

  it("fails closed when quiet-hours configuration is malformed", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T18:00:00.000Z"));
    const prefs = buildPrefs({
      quietHours: {
        enabled: true,
        start: "25:00",
        end: "07:00",
        timezone: "Asia/Kolkata",
      },
    });
    mockPreferences(prefs);

    await expect(getAllowedPreferences("user-1", "morning_mentor")).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      "QUIET_HOURS_CONFIGURATION_INVALID",
      expect.objectContaining({ start: "25:00", end: "07:00" })
    );
  });
});
