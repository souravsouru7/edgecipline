

const mockGenerate = jest.fn();
jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({ generateContentStream: mockGenerate }),
  })),
}));
jest.mock("../../models/CoachConversation", () => ({ updateOne: jest.fn() }));
jest.mock("../../models/CoachMessage", () => ({ create: jest.fn(async () => ({ _id: "a1" })) }));
jest.mock("../../services/coachContextService", () => ({
  resolveMarket: jest.fn(async () => "Forex"),
  getContext: jest.fn(async () => ({ context: {}, digest: { sourceHash: "h" }, cached: true })),
}));
jest.mock("../../services/coachQuotaService", () => ({}));
jest.mock("../../utils/aiUsage", () => ({
  recordAiUsage: jest.fn(),
  isOverDailyBudget: jest.fn(async () => false),
}));
jest.mock("../../utils/geminiCircuit", () => ({
  isOpen: jest.fn(async () => false),
  recordSuccess: jest.fn(async () => {}),
  recordFailure: jest.fn(async () => {}),
  noteUserFacingFailure: jest.fn(async () => {}),
}));
jest.mock("../../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const { appConfig } = require("../../config");
const { recordAiUsage } = require("../../utils/aiUsage");
const coachChatService = require("../../services/coachChatService");

function streamOf(text, usageMetadata) {
  return {
    stream: (async function* gen() { yield { text: () => text }; })(),
    response: Promise.resolve({ usageMetadata }),
  };
}

describe("coach usage metering", () => {
  const savedKey = appConfig.ai.geminiApiKey;
  beforeAll(() => { appConfig.ai.geminiApiKey = "test"; });
  afterAll(() => { appConfig.ai.geminiApiKey = savedKey; });

  it("records the failed first attempt and the successful retry", async () => {
    const transient = Object.assign(new Error("[503 Service Unavailable] overloaded"), { status: 503 });
    mockGenerate
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(streamOf("Wait for the candle close tomorrow.", { promptTokenCount: 3000, candidatesTokenCount: 40, totalTokenCount: 3040 }));

    await coachChatService.streamCompletion({
      conversation: { _id: "c1", market: "Forex", anchor: { kind: "freeform" } },
      user: { _id: "u1" },
      history: [],
      userMessage: { _id: "m1", content: "Where am I at?" },
    });

    expect(recordAiUsage).toHaveBeenCalledTimes(2);
    expect(recordAiUsage).toHaveBeenNthCalledWith(1, expect.objectContaining({ feature: "coach", ok: false, attempt: 1, operationId: "m1", errorCode: "COACH_BUSY" }));
    expect(recordAiUsage).toHaveBeenNthCalledWith(2, expect.objectContaining({ feature: "coach", ok: true, attempt: 2, operationId: "m1" }));
  });
});
