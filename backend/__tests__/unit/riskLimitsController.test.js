// GET/PATCH /api/profile/risk-limits: strict validation, per-field updates.
jest.mock("../../models/Users", () => ({ findById: jest.fn(), findByIdAndUpdate: jest.fn() }));

const User = require("../../models/Users");
const { getRiskLimits, updateRiskLimits } = require("../../controllers/riskLimitsController");

const USER_ID = "507f1f77bcf86cd799439011";

function call(handler, body) {
  return new Promise((resolve) => {
    const res = { json: (data) => resolve({ data }) };
    handler({ user: { _id: USER_ID }, body }, res, (err) => resolve({ err }));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  User.findByIdAndUpdate.mockImplementation((_id, update) => ({
    lean: async () => ({ riskLimits: { Forex: { dailyLossLimit: 200 }, _set: update.$set } }),
  }));
});

const lastSet = () => User.findByIdAndUpdate.mock.calls.at(-1)[1].$set;

describe("PATCH validation", () => {
  it.each([
    ["missing market", { dailyLossLimit: 100 }],
    ["unknown market", { market: "Crypto", dailyLossLimit: 100 }],
    ["zero", { market: "Forex", dailyLossLimit: 0 }],
    ["negative", { market: "Forex", dailyLossLimit: -50 }],
    ["text", { market: "Forex", dailyLossLimit: "abc" }],
    ["too large", { market: "Forex", dailyLossLimit: 1e12 }],
    ["boolean", { market: "Forex", dailyLossLimit: true }],
    ["object", { market: "Forex", dailyLossLimit: { $gt: 0 } }],
    ["decimal trades", { market: "Forex", maxTradesPerDay: 2.5 }],
    ["zero trades", { market: "Forex", maxTradesPerDay: 0 }],
    ["over 100 trades", { market: "Forex", maxTradesPerDay: 101 }],
    ["unknown key", { market: "Forex", dailyLossLimit: 10, isAdmin: true }],
    ["promptAnswered false", { market: "Forex", promptAnswered: false }],
    ["nothing to update", { market: "Forex" }],
  ])("rejects %s with 400", async (_label, body) => {
    const { err } = await call(updateRiskLimits, body);
    expect(err?.statusCode || err?.status).toBe(400);
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});

describe("PATCH updates only what was sent", () => {
  it("sets the loss limit for one market and answers the prompt", async () => {
    await call(updateRiskLimits, { market: "Indian_Market", dailyLossLimit: "5000.505" });
    const set = lastSet();
    expect(set["riskLimits.Indian_Market.dailyLossLimit"]).toBe(5000.51);
    expect(set["riskLimits.Indian_Market.promptAnsweredAt"]).toBeInstanceOf(Date);
    expect(Object.keys(set).some((k) => k.includes("Forex"))).toBe(false);
    expect(set).not.toHaveProperty("riskLimits.Indian_Market.maxTradesPerDay");
  });

  it("null and empty string clear a limit", async () => {
    await call(updateRiskLimits, { market: "Forex", dailyLossLimit: null, maxTradesPerDay: "" });
    expect(lastSet()["riskLimits.Forex.dailyLossLimit"]).toBeNull();
    expect(lastSet()["riskLimits.Forex.maxTradesPerDay"]).toBeNull();
  });

  it("'Not now' only records the answer", async () => {
    await call(updateRiskLimits, { market: "Forex", promptAnswered: true });
    expect(Object.keys(lastSet())).toEqual(["riskLimits.Forex.promptAnsweredAt"]);
  });

  it("accepts a whole-number trade limit sent as a string", async () => {
    await call(updateRiskLimits, { market: "Forex", maxTradesPerDay: "5" });
    expect(lastSet()["riskLimits.Forex.maxTradesPerDay"]).toBe(5);
  });
});

describe("GET", () => {
  it("returns both markets with nulls for anything unset or invalid", async () => {
    User.findById.mockReturnValue({
      select: () => ({ lean: async () => ({ riskLimits: { Forex: { dailyLossLimit: 200, maxTradesPerDay: 0 } } }) }),
    });
    const { data } = await call(getRiskLimits);
    expect(data).toEqual({
      Forex: { dailyLossLimit: 200, maxTradesPerDay: null, promptAnsweredAt: null },
      Indian_Market: { dailyLossLimit: null, maxTradesPerDay: null, promptAnsweredAt: null },
    });
  });

  it("works for a user with no riskLimits field at all (existing accounts)", async () => {
    User.findById.mockReturnValue({ select: () => ({ lean: async () => ({}) }) });
    const { data } = await call(getRiskLimits);
    expect(data.Forex.dailyLossLimit).toBeNull();
    expect(data.Indian_Market.promptAnsweredAt).toBeNull();
  });
});
