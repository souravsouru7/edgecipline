// Entitlement is derived from EVERY row a user owns, not from the token that
// happened to trigger the sync. This file walks the multi-token situations
// that broke the old one-token projection: a plan change (two tokens, the old
// one gets its own EXPIRED notification), a restore batch with a pending token
// next to the live one, and a lapsed subscription that must still read as
// "expired" rather than "never paid".

jest.mock("../../services/googlePlayApiService");
jest.mock("../../models/PlaySubscription");
jest.mock("../../models/Users");
jest.mock("../../services/authCacheService", () => ({
  invalidateAuthCache: jest.fn().mockResolvedValue(true),
}));
jest.mock("../../services/analyticsEventService", () => ({ track: jest.fn() }));
jest.mock("../../config/sentry", () => ({ captureOperationalError: jest.fn() }));

const mongoose = require("mongoose");
const PlaySubscription = require("../../models/PlaySubscription");
const User = require("../../models/Users");
const playApi = require("../../services/googlePlayApiService");
const { invalidateAuthCache } = require("../../services/authCacheService");
const {
  syncPurchase,
  restorePurchases,
  recomputePlayEntitlement,
  getPlaySubscriptionSummary,
} = require("../../services/googlePlayBillingService");
const { buildObfuscatedAccountId, fingerprintPurchaseToken } = require("../../utils/playAccountIdentity");
const { SUBSCRIPTION_STATES } = require("../../constants/googlePlay");
const { isPremium, getEffectiveSubscriptionStatus } = require("../../utils/premium");

const ONE_DAY = 24 * 60 * 60 * 1000;
const USER_A = new mongoose.Types.ObjectId();
const OLD_TOKEN = "edgecipline-test-purchase-token-OLD-0000000000000000";
const NEW_TOKEN = "edgecipline-test-purchase-token-NEW-0000000000000000";
const PENDING_TOKEN = "edgecipline-test-purchase-token-PENDING-00000000000";

function playResponse({ token, state = "SUBSCRIPTION_STATE_ACTIVE", expiryTime, basePlanId = "edgecipline-pro-monthly", linkedPurchaseToken } = {}) {
  return {
    subscriptionState: state,
    startTime: new Date(Date.now() - ONE_DAY).toISOString(),
    latestOrderId: `GPA.${token}`,
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    externalAccountIdentifiers: { obfuscatedExternalAccountId: buildObfuscatedAccountId(USER_A) },
    ...(linkedPurchaseToken ? { linkedPurchaseToken } : {}),
    lineItems: [
      {
        productId: "edgecipline_pro",
        expiryTime: (expiryTime || new Date(Date.now() + 30 * ONE_DAY)).toISOString(),
        offerDetails: { basePlanId },
        autoRenewingPlan: { autoRenewEnabled: state !== "SUBSCRIPTION_STATE_CANCELED" },
      },
    ],
  };
}

/**
 * A tiny in-memory PlaySubscription collection keyed on purchaseToken, so the
 * multi-row recompute sees what a real database would.
 */
let rows;
function installStore() {
  rows = new Map();
  PlaySubscription.findOne = jest.fn().mockImplementation((filter) => ({
    lean: () => Promise.resolve(rows.get(filter.purchaseToken) || null),
  }));
  PlaySubscription.findOneAndUpdate = jest.fn().mockImplementation((filter, update) => {
    const token = filter.purchaseToken;
    const current = rows.get(token);
    if (filter.supersededAt === null && current?.supersededAt) return Promise.resolve(null);
    if (filter.user === null && current?.user) return Promise.resolve(null);
    const next = {
      _id: current?._id || new mongoose.Types.ObjectId(),
      purchaseToken: token,
      user: null,
      supersededAt: null,
      detachedAt: null,
      ...(current || {}),
      ...(update.$set || {}),
    };
    if (!current && !update.$setOnInsert) return Promise.resolve(null);
    rows.set(token, next);
    return Promise.resolve(next);
  });
  PlaySubscription.find = jest.fn().mockImplementation((filter) => {
    const matches = [...rows.values()].filter((row) => {
      if (filter.user !== undefined && String(row.user) !== String(filter.user)) return false;
      if (filter.supersededAt === null && row.supersededAt) return false;
      if (filter.detachedAt === null && row.detachedAt) return false;
      return true;
    });
    const resolve = () => Promise.resolve(matches);
    return { select: () => ({ lean: resolve }), lean: resolve };
  });
  PlaySubscription.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
}

/** The user document as the writes leave it. */
let userDoc;
function lastWrittenExpiry() {
  return userDoc.playEntitlementExpiry;
}

beforeEach(() => {
  jest.clearAllMocks();
  installStore();
  userDoc = { _id: USER_A, subscriptionPlan: "free", subscriptionStatus: "inactive", playEntitlementExpiry: null };
  User.findById = jest.fn().mockReturnValue({
    select: () => ({ lean: () => ({ session: () => Promise.resolve({ subscriptionPlan: userDoc.subscriptionPlan }) }) }),
  });
  User.updateOne = jest.fn().mockImplementation((_filter, update) => {
    Object.assign(userDoc, update.$set);
    return Promise.resolve({ modifiedCount: 1 });
  });
  playApi.acknowledgeSubscriptionPurchase.mockResolvedValue({});
});

describe("plan change", () => {
  it("marks the linkedPurchaseToken row superseded and excludes it from the summary", async () => {
    playApi.getSubscriptionPurchase.mockResolvedValueOnce(playResponse({ token: OLD_TOKEN }));
    await syncPurchase({ purchaseToken: OLD_TOKEN, userId: USER_A, source: "verify" });

    playApi.getSubscriptionPurchase.mockResolvedValueOnce(
      playResponse({
        token: NEW_TOKEN,
        basePlanId: "edgecipline-pro-6month",
        expiryTime: new Date(Date.now() + 180 * ONE_DAY),
        linkedPurchaseToken: OLD_TOKEN,
      })
    );
    await syncPurchase({ purchaseToken: NEW_TOKEN, userId: USER_A, source: "verify" });

    expect(rows.get(OLD_TOKEN).supersededAt).toBeInstanceOf(Date);
    expect(rows.get(OLD_TOKEN).state).toBe(SUBSCRIPTION_STATES.EXPIRED);

    const summary = await getPlaySubscriptionSummary(USER_A);
    expect(summary.basePlanId).toBe("edgecipline-pro-6month");
    expect(summary.purchaseRef).toBe(fingerprintPurchaseToken(NEW_TOKEN));
    expect(summary).not.toHaveProperty("purchaseToken");
  });

  it("does not null playEntitlementExpiry when an EXPIRED RTDN arrives for a superseded token", async () => {
    playApi.getSubscriptionPurchase.mockResolvedValueOnce(playResponse({ token: OLD_TOKEN }));
    await syncPurchase({ purchaseToken: OLD_TOKEN, userId: USER_A, source: "verify" });

    const newExpiry = new Date(Date.now() + 180 * ONE_DAY);
    playApi.getSubscriptionPurchase.mockResolvedValueOnce(
      playResponse({ token: NEW_TOKEN, basePlanId: "edgecipline-pro-6month", expiryTime: newExpiry, linkedPurchaseToken: OLD_TOKEN })
    );
    await syncPurchase({ purchaseToken: NEW_TOKEN, userId: USER_A, source: "verify" });
    expect(lastWrittenExpiry().getTime()).toBe(newExpiry.getTime());

    // Google now tells us the OLD token expired. Under the old one-token
    // projection this wrote null and dropped a paying user to free.
    playApi.getSubscriptionPurchase.mockResolvedValueOnce(
      playResponse({ token: OLD_TOKEN, state: "SUBSCRIPTION_STATE_EXPIRED", expiryTime: new Date(Date.now() - 60_000) })
    );
    const result = await syncPurchase({
      purchaseToken: OLD_TOKEN,
      userId: null,
      source: "rtdn",
      notification: { type: "SUBSCRIPTION_EXPIRED", eventTimeMillis: Date.now() },
    });

    expect(result.entitled).toBe(false); // this token
    expect(result.userEntitled).toBe(true); // the account
    expect(lastWrittenExpiry().getTime()).toBe(newExpiry.getTime());
    expect(isPremium(userDoc)).toBe(true);
    expect(invalidateAuthCache).toHaveBeenCalledWith(USER_A);
  });
});

describe("multi-row recompute", () => {
  it("restore with one pending and one active token leaves the active entitlement intact", async () => {
    const activeExpiry = new Date(Date.now() + 20 * ONE_DAY);
    playApi.getSubscriptionPurchase.mockImplementation((token) =>
      Promise.resolve(
        token === PENDING_TOKEN
          ? playResponse({ token, state: "SUBSCRIPTION_STATE_PENDING" })
          : playResponse({ token, expiryTime: activeExpiry })
      )
    );

    // Order matters for the bug: the pending token is synced LAST.
    const result = await restorePurchases({ userId: USER_A, purchaseTokens: [OLD_TOKEN, PENDING_TOKEN] });

    expect(result.entitled).toBe(true);
    expect(lastWrittenExpiry().getTime()).toBe(activeExpiry.getTime());
    // A pending purchase is never acknowledged.
    expect(playApi.acknowledgeSubscriptionPurchase).not.toHaveBeenCalledWith("edgecipline_pro", PENDING_TOKEN);
  });

  it("entitlement is the max expiry across non-superseded rows", async () => {
    const near = new Date(Date.now() + 5 * ONE_DAY);
    const far = new Date(Date.now() + 90 * ONE_DAY);
    rows.set("a", { purchaseToken: "a", user: USER_A, state: SUBSCRIPTION_STATES.ACTIVE, expiryTime: near, basePlanId: "edgecipline-pro-monthly" });
    rows.set("b", { purchaseToken: "b", user: USER_A, state: SUBSCRIPTION_STATES.CANCELLED, expiryTime: far, basePlanId: "edgecipline-pro-3month" });
    rows.set("c", { purchaseToken: "c", user: USER_A, state: SUBSCRIPTION_STATES.ACTIVE, expiryTime: new Date(Date.now() + 365 * ONE_DAY), supersededAt: new Date(), basePlanId: "edgecipline-pro-6month" });

    const outcome = await recomputePlayEntitlement(USER_A);

    expect(outcome.entitled).toBe(true);
    expect(lastWrittenExpiry().getTime()).toBe(far.getTime());
  });

  it("revoking the only active token nulls entitlement", async () => {
    playApi.getSubscriptionPurchase.mockResolvedValueOnce(playResponse({ token: OLD_TOKEN }));
    await syncPurchase({ purchaseToken: OLD_TOKEN, userId: USER_A, source: "verify" });
    expect(isPremium(userDoc)).toBe(true);

    playApi.getSubscriptionPurchase.mockResolvedValueOnce(
      playResponse({ token: OLD_TOKEN, state: "SUBSCRIPTION_STATE_EXPIRED", expiryTime: new Date(Date.now() - 1000) })
    );
    await syncPurchase({ purchaseToken: OLD_TOKEN, userId: null, source: "rtdn", notification: { type: "VOIDED_PURCHASE" } });

    expect(isPremium(userDoc)).toBe(false);
    // Lapsed, not never-paid: the settings page says "expired".
    expect(getEffectiveSubscriptionStatus(userDoc)).toBe("expired");
  });

  it("a pending-only account reads as inactive, not expired", async () => {
    playApi.getSubscriptionPurchase.mockResolvedValueOnce(
      playResponse({ token: PENDING_TOKEN, state: "SUBSCRIPTION_STATE_PENDING" })
    );
    await syncPurchase({ purchaseToken: PENDING_TOKEN, userId: USER_A, source: "verify" });

    expect(lastWrittenExpiry()).toBeNull();
    expect(getEffectiveSubscriptionStatus(userDoc)).toBe("inactive");
  });

  it("never writes subscriptionStatus, subscriptionExpiry or totalPaid", async () => {
    playApi.getSubscriptionPurchase.mockResolvedValueOnce(playResponse({ token: OLD_TOKEN }));
    await syncPurchase({ purchaseToken: OLD_TOKEN, userId: USER_A, source: "verify" });
    for (const [, update] of User.updateOne.mock.calls) {
      expect(Object.keys(update.$set).sort()).toEqual(["playEntitlementExpiry", "subscriptionPlan"]);
    }
  });
});

describe("summary picks the row the user would call theirs", () => {
  it("prefers a pending row over an old expired one", async () => {
    rows.set("old", { purchaseToken: "old", user: USER_A, state: SUBSCRIPTION_STATES.EXPIRED, expiryTime: new Date(Date.now() - ONE_DAY) });
    rows.set("new", { purchaseToken: "new", user: USER_A, state: SUBSCRIPTION_STATES.PENDING, expiryTime: null });

    const summary = await getPlaySubscriptionSummary(USER_A);
    expect(summary.state).toBe(SUBSCRIPTION_STATES.PENDING);
    expect(summary.active).toBe(false);
  });

  it("prefers a live row over a pending one", async () => {
    rows.set("live", { purchaseToken: "live", user: USER_A, state: SUBSCRIPTION_STATES.ACTIVE, expiryTime: new Date(Date.now() + ONE_DAY) });
    rows.set("new", { purchaseToken: "new", user: USER_A, state: SUBSCRIPTION_STATES.PENDING, expiryTime: null });

    const summary = await getPlaySubscriptionSummary(USER_A);
    expect(summary.purchaseRef).toBe(fingerprintPurchaseToken("live"));
    expect(summary.active).toBe(true);
  });
});

describe("unknown base plan (Phase 4)", () => {
  it("rejects an unknown basePlanId instead of granting", async () => {
    playApi.getSubscriptionPurchase.mockResolvedValueOnce(
      playResponse({ token: OLD_TOKEN, basePlanId: "edgecipline-pro-lifetime" })
    );

    await expect(
      syncPurchase({ purchaseToken: OLD_TOKEN, userId: USER_A, source: "verify" })
    ).rejects.toMatchObject({ errorCode: "PLAY_BASE_PLAN_UNKNOWN", statusCode: 400 });

    expect(PlaySubscription.findOneAndUpdate).not.toHaveBeenCalled();
    expect(User.updateOne).not.toHaveBeenCalled();
    expect(playApi.acknowledgeSubscriptionPurchase).not.toHaveBeenCalled();
  });
});

describe("end-to-end lifecycle against the in-memory store", () => {
  it("RTDN PURCHASED → verify → plan change → EXPIRED RTDN on old token → cancel → expiry", async () => {
    const t1Expiry = new Date(Date.now() + 30 * ONE_DAY);
    const t2Expiry = new Date(Date.now() + 180 * ONE_DAY);
    const rtdn = (type) => ({ type, eventTimeMillis: Date.now() });

    // 1. Google's SUBSCRIPTION_PURCHASED lands before the app's verify call.
    playApi.getSubscriptionPurchase.mockResolvedValueOnce(playResponse({ token: OLD_TOKEN, expiryTime: t1Expiry }));
    let out = await syncPurchase({ purchaseToken: OLD_TOKEN, userId: null, source: "rtdn", notification: rtdn("SUBSCRIPTION_PURCHASED") });
    expect(rows.get(OLD_TOKEN).user).toBeNull();
    expect(rows.get(OLD_TOKEN).detachedAt).toBeNull();
    expect(out.userEntitled).toBe(false);
    expect(lastWrittenExpiry()).toBeNull();

    // 2. The buyer's verify binds the RTDN-first row (the old code refused this as "owner deleted").
    playApi.getSubscriptionPurchase.mockResolvedValueOnce(playResponse({ token: OLD_TOKEN, expiryTime: t1Expiry }));
    out = await syncPurchase({ purchaseToken: OLD_TOKEN, userId: USER_A, source: "verify" });
    expect(String(rows.get(OLD_TOKEN).user)).toBe(String(USER_A));
    expect(out.entitled).toBe(true);
    expect(lastWrittenExpiry().getTime()).toBe(t1Expiry.getTime());
    expect(isPremium(userDoc)).toBe(true);

    // 3. Upgrade to 6 months: new token, linked back to the old one.
    playApi.getSubscriptionPurchase.mockResolvedValueOnce(
      playResponse({ token: NEW_TOKEN, basePlanId: "edgecipline-pro-6month", expiryTime: t2Expiry, linkedPurchaseToken: OLD_TOKEN })
    );
    out = await syncPurchase({ purchaseToken: NEW_TOKEN, userId: USER_A, source: "verify" });
    expect(rows.get(OLD_TOKEN).supersededAt).toBeInstanceOf(Date);
    expect(lastWrittenExpiry().getTime()).toBe(t2Expiry.getTime());
    expect(userDoc.subscriptionPlan).toBe("monthly"); // cosmetic label enum has no 6-month value

    // 4. Google expires the OLD token. Entitlement must stay on the new one.
    playApi.getSubscriptionPurchase.mockResolvedValueOnce(
      playResponse({ token: OLD_TOKEN, state: "SUBSCRIPTION_STATE_EXPIRED", expiryTime: new Date(Date.now() - 1000) })
    );
    out = await syncPurchase({ purchaseToken: OLD_TOKEN, userId: null, source: "rtdn", notification: rtdn("SUBSCRIPTION_EXPIRED") });
    expect(out.entitled).toBe(false);
    expect(out.userEntitled).toBe(true);
    expect(lastWrittenExpiry().getTime()).toBe(t2Expiry.getTime());
    expect(isPremium(userDoc)).toBe(true);

    // 5. User cancels auto-renew: paid through t2Expiry, still PRO.
    playApi.getSubscriptionPurchase.mockResolvedValueOnce(
      playResponse({ token: NEW_TOKEN, basePlanId: "edgecipline-pro-6month", state: "SUBSCRIPTION_STATE_CANCELED", expiryTime: t2Expiry })
    );
    out = await syncPurchase({ purchaseToken: NEW_TOKEN, userId: null, source: "rtdn", notification: rtdn("SUBSCRIPTION_CANCELED") });
    expect(rows.get(NEW_TOKEN).cancelAtPeriodEnd).toBe(true);
    expect(out.userEntitled).toBe(true);
    expect(lastWrittenExpiry().getTime()).toBe(t2Expiry.getTime());
    const summary = await getPlaySubscriptionSummary(USER_A);
    expect(summary).toMatchObject({ state: SUBSCRIPTION_STATES.CANCELLED, active: true, cancelAtPeriodEnd: true });

    // 6. The period ends. Access goes; the paid-through date is kept so the card reads "expired".
    const ended = new Date(Date.now() - 60_000);
    playApi.getSubscriptionPurchase.mockResolvedValueOnce(
      playResponse({ token: NEW_TOKEN, basePlanId: "edgecipline-pro-6month", state: "SUBSCRIPTION_STATE_EXPIRED", expiryTime: ended })
    );
    out = await syncPurchase({ purchaseToken: NEW_TOKEN, userId: null, source: "rtdn", notification: rtdn("SUBSCRIPTION_EXPIRED") });
    expect(out.userEntitled).toBe(false);
    expect(lastWrittenExpiry().getTime()).toBe(ended.getTime());
    expect(isPremium(userDoc)).toBe(false);
    expect(getEffectiveSubscriptionStatus(userDoc)).toBe("expired");

    // Throughout: the Razorpay ledger was never touched and the cache was invalidated on every entitlement write.
    expect(userDoc.subscriptionStatus).toBe("inactive");
    expect(invalidateAuthCache).toHaveBeenCalledWith(USER_A);
  });
});
