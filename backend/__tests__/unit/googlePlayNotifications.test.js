// Phase 7 — real-time developer notifications.
//
// The endpoint is unauthenticated by middleware, so the OIDC check inside the
// service IS the security boundary. Most of this file is about the ways a
// request that is not from Google must be turned away, and about a duplicate
// delivery not being allowed to double-apply anything.

jest.mock("google-auth-library");
jest.mock("../../models/WebhookEvent");
jest.mock("../../services/googlePlayBillingService");

const { OAuth2Client } = require("google-auth-library");
const WebhookEvent = require("../../models/WebhookEvent");
const billing = require("../../services/googlePlayBillingService");

const RTDN_SERVICE_ACCOUNT = "play-rtdn@edgecipline.iam.gserviceaccount.com";
const RTDN_AUDIENCE = "https://api.example.com/api/webhooks/google-play";
const TOKEN = "edgecipline-test-purchase-token-000000000000000000";

// The service reads config at require time, so the env has to be in place
// before the module graph is built.
let service;
let verifyIdToken;

beforeAll(() => {
  process.env.GOOGLE_PLAY_BILLING_ENABLED = "true";
  process.env.GOOGLE_PLAY_PACKAGE_NAME = "com.edgecipline";
  process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT = RTDN_SERVICE_ACCOUNT;
  process.env.GOOGLE_PLAY_RTDN_AUDIENCE = RTDN_AUDIENCE;

  verifyIdToken = jest.fn();
  OAuth2Client.mockImplementation(() => ({ verifyIdToken }));

  jest.isolateModules(() => {
    service = require("../../services/googlePlayNotificationService");
  });
});

/** Wrap a DeveloperNotification in the Pub/Sub push envelope Google sends. */
function pushBody(notification, messageId = "pubsub-message-1") {
  return Buffer.from(
    JSON.stringify({
      message: {
        messageId,
        publishTime: new Date().toISOString(),
        data: Buffer.from(JSON.stringify(notification)).toString("base64"),
      },
      subscription: "projects/edgecipline/subscriptions/play-rtdn",
    })
  );
}

function subscriptionNotification(notificationType = 2) {
  return {
    version: "1.0",
    packageName: "com.edgecipline",
    eventTimeMillis: String(Date.now()),
    subscriptionNotification: {
      version: "1.0",
      notificationType,
      purchaseToken: TOKEN,
      subscriptionId: "edgecipline_pro",
    },
  };
}

const GOOD_AUTH = "Bearer google-signed-oidc-token";

function acceptToken() {
  verifyIdToken.mockResolvedValue({
    getPayload: () => ({ email: RTDN_SERVICE_ACCOUNT, email_verified: true, aud: RTDN_AUDIENCE }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  acceptToken();
  WebhookEvent.findOneAndUpdate = jest
    .fn()
    .mockResolvedValue({ eventId: "pubsub-message-1", processed: false });
  WebhookEvent.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
  billing.handleSubscriptionNotification.mockResolvedValue({ entitled: true, stale: false });
});

describe("push authentication is the security boundary (Phase 14)", () => {
  it("rejects a request with no Authorization header", async () => {
    await expect(
      service.processGooglePlayNotification({
        rawBody: pushBody(subscriptionNotification()),
        authorizationHeader: undefined,
      })
    ).rejects.toMatchObject({ statusCode: 401, errorCode: "PLAY_RTDN_UNAUTHORIZED" });
    expect(billing.handleSubscriptionNotification).not.toHaveBeenCalled();
  });

  it("rejects a token that is not signed by Google", async () => {
    verifyIdToken.mockRejectedValue(new Error("Invalid token signature"));

    await expect(
      service.processGooglePlayNotification({
        rawBody: pushBody(subscriptionNotification()),
        authorizationHeader: GOOD_AUTH,
      })
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects a validly-signed token belonging to someone else's service account", async () => {
    // Any Google customer can mint a valid OIDC token for their OWN service
    // account. Signature alone is not authentication — the principal is.
    verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        email: "attacker@someone-else.iam.gserviceaccount.com",
        email_verified: true,
        aud: RTDN_AUDIENCE,
      }),
    });

    await expect(
      service.processGooglePlayNotification({
        rawBody: pushBody(subscriptionNotification()),
        authorizationHeader: GOOD_AUTH,
      })
    ).rejects.toMatchObject({ errorCode: "PLAY_RTDN_UNAUTHORIZED" });
    expect(billing.handleSubscriptionNotification).not.toHaveBeenCalled();
  });

  it("rejects an unverified email claim", async () => {
    verifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: RTDN_SERVICE_ACCOUNT, email_verified: false }),
    });

    await expect(
      service.processGooglePlayNotification({
        rawBody: pushBody(subscriptionNotification()),
        authorizationHeader: GOOD_AUTH,
      })
    ).rejects.toMatchObject({ errorCode: "PLAY_RTDN_UNAUTHORIZED" });
  });

  it("pins the audience to this exact endpoint", async () => {
    await service.processGooglePlayNotification({
      rawBody: pushBody(subscriptionNotification()),
      authorizationHeader: GOOD_AUTH,
    });
    // Without the aud check, a token issued for another of our services would
    // be replayable here.
    expect(verifyIdToken).toHaveBeenCalledWith(
      expect.objectContaining({ audience: RTDN_AUDIENCE })
    );
  });
});

describe("processing", () => {
  it("re-reads the truth from Google rather than trusting the notification body", async () => {
    await service.processGooglePlayNotification({
      rawBody: pushBody(subscriptionNotification(2)),
      authorizationHeader: GOOD_AUTH,
    });

    expect(billing.handleSubscriptionNotification).toHaveBeenCalledWith(
      expect.objectContaining({ purchaseToken: TOKEN, notificationType: "SUBSCRIPTION_RENEWED" })
    );
  });

  it("routes every subscription notification type down the same path", async () => {
    // Branching per type is how these integrations end up handling most cases
    // and silently mishandling the rest.
    const types = [1, 2, 3, 4, 5, 6, 7, 10, 12, 13];
    for (const type of types) {
      jest.clearAllMocks();
      acceptToken();
      WebhookEvent.findOneAndUpdate = jest.fn().mockResolvedValue({ processed: false });
      WebhookEvent.updateOne = jest.fn().mockResolvedValue({});
      billing.handleSubscriptionNotification.mockResolvedValue({ entitled: false });

      await service.processGooglePlayNotification({
        rawBody: pushBody(subscriptionNotification(type), `msg-${type}`),
        authorizationHeader: GOOD_AUTH,
      });

      expect(billing.handleSubscriptionNotification).toHaveBeenCalledTimes(1);
    }
  });

  it("handles a refund/chargeback through the same reconciliation", async () => {
    await service.processGooglePlayNotification({
      rawBody: pushBody({
        packageName: "com.edgecipline",
        eventTimeMillis: String(Date.now()),
        voidedPurchaseNotification: { purchaseToken: TOKEN, orderId: "GPA.1", productType: 1 },
      }),
      authorizationHeader: GOOD_AUTH,
    });

    expect(billing.handleSubscriptionNotification).toHaveBeenCalledWith(
      expect.objectContaining({ purchaseToken: TOKEN, notificationType: "VOIDED_PURCHASE" })
    );
  });

  it("ignores a notification for a different app", async () => {
    const result = await service.processGooglePlayNotification({
      rawBody: pushBody({
        packageName: "com.someone.else",
        eventTimeMillis: String(Date.now()),
        subscriptionNotification: { notificationType: 2, purchaseToken: TOKEN },
      }),
      authorizationHeader: GOOD_AUTH,
    });

    expect(result.result.skipped).toBe(true);
    expect(billing.handleSubscriptionNotification).not.toHaveBeenCalled();
  });

  it("acknowledges Play Console's test notification without touching entitlement", async () => {
    const result = await service.processGooglePlayNotification({
      rawBody: pushBody({
        packageName: "com.edgecipline",
        eventTimeMillis: String(Date.now()),
        testNotification: { version: "1.0" },
      }),
      authorizationHeader: GOOD_AUTH,
    });

    expect(result.result.reason).toBe("test_notification");
    expect(billing.handleSubscriptionNotification).not.toHaveBeenCalled();
  });

  it("rejects a malformed payload", async () => {
    await expect(
      service.processGooglePlayNotification({
        rawBody: Buffer.from("this is not json"),
        authorizationHeader: GOOD_AUTH,
      })
    ).rejects.toMatchObject({ errorCode: "PLAY_RTDN_INVALID_JSON" });
  });

  it("rejects an envelope with no message data", async () => {
    await expect(
      service.processGooglePlayNotification({
        rawBody: Buffer.from(JSON.stringify({ message: {} })),
        authorizationHeader: GOOD_AUTH,
      })
    ).rejects.toMatchObject({ errorCode: "PLAY_RTDN_INVALID_PAYLOAD" });
  });
});

describe("duplicate delivery (Phase 8)", () => {
  it("processes a message exactly once, keyed on the Pub/Sub messageId", async () => {
    await service.processGooglePlayNotification({
      rawBody: pushBody(subscriptionNotification(), "same-message-id"),
      authorizationHeader: GOOD_AUTH,
    });

    const [filter, update] = WebhookEvent.findOneAndUpdate.mock.calls[0];
    expect(filter.eventId).toBe("same-message-id");
    expect(filter.processed).toBe(false);
    expect(update.$setOnInsert.provider).toBe("google_play");
  });

  it("skips work when the event is already processed", async () => {
    const duplicate = Object.assign(new Error("dup"), { code: 11000 });
    WebhookEvent.findOneAndUpdate = jest
      .fn()
      .mockRejectedValueOnce(duplicate)
      .mockResolvedValueOnce({ processed: true });

    const result = await service.processGooglePlayNotification({
      rawBody: pushBody(subscriptionNotification()),
      authorizationHeader: GOOD_AUTH,
    });

    expect(result.idempotent).toBe(true);
    expect(billing.handleSubscriptionNotification).not.toHaveBeenCalled();
  });

  it("skips work when another worker holds the lock", async () => {
    const duplicate = Object.assign(new Error("dup"), { code: 11000 });
    WebhookEvent.findOneAndUpdate = jest
      .fn()
      .mockRejectedValueOnce(duplicate)
      .mockResolvedValueOnce({ processed: false });

    const result = await service.processGooglePlayNotification({
      rawBody: pushBody(subscriptionNotification()),
      authorizationHeader: GOOD_AUTH,
    });

    expect(result.idempotent).toBe(true);
    expect(result.inProgress).toBe(true);
    expect(billing.handleSubscriptionNotification).not.toHaveBeenCalled();
  });

  it("releases the lock and stays unprocessed when handling throws", async () => {
    // Leaving `processed` false is what makes the reconciliation cron able to
    // recover the event later.
    billing.handleSubscriptionNotification.mockRejectedValue(new Error("Play 503"));

    await expect(
      service.processGooglePlayNotification({
        rawBody: pushBody(subscriptionNotification()),
        authorizationHeader: GOOD_AUTH,
      })
    ).rejects.toThrow("Play 503");

    const [, update] = WebhookEvent.updateOne.mock.calls.at(-1);
    expect(update.processing).toBe(false);
    expect(update.processed).toBeUndefined();
    expect(update.processingError).toBe("Play 503");
  });
});

// ─── Failure classification (Phase 8) ──────────────────────────────────────
//
// Pub/Sub redelivers anything not answered 2xx for up to seven days and the
// reconciliation cron burns its attempt budget on the same event. That is the
// right behaviour for a Google outage and the wrong one for an event that can
// never succeed, or for a deploy that simply has billing switched off.

describe("failure classification (Phase 8)", () => {
  const ApiError = require("../../utils/ApiError");

  it("returns 2xx and marks permanentlyFailed for non-retryable Play errors", async () => {
    const notOurs = new ApiError(400, "not ours", "PLAY_PRODUCT_NOT_ALLOWED");
    billing.handleSubscriptionNotification.mockRejectedValue(notOurs);

    const result = await service.processGooglePlayNotification({
      rawBody: pushBody(subscriptionNotification()),
      authorizationHeader: GOOD_AUTH,
    });

    expect(result).toMatchObject({ processed: true, permanentlyFailed: true, code: "PLAY_PRODUCT_NOT_ALLOWED" });
    const [, update] = WebhookEvent.updateOne.mock.calls.at(-1);
    expect(update.processed).toBe(true);
    expect(update.permanentlyFailed).toBe(true);
    expect(update.processing).toBe(false);
  });

  it("treats Google's purchase-not-found (retryable: false) the same way", async () => {
    const gone = new ApiError(400, "gone", "GOOGLE_PLAY_PURCHASE_NOT_FOUND");
    gone.retryable = false;
    billing.handleSubscriptionNotification.mockRejectedValue(gone);

    const result = await service.processGooglePlayNotification({
      rawBody: pushBody(subscriptionNotification()),
      authorizationHeader: GOOD_AUTH,
    });
    expect(result.permanentlyFailed).toBe(true);
  });

  it("does not burn processingAttempts while billing is disabled", async () => {
    const disabled = Object.assign(new Error("Google Play billing is disabled."), { code: "GOOGLE_PLAY_DISABLED" });
    billing.handleSubscriptionNotification.mockRejectedValue(disabled);

    await expect(
      service.processGooglePlayNotification({
        rawBody: pushBody(subscriptionNotification()),
        authorizationHeader: GOOD_AUTH,
      })
    ).rejects.toMatchObject({ statusCode: 503, errorCode: "PLAY_RTDN_DEFERRED" });

    const [, update] = WebhookEvent.updateOne.mock.calls.at(-1);
    // Lock released, attempt handed back, event still recoverable.
    expect(update.$set.processing).toBe(false);
    expect(update.$inc.processingAttempts).toBe(-1);
    expect(update.$set.processed).toBeUndefined();
    expect(update.$set.permanentlyFailed).toBeUndefined();
  });

  it("still throws for retryable 5xx", async () => {
    const outage = new ApiError(502, "Google Play verification is temporarily unavailable", "GOOGLE_PLAY_UNAVAILABLE");
    outage.retryable = true;
    billing.handleSubscriptionNotification.mockRejectedValue(outage);

    await expect(
      service.processGooglePlayNotification({
        rawBody: pushBody(subscriptionNotification()),
        authorizationHeader: GOOD_AUTH,
      })
    ).rejects.toMatchObject({ errorCode: "GOOGLE_PLAY_UNAVAILABLE" });

    const [, update] = WebhookEvent.updateOne.mock.calls.at(-1);
    expect(update.processing).toBe(false);
    expect(update.permanentlyFailed).toBeUndefined();
  });

  it("classifies by code and by the retryable flag", () => {
    expect(service.classifyProcessingError({ errorCode: "PLAY_BASE_PLAN_UNKNOWN" }).kind).toBe("non_retryable");
    expect(service.classifyProcessingError({ errorCode: "PLAY_PURCHASE_TOKEN_INVALID" }).kind).toBe("non_retryable");
    expect(service.classifyProcessingError({ retryable: false }).kind).toBe("non_retryable");
    expect(service.classifyProcessingError({ code: "GOOGLE_PLAY_CONFIG_MISSING" }).kind).toBe("deferred");
    expect(service.classifyProcessingError({ errorCode: "GOOGLE_PLAY_TIMEOUT", retryable: true }).kind).toBe("retryable");
    expect(service.classifyProcessingError(new Error("boom")).kind).toBe("retryable");
  });

  describe("reconciliation replay", () => {
    function claimedEvent(overrides = {}) {
      const { payload, payloadSecrets } = service.redactNotification(subscriptionNotification());
      return { eventId: "evt", eventType: "SUBSCRIPTION_RENEWED", processingAttempts: 1, payload, payloadSecrets, ...overrides };
    }

    it("re-injects the purchase token from payloadSecrets before replaying", async () => {
      WebhookEvent.findOneAndUpdate = jest.fn().mockResolvedValue(claimedEvent());

      const outcome = await service.reprocessStoredPlayEvent("evt", 6);

      expect(outcome.recovered).toBe(true);
      expect(billing.handleSubscriptionNotification).toHaveBeenCalledWith(
        expect.objectContaining({ purchaseToken: TOKEN })
      );
    });

    it("closes a non-retryable failure immediately rather than after six attempts", async () => {
      WebhookEvent.findOneAndUpdate = jest.fn().mockResolvedValue(claimedEvent());
      billing.handleSubscriptionNotification.mockRejectedValue(new ApiError(400, "no plan", "PLAY_BASE_PLAN_UNKNOWN"));

      const outcome = await service.reprocessStoredPlayEvent("evt", 6);

      expect(outcome).toMatchObject({ recovered: false, exhausted: true });
      const [, update] = WebhookEvent.updateOne.mock.calls.at(-1);
      expect(update.permanentlyFailed).toBe(true);
    });

    it("defers without spending an attempt while billing is disabled", async () => {
      WebhookEvent.findOneAndUpdate = jest.fn().mockResolvedValue(claimedEvent({ processingAttempts: 6 }));
      billing.handleSubscriptionNotification.mockRejectedValue(
        Object.assign(new Error("disabled"), { code: "GOOGLE_PLAY_DISABLED" })
      );

      const outcome = await service.reprocessStoredPlayEvent("evt", 6);

      expect(outcome).toMatchObject({ recovered: false, deferred: true, exhausted: false });
      const [, update] = WebhookEvent.updateOne.mock.calls.at(-1);
      expect(update.$inc.processingAttempts).toBe(-1);
    });

    it("cannot replay once the secrets were pruned, and says so permanently", async () => {
      WebhookEvent.findOneAndUpdate = jest.fn().mockResolvedValue(claimedEvent({ payloadSecrets: undefined }));

      const outcome = await service.reprocessStoredPlayEvent("evt", 6);

      expect(outcome.exhausted).toBe(true);
      expect(billing.handleSubscriptionNotification).not.toHaveBeenCalled();
    });
  });
});

// ─── No raw tokens at rest (Phase 14) ──────────────────────────────────────

describe("purchase tokens are never stored in the event payload", () => {
  it("stores a fingerprint in payload and the raw token in payloadSecrets", async () => {
    await service.processGooglePlayNotification({
      rawBody: pushBody(subscriptionNotification()),
      authorizationHeader: GOOD_AUTH,
    });

    const [, update] = WebhookEvent.findOneAndUpdate.mock.calls[0];
    const stored = update.$setOnInsert;
    expect(JSON.stringify(stored.payload)).not.toContain(TOKEN);
    expect(stored.payload.subscriptionNotification.purchaseToken).toHaveLength(16);
    expect(stored.payload.subscriptionNotification.purchaseTokenRedacted).toBe(true);
    expect(stored.payloadSecrets).toEqual({ purchaseToken: TOKEN });
    // The live path still processes the REAL notification.
    expect(billing.handleSubscriptionNotification).toHaveBeenCalledWith(
      expect.objectContaining({ purchaseToken: TOKEN })
    );
  });

  it("redacts voided-purchase notifications too", () => {
    const { payload, payloadSecrets } = service.redactNotification({
      packageName: "com.edgecipline",
      voidedPurchaseNotification: { purchaseToken: TOKEN, orderId: "GPA.1", productType: 1, refundType: 1 },
    });
    expect(JSON.stringify(payload)).not.toContain(TOKEN);
    expect(payloadSecrets.purchaseToken).toBe(TOKEN);
    expect(service.rehydrateNotification(payload, payloadSecrets).voidedPurchaseNotification.purchaseToken).toBe(TOKEN);
  });

  it("stores nothing secret for a test notification", () => {
    const { payloadSecrets } = service.redactNotification({ testNotification: { version: "1.0" } });
    expect(payloadSecrets).toBeUndefined();
  });
});
