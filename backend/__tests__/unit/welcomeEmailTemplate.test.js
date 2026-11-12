"use strict";

const mockResendSend = jest.fn();
const mockLogger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };

jest.mock("../../config", () => ({
  appConfig: {
    resend: { apiKey: "re_test", from: "Edgecipline <noreply@edgecipline.com>" },
    smtp: {},
    email: { consoleOnly: false, replyTo: "dream@edgecipline.com", sendTimeoutMs: 15000, logoUrl: "" },
    support: { appBaseUrl: "https://app.edgecipline.com/", email: "dream@edgecipline.com", whatsappNumber: "917510606322" },
  },
}));
jest.mock("../../utils/logger", () => ({ logger: mockLogger }));
jest.mock("resend", () => ({ Resend: jest.fn(() => ({ emails: { send: mockResendSend } })) }));
jest.mock("../../services/paymentService", () => ({ listOrderablePlans: () => [] }));

const { buildWelcomeEmail, sendWelcomeEmail } = require("../../services/mailService");

beforeEach(() => jest.clearAllMocks());

describe("welcome email template", () => {
  test("includes the hosted logo, first name, trial pill and dashboard link", () => {
    const { subject, html } = buildWelcomeEmail({
      userName: "Asha Rao",
      trialEndsAt: new Date("2026-11-19T10:00:00Z"),
    });

    expect(subject).toBe("Welcome to Edgecipline, Asha 👋");
    expect(html).toContain('src="https://app.edgecipline.com/brand-opener-logo-dark.png"');
    expect(html).toContain('src="https://app.edgecipline.com/logo.png"');
    expect(html).toContain("Welcome aboard, Asha.");
    expect(html).toContain("7-day Premium trial");
    expect(html).toContain('href="https://app.edgecipline.com/dashboard"');
  });

  test("omits the trial pill without a trial and falls back to 'trader'", () => {
    const { html } = buildWelcomeEmail({ userName: "", trialEndsAt: null });
    expect(html).not.toContain("7-day Premium trial");
    expect(html).toContain("Welcome aboard, trader.");
  });

  test("escapes HTML in the user's name", () => {
    const { html } = buildWelcomeEmail({ userName: "<img src=x onerror=alert(1)>" });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});

describe("sendWelcomeEmail", () => {
  test("sends through the provider and reports success", async () => {
    mockResendSend.mockResolvedValue({ error: null });
    await expect(sendWelcomeEmail({ to: "a@example.com", userName: "Asha" })).resolves.toEqual({ sent: true });
    expect(mockResendSend).toHaveBeenCalledWith(expect.objectContaining({ to: "a@example.com" }));
  });

  test("resolves (never throws) when the provider rejects", async () => {
    mockResendSend.mockResolvedValue({ error: { statusCode: 422, name: "validation_error", message: "bad" } });
    await expect(sendWelcomeEmail({ to: "a@example.com", userName: "Asha" })).resolves.toEqual({
      sent: false,
      reason: "permanent",
    });
    expect(mockLogger.error).toHaveBeenCalledWith("WELCOME_EMAIL_FAILED", expect.any(Object));
  });
});
