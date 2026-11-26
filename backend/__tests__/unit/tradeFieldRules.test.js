const {
  applyRiskRewardRules,
  assertOptionContract,
  assertPositiveIfChanged,
  assertTradeLevels,
  parseRiskReward,
} = require("../../utils/tradeValidation");
const { indianTradeSchemas } = require("../../validation/indianTradeSchemas");
const { tradeSchemas } = require("../../validation/schemas");

const err = (fn) => {
  try { fn(); return null; } catch (e) { return e; }
};

describe("parseRiskReward", () => {
  it.each(["ssd", "abc:2", "1:", ":2", "1:2:3", "1:2.555", "1-2"])("rejects %p", (v) => {
    expect(parseRiskReward(v).error).toBeTruthy();
  });
  it.each([["1:0"], ["0:2"]])("rejects a zero side %p", (v) => {
    expect(parseRiskReward(v).error).toMatch(/above 0/);
  });
  it("rejects absurd sides", () => {
    expect(parseRiskReward("1:500").error).toMatch(/100/);
  });
  it.each([["1:2.5", "1:2.5"], ["1 : 2", "1:2"], ["1/3", "1:3"], ["2.5", "1:2.5"], ["1.50:3", "1.5:3"]])(
    "normalises %p → %p",
    (input, out) => expect(parseRiskReward(input).value).toBe(out)
  );
  it("blank is allowed (empty)", () => expect(parseRiskReward("  ").value).toBe(""));
});

describe("applyRiskRewardRules", () => {
  it("rejects garbage custom R:R on create", () => {
    expect(err(() => applyRiskRewardRules({ riskRewardRatio: "custom", riskRewardCustom: "ssd" }))?.statusCode).toBe(400);
  });
  it("requires a value when custom is chosen", () => {
    expect(err(() => applyRiskRewardRules({ riskRewardRatio: "custom", riskRewardCustom: "" }))?.message).toMatch(/custom R:R/);
  });
  it("stores the normalised value", () => {
    const p = { riskRewardRatio: "custom", riskRewardCustom: " 2.5 " };
    applyRiskRewardRules(p);
    expect(p.riskRewardCustom).toBe("1:2.5");
  });
  it("clears stale custom text when a preset is chosen", () => {
    const p = { riskRewardRatio: "1:2", riskRewardCustom: "ssd" };
    applyRiskRewardRules(p);
    expect(p.riskRewardCustom).toBe("");
  });
  it("lets an older app resend an unchanged legacy value on edit", () => {
    const existing = { riskRewardRatio: "custom", riskRewardCustom: "ssd" };
    const p = { riskRewardRatio: "custom", riskRewardCustom: "ssd", notes: "edited" };
    expect(err(() => applyRiskRewardRules(p, existing))).toBeNull();
    expect(p.riskRewardCustom).toBe("ssd");
  });
  it("blocks changing it to a new bad value on edit", () => {
    const existing = { riskRewardRatio: "custom", riskRewardCustom: "ssd" };
    expect(err(() => applyRiskRewardRules({ riskRewardRatio: "custom", riskRewardCustom: "xyz" }, existing))?.statusCode).toBe(400);
  });
  it("accepts null ratio from legacy Forex edits", () => {
    const p = { riskRewardRatio: null };
    expect(err(() => applyRiskRewardRules(p, { riskRewardRatio: null }))).toBeNull();
  });
});

describe("assertTradeLevels", () => {
  const buy = { type: "BUY", entryPrice: 3900.07 };
  it("blocks a BUY take profit below entry", () => {
    expect(err(() => assertTradeLevels({ ...buy, takeProfit: 3890 }))?.message).toMatch(/above your entry/);
  });
  it("blocks a SELL take profit above entry", () => {
    expect(err(() => assertTradeLevels({ type: "SELL", entryPrice: 100, takeProfit: 110 }))?.message).toMatch(/below your entry/);
  });
  it("allows a trailed / break-even stop beyond entry", () => {
    expect(err(() => assertTradeLevels({ ...buy, stopLoss: 3905, takeProfit: 3950 }))).toBeNull();
  });
  it("blocks equal SL and TP, and negative levels", () => {
    expect(err(() => assertTradeLevels({ ...buy, stopLoss: 3950, takeProfit: 3950 }))?.message).toMatch(/same price/);
    expect(err(() => assertTradeLevels({ ...buy, stopLoss: -1 }))?.statusCode).toBe(400);
  });
  it("treats 0 / blank as not set", () => {
    expect(err(() => assertTradeLevels({ ...buy, stopLoss: 0, takeProfit: "" }))).toBeNull();
  });
  it("on edit, ignores unchanged legacy levels", () => {
    const existing = { ...buy, takeProfit: 3890 };
    expect(err(() => assertTradeLevels({ ...existing, notes: "x" }, existing))).toBeNull();
    expect(err(() => assertTradeLevels({ ...existing, takeProfit: 3880 }, existing))?.statusCode).toBe(400);
  });
});

describe("assertPositiveIfChanged / assertOptionContract", () => {
  it("rejects a changed non-positive price, ignores unchanged", () => {
    expect(err(() => assertPositiveIfChanged({ entryPrice: 0 }, { entryPrice: 5 }, [["entryPrice", "Entry price"]]))?.message).toMatch(/Entry price/);
    expect(err(() => assertPositiveIfChanged({ entryPrice: 5 }, { entryPrice: 5 }, [["entryPrice", "Entry price"]]))).toBeNull();
  });
  it("expiry can't be before the trade date; decimal strikes are fine", () => {
    expect(err(() => assertOptionContract({ strikePrice: 112.5, expiryDate: "2026-11-20", tradeDate: new Date("2026-11-25") }))?.message).toMatch(/Expiry/);
    expect(err(() => assertOptionContract({ strikePrice: 112.5, expiryDate: "2026-11-27", tradeDate: new Date("2026-11-25") }))).toBeNull();
    expect(err(() => assertOptionContract({ strikePrice: 0 }))?.message).toMatch(/Strike/);
  });
  it("skips equity", () => {
    expect(err(() => assertOptionContract({ instrumentType: "EQUITY", strikePrice: 0 }))).toBeNull();
  });
});

describe("schemas", () => {
  const parse = (schema, body) => schema.safeParse({ body, query: {}, params: {} });
  it("Indian create bounds numbers and text but passes unknown keys", () => {
    expect(parse(indianTradeSchemas.create, { entryPrice: "12abc" }).success).toBe(false);
    expect(parse(indianTradeSchemas.create, { notes: "x".repeat(2001) }).success).toBe(false);
    const ok = parse(indianTradeSchemas.create, { entryPrice: "", brokerage: null, somethingNew: true });
    expect(ok.success).toBe(true);
    expect(ok.data.body.somethingNew).toBe(true);
  });
  it("Indian batch validates every item", () => {
    expect(parse(indianTradeSchemas.batchCreate, { trades: [{ exitPrice: 10 }, { exitPrice: "x" }] }).success).toBe(false);
  });
  it("Indian update tolerates legacy long text resent by old apps", () => {
    expect(parse(indianTradeSchemas.update, { lesson: "x".repeat(3000) }).success).toBe(true);
  });
  it("Forex update accepts a null riskRewardRatio (legacy trades)", () => {
    const res = tradeSchemas.update.safeParse({ body: { riskRewardRatio: null, notes: "x" }, query: {}, params: { id: "507f1f77bcf86cd799439011" } });
    expect(res.success).toBe(true);
  });
});
