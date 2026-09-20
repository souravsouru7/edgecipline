jest.mock("../../config", () => ({
  appConfig: {
    cron: { sessionReminderConcurrency: 10, concurrency: 10 },
    sessionReminders: {
      enabled: true,
      schedule: "*/15 * * * *",
      timezone: "Asia/Kolkata",
    },
  },
}));

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../repositories/user.repository", () => ({
  findUsersForSessionReminders: jest.fn(),
}));

jest.mock("../../services/userMarketService", () => ({
  resolveActiveMarketsForUsers: jest.fn(),
}));

jest.mock("../../services/notificationService", () => ({
  notifyUser: jest.fn().mockResolvedValue({ _id: "notif-1", status: "sent" }),
}));

const userRepository = require("../../repositories/user.repository");
const { resolveActiveMarketsForUsers } = require("../../services/userMarketService");
const notificationService = require("../../services/notificationService");
const { logger } = require("../../utils/logger");
const {
  getDueSessions,
  getEligibleSessions,
  runSessionReminderJob,
  SKIP_REASONS,
} = require("../../jobs/sessionReminderCron");

// IST offsets: 12:45 IST = 07:15Z, 18:15 IST = 12:45Z, 09:00 IST = 03:30Z.
// 2026-09-21 Mon · 2026-09-19 Sat · 2026-09-20 Sun · 2026-10-02 Fri (NSE holiday)
const MON_LONDON   = new Date("2026-09-21T07:15:00.000Z");
const MON_NY       = new Date("2026-09-21T12:45:00.000Z");
const MON_NSE      = new Date("2026-09-21T03:30:00.000Z");
const SAT_LONDON   = new Date("2026-09-19T07:15:00.000Z");
const SAT_NY       = new Date("2026-09-19T12:45:00.000Z");
const SAT_NSE      = new Date("2026-09-19T03:30:00.000Z");
const SUN_LONDON   = new Date("2026-09-20T07:15:00.000Z");
const SUN_NY       = new Date("2026-09-20T12:45:00.000Z");
const SUN_NSE      = new Date("2026-09-20T03:30:00.000Z");
const HOLIDAY_NSE  = new Date("2026-10-02T03:30:00.000Z");
const HOLIDAY_LDN  = new Date("2026-10-02T07:15:00.000Z");

function mockUsers(users, markets) {
  userRepository.findUsersForSessionReminders.mockResolvedValue(users);
  resolveActiveMarketsForUsers.mockResolvedValue(
    new Map(Object.entries(markets).map(([id, list]) => [id, new Set(list)]))
  );
}

function sentTo() {
  return notificationService.notifyUser.mock.calls.map(([userId, payload]) => `${userId}:${payload.data.session}`);
}

describe("sessionReminderCron — schedule", () => {
  beforeEach(() => jest.clearAllMocks());

  it("detects London Open at 12:45 IST on a weekday", () => {
    expect(getDueSessions(MON_LONDON, "Asia/Kolkata").map((s) => s.id)).toEqual(["london_open"]);
  });

  it("detects New York Open at 18:15 IST on a weekday", () => {
    expect(getDueSessions(MON_NY, "Asia/Kolkata").map((s) => s.id)).toEqual(["new_york_open"]);
  });

  it("detects Indian Market Open at 09:00 IST on a weekday", () => {
    const [session] = getDueSessions(MON_NSE, "Asia/Kolkata");
    expect(session.id).toBe("indian_market_open");
    expect(session.market).toBe("Indian_Market");
    expect(session.openTime).toBe("09:15");
    expect(session.title).toMatch(/Indian Market opens at 9:15 AM/);
    expect(session.deepLink).toMatch(/^\/indian-market\//);
    expect(session.body).not.toMatch(/London|New York/);
  });

  it("nothing is due at 12:30 IST", () => {
    expect(getDueSessions(new Date("2026-09-21T07:00:00.000Z"), "Asia/Kolkata")).toEqual([]);
  });
});

describe("sessionReminderCron — weekend & holiday regression", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ["Saturday 12:45 IST — no London", SAT_LONDON, "london_open", "WEEKEND"],
    ["Saturday 18:15 IST — no New York", SAT_NY, "new_york_open", "WEEKEND"],
    ["Sunday 12:45 IST — no London", SUN_LONDON, "london_open", "WEEKEND"],
    ["Sunday 18:15 IST — no New York", SUN_NY, "new_york_open", "WEEKEND"],
    ["Saturday 09:00 IST — no Indian Open", SAT_NSE, "indian_market_open", "WEEKEND"],
    ["Sunday 09:00 IST — no Indian Open", SUN_NSE, "indian_market_open", "WEEKEND"],
    ["NSE holiday 09:00 IST — no Indian Open", HOLIDAY_NSE, "indian_market_open", "HOLIDAY"],
  ])("%s", async (_label, now, sessionId, reason) => {
    const { eligible, skipped } = getEligibleSessions(now, "Asia/Kolkata");
    expect(eligible).toEqual([]);
    expect(skipped).toEqual([expect.objectContaining({ reason, session: expect.objectContaining({ id: sessionId }) })]);

    mockUsers([{ _id: "user-1" }], { "user-1": ["Forex", "Indian_Market"] });
    await runSessionReminderJob(now);

    expect(notificationService.notifyUser).not.toHaveBeenCalled();
    expect(userRepository.findUsersForSessionReminders).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "SESSION_REMINDER_DECISION",
      expect.objectContaining({ session: sessionId, eligible: false, reason })
    );
  });

  it("an Indian exchange holiday does not suppress the Forex London reminder", async () => {
    mockUsers([{ _id: "fx" }], { fx: ["Forex"] });
    await runSessionReminderJob(HOLIDAY_LDN);
    expect(sentTo()).toEqual(["fx:london_open"]);
  });
});

describe("sessionReminderCron — market gating", () => {
  beforeEach(() => jest.clearAllMocks());

  const users = [
    { _id: "forex-only" },
    { _id: "indian-only" },
    { _id: "both" },
    { _id: "no-market" },
  ];
  const markets = {
    "forex-only": ["Forex"],
    "indian-only": ["Indian_Market"],
    both: ["Forex", "Indian_Market"],
    "no-market": [],
  };

  it("London Open goes only to users active in Forex", async () => {
    mockUsers(users, markets);
    await runSessionReminderJob(MON_LONDON);
    expect(sentTo().sort()).toEqual(["both:london_open", "forex-only:london_open"]);
  });

  it("Indian Market Open goes only to users active in the Indian market", async () => {
    mockUsers(users, markets);
    await runSessionReminderJob(MON_NSE);
    expect(sentTo().sort()).toEqual(["both:indian_market_open", "indian-only:indian_market_open"]);
  });

  it("logs how many pairs were skipped as MARKET_NOT_ENABLED", async () => {
    mockUsers(users, markets);
    await runSessionReminderJob(MON_NSE);
    expect(logger.info).toHaveBeenCalledWith(
      "[sessionReminderCron] starting",
      expect.objectContaining({ skippedMarketNotEnabled: 2, reasonForSkips: SKIP_REASONS.MARKET_NOT_ENABLED })
    );
  });

  it("a user with no market signal receives nothing", async () => {
    mockUsers([{ _id: "no-market" }], { "no-market": [] });
    await runSessionReminderJob(MON_LONDON);
    await runSessionReminderJob(MON_NSE);
    expect(notificationService.notifyUser).not.toHaveBeenCalled();
  });
});

describe("sessionReminderCron — payload & dedupe", () => {
  beforeEach(() => jest.clearAllMocks());

  it("Forex payload keeps the original wording and route, keyed user+market+session+day", async () => {
    mockUsers([{ _id: "user-1" }], { "user-1": ["Forex"] });
    await runSessionReminderJob(MON_LONDON);
    expect(notificationService.notifyUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        type: "session_reminder",
        title: "London Open starts soon",
        dedupeKey: "session-reminder:user-1:Forex:london_open:2026-09-21",
        deepLink: "/trades?session=London",
        data: expect.objectContaining({ marketType: "Forex", session: "london_open", screen: "trades" }),
      })
    );
  });

  it("Indian payload identifies the market and routes into the Indian area", async () => {
    mockUsers([{ _id: "user-2" }], { "user-2": ["Indian_Market"] });
    await runSessionReminderJob(MON_NSE);
    expect(notificationService.notifyUser).toHaveBeenCalledWith(
      "user-2",
      expect.objectContaining({
        type: "session_reminder",
        title: "Indian Market opens at 9:15 AM",
        dedupeKey: "session-reminder:user-2:Indian_Market:indian_market_open:2026-09-21",
        deepLink: expect.stringMatching(/^\/indian-market\/trades/),
        data: expect.objectContaining({ marketType: "Indian_Market", session: "indian_market_open", screen: "indian-trades" }),
      })
    );
  });

  it("keys the trading day in the user's own timezone", async () => {
    // 12:45 IST Monday is still Monday 03:15 in America/New_York — same day
    // here, but a user in Pacific/Kiritimati (UTC+14) is already on Tuesday.
    mockUsers([{ _id: "kiri", streaks: { timezone: "Pacific/Kiritimati" } }], { kiri: ["Forex"] });
    await runSessionReminderJob(MON_LONDON);
    expect(notificationService.notifyUser.mock.calls[0][1].dedupeKey)
      .toBe("session-reminder:kiri:Forex:london_open:2026-09-21");
    // 18:15 IST Monday = 02:45 Tuesday in Kiritimati.
    jest.clearAllMocks();
    mockUsers([{ _id: "kiri", streaks: { timezone: "Pacific/Kiritimati" } }], { kiri: ["Forex"] });
    await runSessionReminderJob(MON_NY);
    expect(notificationService.notifyUser.mock.calls[0][1].dedupeKey)
      .toBe("session-reminder:kiri:Forex:new_york_open:2026-09-22");
  });

  it("does not fetch users when no session is due", async () => {
    await runSessionReminderJob(new Date("2026-09-21T07:00:00.000Z"));
    expect(userRepository.findUsersForSessionReminders).not.toHaveBeenCalled();
    expect(notificationService.notifyUser).not.toHaveBeenCalled();
  });

  it("logs PREFERENCE_DISABLED when notifyUser returns null", async () => {
    notificationService.notifyUser.mockResolvedValueOnce(null);
    mockUsers([{ _id: "muted" }], { muted: ["Forex"] });
    await runSessionReminderJob(MON_LONDON);
    expect(logger.info).toHaveBeenCalledWith(
      "SESSION_REMINDER_DECISION",
      expect.objectContaining({ userId: "muted", sent: false, reason: SKIP_REASONS.PREFERENCE_DISABLED })
    );
  });
});
