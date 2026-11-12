jest.mock("../../config", () => ({
  appConfig: {
    cron: { sessionReminderConcurrency: 10, concurrency: 10 },
    sessionReminders: { enabled: true, schedule: "*/15 * * * *", timezone: "Asia/Kolkata" },
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
  getSessionOccurrence,
  runSessionReminderJob,
  SKIP_REASONS,
  DEFAULT_SESSIONS,
} = require("../../jobs/sessionReminderCron");

const at = (iso) => new Date(iso);
const ids = (sessions) => sessions.map((s) => s.id);
const session = (id) => DEFAULT_SESSIONS.find((s) => s.id === id);

// Reminder = open − 15 min, open defined in the market's own timezone.
//   Sep (BST / EDT):  London 07:00Z → remind 06:45Z · NY 12:00Z → remind 11:45Z
//   Dec (GMT / EST):  London 08:00Z → remind 07:45Z · NY 13:00Z → remind 12:45Z
//   NSE always 09:15 IST = 03:45Z → remind 03:30Z
const MON_SEP_LONDON = at("2026-09-21T06:45:00.000Z");
const MON_SEP_NY     = at("2026-09-21T11:45:00.000Z");
const MON_SEP_NSE    = at("2026-09-21T03:30:00.000Z");

function mockUsers(users, markets) {
  userRepository.findUsersForSessionReminders.mockResolvedValue(users);
  resolveActiveMarketsForUsers.mockResolvedValue(
    new Map(Object.entries(markets).map(([id, list]) => [id, new Set(list)]))
  );
}

function sentTo() {
  return notificationService.notifyUser.mock.calls.map(([userId, payload]) => `${userId}:${payload.data.session}`);
}

function skipLogged(userId, reason) {
  return logger.info.mock.calls.some(([event, fields]) =>
    event === "SESSION_REMINDER_DECISION" && fields.userId === userId && fields.reason === reason);
}

beforeEach(() => jest.clearAllMocks());

describe("session times follow each market's daylight saving", () => {
  it("London opens 08:00 London time — 07:00Z in summer, 08:00Z in winter", () => {
    expect(getSessionOccurrence(session("london_open"), at("2026-09-21T05:00:00Z")).openAt.toISOString()).toBe("2026-09-21T07:00:00.000Z");
    expect(getSessionOccurrence(session("london_open"), at("2026-12-07T05:00:00Z")).openAt.toISOString()).toBe("2026-12-07T08:00:00.000Z");
  });

  it("New York opens 08:00 New York time — 12:00Z in summer, 13:00Z in winter", () => {
    expect(getSessionOccurrence(session("new_york_open"), at("2026-09-21T10:00:00Z")).openAt.toISOString()).toBe("2026-09-21T12:00:00.000Z");
    expect(getSessionOccurrence(session("new_york_open"), at("2026-12-07T10:00:00Z")).openAt.toISOString()).toBe("2026-12-07T13:00:00.000Z");
  });

  it("handles the March weeks when the US has switched and the UK has not", () => {
    // 2026-03-16: US already on EDT (switched 8 Mar), UK still on GMT (switches 29 Mar).
    expect(ids(getDueSessions(at("2026-03-16T11:45:00Z")))).toEqual(["new_york_open"]);
    expect(ids(getDueSessions(at("2026-03-16T07:45:00Z")))).toEqual(["london_open"]);
    expect(getDueSessions(at("2026-03-16T12:45:00Z"))).toEqual([]);
  });

  it("detects each reminder 15 minutes before the open on a weekday", () => {
    expect(ids(getDueSessions(MON_SEP_LONDON))).toEqual(["london_open"]);
    expect(ids(getDueSessions(MON_SEP_NY))).toEqual(["new_york_open"]);
    expect(ids(getDueSessions(MON_SEP_NSE))).toEqual(["indian_market_open"]);
  });

  it("a tick up to 30 minutes late still sends; after that it does not", () => {
    expect(ids(getDueSessions(at("2026-09-21T07:00:00Z")))).toEqual(["london_open"]);
    expect(ids(getDueSessions(at("2026-09-21T07:14:00Z")))).toEqual(["london_open"]);
    expect(getDueSessions(at("2026-09-21T07:15:00Z"))).toEqual([]);
  });

  it("the old wrong IST times are no longer due", () => {
    // Old table: London at 12:45 IST (07:15Z), NY at 18:15 IST (12:45Z) — both wrong in September.
    expect(getDueSessions(at("2026-09-21T07:15:00Z"))).toEqual([]);
    expect(getDueSessions(at("2026-09-21T12:45:00Z"))).toEqual([]);
  });

  it("copy is relative, not an IST wall-clock time", () => {
    for (const s of DEFAULT_SESSIONS.filter((x) => x.market === "Forex")) {
      expect(s.title).toMatch(/opens in 15 minutes/);
      expect(`${s.title} ${s.body}`).not.toMatch(/\d{1,2}:\d{2}/);
    }
  });
});

describe("market closed days (judged on the session's own date)", () => {
  it.each([
    ["Saturday London",        "2026-09-19T06:45:00Z", "london_open",        "WEEKEND"],
    ["Sunday New York",        "2026-09-20T11:45:00Z", "new_york_open",      "WEEKEND"],
    ["Saturday NSE",           "2026-09-19T03:30:00Z", "indian_market_open", "WEEKEND"],
    ["Christmas London",       "2026-12-25T07:45:00Z", "london_open",        "HOLIDAY"],
    ["New Year New York",      "2027-01-01T12:45:00Z", "new_york_open",      "HOLIDAY"],
    ["NSE Gandhi Jayanti",     "2026-10-02T03:30:00Z", "indian_market_open", "HOLIDAY"],
    ["NSE Republic Day 2027 (recurring, no 2027 list yet)", "2027-01-26T03:30:00Z", "indian_market_open", "HOLIDAY"],
  ])("%s → nothing sent", async (_label, iso, sessionId, reason) => {
    const { eligible, skipped } = getEligibleSessions(at(iso));
    expect(eligible).toEqual([]);
    expect(skipped).toEqual([expect.objectContaining({ reason, session: expect.objectContaining({ id: sessionId }) })]);

    mockUsers([{ _id: "u" }], { u: ["Forex", "Indian_Market"] });
    await runSessionReminderJob(at(iso));
    expect(notificationService.notifyUser).not.toHaveBeenCalled();
    expect(userRepository.findUsersForSessionReminders).not.toHaveBeenCalled();
  });

  it("an Indian exchange holiday does not suppress the Forex London reminder", async () => {
    mockUsers([{ _id: "fx" }], { fx: ["Forex"] });
    await runSessionReminderJob(at("2026-10-02T06:45:00Z"));
    expect(sentTo()).toEqual(["fx:london_open"]);
  });
});

describe("never on the user's own weekend or night", () => {
  it("Friday's New York reminder is not sent to a New Zealand user (already Saturday there)", async () => {
    mockUsers([{ _id: "nz", streaks: { timezone: "Pacific/Auckland" } }], { nz: ["Forex"] });
    // Fri 07:45 New York = Sat 00:45 NZDT (NZ switched to daylight time on 27 Sep).
    await runSessionReminderJob(at("2026-10-09T11:45:00Z"));
    expect(notificationService.notifyUser).not.toHaveBeenCalled();
    expect(skipLogged("nz", SKIP_REASONS.USER_WEEKEND)).toBe(true);
  });

  it("Monday's London reminder is not sent to a California user (still Sunday night there)", async () => {
    mockUsers([{ _id: "ca", streaks: { timezone: "America/Los_Angeles" } }], { ca: ["Forex"] });
    await runSessionReminderJob(MON_SEP_LONDON); // Sun 23:45 PDT
    expect(notificationService.notifyUser).not.toHaveBeenCalled();
    expect(skipLogged("ca", SKIP_REASONS.USER_WEEKEND)).toBe(true);
  });

  it("skips reminders that land in the user's night (23:00–06:00)", async () => {
    mockUsers([{ _id: "nyc", streaks: { timezone: "America/New_York" } }], { nyc: ["Forex"] });
    await runSessionReminderJob(MON_SEP_LONDON); // 02:45 EDT Monday
    expect(notificationService.notifyUser).not.toHaveBeenCalled();
    expect(skipLogged("nyc", SKIP_REASONS.USER_NIGHT)).toBe(true);
  });

  it("an IST user gets both Forex sessions on a weekday", async () => {
    mockUsers([{ _id: "in", streaks: { timezone: "Asia/Kolkata" } }], { in: ["Forex"] });
    await runSessionReminderJob(MON_SEP_LONDON); // 12:15 IST
    await runSessionReminderJob(MON_SEP_NY);     // 17:15 IST
    expect(sentTo()).toEqual(["in:london_open", "in:new_york_open"]);
  });
});

describe("market gating", () => {
  const users = [{ _id: "forex-only" }, { _id: "indian-only" }, { _id: "both" }, { _id: "no-market" }];
  const markets = { "forex-only": ["Forex"], "indian-only": ["Indian_Market"], both: ["Forex", "Indian_Market"], "no-market": [] };

  it("London goes only to Forex users", async () => {
    mockUsers(users, markets);
    await runSessionReminderJob(MON_SEP_LONDON);
    expect(sentTo().sort()).toEqual(["both:london_open", "forex-only:london_open"]);
  });

  it("NSE goes only to Indian-market users", async () => {
    mockUsers(users, markets);
    await runSessionReminderJob(MON_SEP_NSE);
    expect(sentTo().sort()).toEqual(["both:indian_market_open", "indian-only:indian_market_open"]);
  });

  it("a user with no market signal receives nothing", async () => {
    mockUsers([{ _id: "no-market" }], { "no-market": [] });
    await runSessionReminderJob(MON_SEP_LONDON);
    await runSessionReminderJob(MON_SEP_NSE);
    expect(notificationService.notifyUser).not.toHaveBeenCalled();
  });
});

describe("payload & dedupe", () => {
  it("Forex payload: relative copy, route, keyed user+market+session+user-day", async () => {
    mockUsers([{ _id: "user-1" }], { "user-1": ["Forex"] });
    await runSessionReminderJob(MON_SEP_LONDON);
    expect(notificationService.notifyUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        type: "session_reminder",
        title: "London session opens in 15 minutes",
        dedupeKey: "session-reminder:user-1:Forex:london_open:2026-09-21",
        deepLink: "/trades?session=London",
        data: expect.objectContaining({ marketType: "Forex", session: "london_open", opensAt: "2026-09-21T07:00:00.000Z" }),
      })
    );
  });

  it("Indian payload routes into the Indian area", async () => {
    mockUsers([{ _id: "user-2" }], { "user-2": ["Indian_Market"] });
    await runSessionReminderJob(MON_SEP_NSE);
    const [, payload] = notificationService.notifyUser.mock.calls[0];
    expect(payload.title).toBe("NSE opens at 9:15 AM");
    expect(payload.deepLink).toMatch(/^\/indian-market\/trades/);
    expect(payload.body).not.toMatch(/London|New York/);
  });

  it("a late second tick in the same window produces the SAME dedupe key (history row dedupes it)", async () => {
    mockUsers([{ _id: "u" }], { u: ["Forex"] });
    await runSessionReminderJob(MON_SEP_LONDON);
    mockUsers([{ _id: "u" }], { u: ["Forex"] });
    await runSessionReminderJob(at("2026-09-21T07:00:00Z"));
    const keys = notificationService.notifyUser.mock.calls.map(([, p]) => p.dedupeKey);
    expect(new Set(keys).size).toBe(1);
  });

  it("does not fetch users when no session is due", async () => {
    await runSessionReminderJob(at("2026-09-21T09:00:00Z"));
    expect(userRepository.findUsersForSessionReminders).not.toHaveBeenCalled();
  });

  it("logs PREFERENCE_DISABLED when notifyUser returns null", async () => {
    notificationService.notifyUser.mockResolvedValueOnce(null);
    mockUsers([{ _id: "muted" }], { muted: ["Forex"] });
    await runSessionReminderJob(MON_SEP_LONDON);
    expect(skipLogged("muted", SKIP_REASONS.PREFERENCE_DISABLED)).toBe(true);
  });
});
