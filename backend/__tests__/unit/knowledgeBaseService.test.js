"use strict";

/**
 * Knowledge-base behaviour: what a reader can reach, what happens when a
 * search finds nothing, and the guarantee that one reader counts once.
 */

const ARTICLE_ID = "a".repeat(24);
const USER_ID = "b".repeat(24);

function query(result) {
  const chain = {};
  for (const method of ["select", "sort", "skip", "limit", "populate"]) {
    chain[method] = jest.fn(() => chain);
  }
  chain.lean = jest.fn().mockResolvedValue(result);
  return chain;
}

let Article;
let Feedback;
let service;

beforeEach(() => {
  jest.resetModules();

  Article = {
    find: jest.fn(() => query([])),
    findOne: jest.fn(() => query(null)),
    findById: jest.fn(() => query(null)),
    findByIdAndUpdate: jest.fn(() => query(null)),
    create: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue([]),
  };

  Feedback = {
    create: jest.fn().mockResolvedValue({}),
    find: jest.fn(() => query([])),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 3 }),
  };

  jest.doMock("../../models/KnowledgeBaseArticle", () => Article);
  jest.doMock("../../models/ArticleFeedback", () => Feedback);
  jest.doMock("../../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  }));

  service = require("../../services/knowledgeBase.service");
});

describe("slugify", () => {
  it("produces a safe kebab-case slug", () => {
    expect(service.slugify("Why was I charged TWICE?!")).toBe("why-was-i-charged-twice");
    expect(service.slugify("  Spaces   &   symbols  ")).toBe("spaces-symbols");
    expect(service.slugify("已经付款")).toBe("");
  });
});

describe("search", () => {
  it("browses by category when no term is given", async () => {
    const result = await service.searchArticles({ category: "payments" });

    expect(result.matchedBy).toBe("browse");
    const filter = Article.find.mock.calls[0][0];
    // Only published articles are ever reachable by a reader.
    expect(filter.status).toBe("published");
    expect(filter.category).toBe("payments");
    expect(filter.$text).toBeUndefined();
  });

  it("uses the text index for a real term", async () => {
    Article.countDocuments.mockResolvedValue(2);
    Article.find.mockReturnValue(query([{ slug: "a", title: "A", category: "payments" }]));

    const result = await service.searchArticles({ q: "refund" });

    expect(result.matchedBy).toBe("text");
    expect(Article.find.mock.calls[0][0].$text).toEqual({ $search: "refund" });
  });

  it("falls back to a substring match when the text index finds nothing", async () => {
    // An empty result page is the moment a customer gives up on self-service
    // and opens a ticket, so a near-miss must not dead-end them.
    Article.countDocuments.mockResolvedValueOnce(0).mockResolvedValue(1);
    Article.find
      .mockReturnValueOnce(query([]))
      .mockReturnValue(query([{ slug: "subscription", title: "Subscription", category: "subscription_billing" }]));

    const result = await service.searchArticles({ q: "subscri" });

    expect(result.matchedBy).toBe("partial");
    expect(result.items).toHaveLength(1);
    const fallbackFilter = Article.find.mock.calls[1][0];
    expect(fallbackFilter.$or).toBeTruthy();
    expect(fallbackFilter.status).toBe("published");
  });

  it("corrects a misspelling when neither exact nor substring matching helps", async () => {
    // "analitics" shares no substring with "analytics" — the letters are not
    // there. Only word-by-word comparison can recover this.
    Article.countDocuments
      .mockResolvedValueOnce(0)   // text pass
      .mockResolvedValueOnce(0)   // substring pass
      .mockResolvedValue(3);      // fuzzy scan size
    Article.find
      .mockReturnValueOnce(query([]))
      .mockReturnValueOnce(query([]))
      .mockReturnValue(
        query([
          { slug: "understanding-your-analytics", title: "Making sense of your analytics", category: "analytics_reports", tags: [] },
          { slug: "signing-in-problems", title: "I cannot sign in", category: "account_profile", tags: [] },
        ])
      );

    const result = await service.searchArticles({ q: "analitics" });

    expect(result.matchedBy).toBe("fuzzy");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].slug).toBe("understanding-your-analytics");
  });

  it("skips the in-memory fuzzy scan once the knowledge base is large", async () => {
    Article.countDocuments
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValue(5000);   // past FUZZY_SCAN_LIMIT
    Article.find.mockReturnValue(query([]));

    const result = await service.searchArticles({ q: "analitics" });

    // Degrades to "no match" rather than scanning thousands of documents.
    expect(result.matchedBy).toBe("none");
  });

  it("reports 'none' rather than pretending a loose match is an answer", async () => {
    Article.countDocuments.mockResolvedValue(0);
    Article.find.mockReturnValue(query([]));
    const result = await service.searchArticles({ q: "zzzzzz" });
    expect(result.matchedBy).toBe("none");
    expect(result.items).toEqual([]);
  });

  it("escapes regex metacharacters in the fallback term", async () => {
    Article.countDocuments.mockResolvedValue(0);
    Article.find.mockReturnValue(query([]));
    await service.searchArticles({ q: "c++ (beta) [v2]" });

    const fallbackFilter = Article.find.mock.calls[1][0];
    const pattern = fallbackFilter.$or[0].title.$regex;
    // Unescaped, this is either a regex-injection or a catastrophic backtrack.
    expect(pattern).toContain("\\+");
    expect(pattern).toContain("\\(");
    expect(() => new RegExp(pattern)).not.toThrow();
  });

  it("clamps the page size", async () => {
    await service.searchArticles({ limit: 9999 });
    const chain = Article.find.mock.results[0].value;
    expect(chain.limit).toHaveBeenCalledWith(50);
  });
});

describe("reading one article", () => {
  it("only resolves published articles", async () => {
    Article.findOne.mockReturnValue(query(null));

    // A draft slug 404s exactly like a slug that never existed — an editor's
    // unfinished work is not readable by guessing a URL.
    await expect(service.getArticle("secret-draft")).rejects.toMatchObject({ statusCode: 404 });
    expect(Article.findOne.mock.calls[0][0].status).toBe("published");
  });

  it("normalises the slug so casing and padding cannot bypass the lookup", async () => {
    Article.findOne.mockReturnValue(query(null));
    await expect(service.getArticle("  Getting-STARTED  ")).rejects.toMatchObject({ statusCode: 404 });
    expect(Article.findOne.mock.calls[0][0].slug).toBe("getting-started");
  });

  it("resolves related articles to what is currently published", async () => {
    Article.findOne.mockReturnValue(
      query({
        _id: ARTICLE_ID,
        slug: "billing",
        title: "Billing",
        category: "payments",
        bodyMarkdown: "# Billing",
        relatedSlugs: ["refunds", "deleted-article"],
      })
    );
    Article.find.mockReturnValue(query([{ slug: "refunds", title: "Refunds", category: "payments" }]));

    const article = await service.getArticle("billing");

    // A slug that has since been archived simply does not appear, rather than
    // rendering a link that 404s the reader.
    expect(article.related).toHaveLength(1);
    expect(Article.find.mock.calls[0][0].status).toBe("published");
  });

  it("does not fail the read when the view counter cannot be written", async () => {
    Article.findOne.mockReturnValue(
      query({ _id: ARTICLE_ID, slug: "x", title: "X", category: "other", bodyMarkdown: "b", relatedSlugs: [] })
    );
    Article.find.mockReturnValue(query([]));
    Article.updateOne.mockRejectedValue(new Error("write concern failed"));

    // A popularity counter must never turn a readable article into an error.
    await expect(service.getArticle("x")).resolves.toMatchObject({ slug: "x" });
  });
});

describe("article feedback", () => {
  beforeEach(() => {
    Article.findOne.mockReturnValue(query({ _id: ARTICLE_ID }));
  });

  it("records a vote and bumps the cached counter", async () => {
    const result = await service.submitFeedback({ slug: "x", user: null, fingerprint: "fp1", helpful: true });

    expect(result.counted).toBe(true);
    expect(Feedback.create).toHaveBeenCalledWith(expect.objectContaining({ helpful: true, fingerprint: "fp1" }));
    expect(Article.updateOne.mock.calls[0][1]).toEqual({ $inc: { helpfulCount: 1 } });
  });

  it("keys a signed-in reader on their account, not a browser fingerprint", async () => {
    await service.submitFeedback({ slug: "x", user: { _id: USER_ID }, fingerprint: "fp1", helpful: false });

    const doc = Feedback.create.mock.calls[0][0];
    // So voting from a phone and a laptop still counts once.
    expect(String(doc.user)).toBe(USER_ID);
    expect(doc.fingerprint).toBeNull();
    expect(Article.updateOne.mock.calls[0][1]).toEqual({ $inc: { notHelpfulCount: 1 } });
  });

  it("treats a repeat vote as success without double-counting", async () => {
    const duplicate = Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    Feedback.create.mockRejectedValue(duplicate);

    const result = await service.submitFeedback({ slug: "x", user: null, fingerprint: "fp1", helpful: true });

    // The unique index is the control; an error here would only invite the
    // reader to click again.
    expect(result).toEqual({ counted: false, reason: "already_voted" });
    expect(Article.updateOne).not.toHaveBeenCalled();
  });

  it("refuses feedback on an article that is not published", async () => {
    Article.findOne.mockReturnValue(query(null));
    await expect(
      service.submitFeedback({ slug: "draft", user: null, fingerprint: "fp", helpful: true })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("derives a fingerprint that is stable but not reversible to an IP", () => {
    const req = { ip: "203.0.113.9", get: () => "Mozilla/5.0" };
    const a = service.fingerprintFor(req);
    const b = service.fingerprintFor(req);
    const other = service.fingerprintFor({ ip: "198.51.100.4", get: () => "Mozilla/5.0" });

    expect(a).toBe(b);
    expect(a).not.toBe(other);
    expect(a).not.toContain("203.0.113.9");
    expect(a).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe("authoring", () => {
  it("generates a slug from the title when none is given", async () => {
    Article.create.mockResolvedValue({
      toObject: () => ({ _id: ARTICLE_ID, slug: "how-do-i-cancel", title: "How do I cancel?", category: "other", status: "draft" }),
    });

    await service.createArticle({ author: { _id: USER_ID }, body: { title: "How do I cancel?", bodyMarkdown: "x", category: "other" } });

    expect(Article.create.mock.calls[0][0].slug).toBe("how-do-i-cancel");
  });

  it("reports a slug collision as a conflict rather than a 500", async () => {
    Article.create.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));

    await expect(
      service.createArticle({ author: { _id: USER_ID }, body: { title: "Billing", bodyMarkdown: "x", category: "payments" } })
    ).rejects.toMatchObject({ statusCode: 409, errorCode: "DUPLICATE_RESOURCE" });
  });

  it("locks the slug once an article is published", async () => {
    Article.findById.mockReturnValue(query({ _id: ARTICLE_ID, status: "published", slug: "live-article" }));
    Article.findByIdAndUpdate.mockReturnValue(query({ _id: ARTICLE_ID, slug: "live-article", title: "T", category: "other", status: "published" }));

    await service.updateArticle({ id: ARTICLE_ID, editor: { _id: USER_ID }, body: { slug: "renamed" } });

    // Renaming a published slug breaks every bookmark and cross-reference.
    expect(Article.findByIdAndUpdate.mock.calls[0][1].$set.slug).toBeUndefined();
  });

  it("allows a slug change while still a draft", async () => {
    Article.findById.mockReturnValue(query({ _id: ARTICLE_ID, status: "draft", slug: "old" }));
    Article.findByIdAndUpdate.mockReturnValue(query({ _id: ARTICLE_ID, slug: "new-name", title: "T", category: "other", status: "draft" }));

    await service.updateArticle({ id: ARTICLE_ID, editor: { _id: USER_ID }, body: { slug: "New Name" } });

    expect(Article.findByIdAndUpdate.mock.calls[0][1].$set.slug).toBe("new-name");
  });

  it("stamps publishedAt on first publication only", async () => {
    Article.findById.mockReturnValue(query({ _id: ARTICLE_ID, status: "draft", publishedAt: null }));
    Article.findByIdAndUpdate.mockReturnValue(query({ _id: ARTICLE_ID, slug: "x", title: "T", category: "other", status: "published" }));

    await service.changeArticleStatus({ id: ARTICLE_ID, status: "published", editor: { _id: USER_ID } });
    expect(Article.findByIdAndUpdate.mock.calls[0][1].$set.publishedAt).toBeInstanceOf(Date);

    // Republishing after a typo fix must not make a year-old article look new.
    Article.findById.mockReturnValue(query({ _id: ARTICLE_ID, status: "draft", publishedAt: new Date("2026-01-01") }));
    Article.findByIdAndUpdate.mockClear();
    await service.changeArticleStatus({ id: ARTICLE_ID, status: "published", editor: { _id: USER_ID } });
    expect(Article.findByIdAndUpdate.mock.calls[0][1].$set.publishedAt).toBeUndefined();
  });

  it("removes reader feedback along with a deleted article", async () => {
    Article.findById.mockReturnValue(query({ _id: ARTICLE_ID, slug: "gone" }));

    await service.deleteArticle(ARTICLE_ID);

    // Feedback rows are meaningless once the article they describe is gone.
    expect(Feedback.deleteMany).toHaveBeenCalledWith({ article: ARTICLE_ID });
    expect(Article.deleteOne).toHaveBeenCalledWith({ _id: ARTICLE_ID });
  });
});

describe("ticket deflection", () => {
  it("retries without the category filter before giving up", async () => {
    Article.countDocuments.mockResolvedValue(0);
    Article.find.mockReturnValue(query([]));

    await service.suggestForTicket({ category: "payments", subject: "double charged on my card" });

    // The customer's guess at a category is often the reason a good article
    // did not surface, so a category-scoped miss is retried broadly.
    const filtersWithCategory = Article.find.mock.calls.filter(([f]) => f.category === "payments");
    const filtersWithout = Article.find.mock.calls.filter(([f]) => !f.category);
    expect(filtersWithCategory.length).toBeGreaterThan(0);
    expect(filtersWithout.length).toBeGreaterThan(0);
  });

  it("falls back to the category listing for a too-short subject", async () => {
    Article.find.mockReturnValue(query([{ slug: "start", title: "Start", category: "getting_started" }]));
    const items = await service.suggestForTicket({ category: "getting_started", subject: "hi" });
    expect(items).toHaveLength(1);
  });
});
