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

  test("redacts raw token-shaped values and internal filesystem paths in strings", () => {
    const input = "failed at C:/srv/app/internal/file.js with token abc.def.ghi";
    expect(redactMeta({ message: input })).toEqual({
      message: "failed at [REDACTED] with token [REDACTED]",
    });
  });
});
