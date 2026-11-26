/**
 * Mind Score service plumbing: locking, the dirty-flag rerun, hook debounce,
 * the instant-reward timeout, and target validation. The scoring itself is
 * covered by mindProgressEngine.test.js.
 */

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

describe("mindProgressHooks", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  function load(cfg) {
    jest.doMock("../../config", () => ({ appConfig: { mindProgress: cfg } }));
    const recompute = jest.fn().mockResolvedValue({});
    jest.doMock("../../services/mindProgress.service", () => ({ recompute }));
    return { hooks: require("../../services/mindProgressHooks"), recompute };
  }

  it("debounces a burst into one recompute per user", () => {
    const { hooks, recompute } = load({ enabled: true, hooksEnabled: true });
    hooks.scheduleMindRecompute("507f1f77bcf86cd799439011", "trade:create");
    hooks.scheduleMindRecompute("507f1f77bcf86cd799439011", "trade:edit");
    hooks.scheduleMindRecompute("507f1f77bcf86cd799439012", "reflection_submit");
    expect(hooks.pendingCount()).toBe(2);
    jest.advanceTimersByTime(hooks.DEBOUNCE_MS);
    expect(recompute).toHaveBeenCalledTimes(2);
    expect(recompute).toHaveBeenCalledWith("507f1f77bcf86cd799439011", { source: "trade:edit" });
  });

  it("is a no-op when disabled or hooks are off", () => {
    const { hooks, recompute } = load({ enabled: true, hooksEnabled: false });
    hooks.scheduleMindRecompute("507f1f77bcf86cd799439011");
    jest.advanceTimersByTime(10000);
    expect(recompute).not.toHaveBeenCalled();
    expect(hooks.pendingCount()).toBe(0);
  });

  it("swallows recompute failures", async () => {
    const { hooks, recompute } = load({ enabled: true, hooksEnabled: true });
    recompute.mockRejectedValueOnce(new Error("mongo down"));
    hooks.scheduleMindRecompute("507f1f77bcf86cd799439011");
    jest.advanceTimersByTime(hooks.DEBOUNCE_MS);
    await Promise.resolve();
    expect(recompute).toHaveBeenCalled();
  });
});

describe("mindProgress.service", () => {
  const USER = "507f1f77bcf86cd799439011";
  let lock;
  let redisClient;

  function chain(result) {
    const q = { select: () => q, sort: () => q, limit: () => q, lean: () => Promise.resolve(result) };
    return q;
  }

  function load({ enabled = true } = {}) {
    jest.resetModules();
    // The hooks suite above replaces the service with a stub; use the real one.
    jest.dontMock("../../services/mindProgress.service");
    lock = { acquireLock: jest.fn(), releaseLock: jest.fn().mockResolvedValue(true) };
    redisClient = { set: jest.fn().mockResolvedValue("OK"), del: jest.fn().mockResolvedValue(0) };
    jest.doMock("../../config", () => ({ appConfig: { mindProgress: { enabled, aiEnabled: false }, ai: {} } }));
    jest.doMock("../../config/redis", () => ({ client: redisClient, isRedisReady: () => true }));
    jest.doMock("../../utils/distributedLock", () => lock);
    jest.doMock("../../services/streak.service", () => ({
      dayKeyInTz: () => "2026-11-26",
      getUserTimezone: jest.fn().mockResolvedValue("Asia/Kolkata"),
    }));
    const empty = { find: () => chain([]), findOne: () => chain(null), exists: jest.fn().mockResolvedValue(null), bulkWrite: jest.fn(), deleteMany: jest.fn(), updateOne: jest.fn(), updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }), create: jest.fn() };
    for (const m of ["Trade", "IndianTrade", "DailyReflection", "MindScoreDaily", "MindProfile", "MindMilestone", "MindInsight"]) {
      jest.doMock(`../../models/${m}`, () => ({ ...empty }));
    }
    const MindTarget = { ...empty, create: jest.fn() };
    MindTarget.PRESETS = ["no_tag", "follow_rule", "stop_after_losses", "tag_every_trade", "plan_days"];
    jest.doMock("../../models/MindTarget", () => MindTarget);
    return { svc: require("../../services/mindProgress.service"), models: { MindTarget, MindProfile: require("../../models/MindProfile") } };
  }

  it("skips and marks dirty when another recompute holds the lock", async () => {
    const { svc } = load();
    lock.acquireLock.mockResolvedValue({ acquired: false });
    await expect(svc.recompute(USER)).resolves.toEqual({ skipped: true, reason: "locked" });
    expect(redisClient.set).toHaveBeenCalledWith(`mind:dirty:${USER}`, "1", "EX", 120);
  });

  it("reruns once when the dirty flag was set during its run, then releases the lock", async () => {
    const { svc, models } = load();
    lock.acquireLock.mockResolvedValue({ acquired: true, token: "tok" });
    redisClient.del.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    await svc.recompute(USER);
    expect(models.MindProfile.updateOne).toHaveBeenCalledTimes(2);
    expect(lock.releaseLock).toHaveBeenCalledWith(`mind:lock:${USER}`, "tok");
  });

  it("runs without Redis (degraded lock)", async () => {
    const { svc, models } = load();
    lock.acquireLock.mockResolvedValue({ acquired: true, token: null, degraded: true });
    await svc.recompute(USER);
    expect(models.MindProfile.updateOne).toHaveBeenCalledTimes(1);
    expect(lock.releaseLock).not.toHaveBeenCalled();
  });

  it("does nothing when the feature is disabled", async () => {
    const { svc } = load({ enabled: false });
    await expect(svc.recompute(USER)).resolves.toMatchObject({ skipped: true, reason: "disabled" });
    await expect(svc.getMicro(USER)).resolves.toBeNull();
    expect(lock.acquireLock).not.toHaveBeenCalled();
  });

  it("a hung Redis lock degrades instead of blocking the recompute", async () => {
    jest.useFakeTimers();
    const { svc, models } = load();
    lock.acquireLock.mockReturnValue(new Promise(() => {})); // Redis hung mid-reconnect
    const pending = svc.recompute(USER);
    await jest.advanceTimersByTimeAsync(2000);
    await pending;
    expect(models.MindProfile.updateOne).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("micro returns null instead of hanging when Mongo is slow", async () => {
    jest.useFakeTimers();
    const { svc, models } = load();
    lock.acquireLock.mockResolvedValue({ acquired: true, token: null, degraded: true });
    models.MindProfile.findOne = () => ({ lean: () => new Promise(() => {}) });
    const pending = svc.getMicro(USER);
    await jest.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toBeNull();
    jest.useRealTimers();
  });

  it("rejects a target the trader's data didn't suggest", async () => {
    const { svc, models } = load();
    await expect(svc.setTarget(USER, { preset: "follow_rule", params: { rule: "invented" } }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.setTarget(USER, { preset: "not_a_preset" })).rejects.toMatchObject({ statusCode: 400 });
    expect(models.MindTarget.create).not.toHaveBeenCalled();
  });

  it("accepts an always-available preset", async () => {
    const { svc, models } = load();
    models.MindTarget.create.mockResolvedValue({ toObject: () => ({ _id: "t1", preset: "plan_days", params: { need: 5 }, startDay: "2026-11-26", endDay: "2026-12-02", goal: 5, status: "active" }) });
    const target = await svc.setTarget(USER, { preset: "plan_days", params: {} });
    expect(target).toMatchObject({ preset: "plan_days", label: "Follow my plan 5 of 7 days", endDay: "2026-12-02" });
    expect(models.MindTarget.updateMany).toHaveBeenCalledWith({ user: USER, status: "active" }, { $set: { status: "cancelled" } });
  });

  it("markSeen ignores invalid ids and caps the batch", async () => {
    const { svc } = load();
    const MindMilestone = require("../../models/MindMilestone");
    MindMilestone.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    await svc.markSeen(USER, ["nope", "507f1f77bcf86cd799439099"]);
    expect(MindMilestone.updateMany.mock.calls[0][0]._id.$in).toEqual(["507f1f77bcf86cd799439099"]);
  });
});
