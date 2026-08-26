const { buildPagination } = require("../../utils/apiResponse");
const { standardizeResponse } = require("../../middleware/standardizeResponse");
const { errorHandler } = require("../../middleware/errorHandler");
const { notificationSchemas, tradeSchemas } = require("../../validation/schemas");

jest.mock("../../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../../config/sentry", () => ({
  captureOperationalError: jest.fn(),
}));

describe("API contract infrastructure", () => {
  test("builds deterministic pagination metadata", () => {
    expect(buildPagination({ page: 2, limit: 25, total: 61 })).toEqual({
      page: 2,
      limit: 25,
      total: 61,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    });
    expect(buildPagination({ page: 1, limit: 25, total: 0 })).toEqual({
      page: 1,
      limit: 25,
      total: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
    });
  });

  test("coerces and validates list query parameters centrally", async () => {
    const parsed = await notificationSchemas.list.parseAsync({
      body: undefined,
      query: { page: "2", limit: "20", unreadOnly: "true" },
      params: {},
    });
    expect(parsed.query).toEqual({ page: 2, limit: 20, unreadOnly: true });

    const invalid = await tradeSchemas.list.safeParseAsync({
      body: undefined,
      query: { limit: "101" },
      params: {},
    });
    expect(invalid.success).toBe(false);
  });

  test("wraps legacy success and error payloads consistently", () => {
    const req = { requestId: "req-test" };
    const sent = [];
    const res = {
      locals: {},
      statusCode: 200,
      json(body) {
        sent.push(body);
        return body;
      },
    };
    const next = jest.fn();

    standardizeResponse(req, res, next);
    res.json({ totalTrades: 4 });
    expect(sent[0]).toEqual({
      success: true,
      data: { totalTrades: 4 },
    });

    res.statusCode = 400;
    res.json({ errorCode: "VALIDATION_ERROR", message: "Invalid input" });
    expect(sent[1]).toEqual({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid input",
        requestId: "req-test",
      },
    });
  });

  test("normalizes malformed JSON without classifying it as an internal error", () => {
    const err = new SyntaxError("Expected property name or '}' in JSON at position 1");
    err.status = 400;
    err.body = "{bad json";

    const req = {
      method: "POST",
      originalUrl: "/api/auth/login",
      headers: {},
      get: jest.fn(() => "jest"),
      ip: "127.0.0.1",
      requestId: "req-json",
    };
    const res = {
      headersSent: false,
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };

    errorHandler(err, req, res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      status: "error",
      message: "Invalid JSON request body.",
      errorCode: "INVALID_JSON",
      requestId: "req-json",
    });
    expect(res.body).not.toHaveProperty("stack");
  });
});
