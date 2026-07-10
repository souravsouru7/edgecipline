const { buildPagination } = require("../../utils/apiResponse");
const { standardizeResponse } = require("../../middleware/standardizeResponse");
const { notificationSchemas, tradeSchemas } = require("../../validation/schemas");

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
});
