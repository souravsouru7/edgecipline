jest.mock("../../models/Payment", () => ({ findOne: jest.fn(), create: jest.fn() }));
jest.mock("../../models/Users", () => ({ findById: jest.fn(), findByIdAndUpdate: jest.fn() }));
jest.mock("../../services/authCacheService", () => ({ invalidateAuthCache: jest.fn().mockResolvedValue() }));
jest.mock("../../utils/logger", () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const mongoose = require("mongoose");
const Payment = require("../../models/Payment");
const User = require("../../models/Users");
const { addManualPayment } = require("../../admin/controllers/adminPaymentController");

const USER_ID = new mongoose.Types.ObjectId().toString();

function run(body) {
  const req = { body, user: { _id: "admin" } };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return new Promise((resolve, reject) => {
    addManualPayment(req, res, (err) => (err ? reject(err) : resolve(res)));
    // asyncHandler may resolve via res.json rather than next()
    res.json.mockImplementation((payload) => { resolve({ res, payload }); return res; });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  const session = { startTransaction: jest.fn(), commitTransaction: jest.fn(), abortTransaction: jest.fn(), endSession: jest.fn() };
  jest.spyOn(mongoose, "startSession").mockResolvedValue(session);
  Payment.findOne.mockReturnValue({ session: () => Promise.resolve(null) });
  User.findById.mockReturnValue({ session: () => Promise.resolve({ _id: USER_ID, subscriptionExpiry: null, subscriptionPlan: "free" }) });
  Payment.create.mockImplementation(async ([doc]) => [{ _id: "pay1", ...doc }]);
  User.findByIdAndUpdate.mockResolvedValue({});
});

const base = { userId: USER_ID, planType: "3_months", amount: 899 };

test.each([
  ["current price", { ...base }],
  ["string amount with spaces/decimals", { ...base, amount: " 899.00 " }],
  ["prior price still accepted", { ...base, amount: 537 }],
  ["monthly at current price", { ...base, planType: "monthly", amount: 349 }],
  ["custom with any amount", { ...base, planType: "custom", amount: 150.5, customDays: 45 }],
  ["custom with string days", { ...base, planType: "custom", amount: 1, customDays: "10" }],
])("accepts %s", async (_, body) => {
  const { payload } = await run(body);
  expect(payload.message).toMatch(/recorded/);
});

test.each([
  ["price never charged for this plan", { ...base, amount: 200 }, "PAYMENT_INTEGRITY_CHECK_FAILED"],
  ["off-by-one price", { ...base, amount: 900 }, "PAYMENT_INTEGRITY_CHECK_FAILED"],
  ["fractional fixed price", { ...base, amount: 899.5 }, "PAYMENT_INTEGRITY_CHECK_FAILED"],
  ["zero amount", { ...base, amount: 0 }, "VALIDATION_ERROR"],
  ["negative amount", { ...base, amount: -899 }, "VALIDATION_ERROR"],
  ["non-numeric amount", { ...base, amount: "abc" }, "VALIDATION_ERROR"],
  ["three decimals", { ...base, planType: "custom", amount: 10.123, customDays: 5 }, "VALIDATION_ERROR"],
  ["absurd amount", { ...base, planType: "custom", amount: 5_000_000, customDays: 5 }, "VALIDATION_ERROR"],
  ["custom without days", { ...base, planType: "custom", amount: 100 }, "VALIDATION_ERROR"],
  ["custom fractional days", { ...base, planType: "custom", amount: 100, customDays: 2.5 }, "VALIDATION_ERROR"],
  ["custom too many days", { ...base, planType: "custom", amount: 100, customDays: 5000 }, "VALIDATION_ERROR"],
  ["unknown plan", { ...base, planType: "lifetime" }, "VALIDATION_ERROR"],
  ["bad userId", { ...base, userId: "nope" }, "VALIDATION_ERROR"],
  ["non-string transactionId", { ...base, transactionId: 123 }, "VALIDATION_ERROR"],
  ["overlong transactionId", { ...base, transactionId: "x".repeat(200) }, "VALIDATION_ERROR"],
])("rejects %s", async (_, body, code) => {
  await expect(run(body)).rejects.toMatchObject({ statusCode: 400, errorCode: code });
  expect(Payment.create).not.toHaveBeenCalled();
});

test("mismatch error tells admin the expected price", async () => {
  await expect(run({ ...base, amount: 200 })).rejects.toMatchObject({
    message: expect.stringContaining("₹899"),
    details: { expectedAmount: 899 },
  });
});

test("blank transactionId gets a generated one and blank notes get the default", async () => {
  await run({ ...base, transactionId: "   ", notes: "  " });
  const [[doc]] = Payment.create.mock.calls[0];
  expect(doc.transactionId).toMatch(/^MAN-\d+$/);
  expect(doc.notes).toBe("Manual admin entry");
});
