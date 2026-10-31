// Apple In-App Purchase — the properties that matter for money and access.
//
// Apple's signature check is mocked: the property under test is what the
// SERVICE does with a verified transaction (ownership, product allowlist,
// entitlement), not whether Apple's crypto works. The mock verifier still
// refuses anything not shaped like a JWS, and only "decodes" the payload the
// test put there — exactly what the real one returns once the chain checks out.

jest.mock("@apple/app-store-server-library", () => {
  const decode = (jws) => JSON.parse(Buffer.from(jws.split(".")[1], "base64url").toString("utf8"));
  class SignedDataVerifier {
    async verifyAndDecodeTransaction(jws) {
      const payload = decode(jws);
      if (payload.__forged) throw Object.assign(new Error("bad chain"), { status: 1 });
      return payload;
    }
    async verifyAndDecodeRenewalInfo(jws) { return decode(jws); }
    async verifyAndDecodeNotification(jws) { return decode(jws); }
  }
  return {
    SignedDataVerifier,
    AppStoreServerAPIClient: jest.fn(),
    Environment: { SANDBOX: "Sandbox", PRODUCTION: "Production", XCODE: "Xcode", LOCAL_TESTING: "LocalTesting" },
  };
});
jest.mock("../../models/AppStoreSubscription");
jest.mock("../../models/Users");
jest.mock("../../services/authCacheService", () => ({
  invalidateAuthCache: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../services/paymentService", () => ({
  resolveSubscriptionPlanLabel: jest.fn((current, next) => next),
}));

const mongoose = require("mongoose");
const AppStoreSubscription = require("../../models/AppStoreSubscription");
const User = require("../../models/Users");
const { appConfig } = require("../../config");
const {
  verifyTransaction,
  restoreTransactions,
  handleServerNotification,
  resolveOwner,
  allowedEnvironments,
} = require("../../services/appStoreBillingService");
const { buildAppAccountToken, matchesUser } = require("../../utils/appStoreAccountIdentity");
const { isPremium } = require("../../utils/premium");

const ONE_DAY = 24 * 60 * 60 * 1000;
const USER_A = new mongoose.Types.ObjectId();
const USER_B = new mongoose.Types.ObjectId();

const jws = (payload) =>
  `eyJhbGciOiJFUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.c2ln`;

function transaction(overrides = {}) {
  return {
    originalTransactionId: "2000000111111111",
    transactionId: "2000000222222222",
    productId: "com.edgecipline.pro.monthly",
    purchaseDate: Date.now() - ONE_DAY,
    expiresDate: Date.now() + 30 * ONE_DAY,
    appAccountToken: buildAppAccountToken(USER_A),
    environment: "Sandbox",
    bundleId: "com.edgecipline",
    ...overrides,
  };
}

// Tiny in-memory stand-in for the two collections.
let rows;
let users;
const lean = (value) => ({ lean: () => Promise.resolve(value) });

beforeEach(() => {
  rows = new Map();
  users = new Map([[String(USER_A), { _id: USER_A }], [String(USER_B), { _id: USER_B }]]);

  AppStoreSubscription.findOne.mockImplementation(({ originalTransactionId }) =>
    lean(rows.get(originalTransactionId) || null));
  AppStoreSubscription.findOneAndUpdate.mockImplementation(({ originalTransactionId }, update) => {
    const row = { ...(rows.get(originalTransactionId) || {}), ...update.$setOnInsert, ...update.$set };
    rows.set(originalTransactionId, row);
    return lean(row);
  });
  AppStoreSubscription.find.mockImplementation((query) => {
    const match = [...rows.values()].filter(
      (r) => String(r.user) === String(query.user) && !r.detachedAt
    );
    return { select: () => lean(match), sort: () => lean(match), lean: () => Promise.resolve(match) };
  });
  User.findById.mockImplementation((id) => ({
    select: () => lean(users.get(String(id))),
    lean: () => Promise.resolve(users.get(String(id))),
  }));
  User.updateOne.mockImplementation(({ _id }, update) => {
    users.set(String(_id), { ...users.get(String(_id)), ...update.$set });
    return Promise.resolve({ modifiedCount: 1 });
  });
});

describe("appAccountToken", () => {
  it("is a stable, lower-case RFC 4122 UUID per user", () => {
    const token = buildAppAccountToken(USER_A);
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(buildAppAccountToken(USER_A)).toBe(token);
    expect(buildAppAccountToken(USER_B)).not.toBe(token);
  });

  it("matches only its own user, case-insensitively", () => {
    const token = buildAppAccountToken(USER_A);
    expect(matchesUser(token.toUpperCase(), USER_A)).toBe(true);
    expect(matchesUser(token, USER_B)).toBe(false);
    expect(matchesUser(null, USER_A)).toBe(false);
  });
});

describe("verify", () => {
  it("grants PRO from a verified purchase and writes only the App Store field", async () => {
    const result = await verifyTransaction({ userId: USER_A, signedTransaction: jws(transaction()) });

    expect(result.entitlement.entitled).toBe(true);
    const user = users.get(String(USER_A));
    expect(user.appStoreEntitlementExpiry.getTime()).toBeGreaterThan(Date.now());
    expect(user.subscriptionStatus).toBeUndefined();
    expect(user.subscriptionExpiry).toBeUndefined();
    expect(isPremium(user)).toBe(true);
    expect(rows.get("2000000111111111")).toMatchObject({
      user: USER_A, state: "active", planType: "monthly", environment: "Sandbox",
    });
  });

  it("refuses a purchase made under another account's appAccountToken", async () => {
    const signedTransaction = jws(transaction({ appAccountToken: buildAppAccountToken(USER_B) }));
    await expect(verifyTransaction({ userId: USER_A, signedTransaction }))
      .rejects.toMatchObject({ statusCode: 409, errorCode: "APP_STORE_ACCOUNT_MISMATCH" });
    expect(users.get(String(USER_A)).appStoreEntitlementExpiry).toBeUndefined();
  });

  it("never moves a chain already bound to someone else", async () => {
    await verifyTransaction({ userId: USER_A, signedTransaction: jws(transaction()) });
    await expect(verifyTransaction({ userId: USER_B, signedTransaction: jws(transaction()) }))
      .rejects.toMatchObject({ errorCode: "APP_STORE_PURCHASE_OWNED_ELSEWHERE" });
  });

  it("refuses a chain whose owner deleted their account", async () => {
    rows.set("2000000111111111", { originalTransactionId: "2000000111111111", user: null, detachedAt: new Date() });
    await expect(verifyTransaction({ userId: USER_A, signedTransaction: jws(transaction()) }))
      .rejects.toMatchObject({ errorCode: "APP_STORE_PURCHASE_DETACHED" });
  });

  it("rejects a product that is not ours", async () => {
    const signedTransaction = jws(transaction({ productId: "com.someoneelse.pro" }));
    await expect(verifyTransaction({ userId: USER_A, signedTransaction }))
      .rejects.toMatchObject({ errorCode: "APP_STORE_PRODUCT_UNKNOWN" });
  });

  it("rejects data that fails Apple's signature check", async () => {
    const signedTransaction = jws(transaction({ __forged: true }));
    await expect(verifyTransaction({ userId: USER_A, signedTransaction }))
      .rejects.toMatchObject({ errorCode: "APP_STORE_VERIFICATION_FAILED" });
  });

  it("rejects junk that is not a JWS at all", async () => {
    await expect(verifyTransaction({ userId: USER_A, signedTransaction: "not-a-jws" }))
      .rejects.toMatchObject({ errorCode: "APP_STORE_SIGNED_DATA_INVALID" });
  });

  it("does not grant on a revoked (refunded) transaction", async () => {
    const signedTransaction = jws(transaction({ revocationDate: Date.now() - 1000 }));
    const result = await verifyTransaction({ userId: USER_A, signedTransaction });
    expect(result.entitlement.entitled).toBe(false);
    expect(isPremium(users.get(String(USER_A)))).toBe(false);
  });

  it("does not grant on an expired transaction but keeps the lapsed date", async () => {
    const signedTransaction = jws(transaction({ expiresDate: Date.now() - ONE_DAY }));
    const result = await verifyTransaction({ userId: USER_A, signedTransaction });
    expect(result.entitlement.entitled).toBe(false);
    expect(users.get(String(USER_A)).appStoreEntitlementExpiry.getTime()).toBeLessThan(Date.now());
  });
});

describe("environments", () => {
  it("never accepts Xcode-signed (unverified) transactions in production", () => {
    const { env } = appConfig;
    const { allowXcode } = appConfig.appStore;
    try {
      appConfig.env = "production";
      appConfig.appStore.allowXcode = true;
      expect(allowedEnvironments()).not.toContain("Xcode");
      expect(allowedEnvironments()).toContain("Production");
    } finally {
      appConfig.env = env;
      appConfig.appStore.allowXcode = allowXcode;
    }
  });

  it("rejects an environment outside the allowlist", async () => {
    const signedTransaction = jws(transaction({ environment: "Xcode" }));
    await expect(verifyTransaction({ userId: USER_A, signedTransaction }))
      .rejects.toMatchObject({ errorCode: "APP_STORE_ENVIRONMENT_REJECTED" });
  });
});

describe("restore", () => {
  it("restores the user's own chains and skips foreign ones without failing", async () => {
    const own = jws(transaction());
    const foreign = jws(transaction({
      originalTransactionId: "2000000999999999",
      appAccountToken: buildAppAccountToken(USER_B),
    }));
    const { results, entitlement } = await restoreTransactions({ userId: USER_A, signedTransactions: [own, foreign] });
    expect(results.map((r) => r.ok)).toEqual([true, false]);
    expect(entitlement.entitled).toBe(true);
  });
});

describe("server notifications", () => {
  const notification = (tx, notificationType = "DID_RENEW") =>
    jws({ notificationType, data: { environment: "Sandbox", signedTransactionInfo: jws(tx) }, environment: "Sandbox" });

  it("revokes PRO when Apple reports a refund for a bound chain", async () => {
    await verifyTransaction({ userId: USER_A, signedTransaction: jws(transaction()) });
    expect(isPremium(users.get(String(USER_A)))).toBe(true);

    await handleServerNotification(notification(transaction({ revocationDate: Date.now() }), "REFUND"));
    expect(rows.get("2000000111111111").state).toBe("revoked");
    expect(isPremium(users.get(String(USER_A)))).toBe(false);
  });

  it("records an early notification unbound, without granting anyone", async () => {
    const result = await handleServerNotification(notification(transaction(), "SUBSCRIBED"));
    expect(result.handled).toBe(true);
    expect(rows.get("2000000111111111").user).toBeUndefined();
    expect(User.updateOne).not.toHaveBeenCalled();

    // The buyer's own /verify then binds it.
    await verifyTransaction({ userId: USER_A, signedTransaction: jws(transaction()) });
    expect(rows.get("2000000111111111").user).toBe(USER_A);
  });

  it("ignores TEST notifications that carry no transaction", async () => {
    const result = await handleServerNotification(jws({ notificationType: "TEST", data: {}, environment: "Sandbox" }));
    expect(result.handled).toBe(false);
  });
});

describe("ownership rules", () => {
  it("lets a bound owner re-verify their own chain", () => {
    expect(resolveOwner({ existing: { user: USER_A }, claimingUserId: USER_A, transaction: transaction() }))
      .toBe(USER_A);
  });
});
