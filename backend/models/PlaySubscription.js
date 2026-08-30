"use strict";

const mongoose = require("mongoose");
const { SUBSCRIPTION_STATE_VALUES, SUBSCRIPTION_STATES } = require("../constants/googlePlay");

// ─── Google Play subscription state ─────────────────────────────────────────
//
// Why this is a separate collection rather than more fields on Payment:
//
// A Payment row is an immutable receipt for a prepaid block of days — that is
// what Razorpay sells us. A Play subscription is a LIVING agreement whose state
// Google mutates for months after the first charge (renew, cancel, grace, hold,
// pause, revoke). Modelling it as a Payment would mean mutating receipts, which
// breaks the refund ledger and the revenue reporting built on top of it.
//
// So: this collection holds the live agreement, and a Payment row is still
// written per successful charge for the receipt trail. The two are linked by
// `latestOrderId`.
//
// The document is keyed on `purchaseToken`, which is what Google guarantees to
// be unique per purchase. That unique index is the backbone of Phase 8
// (idempotency) and Phase 9 (no silent account transfer): a token can only ever
// exist once, and therefore can only ever be attached to one Edgecipline user.
const playSubscriptionSchema = new mongoose.Schema(
  {
    // Nullable ON PURPOSE. Account deletion detaches the purchase rather than
    // deleting the row — see accountDeletionService. If the row were deleted,
    // the same purchase token could later be presented by a different account
    // and would look brand new, silently transferring a live subscription.
    // Keeping the (now ownerless) row means the token stays spent forever.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    // Google's unique handle for this purchase. THE idempotency key.
    purchaseToken: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    // Always PRODUCT_ID today, stored so a future second product does not need
    // a migration and so admin tooling can read it without a join.
    productId: {
      type: String,
      required: true,
      trim: true,
    },
    basePlanId: {
      type: String,
      default: null,
      trim: true,
    },
    offerId: {
      type: String,
      default: null,
      trim: true,
    },
    // The web plan this base plan mirrors ("monthly" / "3_months" / "6_months"),
    // so revenue reporting can group Play and Razorpay purchases together.
    planType: {
      type: String,
      default: null,
    },

    // An upgrade/downgrade does not mutate the token — Google issues a NEW one
    // and points it back at the old via linkedPurchaseToken. Recording the link
    // lets us retire the superseded row instead of leaving two live
    // subscriptions for one user.
    linkedPurchaseToken: {
      type: String,
      default: null,
      trim: true,
    },
    // Set when a newer token supersedes this one. A superseded row never grants
    // entitlement again regardless of the state Play last reported for it.
    supersededAt: {
      type: Date,
      default: null,
    },

    latestOrderId: {
      type: String,
      default: null,
      trim: true,
    },

    state: {
      type: String,
      enum: SUBSCRIPTION_STATE_VALUES,
      default: SUBSCRIPTION_STATES.PENDING,
      required: true,
    },
    // Mirrors Play's raw subscriptionState string. Kept for support/debugging
    // so an unmapped future state is visible rather than silently normalised.
    playState: {
      type: String,
      default: null,
    },

    autoRenewing: {
      type: Boolean,
      default: false,
    },
    // True once the user has cancelled but before expiry — the window where
    // PRO must REMAIN active because the time is already paid for.
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },

    startTime: {
      type: Date,
      default: null,
    },
    // Play's authoritative paid-through date. This — never anything the client
    // sends — is what drives entitlement.
    expiryTime: {
      type: Date,
      default: null,
      index: true,
    },

    // Phase 6. Google auto-refunds an unacknowledged subscription purchase
    // after 3 days, so this is not bookkeeping — an unacknowledged purchase is
    // money that gets taken back.
    acknowledged: {
      type: Boolean,
      default: false,
    },
    acknowledgedAt: {
      type: Date,
      default: null,
    },
    acknowledgementAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastAcknowledgementError: {
      type: String,
      default: null,
    },

    // Licence-tester purchases. Surfaced so a test subscription can never be
    // mistaken for revenue in reporting, and so support can tell them apart.
    testPurchase: {
      type: Boolean,
      default: false,
    },

    // Phase 9. The HMAC of the Edgecipline user id we handed to Play at
    // purchase time, echoed back by the API. Verifying it is what proves the
    // purchase was started by the account now claiming it.
    obfuscatedAccountId: {
      type: String,
      default: null,
    },
    // Set when the echoed identifier did NOT match the claiming user. The
    // purchase is still recorded (we must never lose a real payment) but it is
    // flagged for a human rather than silently trusted.
    accountMismatchAt: {
      type: Date,
      default: null,
    },

    regionCode: {
      type: String,
      default: null,
    },

    // ─── Ordering guards (Phase 7 / Phase 8) ──────────────────────────────
    //
    // Every write re-reads the authoritative state from the Play API first, so
    // the payload is always fresh AT FETCH TIME. What is not guaranteed is the
    // order two concurrent handlers reach the database: a renewal fetched at
    // T1 can land after a cancellation fetched at T2 > T1, leaving us holding
    // the older truth. `lastSyncedAt` is the fetch timestamp and every write is
    // conditional on it not going backwards, which makes the last WRITE the
    // freshest FETCH rather than merely the latest arrival.
    lastSyncedAt: {
      type: Date,
      default: null,
    },
    // Google's own clock for the notification that triggered the sync.
    // Informational, and used to spot out-of-order RTDN delivery in logs.
    lastEventTimeMillis: {
      type: Number,
      default: 0,
    },
    lastNotificationType: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// One live subscription per user. Partial so the detached (user: null) rows
// left behind by account deletion do not all collide with each other.
playSubscriptionSchema.index(
  { user: 1, supersededAt: 1, expiryTime: -1 },
  {
    name: "play_user_active",
    partialFilterExpression: { user: { $type: "objectId" } },
  }
);

// Drives the linked-token retirement lookup on upgrade/downgrade.
playSubscriptionSchema.index(
  { linkedPurchaseToken: 1 },
  {
    name: "play_linked_token",
    partialFilterExpression: { linkedPurchaseToken: { $type: "string" } },
  }
);

// Reconciliation sweep: purchases that were verified but never acknowledged.
// Google refunds these after 3 days, so they need to be found quickly.
playSubscriptionSchema.index(
  { acknowledged: 1, createdAt: 1 },
  {
    name: "play_unacknowledged",
    partialFilterExpression: { acknowledged: false },
  }
);

module.exports = mongoose.model("PlaySubscription", playSubscriptionSchema);
