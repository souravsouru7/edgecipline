jest.mock("../../config/redis", () => ({ client: { set: jest.fn(async () => "OK") }, isRedisReady: jest.fn(() => false) }));
jest.mock("../../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock("../../models/CoachMessage", () => ({ find: jest.fn() }));
jest.mock("../../models/CoachConversation", () => ({ updateOne: jest.fn() }));
jest.mock("../../utils/geminiCircuit", () => ({ guardedCall: jest.fn() }));

const { appConfig } = require("../../config");
const CoachMessage = require("../../models/CoachMessage");
const CoachConversation = require("../../models/CoachConversation");
const { guardedCall } = require("../../utils/geminiCircuit");
const summary = require("../../services/coachSummaryService");
const { buildModelInput } = require("../../services/coachPromptService");

const msgs = (n, startMs = Date.UTC(2026, 10, 1)) =>
  Array.from({ length: n }, (_, i) => ({
    _id: `m${i}`,
    role: i % 2 ? "assistant" : "user",
    content: `message ${i}`,
    status: "complete",
    createdAt: new Date(startMs + i * 60_000),
  }));

describe("coach summary mode", () => {
  const savedMode = appConfig.ai.coachHistoryMode;
  const savedKey = appConfig.ai.geminiApiKey;
  afterEach(() => {
    appConfig.ai.coachHistoryMode = savedMode;
    appConfig.ai.geminiApiKey = savedKey;
    jest.clearAllMocks();
  });

  it("is off by default", () => {
    expect(appConfig.ai.coachHistoryMode).toBe("full");
    expect(summary.isEnabled()).toBe(false);
  });

  it("sends everything verbatim until a summary exists, so nothing is lost", () => {
    const history = msgs(20);
    const { recent, summary: s } = summary.selectWindow(history, {});
    expect(recent).toHaveLength(20);
    expect(s).toBe("");
  });

  it("sends the last 4 turns plus the summary once older turns are summarized", () => {
    const history = msgs(20);
    const conversation = { summary: "Trader broke the 2-loss stop rule twice.", summarizedThroughAt: history[11].createdAt };
    const { recent, summary: s } = summary.selectWindow(history, conversation);
    expect(recent.map((m) => m._id)).toEqual(history.slice(12).map((m) => m._id));
    expect(s).toMatch(/2-loss stop rule/);
  });

  it("still sends older messages the summary has not covered yet", () => {
    const history = msgs(20);
    const conversation = { summary: "x", summarizedThroughAt: history[5].createdAt };
    const { recent } = summary.selectWindow(history, conversation);
    expect(recent[0]._id).toBe("m6");
    expect(recent).toHaveLength(14);
  });

  it("puts the summary after the trader context, before the recent turns", () => {
    const input = buildModelInput({ context: { a: 1 }, history: msgs(2), nextUserMessage: "q", conversationSummary: "SUMMARY" });
    const texts = input.contents.map((c) => c.parts[0].text);
    expect(texts[0]).toMatch(/^Trader Context/);
    expect(texts[2]).toMatch(/SUMMARY/);
    expect(texts[texts.length - 1]).toBe("q");
  });

  it("leaves the prompt unchanged when there is no summary", () => {
    const a = buildModelInput({ context: { a: 1 }, history: msgs(2), nextUserMessage: "q" });
    const b = buildModelInput({ context: { a: 1 }, history: msgs(2), nextUserMessage: "q", conversationSummary: "" });
    expect(b).toEqual(a);
  });

  it("asks the summarizer to keep rules, mistakes, decisions and emotions", () => {
    const prompt = summary.buildSummaryPrompt({ previousSummary: "", messages: msgs(4) });
    for (const word of [/rules/i, /Mistakes/i, /Decisions/i, /Emotional/i, /Do not invent/i]) expect(prompt).toMatch(word);
  });

  it("does nothing while the mode is off", async () => {
    appConfig.ai.coachHistoryMode = "full";
    await expect(summary.refreshIfNeeded({ conversation: { _id: "c1" } })).resolves.toBeNull();
    expect(CoachMessage.find).not.toHaveBeenCalled();
  });

  it("folds only messages older than the recent window, and only 4 or more", async () => {
    appConfig.ai.coachHistoryMode = "summary";
    appConfig.ai.geminiApiKey = "k";
    const chain = (rows) => ({ sort: () => ({ limit: () => ({ lean: () => Promise.resolve(rows) }) }) });

    CoachMessage.find.mockReturnValueOnce(chain(msgs(10)));
    await expect(summary.refreshIfNeeded({ conversation: { _id: "c1" } })).resolves.toBeNull();
    expect(guardedCall).not.toHaveBeenCalled();

    const rows = msgs(12);
    CoachMessage.find.mockReturnValueOnce(chain(rows));
    guardedCall.mockResolvedValueOnce({ response: { text: () => "Updated summary" } });
    const out = await summary.refreshIfNeeded({ conversation: { _id: "c1" }, userId: "u1" });
    expect(out.summarizedThroughAt).toEqual(rows[3].createdAt);
    expect(guardedCall).toHaveBeenCalledWith(expect.objectContaining({ feature: "coach_summary" }));
    expect(CoachConversation.updateOne).toHaveBeenCalledWith(
      { _id: "c1" },
      { $set: expect.objectContaining({ summary: "Updated summary" }) }
    );
  });
});
