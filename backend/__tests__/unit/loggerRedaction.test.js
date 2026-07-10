"use strict";

jest.mock("../../config", () => ({
  appConfig: { logLevel: "error" },
}));

const { redactMeta } = require("../../utils/logger");

describe("logger redaction", () => {
  test("preserves ordinary email and body fields for forensic context", () => {
    expect(redactMeta({
      email: "person@example.com",
      body: "validation failed",
    })).toEqual({
      email: "person@example.com",
      body: "validation failed",
    });
  });

  test("redacts every sensitive value without shared regex state", () => {
    const input = "Bearer abc.def.ghi then Bearer second.token.value";
    expect(redactMeta({ first: input, second: input })).toEqual({
      first: "[REDACTED] then [REDACTED]",
      second: "[REDACTED] then [REDACTED]",
    });
  });
});
