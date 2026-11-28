jest.mock("../../config/redis", () => ({ client: {}, isRedisReady: jest.fn(() => false) }));
jest.mock("../../config/sentry", () => ({ captureOperationalError: jest.fn() }));
jest.mock("../../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const { hedgedGenerate } = require("../../utils/geminiHedge");

// A fake model whose calls are scripted: "ok:<value>", "hang", or "fail:<status>".
function scriptedModel(script) {
  const calls = [];
  const model = {
    generateContent: jest.fn((request, { signal }) => {
      const step = script[calls.length] || "hang";
      const call = { aborted: false };
      calls.push(call);
      signal.addEventListener("abort", () => { call.aborted = true; });
      if (step.startsWith("ok:")) return Promise.resolve({ value: step.slice(3) });
      if (step.startsWith("fail:")) {
        const status = Number(step.slice(5));
        return Promise.reject(Object.assign(new Error(`[${status} x] boom`), { status }));
      }
      return new Promise(() => {}); // hang forever
    }),
  };
  return { model, calls };
}

const opts = { hedgeAfterMs: 8_000, timeoutMs: 25_000 };

describe("hedgedGenerate", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("returns a fast answer without sending a backup", async () => {
    const { model } = scriptedModel(["ok:first"]);
    await expect(hedgedGenerate(model, {}, opts)).resolves.toEqual({ value: "first" });
    jest.advanceTimersByTime(30_000);
    expect(model.generateContent).toHaveBeenCalledTimes(1);
  });

  it("sends a backup after 8s when the first call hangs, uses it, and aborts the first", async () => {
    const { model, calls } = scriptedModel(["hang", "ok:backup"]);
    const promise = hedgedGenerate(model, {}, opts);
    await jest.advanceTimersByTimeAsync(7_999);
    expect(model.generateContent).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toEqual({ value: "backup" });
    expect(calls[0].aborted).toBe(true);
  });

  it("fails with a TimeoutError at 25s when both calls hang", async () => {
    const { model, calls } = scriptedModel(["hang", "hang"]);
    const promise = hedgedGenerate(model, {}, opts);
    const assertion = expect(promise).rejects.toMatchObject({ name: "TimeoutError" });
    await jest.advanceTimersByTimeAsync(25_000);
    await assertion;
    expect(calls.every((c) => c.aborted)).toBe(true);
  });

  it("launches the backup immediately when the first fails with a transient error", async () => {
    const { model } = scriptedModel(["fail:503", "ok:backup"]);
    await expect(hedgedGenerate(model, {}, opts)).resolves.toEqual({ value: "backup" });
    expect(model.generateContent).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-transient error such as a bad key", async () => {
    const { model } = scriptedModel(["fail:403"]);
    await expect(hedgedGenerate(model, {}, opts)).rejects.toMatchObject({ status: 403 });
    expect(model.generateContent).toHaveBeenCalledTimes(1);
  });

  it("does not send a backup on a 429 quota error (it would only burn more quota)", async () => {
    const { model } = scriptedModel(["fail:429", "ok:backup"]);
    await expect(hedgedGenerate(model, {}, opts)).rejects.toMatchObject({ status: 429 });
    jest.advanceTimersByTime(30_000);
    expect(model.generateContent).toHaveBeenCalledTimes(1);
  });

  it("passes the error on when both attempts fail", async () => {
    const { model } = scriptedModel(["fail:503", "fail:503"]);
    await expect(hedgedGenerate(model, {}, opts)).rejects.toMatchObject({ status: 503 });
    expect(model.generateContent).toHaveBeenCalledTimes(2);
  });
});

describe("hedgedGenerate metering and caller abort", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("reports every request it sent: the winner and the aborted loser", async () => {
    const { model } = scriptedModel(["hang", "ok:backup"]);
    let reported;
    const promise = hedgedGenerate(model, {}, { ...opts, onAttempts: (list) => { reported = list; } });
    await jest.advanceTimersByTimeAsync(8_000);
    await promise;
    expect(reported.map((a) => [a.attempt, a.outcome])).toEqual([[1, "aborted"], [2, "won"]]);
  });

  it("reports a single attempt when the first call answers", async () => {
    const { model } = scriptedModel(["ok:first"]);
    let reported;
    await hedgedGenerate(model, {}, { ...opts, onAttempts: (list) => { reported = list; } });
    expect(reported).toEqual([expect.objectContaining({ attempt: 1, outcome: "won" })]);
  });

  it("stops everything when the caller aborts, and sends no backup afterwards", async () => {
    const { model, calls } = scriptedModel(["hang", "ok:backup"]);
    const controller = new AbortController();
    const promise = hedgedGenerate(model, {}, { ...opts, signal: controller.signal });
    const assertion = expect(promise).rejects.toMatchObject({ name: "TimeoutError", aborted: true });
    await jest.advanceTimersByTimeAsync(1_000);
    controller.abort();
    await assertion;
    await jest.advanceTimersByTimeAsync(30_000);
    expect(model.generateContent).toHaveBeenCalledTimes(1);
    expect(calls[0].aborted).toBe(true);
  });

  it("does not start at all when the signal is already aborted", async () => {
    const { model } = scriptedModel(["ok:first"]);
    const controller = new AbortController();
    controller.abort();
    await expect(hedgedGenerate(model, {}, { ...opts, signal: controller.signal })).rejects.toMatchObject({ aborted: true });
    expect(model.generateContent).not.toHaveBeenCalled();
  });
});
