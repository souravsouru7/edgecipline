// The acknowledgement sweep is the only thing standing between a failed
// inline acknowledge and Google's automatic refund at 72 hours.

jest.mock("../../models/PlaySubscription");
jest.mock("../../services/googlePlayBillingService", () => ({
  syncPurchase: jest.fn(),
  isPlayBillingAvailable: jest.fn().mockReturnValue(true),
}));
jest.mock("../../config/sentry", () => ({ captureOperationalError: jest.fn() }));
jest.mock("../../utils/distributedLock", () => ({
  withCronLock: jest.fn(async (_opts, fn) => ({ result: await fn() })),
}));
jest.mock("../../utils/cronMetrics", () => ({ recordCronRun: jest.fn((name, data) => ({ name, ...data })) }));

const PlaySubscription = require("../../models/PlaySubscription");
const billing = require("../../services/googlePlayBillingService");
const { captureOperationalError } = require("../../config/sentry");
const { sweepUnacknowledgedPurchases } = require("../../jobs/playAcknowledgementSweepCron");

const HOUR = 60 * 60 * 1000;
const TOKEN_A = "edgecipline-test-purchase-token-A-000000000000000000";
const TOKEN_B = "edgecipline-test-purchase-token-B-000000000000000000";

let queriedFilter;
function mockRows(rows) {
  PlaySubscription.find = jest.fn().mockImplementation((filter) => {
    queriedFilter = filter;
    const chain = {
      select: () => chain,
      sort: () => chain,
      limit: () => chain,
      lean: () => Promise.resolve(rows),
    };
    return chain;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  billing.isPlayBillingAvailable.mockReturnValue(true);
  billing.syncPurchase.mockResolvedValue({ acknowledged: true, entitled: true });
  PlaySubscription.findById = jest.fn().mockReturnValue({
    select: () => ({ lean: () => Promise.resolve({ acknowledged: true }) }),
  });
});

describe("playAcknowledgementSweepCron", () => {
  it("sweep re-syncs rows older than 30 minutes that are unacknowledged", async () => {
    const now = new Date();
    mockRows([
      { _id: "a", purchaseToken: TOKEN_A, createdAt: new Date(now - 2 * HOUR), state: "active", acknowledgementAttempts: 1 },
      { _id: "b", purchaseToken: TOKEN_B, createdAt: new Date(now - 3 * HOUR), state: "active", acknowledgementAttempts: 2 },
    ]);

    const result = await sweepUnacknowledgedPurchases(now);

    expect(queriedFilter.acknowledged).toBe(false);
    expect(queriedFilter.createdAt.$lt.getTime()).toBe(now.getTime() - 30 * 60 * 1000);
    expect(billing.syncPurchase).toHaveBeenCalledTimes(2);
    expect(billing.syncPurchase).toHaveBeenCalledWith({ purchaseToken: TOKEN_A, userId: null, source: "reconcile" });
    expect(result).toMatchObject({ scanned: 2, acknowledged: 2, failed: 0, atRisk: 0 });
  });

  it("sweep skips detached rows", async () => {
    mockRows([]);
    await sweepUnacknowledgedPurchases(new Date());
    // The query itself excludes them — a detached token grants nobody
    // anything, so acknowledging it would only confirm an orphan charge.
    expect(queriedFilter.detachedAt).toBeNull();
    expect(billing.syncPurchase).not.toHaveBeenCalled();
  });

  it("sweep alerts on rows older than 48h", async () => {
    const now = new Date();
    mockRows([
      { _id: "old", purchaseToken: TOKEN_A, createdAt: new Date(now - 50 * HOUR), state: "active", acknowledgementAttempts: 4, lastAcknowledgementError: "Play 503" },
    ]);
    billing.syncPurchase.mockResolvedValue({ acknowledged: false, entitled: true });
    PlaySubscription.findById = jest.fn().mockReturnValue({
      select: () => ({ lean: () => Promise.resolve({ acknowledged: false }) }),
    });

    const result = await sweepUnacknowledgedPurchases(now);

    expect(result.atRisk).toBe(1);
    expect(captureOperationalError).toHaveBeenCalledTimes(1);
    const [, context] = captureOperationalError.mock.calls[0];
    expect(context.extra.purchaseRef).toHaveLength(16);
    expect(JSON.stringify(context)).not.toContain(TOKEN_A);
  });

  it("does not alert when the sweep itself just fixed the row", async () => {
    const now = new Date();
    mockRows([{ _id: "old", purchaseToken: TOKEN_A, createdAt: new Date(now - 50 * HOUR), state: "active" }]);
    // syncPurchase acknowledged it; the re-read sees acknowledged: true (default mock).
    const result = await sweepUnacknowledgedPurchases(now);
    expect(result.atRisk).toBe(0);
    expect(captureOperationalError).not.toHaveBeenCalled();
  });

  it("keeps going when one token fails", async () => {
    const now = new Date();
    mockRows([
      { _id: "a", purchaseToken: TOKEN_A, createdAt: new Date(now - 2 * HOUR), state: "active" },
      { _id: "b", purchaseToken: TOKEN_B, createdAt: new Date(now - 2 * HOUR), state: "active" },
    ]);
    billing.syncPurchase
      .mockRejectedValueOnce(Object.assign(new Error("Play 503"), { errorCode: "GOOGLE_PLAY_UNAVAILABLE" }))
      .mockResolvedValueOnce({ acknowledged: true });

    const result = await sweepUnacknowledgedPurchases(now);
    expect(result).toMatchObject({ scanned: 2, acknowledged: 1, failed: 1 });
  });

  it("does nothing while Play billing is unavailable", async () => {
    billing.isPlayBillingAvailable.mockReturnValue(false);
    mockRows([{ _id: "a", purchaseToken: TOKEN_A, createdAt: new Date(Date.now() - 2 * HOUR) }]);
    const result = await sweepUnacknowledgedPurchases(new Date());
    expect(result.unavailable).toBe(true);
    expect(billing.syncPurchase).not.toHaveBeenCalled();
  });
});
