// The trade log's filters now run in the database. These cover the query the
// list, the count and the header totals all share, plus the keyset cursor
// that replaced skip/limit.
jest.mock("../../models/Trade", () => ({
  find: jest.fn(),
  countDocuments: jest.fn(),
  aggregate: jest.fn(),
}));

const Trade = require("../../models/Trade");
const repo = require("../../repositories/trade.repository");

const USER = "507f1f77bcf86cd799439011";

function mockFindReturning(rows) {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(rows),
  };
  Trade.find.mockReturnValue(chain);
  return chain;
}

describe("buildForexListQuery", () => {
  it("keeps the base visibility rules", () => {
    const q = repo.buildForexListQuery(USER);
    expect(q.deletedAt).toBeNull();
    expect(q.marketType).toEqual({ $ne: "Indian_Market" });
    expect(q.status).toEqual({ $nin: ["pending", "processing", "failed"] });
  });

  it("maps LONG and SHORT onto the stored BUY/SELL", () => {
    expect(repo.buildForexListQuery(USER, { direction: "LONG" }).type).toBe("BUY");
    expect(repo.buildForexListQuery(USER, { direction: "SHORT" }).type).toBe("SELL");
    expect(repo.buildForexListQuery(USER, { direction: "ALL" }).type).toBeUndefined();
  });

  it("searches the symbol by anchored prefix so the index can bound it", () => {
    const q = repo.buildForexListQuery(USER, { search: "eur" });
    expect(q.pair.$regex).toBe("^eur");
    expect(q.pair.$options).toBe("i");
  });

  it("neutralises regex characters a trader might type", () => {
    const q = repo.buildForexListQuery(USER, { search: "EUR/USD" });
    // The slash must match literally, not act as a delimiter.
    // Every non-alphanumeric character is escaped, including the slash, which
    // is harmless in a regex and keeps the rule simple.
    expect(q.pair.$regex.startsWith("^EUR")).toBe(true);
    expect(new RegExp(q.pair.$regex, "i").test("EUR/USD")).toBe(true);
    expect(new RegExp(q.pair.$regex, "i").test("EURXUSD")).toBe(false);
  });

  it("treats an ISO day as a date filter, not a symbol", () => {
    const q = repo.buildForexListQuery(USER, { search: "2026-10-08" });
    expect(q.pair).toBeUndefined();
    expect(q.effectiveTradeDate.$gte.toISOString()).toBe("2026-10-08T00:00:00.000Z");
    expect(q.effectiveTradeDate.$lt.toISOString()).toBe("2026-10-09T00:00:00.000Z");
  });

  it("does not let a date search widen the selected period", () => {
    const periodStart = new Date("2026-10-01T00:00:00.000Z");
    const q = repo.buildForexListQuery(USER, { dateFrom: periodStart, search: "2026-01-05" });
    // The searched day predates the period, so the stricter bound wins and the
    // range is empty rather than silently reaching outside the period.
    expect(q.effectiveTradeDate.$gte).toEqual(periodStart);
    expect(q.effectiveTradeDate.$lt.toISOString()).toBe("2026-01-06T00:00:00.000Z");
  });

  it("rejects a user id that is not an ObjectId", () => {
    expect(() => repo.buildForexListQuery("not-an-id")).toThrow(TypeError);
  });
});

describe("findForexTradePage", () => {
  beforeEach(() => jest.clearAllMocks());

  it("asks for one row beyond the page to detect a next page", async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({
      _id: `id-${i}`, effectiveTradeDate: new Date("2026-10-08T00:00:00.000Z"),
    }));
    const chain = mockFindReturning(rows);

    const page = await repo.findForexTradePage(USER, { limit: 50 });

    expect(chain.limit).toHaveBeenCalledWith(51);
    expect(page.items).toHaveLength(50);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual({
      date: "2026-10-08T00:00:00.000Z",
      id: "id-49",
    });
  });

  it("reports the end of the list without a cursor", async () => {
    mockFindReturning([{ _id: "a", effectiveTradeDate: new Date() }]);
    const page = await repo.findForexTradePage(USER, { limit: 50 });
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("never calls skip", async () => {
    const chain = mockFindReturning([]);
    await repo.findForexTradePage(USER, { limit: 50, cursor: { date: "2026-10-08T00:00:00.000Z", id: "507f1f77bcf86cd799439011" } });
    expect(chain.skip).not.toHaveBeenCalled();
  });

  it("seeks past the cursor on date, breaking ties on _id", async () => {
    mockFindReturning([]);
    await repo.findForexTradePage(USER, {
      limit: 50,
      cursor: { date: "2026-10-08T00:00:00.000Z", id: "507f1f77bcf86cd799439011" },
    });
    const query = Trade.find.mock.calls[0][0];
    const keyset = query.$and[0].$or;
    expect(keyset[0].effectiveTradeDate.$lt.toISOString()).toBe("2026-10-08T00:00:00.000Z");
    // Same-day trades continue by id instead of stalling on the date.
    expect(keyset[1]._id.$lt).toBeDefined();
  });

  it("composes the cursor with the period filter instead of replacing it", async () => {
    mockFindReturning([]);
    const periodStart = new Date("2026-09-01T00:00:00.000Z");
    await repo.findForexTradePage(USER, {
      limit: 50,
      dateFrom: periodStart,
      cursor: { date: "2026-10-08T00:00:00.000Z", id: "507f1f77bcf86cd799439011" },
    });
    const query = Trade.find.mock.calls[0][0];
    expect(query.effectiveTradeDate.$gte).toEqual(periodStart);
    expect(query.$and).toHaveLength(1);
  });

  it("ignores a corrupt cursor rather than failing the request", async () => {
    mockFindReturning([]);
    await repo.findForexTradePage(USER, { limit: 50, cursor: { date: "nonsense", id: "also-nonsense" } });
    expect(Trade.find.mock.calls[0][0].$and).toBeUndefined();
  });

  it("caps the page size so a client cannot ask for everything", async () => {
    const chain = mockFindReturning([]);
    await repo.findForexTradePage(USER, { limit: 100000 });
    expect(chain.limit).toHaveBeenCalledWith(201);
  });
});

describe("count and summary use the same filters as the list", () => {
  beforeEach(() => jest.clearAllMocks());

  it("counts only the filtered trades", async () => {
    Trade.countDocuments.mockResolvedValue(3);
    await repo.countForexTradesByUser(USER, { direction: "LONG", search: "eur" });
    const q = Trade.countDocuments.mock.calls[0][0];
    expect(q.type).toBe("BUY");
    expect(q.pair.$regex).toBe("^eur");
  });

  it("totals only the filtered trades", async () => {
    Trade.aggregate.mockResolvedValue([{ totalTrades: 2, grossPnL: 10, wins: 1, losses: 1 }]);
    const summary = await repo.summarizeForexTradesByUser(USER, { direction: "SHORT" });
    expect(Trade.aggregate.mock.calls[0][0][0].$match.type).toBe("SELL");
    expect(summary.totalTrades).toBe(2);
    expect(summary.winRate).toBe(50);
  });
});
