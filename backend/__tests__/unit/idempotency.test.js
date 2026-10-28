const userId = "507f1f77bcf86cd799439012";

function buildRes() {
  const res = {
    statusCode: 200,
    locals: {},
    headers: {},
    _finishHandlers: [],
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json: jest.fn(function (body) { this.body = body; return this; }),
    on(event, fn) { if (event === "finish") this._finishHandlers.push(fn); },
    emitFinish() { this._finishHandlers.forEach((fn) => fn()); },
  };
  return res;
}

function buildReq({ key = "key-1", body = { pair: "EURUSD" }, user = { _id: userId } } = {}) {
  return {
    method: "POST",
    originalUrl: "/api/trades?x=1",
    body,
    user,
    get: (header) => (header.toLowerCase() === "idempotency-key" ? key : undefined),
  };
}

function mockStore({ createImpl, findOneResult }) {
  const create = jest.fn(createImpl);
  const updateOne = jest.fn().mockResolvedValue({});
  const deleteOne = jest.fn().mockResolvedValue({});
  const findOne = jest.fn(() => ({ lean: jest.fn().mockResolvedValue(findOneResult) }));

  jest.doMock("../../models/IdempotencyRecord", () => ({
    create, updateOne, deleteOne, findOne,
  }));
  jest.doMock("../../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  }));

  return { create, updateOne, deleteOne, findOne };
}

const duplicateKeyError = () => Object.assign(new Error("E11000"), { code: 11000 });
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("idempotency middleware", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test("passes through when no key is supplied, so existing callers are unaffected", async () => {
    mockStore({ createImpl: jest.fn() });
    const { idempotency } = require("../../middleware/idempotency");
    const next = jest.fn();

    idempotency(buildReq({ key: "" }), buildRes(), next);
    await flush();

    expect(next).toHaveBeenCalledWith();
  });

  test("claims the key and runs the handler on a first request", async () => {
    const { create } = mockStore({ createImpl: () => Promise.resolve({}) });
    const { idempotency } = require("../../middleware/idempotency");
    const next = jest.fn();

    idempotency(buildReq(), buildRes(), next);
    await flush();

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ key: "key-1", status: "in_progress" })
    );
    expect(next).toHaveBeenCalledWith();
  });

  test("stores the response body on a 2xx so it can be replayed", async () => {
    const { updateOne } = mockStore({ createImpl: () => Promise.resolve({}) });
    const { idempotency } = require("../../middleware/idempotency");
    const res = buildRes();

    idempotency(buildReq(), res, jest.fn());
    await flush();

    res.status(201).json({ success: true, data: { _id: "t1" } });
    await flush();

    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ key: "key-1" }),
      expect.objectContaining({
        $set: expect.objectContaining({ status: "completed", responseStatus: 201 }),
      })
    );
  });

  // The whole point: the client never saw the first answer (false timeout),
  // retried, and must get the SAME trade back rather than create a second.
  test("replays the stored response for a repeat of a completed key", async () => {
    mockStore({
      createImpl: () => Promise.reject(duplicateKeyError()),
      findOneResult: {
        status: "completed",
        responseStatus: 201,
        responseBody: { success: true, data: { _id: "t1" } },
        requestHash: null,
        path: "/api/trades",
      },
    });
    const { idempotency } = require("../../middleware/idempotency");
    const res = buildRes();
    const next = jest.fn();

    idempotency(buildReq(), res, next);
    await flush();

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: "t1" } });
    expect(res.headers["Idempotent-Replay"]).toBe("true");
  });

  test("rejects a concurrent duplicate while the first is still in flight", async () => {
    mockStore({
      createImpl: () => Promise.reject(duplicateKeyError()),
      findOneResult: { status: "in_progress", requestHash: null },
    });
    const { idempotency } = require("../../middleware/idempotency");
    const next = jest.fn();

    idempotency(buildReq(), buildRes(), next);
    await flush();

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409, errorCode: "IDEMPOTENT_REQUEST_IN_PROGRESS" })
    );
  });

  // Answering a different body with the first body would silently discard a
  // real write, so the reuse is surfaced instead.
  test("rejects the same key used for a different body", async () => {
    const { hashBody } = (() => {
      mockStore({ createImpl: () => Promise.resolve({}) });
      return require("../../middleware/idempotency");
    })();
    const otherHash = hashBody({ pair: "GBPUSD" });

    jest.resetModules();
    mockStore({
      createImpl: () => Promise.reject(duplicateKeyError()),
      findOneResult: { status: "completed", requestHash: otherHash, responseBody: { a: 1 } },
    });
    const { idempotency } = require("../../middleware/idempotency");
    const next = jest.fn();

    idempotency(buildReq({ body: { pair: "EURUSD" } }), buildRes(), next);
    await flush();

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 422, errorCode: "IDEMPOTENCY_KEY_REUSED" })
    );
  });

  test("key order in the body does not change the hash", () => {
    mockStore({ createImpl: () => Promise.resolve({}) });
    const { hashBody } = require("../../middleware/idempotency");

    expect(hashBody({ a: 1, b: { c: 2, d: 3 } })).toBe(hashBody({ b: { d: 3, c: 2 }, a: 1 }));
    expect(hashBody({ a: 1 })).not.toBe(hashBody({ a: 2 }));
  });

  test("releases the claim on a non-2xx so a corrected retry is allowed", async () => {
    const { deleteOne } = mockStore({ createImpl: () => Promise.resolve({}) });
    const { idempotency } = require("../../middleware/idempotency");
    const res = buildRes();

    idempotency(buildReq(), res, jest.fn());
    await flush();

    res.status(400).json({ success: false });
    await flush();

    expect(deleteOne).toHaveBeenCalledWith(expect.objectContaining({ key: "key-1" }));
  });

  // A handler that throws never reaches res.json, so without the finish hook
  // the claim would wedge the key for its whole TTL.
  test("releases the claim when the handler throws before responding", async () => {
    const { deleteOne } = mockStore({ createImpl: () => Promise.resolve({}) });
    const { idempotency } = require("../../middleware/idempotency");
    const res = buildRes();

    idempotency(buildReq(), res, jest.fn());
    await flush();

    res.emitFinish();
    await flush();

    expect(deleteOne).toHaveBeenCalledWith(
      expect.objectContaining({ key: "key-1", status: "in_progress" })
    );
  });

  // Losing an entered trade is worse than the duplicate this guards against.
  test("fails open when the dedupe store is unavailable", async () => {
    mockStore({ createImpl: () => Promise.reject(new Error("mongo down")) });
    const { idempotency } = require("../../middleware/idempotency");
    const next = jest.fn();

    idempotency(buildReq(), buildRes(), next);
    await flush();

    expect(next).toHaveBeenCalledWith();
  });

  test("skips unauthenticated requests, which have no user to scope the key to", async () => {
    const { create } = mockStore({ createImpl: () => Promise.resolve({}) });
    const { idempotency } = require("../../middleware/idempotency");
    const next = jest.fn();

    idempotency(buildReq({ user: null }), buildRes(), next);
    await flush();

    expect(create).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  test("rejects an over-long key", async () => {
    mockStore({ createImpl: () => Promise.resolve({}) });
    const { idempotency } = require("../../middleware/idempotency");
    const next = jest.fn();

    idempotency(buildReq({ key: "x".repeat(201) }), buildRes(), next);
    await flush();

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400 })
    );
  });
});
