"use strict";

// Transport selection: SMTP credentials take priority over Resend, and SMTP
// failures are classified (permanent vs transient) the same way Resend's are so
// the forgot-password controller keeps telling users the truth.

const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn(() => ({ sendMail: mockSendMail }));
const mockResendSend = jest.fn();

const mockConfig = {
  appConfig: {
    resend: { apiKey: "re_test", from: "Edgecipline <onboarding@resend.dev>" },
    smtp: { host: "smtp.gmail.com", port: 587, secure: false, user: "", pass: "", from: "" },
    email: { consoleOnly: false, replyTo: "edgecipline@gmail.com", sendTimeoutMs: 15000 },
  },
};

jest.mock("../../config", () => mockConfig);
jest.mock("../../utils/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));
jest.mock("nodemailer", () => ({ createTransport: mockCreateTransport }));
jest.mock("resend", () => ({
  Resend: jest.fn(() => ({ emails: { send: mockResendSend } })),
}));
jest.mock("../../services/paymentService", () => ({ listOrderablePlans: () => [] }));

function load() {
  jest.resetModules();
  return require("../../services/mailService");
}

beforeEach(() => {
  mockSendMail.mockReset();
  mockCreateTransport.mockClear();
  mockResendSend.mockReset();
  mockConfig.appConfig.smtp.user = "";
  mockConfig.appConfig.smtp.pass = "";
  mockConfig.appConfig.smtp.from = "";
  mockConfig.appConfig.email.consoleOnly = false;
  mockConfig.appConfig.email.replyTo = "edgecipline@gmail.com";
  mockConfig.appConfig.email.sendTimeoutMs = 15000;
});

describe("mailService transport selection", () => {
  test("console mode prints the email to stdout and sends nothing", async () => {
    mockConfig.appConfig.email.consoleOnly = true;
    mockConfig.appConfig.smtp.user = "edgecipline@gmail.com";
    mockConfig.appConfig.smtp.pass = "app-password";
    const write = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    const mail = load();

    expect(mail.getProvider()).toBe("console");
    await expect(mail.sendOTPEmail("person@example.com", "123456")).resolves.toBe(true);

    const printed = write.mock.calls.map((c) => String(c[0])).join("");
    write.mockRestore();
    expect(printed).toContain("To:      person@example.com");
    expect(printed).toContain("123456");
    expect(printed).not.toMatch(/<[a-z]+[ >]/i); // HTML stripped
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockResendSend).not.toHaveBeenCalled();
  });

  test("uses Resend when no SMTP credentials are set", async () => {
    mockResendSend.mockResolvedValue({ error: null });
    const mail = load();

    expect(mail.getProvider()).toBe("resend");
    await expect(mail.sendOTPEmail("person@example.com", "123456")).resolves.toBe(true);
    expect(mockResendSend).toHaveBeenCalledTimes(1);
    expect(mockCreateTransport).not.toHaveBeenCalled();
  });

  test("prefers SMTP over Resend once SMTP_USER and SMTP_PASS are set", async () => {
    mockConfig.appConfig.smtp.user = "edgecipline@gmail.com";
    mockConfig.appConfig.smtp.pass = "app-password";
    mockSendMail.mockResolvedValue({ accepted: ["person@example.com"] });
    const mail = load();

    expect(mail.getProvider()).toBe("smtp");
    await expect(mail.sendOTPEmail("person@example.com", "123456")).resolves.toBe(true);

    expect(mockResendSend).not.toHaveBeenCalled();
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.gmail.com",
        port: 587,
        auth: { user: "edgecipline@gmail.com", pass: "app-password" },
      })
    );
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Edgecipline <edgecipline@gmail.com>",
        to: "person@example.com",
        html: expect.stringContaining("123456"),
      })
    );
  });

  test("classifies an SMTP auth rejection as permanent", async () => {
    mockConfig.appConfig.smtp.user = "edgecipline@gmail.com";
    mockConfig.appConfig.smtp.pass = "wrong";
    const authError = Object.assign(new Error("Invalid login: 535-5.7.8 Username and Password not accepted"), {
      code: "EAUTH",
      responseCode: 535,
    });
    mockSendMail.mockRejectedValue(authError);
    const mail = load();

    await expect(mail.sendOTPEmail("person@example.com", "123456")).rejects.toMatchObject({
      provider: "smtp",
      permanent: true,
      providerErrorName: "EAUTH",
    });
  });

  test("classifies an SMTP connection drop as transient", async () => {
    mockConfig.appConfig.smtp.user = "edgecipline@gmail.com";
    mockConfig.appConfig.smtp.pass = "app-password";
    mockSendMail.mockRejectedValue(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }));
    const mail = load();

    await expect(mail.sendOTPEmail("person@example.com", "123456")).rejects.toMatchObject({
      provider: "smtp",
      permanent: false,
    });
  });
});

describe("mailService delivery envelope and failure classification", () => {
  test("Resend sends reply-to and a plain-text alternative alongside the HTML", async () => {
    mockResendSend.mockResolvedValue({ error: null });
    const mail = load();

    await mail.sendOTPEmail("person@example.com", "654321");

    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Edgecipline <onboarding@resend.dev>",
        to: "person@example.com",
        replyTo: "edgecipline@gmail.com",
        html: expect.stringContaining("654321"),
        text: expect.stringContaining("654321"),
      })
    );
    const { text } = mockResendSend.mock.calls[0][0];
    expect(text).not.toMatch(/<[a-z]+[ >]/i);
  });

  test("SMTP sends reply-to, text, and bounded socket timeouts", async () => {
    mockConfig.appConfig.smtp.user = "edgecipline@gmail.com";
    mockConfig.appConfig.smtp.pass = "app-password";
    mockConfig.appConfig.email.sendTimeoutMs = 7000;
    mockSendMail.mockResolvedValue({ accepted: ["person@example.com"] });
    const mail = load();

    await mail.sendOTPEmail("person@example.com", "111222");

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ connectionTimeout: 7000, greetingTimeout: 7000, socketTimeout: 7000 })
    );
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: "edgecipline@gmail.com", text: expect.stringContaining("111222") })
    );
  });

  test("omits reply-to when none is configured", async () => {
    mockConfig.appConfig.email.replyTo = "";
    mockResendSend.mockResolvedValue({ error: null });
    const mail = load();

    await mail.sendOTPEmail("person@example.com", "654321");

    expect(mockResendSend.mock.calls[0][0].replyTo).toBeUndefined();
  });

  test("a Resend call that hangs past the timeout is a transient failure", async () => {
    jest.useFakeTimers();
    mockConfig.appConfig.email.sendTimeoutMs = 1000;
    mockResendSend.mockReturnValue(new Promise(() => {})); // never settles
    const mail = load();

    const pending = mail.sendOTPEmail("person@example.com", "123456");
    const assertion = expect(pending).rejects.toMatchObject({
      provider: "resend",
      permanent: false,
      providerErrorName: "TimeoutError",
    });
    await jest.advanceTimersByTimeAsync(1001);
    await assertion;
    jest.useRealTimers();
  });

  test("a Resend SDK throw (network failure) is a transient failure, not an unclassified crash", async () => {
    mockResendSend.mockRejectedValue(Object.assign(new Error("fetch failed"), { code: "ENOTFOUND" }));
    const mail = load();

    await expect(mail.sendOTPEmail("person@example.com", "123456")).rejects.toMatchObject({
      provider: "resend",
      permanent: false,
    });
  });

  test("an unverified sender domain is permanent and names the fix for the operator", async () => {
    mockConfig.appConfig.resend.from = "Edgecipline <edgecipline@gmail.com>";
    mockResendSend.mockResolvedValue({
      error: { statusCode: 403, name: "validation_error", message: "The gmail.com domain is not verified." },
    });
    const mail = load();
    const { logger } = require("../../utils/logger"); // after load(): same registry as mailService

    await expect(mail.sendOTPEmail("person@example.com", "123456")).rejects.toMatchObject({
      provider: "resend",
      permanent: true,
      providerStatus: 403,
    });
    const logged = logger.error.mock.calls.find((c) => c[0] === "OTP email failed")?.[1];
    expect(logged.operatorAction).toContain("gmail.com");
    expect(logged.operatorAction).toContain("noreply@edgecipline.com");
    expect(logged.recipientId).not.toContain("person@example.com");
    mockConfig.appConfig.resend.from = "Edgecipline <onboarding@resend.dev>";
  });

  test("a rejected API key is permanent and points at the key, not the domain", async () => {
    mockResendSend.mockResolvedValue({
      error: { statusCode: 401, name: "invalid_api_key", message: "API key is invalid" },
    });
    const mail = load();
    const { logger } = require("../../utils/logger"); // after load(): same registry as mailService

    await expect(mail.sendOTPEmail("person@example.com", "123456")).rejects.toMatchObject({ permanent: true });
    const logged = logger.error.mock.calls.find((c) => c[0] === "OTP email failed")?.[1];
    expect(logged.operatorAction).toContain("RESEND_API_KEY");
  });

  test("Resend rate limiting (429) is transient", async () => {
    mockResendSend.mockResolvedValue({
      error: { statusCode: 429, name: "rate_limit_exceeded", message: "Too many requests" },
    });
    const mail = load();

    await expect(mail.sendOTPEmail("person@example.com", "123456")).rejects.toMatchObject({
      permanent: false,
      providerStatus: 429,
    });
  });
});
