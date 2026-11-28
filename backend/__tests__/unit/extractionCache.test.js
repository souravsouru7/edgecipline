const mockStore = new Map();
jest.mock("../../config/redis", () => ({
  client: {
    get: jest.fn(async (k) => (mockStore.has(k) ? mockStore.get(k) : null)),
    set: jest.fn(async (k, v) => { mockStore.set(k, v); return "OK"; }),
  },
  isRedisReady: jest.fn(() => true),
}));
jest.mock("../../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const { client: redis, isRedisReady } = require("../../config/redis");
const cache = require("../../utils/extractionCache");

describe("extractionCache", () => {
  beforeEach(() => { mockStore.clear(); jest.clearAllMocks(); isRedisReady.mockReturnValue(true); });

  it("returns what an earlier attempt of the same job stored for the same image", async () => {
    const hash = cache.imageHash(Buffer.from("png-bytes"));
    await cache.set("job1", hash, "vision:m:Forex", { pair: "EURUSD", entryPrice: 1.085 });
    await expect(cache.get("job1", hash, "vision:m:Forex")).resolves.toEqual({ pair: "EURUSD", entryPrice: 1.085 });
    expect(redis.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), "EX", cache.TTL_SECONDS);
  });

  it("never serves one job's result to another job or another image", async () => {
    const hash = cache.imageHash(Buffer.from("a"));
    await cache.set("job1", hash, "ocr", { text: "x" });
    await expect(cache.get("job2", hash, "ocr")).resolves.toBeNull();
    await expect(cache.get("job1", cache.imageHash(Buffer.from("b")), "ocr")).resolves.toBeNull();
  });

  it("is a no-op when Redis is down", async () => {
    isRedisReady.mockReturnValue(false);
    await cache.set("job1", "h", "ocr", { text: "x" });
    await expect(cache.get("job1", "h", "ocr")).resolves.toBeNull();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("does not cache without a job id or image hash", async () => {
    await cache.set("", "h", "ocr", { text: "x" });
    await cache.set("job1", "", "ocr", { text: "x" });
    expect(redis.set).not.toHaveBeenCalled();
  });
});
