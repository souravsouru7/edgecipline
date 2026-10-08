// Covers the two behaviours that decide what a trader sees when the coach
// can't answer: which upstream failure maps to which message, and whether the
// question is refunded.
jest.mock("@google/generative-ai", () => ({ GoogleGenerativeAI: jest.fn() }));

jest.mock("../../models/CoachConversation", () => ({
  findOne: jest.fn(), create: jest.fn(), updateOne: jest.fn(),
}));
jest.mock("../../models/CoachMessage", () => ({
  create: jest.fn(), find: jest.fn(), findOne: jest.fn(),
  updateOne: jest.fn(), updateMany: jest.fn(), countDocuments: jest.fn(),
}));
jest.mock("../../services/coachContextService", () => ({
  resolveMarket: jest.fn(), getContext: jest.fn(), invalidate: jest.fn(),
}));
jest.mock("../../services/coachPromptService", () => ({
  buildModelInput: jest.fn(), getQuickPrompts: jest.fn(),
}));
jest.mock("../../services/coachQuotaService", () => ({
  FREE_WEEKLY_LIMIT: 5,
  getQuota: jest.fn(),
  incrementUsage: jest.fn(),
  refundUsage: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const CoachMessage = require("../../models/CoachMessage");
const coachQuotaService = require("../../services/coachQuotaService");
const coachChatService = require("../../services/coachChatService");

const { describeFailure, statusOf, isRefundable, refundTurn, supersedeTurn } = coachChatService;

// The SDK reports a hard failure as a status plus a bracketed message prefix.
function upstream(status, text) {
  const err = new Error(
    `[GoogleGenerativeAI Error]: Error fetching from https://example: [${status} X] ${text}`
  );
  err.status = status;
  return err;
}

describe("statusOf", () => {
  it("prefers the status the SDK set on the error", () => {
    expect(statusOf({ status: 403, message: "whatever" })).toBe(403);
  });

  it("falls back to the bracketed status in the message", () => {
    expect(statusOf({ message: "[404 Not Found] gone" })).toBe(404);
  });

  it("returns 0 when there is no status to find", () => {
    expect(statusOf({ message: "socket hang up" })).toBe(0);
    expect(statusOf(null)).toBe(0);
  });
});

describe("describeFailure", () => {
  it("maps a denied project (403) to COACH_UNAVAILABLE", () => {
    // This is the live failure: the key lists models fine but generation is
    // refused project-wide.
    const mapped = describeFailure(upstream(403, "Your project has been denied access. Please contact support."));
    expect(mapped.errorCode).toBe("COACH_UNAVAILABLE");
    expect(mapped.statusCode).toBe(503);
    expect(mapped.message).toBe("Coach is unavailable right now. We're on it.");
  });

  it("maps an unauthenticated key (401) to COACH_UNAVAILABLE", () => {
    expect(describeFailure(upstream(401, "API key not valid")).errorCode).toBe("COACH_UNAVAILABLE");
  });

  it("maps a retired model (404) to COACH_UNAVAILABLE", () => {
    const mapped = describeFailure(upstream(404, "This model is no longer available."));
    expect(mapped.errorCode).toBe("COACH_UNAVAILABLE");
    expect(mapped.message).toBe("Coach is unavailable right now. We're on it.");
  });

  it("maps a malformed request (400) to COACH_BAD_REQUEST", () => {
    const mapped = describeFailure(upstream(400, "Invalid argument: thinkingConfig"));
    expect(mapped.errorCode).toBe("COACH_BAD_REQUEST");
    expect(mapped.statusCode).toBe(400);
  });

  it("still maps 429 and 5xx to COACH_BUSY, ahead of the hard-status branches", () => {
    expect(describeFailure(upstream(429, "quota")).errorCode).toBe("COACH_BUSY");
    expect(describeFailure(upstream(503, "overloaded")).errorCode).toBe("COACH_BUSY");
  });

  it("still maps a safety block to COACH_BLOCKED", () => {
    expect(describeFailure(new Error("response blocked for SAFETY")).errorCode).toBe("COACH_BLOCKED");
  });

  it("keeps the catch-all for anything unrecognised", () => {
    expect(describeFailure(new Error("something odd")).errorCode).toBe("COACH_STREAM_ERROR");
  });

  it("passes an ApiError through untouched", () => {
    const ApiError = require("../../utils/ApiError");
    const original = new ApiError(402, "quota gone", "COACH_QUOTA_EXHAUSTED");
    expect(describeFailure(original)).toBe(original);
  });

  it("never leaks the upstream text to the user", () => {
    const mapped = describeFailure(upstream(403, "project 12345 denied, contact support"));
    expect(mapped.message).not.toMatch(/12345|denied/);
  });
});

describe("isRefundable", () => {
  it("refunds our own failures", () => {
    for (const code of ["COACH_UNAVAILABLE", "COACH_BUSY", "COACH_STREAM_ERROR", "COACH_EMPTY_RESPONSE"]) {
      expect(isRefundable(code)).toBe(true);
    }
  });

  it("does not refund a blocked question, a bad request, or an exhausted quota", () => {
    for (const code of ["COACH_BLOCKED", "COACH_BAD_REQUEST", "COACH_QUOTA_EXHAUSTED"]) {
      expect(isRefundable(code)).toBe(false);
    }
  });
});

describe("refundTurn", () => {
  const user = { _id: "user-1" };
  beforeEach(() => jest.clearAllMocks());

  it("clears the charge in Mongo and corrects the Redis cache", async () => {
    CoachMessage.updateOne.mockResolvedValue({ matchedCount: 1 });
    coachQuotaService.refundUsage.mockResolvedValue(0);

    await expect(refundTurn({ user, userMessageId: "msg-1" })).resolves.toBe(true);

    expect(CoachMessage.updateOne).toHaveBeenCalledWith(
      { _id: "msg-1", user: "user-1" },
      { $set: { billable: false } }
    );
    expect(coachQuotaService.refundUsage).toHaveBeenCalledWith(user);
  });

  it("only refunds the caller's own message", async () => {
    CoachMessage.updateOne.mockResolvedValue({ matchedCount: 0 });
    coachQuotaService.refundUsage.mockResolvedValue(0);
    await refundTurn({ user, userMessageId: "someone-elses" });
    expect(CoachMessage.updateOne.mock.calls[0][0].user).toBe("user-1");
  });

  it("does nothing without a message id", async () => {
    await expect(refundTurn({ user, userMessageId: null })).resolves.toBe(false);
    expect(coachQuotaService.refundUsage).not.toHaveBeenCalled();
  });

  it("swallows a refund failure so it can't mask the original error", async () => {
    CoachMessage.updateOne.mockRejectedValue(new Error("mongo down"));
    await expect(refundTurn({ user, userMessageId: "msg-1" })).resolves.toBe(false);
  });
});

describe("supersedeTurn", () => {
  const user = { _id: "user-1" };
  beforeEach(() => jest.clearAllMocks());

  it("retires the failed pair and stops it counting", async () => {
    const createdAt = new Date("2026-10-08T10:00:00Z");
    CoachMessage.findOne.mockReturnValue({ lean: () => Promise.resolve({ _id: "msg-1", createdAt }) });
    CoachMessage.updateMany.mockResolvedValue({ modifiedCount: 2 });

    await expect(supersedeTurn({ user, conversationId: "c-1", userMessageId: "msg-1" })).resolves.toBe(true);

    const [filter, update] = CoachMessage.updateMany.mock.calls[0];
    expect(update).toEqual({ $set: { superseded: true, billable: false } });
    // Nothing before the failed question may be swept up by a retry.
    expect(filter.createdAt).toEqual({ $gte: createdAt });
    expect(filter.user).toBe("user-1");
  });

  it("is a no-op when the message isn't the caller's", async () => {
    CoachMessage.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });
    await expect(supersedeTurn({ user, conversationId: "c-1", userMessageId: "nope" })).resolves.toBe(false);
    expect(CoachMessage.updateMany).not.toHaveBeenCalled();
  });
});
