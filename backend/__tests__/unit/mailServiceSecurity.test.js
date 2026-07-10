"use strict";

const mockWarn = jest.fn();
const mockInfo = jest.fn();

jest.mock("../../config", () => ({
  appConfig: {
    resend: {
      apiKey: "",
      from: "noreply@example.com",
    },
  },
}));

jest.mock("../../utils/logger", () => ({
  logger: {
    warn: mockWarn,
    info: mockInfo,
    error: jest.fn(),
  },
}));

jest.mock("resend", () => ({
  Resend: jest.fn(),
}));

const { sendOTPEmail } = require("../../services/mailService");

describe("mailService OTP logging", () => {
  test("never writes the plaintext OTP when email delivery is unconfigured", async () => {
    await expect(sendOTPEmail("person@example.com", "123456")).resolves.toBe(true);

    const logged = JSON.stringify([
      ...mockWarn.mock.calls,
      ...mockInfo.mock.calls,
    ]);
    expect(logged).not.toContain("123456");
    expect(logged).not.toContain("person@example.com");
  });
});
