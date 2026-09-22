// Phases 8, 9 and 14 — the attacks this integration has to survive.
//
// Everything here mocks the Play API and MongoDB, because the property under
// test is what the SERVICE does with an answer, not whether Google answers. The
// recurring theme: the client is a courier for a purchase token and nothing
// else, and any claim it makes about product, price, expiry, state or account
// must be ignored.

jest.mock("../../services/googlePlayApiService");
jest.mock("../../models/PlaySubscription");
jest.mock("../../models/Users");
jest.mock("../../services/authCacheService", () => ({
  invalidateAuthCache: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../services/analyticsEventService", () => ({ track: jest.fn() }));
jest.mock("../../config/sentry", () => ({ captureOperationalError: jest.fn() }));

const mongoose = require("mongoose");
const PlaySubscription = require("../../models/PlaySubscription");
const User = require("../../models/Users");
const playApi = require("../../services/googlePlayApiService");
const { invalidateAuthCache } = require("../../services/authCacheService");
const {
  verifyPurchase,
  restorePurchases,
  normalizePlayPurchase,
  resolvePurchaseOwner,
} = require("../../services/googlePlayBillingService");
const {
  buildObfuscatedAccountId,
  verifyObfuscatedAccountId,
  fingerprintPurchaseToken,
} = require("../../utils/playAccountIdentity");
const { SUBSCRIPTION_STATES } = require("../../constants/googlePlay");
const { isPremium } = require("../../utils/premium");

const ONE_DAY = 24 * 60 * 60 * 1000;
const USER_A = new mongoose.Types.ObjectId();
const USER_B = new mongoose.Types.ObjectId();
const TOKEN = "edgecipline-test-purchase-token-000000000000000000";

/** A well-formed subscriptionsv2 response for USER_A's active monthly plan. */
function playResponse(overrides = {}) {
  const { lineItem = {}, ...rest } = overrides;
  return {
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    startTime: new Date(Date.now() - ONE_DAY).toISOString(),
    latestOrderId: "GPA.0000-1111-2222-33333",
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    externalAccountIdentifiers: {
      obfuscatedExternalAccountId: buildObfuscatedAccountId(USER_A),
    },
    regionCode: "IN",
    lineItems: [
      {
        productId: "edgecipline_pro",
        expiryTime: new Date(Date.now() + 30 * ONE_DAY).toISOString(),
        offerDetails: { basePlanId: "edgecipline-pro-monthly" },
        autoRenewingPlan: { autoRenewEnabled: true },
        ...lineItem,
      },
    ],
    ...rest,
  };
}

/**
 * Entitlement is recomputed from every row the user owns
 * (recomputePlayEntitlement), so `find` has to answer. By default it returns
 * whatever the last upsert wrote, which is what a real database would hold.
 */
let lastUpsertedRow = null;
function mockUserRows(rows) {
  const resolve = () => Promise.resolve(rows);
  PlaySubscription.find = jest.fn().mockReturnValue({
    select: () => ({ lean: resolve }),
    lean: resolve,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  lastUpsertedRow = null;
  PlaySubscription.findOne = jest.fn().mockReturnValue({ lean: () => Promise.resolve(null) });
  PlaySubscription.findOneAndUpdate = jest.fn().mockImplementation((_filter, update) => {
    const row = { _id: new mongoose.Types.ObjectId(), purchaseToken: TOKEN, ...update.$set };
    if (update.$setOnInsert) lastUpsertedRow = row;
    return Promise.resolve(row);
  });
  PlaySubscription.find = jest.fn().mockImplementation(() => {
    const resolve = () => Promise.resolve(lastUpsertedRow ? [lastUpsertedRow] : []);
    return { select: () => ({ lean: resolve }), lean: resolve };
  });
  PlaySubscription.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
  User.findById = jest.fn().mockReturnValue({
    select: () => ({ lean: () => ({ session: () => Promise.resolve({ subscriptionPlan: "free" }) }) }),
  });
  User.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
  playApi.getSubscriptionPurchase.mockResolvedValue(playResponse());
  playApi.acknowledgeSubscriptionPurchase.mockResolvedValue({});
});

// ─── Nothing from the client is trusted ────────────────────────────────────

describe("client-supplied data is never trusted (Phase 14)", () => {
  it("rejects a productId the client claims but the allowlist does not know", () => {
    return expect(
      verifyPurchase({ userId: USER_A, purchaseToken: TOKEN, productId: "edgecipline_pro_free" })
    ).rejects.toMatchObject({ errorCode: "PLAY_PRODUCT_NOT_ALLOWED" });
  });

  it("rejects the purchase when GOOGLE reports a product that is not ours", () => {
    // The client can lie about productId, but so can a token minted against
    // another developer's app. This is the check that catches the second.
    playApi.getSubscriptionPurchase.mockResolvedValue(
      playResponse({ lineItem: { productId: "com.someone.else.pro" } })
    );
    return expect(
      verifyPurchase({ userId: USER_A, purchaseToken: TOKEN })
    ).rejects.toMatchObject({ errorCode: "PLAY_PRODUCT_NOT_ALLOWED" });
  });

  it("takes the expiry from Google, never from anything the caller passes", async () => {
    const googleExpiry = new Date(Date.now() + 7 * ONE_DAY);
    playApi.getSubscriptionPurchase.mockResolvedValue(
      playResponse({ lineItem: { expiryTime: googleExpiry.toISOString() } })
    );

    await verifyPurchase({
      userId: USER_A,
      purchaseToken: TOKEN,
      // A malicious client trying to buy a month and get a decade.
      expiryTime: new Date(Date.now() + 3650 * ONE_DAY),
      entitled: true,
      plan: "yearly",
    });

    const [, update] = User.updateOne.mock.calls[0];
    expect(new Date(update.$set.playEntitlementExpiry).getTime()).toBe(googleExpiry.getTime());
  });

  it("refuses a malformed purchase token before calling Google at all", async () => {
    await expect(
      verifyPurchase({ userId: USER_A, purchaseToken: "not-a-token" })
    ).rejects.toMatchObject({ errorCode: "PLAY_PURCHASE_TOKEN_INVALID" });
    expect(playApi.getSubscriptionPurchase).not.toHaveBeenCalled();
  });
});

// ─── Entitlement follows Google's state ────────────────────────────────────

describe("entitlement is written only from verified state", () => {
  it("grants on an active purchase and invalidates the auth cache", async () => {
    const result = await verifyPurchase({ userId: USER_A, purchaseToken: TOKEN });

    expect(result.entitled).toBe(true);
    const [filter, update] = User.updateOne.mock.calls[0];
    expect(String(filter._id)).toBe(String(USER_A));
    expect(update.$set.playEntitlementExpiry).toBeTruthy();
    // Without this a paying user keeps being told to upgrade for the cache TTL.
    expect(invalidateAuthCache).toHaveBeenCalledWith(USER_A);
  });

  it("never sets subscriptionStatus or subscriptionExpiry", async () => {
    // Those two belong to the Razorpay prepaid ledger. Worse, hasActiveSubscription
    // treats status "active" with a null expiry as UNLIMITED access, so a Play
    // write that touched status would hand out permanent free premium.
    await verifyPurchase({ userId: USER_A, purchaseToken: TOKEN });

    const [, update] = User.updateOne.mock.calls[0];
    expect(update.$set).not.toHaveProperty("subscriptionStatus");
    expect(update.$set).not.toHaveProperty("subscriptionExpiry");
    expect(update.$set).not.toHaveProperty("totalPaid");
  });

  it("grants nothing on a PENDING purchase — Google has not taken payment", async () => {
    playApi.getSubscriptionPurchase.mockResolvedValue(
      playResponse({ subscriptionState: "SUBSCRIPTION_STATE_PENDING" })
    );

    const result = await verifyPurchase({ userId: USER_A, purchaseToken: TOKEN });

    expect(result.entitled).toBe(false);
    const [, update] = User.updateOne.mock.calls[0];
    expect(update.$set.playEntitlementExpiry).toBeNull();
  });

  it("withdraws entitlement when Google reports the purchase revoked", async () => {
    playApi.getSubscriptionPurchase.mockResolvedValue(
      playResponse({ subscriptionState: "SUBSCRIPTION_STATE_EXPIRED" })
    );

    const result = await verifyPurchase({ userId: USER_A, purchaseToken: TOKEN });

    expect(result.entitled).toBe(false);
    // The field keeps a PAST date (so the settings page can say "expired"
    // rather than "never paid") but must never be in the future — even though
    // Google's snapshot still carries a future expiryTime on this row.
    const written = User.updateOne.mock.calls[0][1].$set.playEntitlementExpiry;
    expect(written).toBeInstanceOf(Date);
    expect(written.getTime()).toBeLessThan(Date.now());
    expect(isPremium({ playEntitlementExpiry: written })).toBe(false);
  });

  it("carries the paid-through date, not a future one, when a held subscription lapses", async () => {
    // ON_HOLD reports a future expiryTime. Writing it verbatim would grant
    // access; the recompute caps it at now.
    playApi.getSubscriptionPurchase.mockResolvedValue(
      playResponse({ subscriptionState: "SUBSCRIPTION_STATE_ON_HOLD" })
    );

    const result = await verifyPurchase({ userId: USER_A, purchaseToken: TOKEN });

    expect(result.entitled).toBe(false);
    const written = User.updateOne.mock.calls[0][1].$set.playEntitlementExpiry;
    expect(written.getTime()).toBeLessThan(Date.now());
  });

  it("does not acknowledge a purchase that grants nothing", async () => {
    // Acknowledging a PENDING purchase would confirm a transaction Google has
    // not completed.
    playApi.getSubscriptionPurchase.mockResolvedValue(
      playResponse({
        subscriptionState: "SUBSCRIPTION_STATE_PENDING",
        acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
      })
    );

    await verifyPurchase({ userId: USER_A, purchaseToken: TOKEN });

    expect(playApi.acknowledgeSubscriptionPurchase).not.toHaveBeenCalled();
  });

  it("acknowledges an entitling purchase that Google has not yet seen acknowledged", async () => {
    // Google auto-refunds anything left unacknowledged for three days.
    playApi.getSubscriptionPurchase.mockResolvedValue(
      playResponse({ acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING" })
    );

    await verifyPurchase({ userId: USER_A, purchaseToken: TOKEN });

    expect(playApi.acknowledgeSubscriptionPurchase).toHaveBeenCalledWith("edgecipline_pro", TOKEN);
  });

  it("still grants when acknowledgement fails, and records it for retry", async () => {
    // The user has paid and Google confirmed it. A failed side effect must not
    // cost them the access they bought.
    playApi.getSubscriptionPurchase.mockResolvedValue(
      playResponse({ acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING" })
    );
    playApi.acknowledgeSubscriptionPurchase.mockRejectedValue(new Error("Play 503"));

    const result = await verifyPurchase({ userId: USER_A, purchaseToken: TOKEN });

    expect(result.entitled).toBe(true);
    expect(result.acknowledged).toBe(false);
    const errorWrite = PlaySubscription.updateOne.mock.calls.find(
      ([, update]) => update?.$set?.lastAcknowledgementError
    );
    expect(errorWrite).toBeTruthy();
  });
});

// ─── Account association ───────────────────────────────────────────────────

describe("a purchase can never move between accounts (Phase 9)", () => {
  const bound = { _id: "row", user: USER_A, purchaseToken: TOKEN, state: SUBSCRIPTION_STATES.ACTIVE };

  it("refuses a token already bound to a different Edgecipline account", () => {
    // The core attack: user A buys, signs out, user B signs in on the same
    // device and the app presents A's still-valid purchase.
    expect(() =>
      resolvePurchaseOwner({ existing: bound, claimingUserId: USER_B, purchase: {}, tokenFingerprint: "x" })
    ).toThrow(expect.objectContaining({ errorCode: "PLAY_PURCHASE_ALREADY_CLAIMED" }));
  });

  it("allows the account that already owns it to re-verify", () => {
    const owner = resolvePurchaseOwner({
      existing: bound,
      claimingUserId: USER_A,
      purchase: {},
      tokenFingerprint: "x",
    });
    expect(String(owner.userId)).toBe(String(USER_A));
  });

  it("still refuses a deletion-detached row (detachedAt set)", () => {
    // Account deletion nulls the user AND stamps detachedAt, and keeps the row
    // precisely so the token stays spent. Re-binding it would resurrect a
    // subscription onto a stranger.
    expect(() =>
      resolvePurchaseOwner({
        existing: { ...bound, user: null, detachedAt: new Date() },
        claimingUserId: USER_B,
        purchase: { obfuscatedAccountId: buildObfuscatedAccountId(USER_B) },
        tokenFingerprint: "x",
      })
    ).toThrow(expect.objectContaining({ errorCode: "PLAY_PURCHASE_DETACHED" }));
  });

  it("does not throw for an RTDN on a detached row — it just grants nobody", () => {
    const owner = resolvePurchaseOwner({
      existing: { ...bound, user: null, detachedAt: new Date() },
      claimingUserId: null,
      purchase: {},
      tokenFingerprint: "x",
    });
    expect(owner.userId).toBeNull();
    expect(owner.identity).toBe("detached");
  });

  it("binds a token whose row was created unbound by an earlier RTDN", async () => {
    // The routine race: Google's SUBSCRIPTION_PURCHASED notification lands
    // before the app's verify call and creates the row with no user. That
    // row is NOT "owner deleted" — the buyer must be able to claim it.
    const rtdnRow = {
      _id: "row",
      user: null,
      detachedAt: null,
      purchaseToken: TOKEN,
      state: SUBSCRIPTION_STATES.ACTIVE,
      expiryTime: new Date(Date.now() + 30 * ONE_DAY),
      lastSyncedAt: new Date(Date.now() - 5_000),
    };
    PlaySubscription.findOne = jest.fn().mockReturnValue({ lean: () => Promise.resolve(rtdnRow) });

    const result = await verifyPurchase({ userId: USER_A, purchaseToken: TOKEN });

    expect(result.stale).toBe(false);
    expect(result.entitled).toBe(true);
    const [filter, update] = PlaySubscription.findOneAndUpdate.mock.calls[0];
    expect(String(update.$set.user)).toBe(String(USER_A));
    // Ownership is re-asserted inside the write, so a concurrent bind to a
    // different account can never be overwritten.
    expect(filter.user).toEqual({ $in: [null, USER_A] });
    expect(User.updateOne).toHaveBeenCalled();
    expect(invalidateAuthCache).toHaveBeenCalledWith(USER_A);
  });

  it("RTDN-first then a DIFFERENT user restores → PLAY_PURCHASE_ACCOUNT_MISMATCH when the echoed id belongs to someone else", async () => {
    const rtdnRow = {
      _id: "row",
      user: null,
      detachedAt: null,
      purchaseToken: TOKEN,
      state: SUBSCRIPTION_STATES.ACTIVE,
      lastSyncedAt: new Date(Date.now() - 5_000),
    };
    PlaySubscription.findOne = jest.fn().mockReturnValue({ lean: () => Promise.resolve(rtdnRow) });
    // Google echoes USER_A's identifier (playResponse default); USER_B claims.
    await expect(verifyPurchase({ userId: USER_B, purchaseToken: TOKEN })).rejects.toMatchObject({
      errorCode: "PLAY_PURCHASE_ACCOUNT_MISMATCH",
    });
    expect(PlaySubscription.findOneAndUpdate).not.toHaveBeenCalled();
    expect(User.updateOne).not.toHaveBeenCalled();
  });

  it("binds the user when verify loses the upsert race to an RTDN", async () => {
    const duplicate = Object.assign(new Error("dup"), { code: 11000 });
    const winnerRow = {
      _id: "row",
      user: null,
      detachedAt: null,
      purchaseToken: TOKEN,
      state: SUBSCRIPTION_STATES.ACTIVE,
      expiryTime: new Date(Date.now() + 30 * ONE_DAY),
      lastSyncedAt: new Date(Date.now() + 1_000),
    };
    PlaySubscription.findOneAndUpdate = jest
      .fn()
      // The upsert collides with the RTDN's freshly inserted row.
      .mockRejectedValueOnce(duplicate)
      // The follow-up bind of the claiming user succeeds.
      .mockImplementationOnce((_filter, update) =>
        Promise.resolve({ ...winnerRow, ...update.$set })
      );
    PlaySubscription.findOne = jest
      .fn()
      .mockReturnValueOnce({ lean: () => Promise.resolve(null) })
      .mockReturnValueOnce({ lean: () => Promise.resolve(winnerRow) });
    mockUserRows([{ ...winnerRow, user: USER_A }]);

    const result = await verifyPurchase({ userId: USER_A, purchaseToken: TOKEN });

    expect(result.stale).toBe(true);
    expect(result.entitled).toBe(true);
    expect(result.userEntitled).toBe(true);
    const [bindFilter, bindUpdate] = PlaySubscription.findOneAndUpdate.mock.calls[1];
    expect(bindFilter).toEqual({ purchaseToken: TOKEN, user: null, detachedAt: null });
    expect(String(bindUpdate.$set.user)).toBe(String(USER_A));
    expect(User.updateOne).toHaveBeenCalled();
    expect(invalidateAuthCache).toHaveBeenCalledWith(USER_A);
  });

  it("refuses a new token whose Google identifier belongs to someone else", () => {
    expect(() =>
      resolvePurchaseOwner({
        existing: null,
        claimingUserId: USER_B,
        purchase: { obfuscatedAccountId: buildObfuscatedAccountId(USER_A) },
        tokenFingerprint: "x",
      })
    ).toThrow(expect.objectContaining({ errorCode: "PLAY_PURCHASE_ACCOUNT_MISMATCH" }));
  });

  it("binds a new token whose identifier matches the claiming user", () => {
    const owner = resolvePurchaseOwner({
      existing: null,
      claimingUserId: USER_A,
      purchase: { obfuscatedAccountId: buildObfuscatedAccountId(USER_A) },
      tokenFingerprint: "x",
    });
    expect(owner.identity).toBe("match");
    expect(String(owner.userId)).toBe(String(USER_A));
  });

  it("binds a purchase with no identifier at all rather than stranding it", () => {
    // Pre-dates the obfuscated id, or a restore path that omits it. The token
    // still came from Play on a device this user is signed into, and refusing
    // would leave a real subscriber with no way to recover their purchase.
    const owner = resolvePurchaseOwner({
      existing: null,
      claimingUserId: USER_A,
      purchase: { obfuscatedAccountId: null },
      tokenFingerprint: "x",
    });
    expect(owner.identity).toBe("absent");
    expect(String(owner.userId)).toBe(String(USER_A));
  });

  it("leaves an RTDN for an unknown token unbound instead of guessing an owner", () => {
    const owner = resolvePurchaseOwner({
      existing: null,
      claimingUserId: null,
      purchase: {},
      tokenFingerprint: "x",
    });
    expect(owner.userId).toBeNull();
    expect(owner.identity).toBe("unknown");
  });

  it("never rebinds the user on an already-bound row", async () => {
    PlaySubscription.findOne = jest.fn().mockReturnValue({ lean: () => Promise.resolve(bound) });

    await verifyPurchase({ userId: USER_A, purchaseToken: TOKEN });

    const [, update] = PlaySubscription.findOneAndUpdate.mock.calls[0];
    expect(update.$set).not.toHaveProperty("user");
  });
});

describe("obfuscated account identity", () => {
  it("is deterministic per user and different between users", () => {
    expect(buildObfuscatedAccountId(USER_A)).toBe(buildObfuscatedAccountId(USER_A));
    expect(buildObfuscatedAccountId(USER_A)).not.toBe(buildObfuscatedAccountId(USER_B));
  });

  it("does not leak the user id — Google's docs require it not be PII", () => {
    const value = buildObfuscatedAccountId(USER_A);
    expect(value).not.toContain(String(USER_A));
    expect(value).toHaveLength(64);
  });

  it("classifies match, mismatch and absent distinctly", () => {
    expect(verifyObfuscatedAccountId(buildObfuscatedAccountId(USER_A), USER_A)).toBe("match");
    expect(verifyObfuscatedAccountId(buildObfuscatedAccountId(USER_B), USER_A)).toBe("mismatch");
    expect(verifyObfuscatedAccountId("", USER_A)).toBe("absent");
    // A truncated value must not slip through a length-mismatch crash.
    expect(verifyObfuscatedAccountId("abc", USER_A)).toBe("mismatch");
  });

  it("fingerprints tokens irreversibly for logging", () => {
    const print = fingerprintPurchaseToken(TOKEN);
    expect(print).toHaveLength(16);
    expect(TOKEN).not.toContain(print);
    expect(fingerprintPurchaseToken(TOKEN)).toBe(print);
  });
});

// ─── Idempotency and ordering ──────────────────────────────────────────────

describe("idempotency and out-of-order delivery (Phases 7 and 8)", () => {
  it("keys the upsert on the purchase token so a replay cannot duplicate", async () => {
    await verifyPurchase({ userId: USER_A, purchaseToken: TOKEN });
    await verifyPurchase({ userId: USER_A, purchaseToken: TOKEN });

    for (const [filter] of PlaySubscription.findOneAndUpdate.mock.calls) {
      expect(filter.purchaseToken).toBe(TOKEN);
    }
  });

  it("ignores a snapshot older than the one already stored", async () => {
    // A renewal fetched at T1 must not land after a cancellation fetched at
    // T2 > T1 and resurrect the subscription.
    PlaySubscription.findOne = jest.fn().mockReturnValue({
      lean: () =>
        Promise.resolve({
          _id: "row",
          user: USER_A,
          purchaseToken: TOKEN,
          state: SUBSCRIPTION_STATES.EXPIRED,
          expiryTime: new Date(Date.now() - ONE_DAY),
          lastSyncedAt: new Date(Date.now() + 60_000),
        }),
    });

    // The stored rows say EXPIRED; the (stale) fetch says ACTIVE.
    mockUserRows([
      {
        user: USER_A,
        purchaseToken: TOKEN,
        state: SUBSCRIPTION_STATES.EXPIRED,
        expiryTime: new Date(Date.now() - ONE_DAY),
      },
    ]);

    const result = await verifyPurchase({ userId: USER_A, purchaseToken: TOKEN });

    expect(result.stale).toBe(true);
    // The stale snapshot is never written to the row...
    expect(PlaySubscription.findOneAndUpdate).not.toHaveBeenCalled();
    // ...and the entitlement that IS written comes from the stored rows, not
    // from the stale fetch.
    expect(result.entitled).toBe(false);
    for (const [, update] of User.updateOne.mock.calls) {
      const written = update.$set.playEntitlementExpiry;
      expect(written === null || written.getTime() < Date.now()).toBe(true);
    }
  });

  it("re-asserts the ordering guard inside the write, not just before it", async () => {
    await verifyPurchase({ userId: USER_A, purchaseToken: TOKEN });

    const [filter] = PlaySubscription.findOneAndUpdate.mock.calls[0];
    // Without this clause two concurrent handlers could both pass the read-time
    // check and the loser would overwrite the winner.
    expect(filter.$or).toEqual([
      { lastSyncedAt: null },
      { lastSyncedAt: { $lte: expect.any(Date) } },
    ]);
  });

  it("adopts the winner's state when it loses an upsert race", async () => {
    const duplicate = Object.assign(new Error("dup"), { code: 11000 });
    PlaySubscription.findOneAndUpdate = jest.fn().mockRejectedValue(duplicate);
    PlaySubscription.findOne = jest
      .fn()
      // Read before the write: nothing there yet.
      .mockReturnValueOnce({ lean: () => Promise.resolve(null) })
      // Re-read after the collision: the winner's row.
      .mockReturnValueOnce({
        lean: () =>
          Promise.resolve({
            user: USER_A,
            purchaseToken: TOKEN,
            state: SUBSCRIPTION_STATES.ACTIVE,
            expiryTime: new Date(Date.now() + ONE_DAY),
          }),
      });

    const result = await verifyPurchase({ userId: USER_A, purchaseToken: TOKEN });

    expect(result.stale).toBe(true);
    expect(result.entitled).toBe(true);
  });
});

// ─── Restore ───────────────────────────────────────────────────────────────

describe("restore (Phase 10)", () => {
  it("verifies each token server-side rather than trusting the device", async () => {
    await restorePurchases({ userId: USER_A, purchaseTokens: [TOKEN] });
    expect(playApi.getSubscriptionPurchase).toHaveBeenCalledWith(TOKEN);
  });

  it("reports per-token outcomes instead of failing the whole batch", async () => {
    const other = "another-valid-looking-token-1111111111111111111111";
    playApi.getSubscriptionPurchase
      .mockResolvedValueOnce(playResponse())
      .mockRejectedValueOnce(
        Object.assign(new Error("nope"), { errorCode: "GOOGLE_PLAY_PURCHASE_NOT_FOUND" })
      );

    const result = await restorePurchases({ userId: USER_A, purchaseTokens: [TOKEN, other] });

    expect(result.entitled).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].status).toBe("active");
    expect(result.results[1].status).toBe("failed");
  });

  it("never returns a raw purchase token to the client", async () => {
    const result = await restorePurchases({ userId: USER_A, purchaseTokens: [TOKEN] });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(result.results[0].purchaseRef).toHaveLength(16);
  });

  it("de-duplicates repeated tokens in one request", async () => {
    await restorePurchases({ userId: USER_A, purchaseTokens: [TOKEN, TOKEN, TOKEN] });
    expect(playApi.getSubscriptionPurchase).toHaveBeenCalledTimes(1);
  });

  it("caps the batch so the endpoint cannot be used to probe tokens", () => {
    const many = Array.from({ length: 25 }, (_, i) => `${TOKEN}${i}`);
    return expect(restorePurchases({ userId: USER_A, purchaseTokens: many })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("does nothing at all when the device holds no purchases", async () => {
    const result = await restorePurchases({ userId: USER_A, purchaseTokens: [] });
    expect(result).toEqual({ restored: 0, entitled: false, results: [] });
    expect(playApi.getSubscriptionPurchase).not.toHaveBeenCalled();
  });
});

// ─── Normalisation ─────────────────────────────────────────────────────────

describe("normalising Google's response", () => {
  it("reads the longest-lived line item rather than the first", () => {
    const near = new Date(Date.now() + ONE_DAY).toISOString();
    const far = new Date(Date.now() + 90 * ONE_DAY).toISOString();
    const normalized = normalizePlayPurchase({
      subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
      lineItems: [
        { productId: "edgecipline_pro", expiryTime: near, offerDetails: { basePlanId: "a" } },
        { productId: "edgecipline_pro", expiryTime: far, offerDetails: { basePlanId: "b" } },
      ],
    });
    expect(normalized.expiryTime.toISOString()).toBe(far);
  });

  it("flags a cancelled-but-unexpired subscription as cancel-at-period-end", () => {
    const normalized = normalizePlayPurchase(
      playResponse({
        subscriptionState: "SUBSCRIPTION_STATE_CANCELED",
        lineItem: { autoRenewingPlan: { autoRenewEnabled: false } },
      })
    );
    expect(normalized.state).toBe(SUBSCRIPTION_STATES.CANCELLED);
    expect(normalized.cancelAtPeriodEnd).toBe(true);
    expect(normalized.autoRenewing).toBe(false);
  });

  it("marks licence-tester purchases so they never count as revenue", () => {
    const normalized = normalizePlayPurchase(playResponse({ testPurchase: {} }));
    expect(normalized.testPurchase).toBe(true);
  });

  it("survives an empty or malformed response without throwing", () => {
    expect(normalizePlayPurchase({}).state).toBe(SUBSCRIPTION_STATES.PENDING);
    expect(normalizePlayPurchase({}).expiryTime).toBeNull();
    expect(normalizePlayPurchase(null).productId).toBeNull();
  });
});
