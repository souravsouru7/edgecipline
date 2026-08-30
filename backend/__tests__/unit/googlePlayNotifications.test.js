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
