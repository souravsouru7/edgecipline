// The OCR-text extraction chain used to be able to send up to 8 Gemini
// requests, some of them after the caller had already timed out. It must now
// send at most 3 (hedged pair + one compact retry), none after the deadline.

jest.mock("../../config/redis", () => ({ client: {}, isRedisReady: jest.fn(() => false) }));
jest.mock("../../config/sentry", () => ({ captureOperationalError: jest.fn() }));
jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../utils/aiUsage", () => ({
  recordAiUsage: jest.fn(),
  readOpenAiUsage: jest.fn(() => ({})),
  isOverDailyBudget: jest.fn(async () => false),
}));

const calls = [];
jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({
      generateContent: (request, { signal }) => {
        const call = { at: Date.now(), aborted: false };
        calls.push(call);
        signal.addEventListener("abort", () => { call.aborted = true; });
        return new Promise(() => {}); // always hangs
      },
    }),
  })),
}));

const { appConfig } = require("../../config");
const circuit = require("../../utils/geminiCircuit");

const OCR_TEXT = "MetaTrader 5 History EURUSD buy 0.10 1.08500 -> 1.09000 profit 50.00 S/L 1.08000 T/P 1.09500";

describe("trade_text request budget", () => {
  const saved = { ...appConfig.ai };

  beforeEach(() => {
    calls.length = 0;
    circuit.reset();
    jest.useFakeTimers();
    appConfig.ai.geminiApiKey = "test-key";
    appConfig.ai.openaiApiKey = "";
    appConfig.ai.hedgeAfterMs = 8_000;
    appConfig.ai.extractionTimeoutMs = 25_000;
    appConfig.ai.circuit = { failureThreshold: 100, windowMs: 60_000, openMs: 60_000 };
  });

  afterEach(() => {
    jest.useRealTimers();
    Object.assign(appConfig.ai, saved);
  });

  it("sends at most 3 requests and none after the deadline when Gemini hangs", async () => {
    const { extractTradeWithAI } = require("../../services/aiExtractionService");
    const start = Date.now();
    const deadlineAt = start + 45_000;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 45_000);

    const promise = extractTradeWithAI(OCR_TEXT, { marketType: "Forex", deadlineAt, signal: controller.signal });
    await jest.advanceTimersByTimeAsync(120_000);
    await expect(promise).resolves.toBeNull();

    expect(calls.length).toBeLessThanOrEqual(3);
    expect(calls.every((c) => c.at - start < 45_000)).toBe(true);
    expect(calls.every((c) => c.aborted)).toBe(true);
  });

  it("skips the compact retry when too little of the budget is left", async () => {
    const { extractTradeWithAI } = require("../../services/aiExtractionService");
    const deadlineAt = Date.now() + 30_000;
    const promise = extractTradeWithAI(OCR_TEXT, { marketType: "Forex", deadlineAt });
    await jest.advanceTimersByTimeAsync(60_000);
    await expect(promise).resolves.toBeNull();
    // hedged pair only: 25s first run leaves 5s, under the 8s retry window
    expect(calls.length).toBe(2);
  });
});
