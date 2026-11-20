jest.mock("../../config/redis", () => ({
  client: {},
  isRedisReady: jest.fn(() => false),
}));

jest.mock("../../config/sentry", () => ({
  captureOperationalError: jest.fn(),
}));

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("../../utils/aiUsage", () => ({
  recordAiUsage: jest.fn(),
}));

const { captureOperationalError } = require("../../config/sentry");
const { recordAiUsage } = require("../../utils/aiUsage");
const circuit = require("../../utils/geminiCircuit");

const transient = () => Object.assign(new Error("[503 Service Unavailable] overloaded"), { status: 503 });

describe("geminiCircuit (in-memory, Redis down)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    circuit.reset();
  });

  it("classifies transient vs config failures", () => {
    expect(circuit.isTransientGeminiError(transient())).toBe(true);
    expect(circuit.isTransientGeminiError(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe(true);
    expect(circuit.isTransientGeminiError(new Error("fetch failed"))).toBe(true);
    expect(circuit.isTransientGeminiError(Object.assign(new Error("[403 Forbidden] denied"), { status: 403 }))).toBe(false);
    expect(circuit.isTransientGeminiError(Object.assign(new Error("[400] bad"), { status: 400 }))).toBe(false);
  });

  it("opens after 5 transient failures and alerts once", async () => {
    for (let i = 0; i < 4; i += 1) await circuit.recordFailure(transient());
    expect(await circuit.isOpen()).toBe(false);
    await circuit.recordFailure(transient());
    expect(await circuit.isOpen()).toBe(true);
    expect(captureOperationalError).toHaveBeenCalledTimes(1);
  });

  it("ignores non-transient failures", async () => {
    for (let i = 0; i < 10; i += 1) {
      await circuit.recordFailure(Object.assign(new Error("[403] denied"), { status: 403 }));
    }
    expect(await circuit.isOpen()).toBe(false);
  });

  it("lets exactly one probe through after the open period, and closes on success", async () => {
    jest.useFakeTimers({ now: Date.now() });
    for (let i = 0; i < 5; i += 1) await circuit.recordFailure(transient());
    expect(await circuit.isOpen()).toBe(true);

    jest.setSystemTime(Date.now() + 61_000);
    expect(await circuit.isOpen()).toBe(false); // the probe
    expect(await circuit.isOpen()).toBe(true); // everyone else waits

    await circuit.recordSuccess();
    expect(await circuit.isOpen()).toBe(false);
    expect(await circuit.isOpen()).toBe(false);
  });

  it("re-opens immediately when the probe fails", async () => {
    jest.useFakeTimers({ now: Date.now() });
    for (let i = 0; i < 5; i += 1) await circuit.recordFailure(transient());
    jest.setSystemTime(Date.now() + 61_000);
    expect(await circuit.isOpen()).toBe(false);
    await circuit.recordFailure(transient());
    expect(await circuit.isOpen()).toBe(true);
  });

  it("guardedCall skips the call while open and meters successes and failures", async () => {
    const ok = jest.fn().mockResolvedValue({ response: { usageMetadata: { totalTokenCount: 10 } } });
    await circuit.guardedCall({ feature: "coach", userId: "u1", model: "m", call: ok });
    expect(recordAiUsage).toHaveBeenLastCalledWith(expect.objectContaining({ feature: "coach", ok: true }));

    const bad = jest.fn().mockRejectedValue(transient());
    for (let i = 0; i < 5; i += 1) {
      await expect(circuit.guardedCall({ feature: "coach", call: bad })).rejects.toThrow("overloaded");
    }
    expect(recordAiUsage).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false }));

    // recordFailure is fire-and-forget inside guardedCall; let it settle.
    await new Promise((r) => setImmediate(r));
    const skipped = jest.fn();
    await expect(circuit.guardedCall({ feature: "coach", call: skipped })).rejects.toBeInstanceOf(circuit.GeminiCircuitOpenError);
    expect(skipped).not.toHaveBeenCalled();
  });

  it("alerts on a coach failure spike, throttled", async () => {
    for (let i = 0; i < 25; i += 1) await circuit.noteUserFacingFailure("COACH_BUSY");
    expect(captureOperationalError).toHaveBeenCalledTimes(1);
  });
});
