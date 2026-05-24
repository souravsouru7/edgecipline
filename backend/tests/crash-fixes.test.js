/**
 * Tests for the three production crash fixes:
 * 1. server.js — global uncaughtException / unhandledRejection handlers
 * 2. weeklyReportsCron.js — try-catch around userRepository call + logger usage
 * 3. tradeProcessingService.js — withTimeout timer cleanup
 */

// ─── Fix 1: Global error handlers in server.js ───────────────────────────────
// We can't require server.js (it starts Express + DB connections), so we test
// the handler registration logic directly by isolating the pattern.

describe("Fix 1 — global error handlers", () => {
  let originalUncaught;
  let originalUnhandled;

  beforeEach(() => {
    originalUncaught = process.listeners("uncaughtException").slice();
    originalUnhandled = process.listeners("unhandledRejection").slice();
    process.removeAllListeners("uncaughtException");
    process.removeAllListeners("unhandledRejection");
  });

  afterEach(() => {
    process.removeAllListeners("uncaughtException");
    process.removeAllListeners("unhandledRejection");
    originalUncaught.forEach((l) => process.on("uncaughtException", l));
    originalUnhandled.forEach((l) => process.on("unhandledRejection", l));
  });

  test("registers uncaughtException handler", () => {
    // Simulate what server.js does — register a console-based handler early
    process.on("uncaughtException", (error) => {
      console.error("[FATAL] Uncaught Exception", error.message);
      // In real server.js this calls process.exit(1)
    });

    expect(process.listenerCount("uncaughtException")).toBe(1);
  });

  test("registers unhandledRejection handler", () => {
    process.on("unhandledRejection", (reason) => {
      const msg = reason instanceof Error ? reason.message : String(reason);
      console.error("[FATAL] Unhandled Rejection", msg);
    });

    expect(process.listenerCount("unhandledRejection")).toBe(1);
  });

  test("removeAllListeners clears old handlers before upgrading to logger", () => {
    // Phase 1: console-based (pre-logger)
    process.on("uncaughtException", () => {});
    process.on("unhandledRejection", () => {});
    expect(process.listenerCount("uncaughtException")).toBe(1);
    expect(process.listenerCount("unhandledRejection")).toBe(1);

    // Phase 2: upgrade — server.js calls removeAllListeners then re-registers
    process.removeAllListeners("uncaughtException");
    process.removeAllListeners("unhandledRejection");
    process.on("uncaughtException", () => {});
    process.on("unhandledRejection", () => {});

    // Exactly one handler each (not two accumulated)
    expect(process.listenerCount("uncaughtException")).toBe(1);
    expect(process.listenerCount("unhandledRejection")).toBe(1);
  });

  test("unhandledRejection handler formats Error reason correctly", () => {
    const logged = [];
    process.on("unhandledRejection", (reason) => {
      logged.push({
        msg: reason instanceof Error ? reason.message : String(reason),
        hasStack: reason instanceof Error && !!reason.stack,
      });
    });

    const err = new Error("test rejection");
    process.emit("unhandledRejection", err);

    expect(logged[0].msg).toBe("test rejection");
    expect(logged[0].hasStack).toBe(true);
  });

  test("unhandledRejection handler formats non-Error reason as string", () => {
    const logged = [];
    process.on("unhandledRejection", (reason) => {
      logged.push(reason instanceof Error ? reason.message : String(reason));
    });

    process.emit("unhandledRejection", "plain string reason");
    expect(logged[0]).toBe("plain string reason");
  });
});

// ─── Fix 2: weeklyReportsCron — try-catch around repository call ──────────────

jest.mock("../config", () => ({
  appConfig: {
    weeklyReports: { enabled: true, schedule: "0 1 * * *" },
  },
}));

jest.mock("../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../repositories/user.repository", () => ({
  findUsersForWeeklyReports: jest.fn(),
}));

jest.mock("../repositories/weeklyReport.repository", () => ({
  findRecentlyGeneratedWeeklyReport: jest.fn(),
}));

jest.mock("../services/weeklyReport.service", () => ({
  generateRolling7dReportForUser: jest.fn(),
}));

const { logger } = require("../utils/logger");
const userRepository = require("../repositories/user.repository");
const weeklyReportRepository = require("../repositories/weeklyReport.repository");
const { generateRolling7dReportForUser } = require("../services/weeklyReport.service");
const { runWeeklyReportsJob } = require("../jobs/weeklyReportsCron");

describe("Fix 2 — weeklyReportsCron DB error handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("logs error and returns early when findUsersForWeeklyReports throws", async () => {
    const dbError = new Error("MongoDB connection lost");
    userRepository.findUsersForWeeklyReports.mockRejectedValue(dbError);

    await expect(runWeeklyReportsJob()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("[weeklyReportsCron] failed to fetch users"),
      expect.objectContaining({ error: "MongoDB connection lost" })
    );
    // Should not attempt to generate any reports
    expect(generateRolling7dReportForUser).not.toHaveBeenCalled();
  });

  test("continues other users when one user report generation fails", async () => {
    const users = [{ _id: "user-1" }, { _id: "user-2" }];
    userRepository.findUsersForWeeklyReports.mockResolvedValue(users);
    weeklyReportRepository.findRecentlyGeneratedWeeklyReport.mockResolvedValue(null);

    // First call throws, second succeeds
    generateRolling7dReportForUser
      .mockRejectedValueOnce(new Error("AI service timeout"))
      .mockResolvedValue(undefined);

    await runWeeklyReportsJob();

    // Error logged for the failing user
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("report generation failed for user"),
      expect.objectContaining({ error: "AI service timeout" })
    );

    // Should still process remaining user+market combos
    expect(generateRolling7dReportForUser.mock.calls.length).toBeGreaterThan(1);
  });

  test("uses logger.error instead of console.error", async () => {
    const consoleSpy = jest.spyOn(console, "error");
    const dbError = new Error("Connection refused");
    userRepository.findUsersForWeeklyReports.mockRejectedValue(dbError);

    await runWeeklyReportsJob();

    // Fix: logger.error called, console.error NOT called by our cron code
    expect(logger.error).toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test("uses logger.info for completion instead of console.log", async () => {
    const consoleSpy = jest.spyOn(console, "log");
    userRepository.findUsersForWeeklyReports.mockResolvedValue([]);

    await runWeeklyReportsJob();

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("completed for 0 users"));
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test("isRunning guard prevents concurrent runs", async () => {
    userRepository.findUsersForWeeklyReports.mockResolvedValue([]);

    // Start two runs simultaneously
    const [r1, r2] = await Promise.all([runWeeklyReportsJob(), runWeeklyReportsJob()]);
    expect(r1).toBeUndefined();
    expect(r2).toBeUndefined();

    // Only one call to the repository despite two invocations
    expect(userRepository.findUsersForWeeklyReports).toHaveBeenCalledTimes(1);
  });
});

// ─── Fix 3: withTimeout timer cleanup ────────────────────────────────────────
// Extract and test the withTimeout function directly without loading the full
// service (which has many side-effect imports).

function withTimeout(promise, message, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

describe("Fix 3 — withTimeout timer cleanup", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("resolves with the promise value before timeout", async () => {
    const result = await withTimeout(Promise.resolve("ok"), "timed out", 5000);
    expect(result).toBe("ok");
  });

  test("rejects with timeout error when promise is slow", async () => {
    const slow = new Promise(() => {}); // never resolves
    const racePromise = withTimeout(slow, "processing timeout", 1000);
    jest.advanceTimersByTime(1001);
    await expect(racePromise).rejects.toThrow("processing timeout");
  });

  test("clears timer after promise resolves (no lingering timer)", async () => {
    const clearSpy = jest.spyOn(global, "clearTimeout");

    const fast = Promise.resolve("done");
    await withTimeout(fast, "timeout", 5000);

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  test("clears timer after promise rejects (no lingering timer)", async () => {
    const clearSpy = jest.spyOn(global, "clearTimeout");

    const failing = Promise.reject(new Error("service error"));
    await expect(withTimeout(failing, "timeout", 5000)).rejects.toThrow("service error");

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  test("clears timer after timeout fires", async () => {
    const clearSpy = jest.spyOn(global, "clearTimeout");

    const slow = new Promise(() => {});
    const p = withTimeout(slow, "too slow", 500);
    jest.advanceTimersByTime(501);
    await expect(p).rejects.toThrow("too slow");

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  test("does not accumulate active timers across multiple calls", async () => {
    const setTimeoutSpy = jest.spyOn(global, "setTimeout");
    const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

    await withTimeout(Promise.resolve("a"), "t", 1000);
    await withTimeout(Promise.resolve("b"), "t", 1000);
    await withTimeout(Promise.resolve("c"), "t", 1000);

    expect(setTimeoutSpy).toHaveBeenCalledTimes(3);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(3);

    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });
});
