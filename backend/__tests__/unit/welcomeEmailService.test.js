"use strict";

const mockFindOneAndUpdate = jest.fn();
const mockSendWelcomeEmail = jest.fn();
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

jest.mock("../../models/Users", () => ({ findOneAndUpdate: mockFindOneAndUpdate }));
jest.mock("../../services/mailService", () => ({ sendWelcomeEmail: mockSendWelcomeEmail }));
jest.mock("../../utils/logger", () => ({ logger: mockLogger }));

const { maybeSendWelcomeEmail, NEW_ACCOUNT_WINDOW_MS } = require("../../services/welcomeEmailService");

function claimResolves(doc) {
  mockFindOneAndUpdate.mockReturnValue({ lean: () => Promise.resolve(doc) });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("maybeSendWelcomeEmail", () => {
  const now = new Date("2026-11-12T10:00:00Z");

  test("claims atomically (unsent + new account) and sends to the claimed user", async () => {
    const trialEnd = new Date("2026-11-19T10:00:00Z");
    claimResolves({ email: "a@example.com", name: "Asha Rao", trial: { endsAt: trialEnd } });
    mockSendWelcomeEmail.mockResolvedValue({ sent: true });

    await expect(maybeSendWelcomeEmail("u1", { now })).resolves.toEqual({ sent: true });

    const [filter, update] = mockFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({
      _id: "u1",
      welcomeEmailSentAt: { $exists: false },
      createdAt: { $gte: new Date(now.getTime() - NEW_ACCOUNT_WINDOW_MS) },
    });
    expect(update).toEqual({ $set: { welcomeEmailSentAt: now } });
    expect(mockSendWelcomeEmail).toHaveBeenCalledWith({
      to: "a@example.com",
      userName: "Asha Rao",
      trialEndsAt: trialEnd,
    });
  });

  test("skips when the claim matches nothing (already welcomed or old account)", async () => {
    claimResolves(null);

    await expect(maybeSendWelcomeEmail("u1", { now })).resolves.toEqual({
      sent: false,
      reason: "already_sent_or_not_new",
    });
    expect(mockSendWelcomeEmail).not.toHaveBeenCalled();
  });

  test("never rejects when the database throws", async () => {
    mockFindOneAndUpdate.mockReturnValue({ lean: () => Promise.reject(new Error("db down")) });

    await expect(maybeSendWelcomeEmail("u1", { now })).resolves.toMatchObject({ sent: false, reason: "exception" });
    expect(mockLogger.error).toHaveBeenCalled();
  });

  test("passes through a failed send without throwing", async () => {
    claimResolves({ email: "a@example.com", name: "A" });
    mockSendWelcomeEmail.mockResolvedValue({ sent: false, reason: "transient" });

    await expect(maybeSendWelcomeEmail("u1", { now })).resolves.toEqual({ sent: false, reason: "transient" });
  });
});
