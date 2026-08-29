"use strict";

/**
 * The assistant's safety guarantee.
 *
 * The whole reason this is retrieval-only is that a support bot which composes
 * its own prose will eventually state a refund policy nobody wrote, and the
 * customer will hold the business to it. These tests pin that down:
 *
 *   1. Money, account-security, data-loss and complaint questions NEVER get an
 *      article — they go straight to a human.
 *   2. Nothing the assistant says is generated. Every reply is either a fixed
 *      string from the service or an article a human published.
 */

let knowledgeBase;
let assistant;

const ARTICLE = {
  slug: "importing-trades-from-a-screenshot",
  title: "Importing trades from a broker screenshot",
  excerpt: "How screenshot extraction works.",
  category: "trade_import",
};

beforeEach(() => {
  jest.resetModules();

  knowledgeBase = {
    searchArticles: jest.fn().mockResolvedValue({ items: [], pagination: {}, matchedBy: "none" }),
  };

  jest.doMock("../../services/knowledgeBase.service", () => knowledgeBase);
  jest.doMock("../../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  }));

  assistant = require("../../services/supportAssistant.service");
});

describe("sensitive questions never receive an article", () => {
  const MONEY = [
    "I was charged twice this month",
    "money deducted but plan not active",
    "i paid but nothing happened",
    "please refund my payment",
    "double charge on my card",
    "upi payment failed",
    "₹1299 debited and no premium",
    "my bank shows two payments",
    "where is my invoice",
  ];

  it.each(MONEY)("routes %p straight to a human", async (text) => {
    const result = await assistant.answer({ text });

    expect(result.outcome).toBe("escalate");
    expect(result.reason).toBe("money");
    expect(result.category).toBe("payments");
    expect(result.articles).toEqual([]);
    // The knowledge base is not even consulted — there is no code path where a
    // payment question gets answered from an article.
    expect(knowledgeBase.searchArticles).not.toHaveBeenCalled();
  });

  const SECURITY = [
    "my account is hacked",
    "someone else logged into my account",
    "unauthorized access to my profile",
    "i think this is a scam message",
  ];

  it.each(SECURITY)("routes %p to a human", async (text) => {
    const result = await assistant.answer({ text });
    expect(result.outcome).toBe("escalate");
    expect(result.reason).toBe("account_security");
    expect(knowledgeBase.searchArticles).not.toHaveBeenCalled();
  });

  const DATA_LOSS = ["all my trades are gone", "my journal disappeared", "you deleted my data"];

  it.each(DATA_LOSS)("routes %p to a human", async (text) => {
    const result = await assistant.answer({ text });
    expect(result.outcome).toBe("escalate");
    expect(result.reason).toBe("data_loss");
  });

  it("routes a complaint to a human rather than arguing", async () => {
    const result = await assistant.answer({ text: "this app is pathetic, I want to complain" });
    expect(result.outcome).toBe("escalate");
    expect(result.reason).toBe("complaint");
  });

  it("escalates even when the knowledge base has a matching article", async () => {
    // The article exists and would match. It is still not offered.
    knowledgeBase.searchArticles.mockResolvedValue({
      items: [{ slug: "payment-taken-but-plan-not-active", title: "I paid but my plan is not active", category: "payments" }],
      matchedBy: "text",
    });

    const result = await assistant.answer({ text: "charged twice, need a refund" });

    expect(result.outcome).toBe("escalate");
    expect(result.articles).toEqual([]);
  });
});

describe("ordinary questions get articles", () => {
  it("returns matching articles for a product question", async () => {
    knowledgeBase.searchArticles.mockResolvedValue({ items: [ARTICLE], matchedBy: "text" });

    const result = await assistant.answer({ text: "the ocr is not reading my screenshot" });

    expect(result.outcome).toBe("articles");
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].slug).toBe(ARTICLE.slug);
    expect(result.category).toBe("trade_import");
  });

  it("says so plainly when the match is only partial", async () => {
    knowledgeBase.searchArticles.mockResolvedValue({ items: [ARTICLE], matchedBy: "partial" });

    const result = await assistant.answer({ text: "screenshto not workingg" });

    // Presenting a loose match as a confident answer wastes the customer's time.
    expect(result.message).toMatch(/not find an exact match/i);
  });

  it("retries without the category filter before giving up", async () => {
    knowledgeBase.searchArticles
      .mockResolvedValueOnce({ items: [], matchedBy: "none" })
      .mockResolvedValue({ items: [ARTICLE], matchedBy: "text" });

    const result = await assistant.answer({ text: "upload screenshot import problem" });

    expect(result.outcome).toBe("articles");
    expect(knowledgeBase.searchArticles).toHaveBeenCalledTimes(2);
    expect(knowledgeBase.searchArticles.mock.calls[0][0].category).toBe("trade_import");
    expect(knowledgeBase.searchArticles.mock.calls[1][0].category).toBeUndefined();
  });

  it("offers a human when nothing matches at all", async () => {
    const result = await assistant.answer({ text: "how do I export to metatrader" });

    expect(result.outcome).toBe("no_match");
    expect(result.articles).toEqual([]);
    expect(result.message).toMatch(/reach us/i);
  });

  it("asks for more detail on a one-word question", async () => {
    const result = await assistant.answer({ text: "hi" });
    expect(result.outcome).toBe("no_match");
    expect(knowledgeBase.searchArticles).not.toHaveBeenCalled();
  });
});

describe("nothing is generated", () => {
  it("only ever emits fixed service strings or published article fields", async () => {
    knowledgeBase.searchArticles.mockResolvedValue({ items: [ARTICLE], matchedBy: "text" });

    const fixedMessages = new Set([
      ...assistant.SENSITIVE_RULES.map((rule) => rule.message),
      "Tell me a little more about what is going wrong and I will find the right guide.",
      "I could not find a guide for that one. A person will be able to help — here are the fastest ways to reach us.",
      "I did not find an exact match, but this looks closest:",
      "This should cover it:",
      "This should help:",
    ]);

    for (const text of ["ocr broken", "charged twice", "hi", "how do I export to metatrader"]) {
      // eslint-disable-next-line no-await-in-loop
      const result = await assistant.answer({ text });
      expect(fixedMessages.has(result.message)).toBe(true);
    }
  });
});

describe("input handling", () => {
  it("truncates an oversized question rather than rejecting it", async () => {
    knowledgeBase.searchArticles.mockResolvedValue({ items: [], matchedBy: "none" });
    await assistant.answer({ text: "screenshot ".repeat(500) });

    const searched = knowledgeBase.searchArticles.mock.calls[0][0].q;
    expect(searched.length).toBeLessThanOrEqual(assistant.MAX_QUESTION_LENGTH);
  });

  it("survives empty, null and non-string input", async () => {
    for (const text of ["", "   ", null, undefined, 12345, {}]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(assistant.answer({ text })).resolves.toMatchObject({ articles: [] });
    }
  });

  it("matches regardless of casing and spacing", async () => {
    expect(assistant.detectSensitive(assistant.normalize("  CHARGED   TWICE  "))).toBeTruthy();
    expect(assistant.detectSensitive(assistant.normalize("Refund Please"))).toBeTruthy();
  });

  it("does not treat an ordinary question as sensitive", async () => {
    for (const text of ["how do I add a setup", "what is discipline score", "change my trading style"]) {
      expect(assistant.detectSensitive(assistant.normalize(text))).toBeNull();
    }
  });
});
